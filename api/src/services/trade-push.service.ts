/**
 * 交易推送服务
 * 订阅 Longbridge SDK 交易推送，实时更新订单状态和缓存
 */

import { getTradeContext } from '../config/longport';
import { logger } from '../utils/logger';
import strategyScheduler from './strategy-scheduler.service';
import basicExecutionService from './basic-execution.service';
import orderPreventionMetrics from './order-prevention-metrics.service';

class TradePushService {
  private isSubscribed: boolean = false;
  private tradeContext: any = null;

  /**
   * 初始化交易推送
   */
  async initialize(): Promise<void> {
    try {
      const tradeCtx = await getTradeContext();
      this.tradeContext = tradeCtx;

      // 设置订单变更回调
      // 注意：Node.js SDK 的方法名可能是 setOnOrderChanged 或 onOrderChanged
      // 根据文档：https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#setonorderchanged
      if (tradeCtx.setOnOrderChanged) {
        tradeCtx.setOnOrderChanged((err: Error, event: any) => {
          this.handleOrderChanged(err, event);
        });
      } else if (tradeCtx.onOrderChanged) {
        tradeCtx.onOrderChanged((err: Error, event: any) => {
          this.handleOrderChanged(err, event);
        });
      } else {
        logger.warn('[交易推送] TradeContext 不支持 setOnOrderChanged 方法，可能SDK版本不匹配');
        return;
      }

      // 订阅交易推送（TopicType.Private）
      // 根据文档：https://open.longbridge.com/zh-CN/docs/trade/trade-push
      const longport = require('longport');
      const { TopicType } = longport;

      if (tradeCtx.subscribe) {
        await tradeCtx.subscribe([TopicType.Private]);
        this.isSubscribed = true;
        logger.log('[交易推送] 已订阅交易推送 (TopicType.Private)');
      } else {
        logger.warn('[交易推送] TradeContext 不支持 subscribe 方法，可能SDK版本不匹配');
      }
    } catch (error: any) {
      logger.error('[交易推送] 初始化失败:', error);
      // 不抛出错误，允许系统继续运行（降级到轮询模式）
    }
  }

  /**
   * 处理订单变更事件
   */
  private handleOrderChanged(err: Error | null, event: any): void {
    if (err) {
      logger.error('[交易推送] 订单变更推送错误:', err);
      orderPreventionMetrics.recordTradePush(false);
      return;
    }
    
    // 记录监控指标
    orderPreventionMetrics.recordTradePush(true);

    try {
      // 解析推送事件
      // 根据 Longbridge SDK 文档，PushOrderChanged 事件包含：
      // - orderId: 订单ID
      // - symbol: 标的代码
      // - side: 买卖方向
      // - status: 订单状态
      // - executedQuantity: 已成交数量
      // - executedPrice: 成交价格
      // - strategyId: 策略ID（如果有）
      
      const orderId = event.orderId || event.order_id;
      const symbol = event.symbol || event.stock_name;
      const side = event.side;
      const status = event.status;
      const executedQuantity = event.executedQuantity || event.executed_quantity || 0;
      const executedPrice = event.executedPrice || event.executed_price;
      const strategyId = event.strategyId || event.strategy_id;

      if (!orderId || !symbol) {
        logger.warn('[交易推送] 订单变更事件缺少必要字段:', JSON.stringify(event));
        return;
      }

      logger.log(`[交易推送] 收到订单变更: ${symbol}, 订单ID=${orderId}, 状态=${status}, 已成交=${executedQuantity}`);

      // 标准化订单方向
      const isSell = side === 'Sell' || side === 2 || side === 'SELL' || side === 'sell';
      const action = isSell ? 'SELL' : 'BUY';

      // 更新订单提交缓存（立即更新，避免重复提交）
      // 注意：markOrderSubmitted 是私有方法，需要通过其他方式更新缓存
      // 这里暂时记录日志，实际的缓存更新在订单提交时完成
      if (strategyId) {
        logger.debug(`[交易推送] 订单已提交: ${strategyId}:${symbol}:${action}, 订单ID=${orderId}`);
        // 实际的缓存更新在 BasicExecutionService.submitOrder 成功后完成
      }

      // 订单状态变更时，立即更新可用持仓计算
      // 如果订单已成交或已拒绝，需要重新计算可用持仓
      const completedStatuses = ['FilledStatus', 'PartialFilledStatus', 'RejectedStatus', 'CanceledStatus'];
      const normalizedStatus = this.normalizeStatus(status);
      
      if (completedStatuses.includes(normalizedStatus)) {
        // 订单已完成，立即重新计算可用持仓（异步执行，不阻塞）
        basicExecutionService.calculateAvailablePosition(symbol)
          .then(positionInfo => {
            logger.log(`[交易推送] 订单完成后重新计算可用持仓: ${symbol}, 可用持仓=${positionInfo.availableQuantity}`);
          })
          .catch(error => {
            logger.error(`[交易推送] 重新计算可用持仓失败 (${symbol}):`, error);
          });
      }

      // 订单拒绝时，立即释放资金和持仓占用
      if (normalizedStatus === 'RejectedStatus') {
        logger.warn(`[交易推送] 订单被拒绝: ${symbol}, 订单ID=${orderId}, 需要释放资金和持仓占用`);
        // 这里可以触发资金释放逻辑（如果需要）
        // 注意：资金释放逻辑应该在订单追踪服务中处理
      }
    } catch (error: any) {
      logger.error('[交易推送] 处理订单变更事件失败:', error);
    }
  }

  /**
   * 标准化订单状态
   */
  private normalizeStatus(status: any): string {
    if (status === null || status === undefined) return 'Unknown';
    
    if (typeof status === 'string') {
      // 如果已经是完整的枚举值名称，直接返回
      if (status.includes('Status') || status.includes('Reported') || status.includes('To')) {
        return status;
      }
      
      // 简写形式映射
      const statusMap: Record<string, string> = {
        'Filled': 'FilledStatus',
        'PartialFilled': 'PartialFilledStatus',
        'New': 'NewStatus',
        'Canceled': 'CanceledStatus',
        'Rejected': 'RejectedStatus',
      };
      return statusMap[status] || status;
    }
    
    return status.toString();
  }

  /**
   * 取消订阅交易推送
   */
  async unsubscribe(): Promise<void> {
    try {
      if (this.tradeContext && this.tradeContext.unsubscribe) {
        const longport = require('longport');
        const { TopicType } = longport;
        await this.tradeContext.unsubscribe([TopicType.Private]);
        this.isSubscribed = false;
        logger.log('[交易推送] 已取消订阅交易推送');
      }
    } catch (error: any) {
      logger.error('[交易推送] 取消订阅失败:', error);
    }
  }

  /**
   * 检查是否已订阅
   */
  isActive(): boolean {
    return this.isSubscribed;
  }
}

// 导出单例
export default new TradePushService();

