/**
 * 交易推送服务
 * 订阅 Longbridge SDK 交易推送，实时更新订单状态和缓存
 */

import { getTradeContext } from '../config/longport';
import { logger } from '../utils/logger';
import strategyScheduler from './strategy-scheduler.service';
import basicExecutionService from './basic-execution.service';
import orderPreventionMetrics from './order-prevention-metrics.service';
import pool from '../config/database';

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
  private async handleOrderChanged(err: Error | null, event: any): Promise<void> {
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

      // 标准化订单状态
      const normalizedStatus = this.normalizeStatus(status);
      const dbStatus = this.mapStatusToDbStatus(normalizedStatus);

      // ✅ 修复BUG 1: 更新数据库订单状态（只在状态发生变化时更新，避免竞态条件）
      try {
        const updateResult = await pool.query(
          `UPDATE execution_orders 
           SET current_status = $1, updated_at = NOW()
           WHERE order_id = $2 AND current_status != $1`,
          [dbStatus, orderId]
        );
        
        if (updateResult.rowCount && updateResult.rowCount > 0) {
          logger.debug(`[交易推送] 已更新订单状态: ${orderId}, 状态=${dbStatus} (原始状态=${status})`);
        } else {
          logger.debug(`[交易推送] 订单状态未变化: ${orderId}, 当前状态=${dbStatus}`);
        }
      } catch (dbError: any) {
        logger.error(`[交易推送] 更新订单状态失败 (${orderId}):`, dbError);
      }

      // ✅ 修复BUG 2: 更新信号状态（如果订单已完成）
      const completedStatuses = ['FilledStatus', 'PartialFilledStatus', 'RejectedStatus', 'CanceledStatus'];
      if (completedStatuses.includes(normalizedStatus)) {
        try {
          let signalStatus: 'EXECUTED' | 'REJECTED' | 'IGNORED';
          if (normalizedStatus === 'FilledStatus' || normalizedStatus === 'PartialFilledStatus') {
            signalStatus = 'EXECUTED';
          } else if (normalizedStatus === 'RejectedStatus') {
            signalStatus = 'REJECTED';
          } else {
            signalStatus = 'IGNORED';
          }
          
          await basicExecutionService.updateSignalStatusByOrderId(orderId, signalStatus);
          logger.debug(`[交易推送] 已更新信号状态: ${orderId}, 状态=${signalStatus}`);
        } catch (signalError: any) {
          logger.error(`[交易推送] 更新信号状态失败 (${orderId}):`, signalError);
        }

        // 订单已完成，立即重新计算可用持仓（异步执行，不阻塞）
        basicExecutionService.calculateAvailablePosition(symbol)
          .then(positionInfo => {
            logger.log(`[交易推送] 订单完成后重新计算可用持仓: ${symbol}, 可用持仓=${positionInfo.availableQuantity}`);
          })
          .catch(error => {
            logger.error(`[交易推送] 重新计算可用持仓失败 (${symbol}):`, error);
          });
      }

      // ⚠️ 修复：标准化订单方向（区分开仓和平仓）
      const isSell = side === 'Sell' || side === 2 || side === 'SELL' || side === 'sell';
      const isBuy = side === 'Buy' || side === 1 || side === 'BUY' || side === 'buy';
      const action = isSell ? 'SELL' : 'BUY';
      
      // ⚠️ 可选：获取当前持仓判断订单类型（开仓/平仓）
      // 注意：这里不阻塞主流程，只是记录日志
      let orderType: 'OPEN' | 'CLOSE' | 'UNKNOWN' = 'UNKNOWN';
      try {
        const { getTradeContext } = await import('../config/longport');
        const tradeCtx = await getTradeContext();
        const positions = await tradeCtx.stockPositions();
        
        let positionsArray: any[] = [];
        if (positions?.positions) {
          positionsArray = positions.positions;
        } else if (positions?.channels) {
          for (const channel of positions.channels) {
            if (channel.positions) {
              positionsArray.push(...channel.positions);
            }
          }
        }
        
        const position = positionsArray.find((p: any) => p.symbol === symbol);
        const currentQuantity = position ? parseFloat(position.quantity?.toString() || '0') : 0;
        
        if (isSell) {
          orderType = currentQuantity > 0 ? 'CLOSE' : 'OPEN';  // 有做多持仓=平仓，无持仓=卖空
        } else if (isBuy) {
          orderType = currentQuantity < 0 ? 'CLOSE' : 'OPEN';  // 有卖空持仓=平仓，无持仓=做多
        }
      } catch (error) {
        // 忽略错误，不影响主流程
      }

      // 更新订单提交缓存（立即更新，避免重复提交）
      // 注意：markOrderSubmitted 是私有方法，需要通过其他方式更新缓存
      // 这里暂时记录日志，实际的缓存更新在订单提交时完成
      if (strategyId) {
        logger.debug(`[交易推送] 订单已提交: ${strategyId}:${symbol}:${action}(${orderType}), 订单ID=${orderId}`);
        // 实际的缓存更新在 BasicExecutionService.submitOrder 成功后完成
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
   * 映射订单状态到数据库状态
   * ✅ 修复BUG 1: 添加状态映射函数
   */
  private mapStatusToDbStatus(normalizedStatus: string): string {
    const statusMap: Record<string, string> = {
      'FilledStatus': 'FILLED',
      'PartialFilledStatus': 'FILLED',
      'NewStatus': 'NEW',
      'NotReported': 'SUBMITTED',
      'WaitToNew': 'SUBMITTED',
      'PendingReplaceStatus': 'SUBMITTED',
      'WaitToReplace': 'SUBMITTED',
      'CanceledStatus': 'CANCELLED',
      'PendingCancelStatus': 'CANCELLED',
      'WaitToCancel': 'CANCELLED',
      'RejectedStatus': 'FAILED',
      'ExpiredStatus': 'CANCELLED',
    };
    return statusMap[normalizedStatus] || 'SUBMITTED';
  }

  /**
   * 取消订阅交易推送
   * 修复：添加状态检查、错误处理、回调函数清理
   */
  async unsubscribe(): Promise<void> {
    // 如果未订阅，直接返回（幂等性）
    if (!this.isSubscribed) {
      logger.debug('[交易推送] 未订阅，无需取消订阅');
      return;
    }

    try {
      if (!this.tradeContext) {
        logger.warn('[交易推送] TradeContext 不存在，无法取消订阅');
        this.isSubscribed = false;
        return;
      }

      if (!this.tradeContext.unsubscribe) {
        logger.warn('[交易推送] TradeContext 不支持 unsubscribe 方法');
        this.isSubscribed = false;
        return;
      }

      const longport = require('longport');
      const { TopicType } = longport;
      
      // 取消订阅
      await this.tradeContext.unsubscribe([TopicType.Private]);
      
      // 清理回调函数（如果SDK支持）
      if (this.tradeContext.clearOnOrderChanged) {
        this.tradeContext.clearOnOrderChanged();
        logger.debug('[交易推送] 已清理订单变更回调');
      } else if (this.tradeContext.setOnOrderChanged) {
        // 如果SDK不支持清理方法，设置为空函数（避免内存泄漏）
        this.tradeContext.setOnOrderChanged(() => {});
        logger.debug('[交易推送] 已重置订单变更回调');
      }
      
      this.isSubscribed = false;
      logger.log('[交易推送] 已取消订阅交易推送');
    } catch (error: any) {
      logger.error('[交易推送] 取消订阅失败:', error);
      // 即使失败，也设置 isSubscribed 为 false（避免状态不一致）
      this.isSubscribed = false;
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

