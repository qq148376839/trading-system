/**
 * 基础执行器服务
 * 直接调用 Longbridge SDK 进行实盘交易（模拟盘环境）
 */

import { getTradeContext, getQuoteContext, OrderType, OrderSide, TimeInForceType, Decimal, OutsideRTH } from '../config/longport';
import pool from '../config/database';
import { TradingIntent } from './strategies/strategy-base';
import { detectMarket } from '../utils/order-validation';

export interface ExecutionResult {
  success: boolean;
  orderId?: string;
  avgPrice?: number;
  filledQuantity?: number;
  fees?: number; // 实际手续费（从订单详情获取）
  error?: string;
}

class BasicExecutionService {
  /**
   * 执行买入意图
   */
  async executeBuyIntent(
    intent: TradingIntent,
    strategyId: number
  ): Promise<ExecutionResult> {
    if (!intent.quantity || !intent.entryPrice) {
      return {
        success: false,
        error: '缺少数量或价格信息',
      };
    }

    try {
      return await this.submitOrder(
        intent.symbol,
        'BUY',
        intent.quantity,
        intent.entryPrice,
        strategyId
      );
    } catch (error: any) {
      console.error(`执行买入失败 (${intent.symbol}):`, error);
      return {
        success: false,
        error: error.message || '未知错误',
      };
    }
  }

  /**
   * 执行卖出意图
   */
  async executeSellIntent(
    intent: TradingIntent,
    strategyId: number
  ): Promise<ExecutionResult> {
    if (!intent.quantity || !intent.entryPrice) {
      return {
        success: false,
        error: '缺少数量或价格信息',
      };
    }

    try {
      return await this.submitOrder(
        intent.symbol,
        'SELL',
        intent.quantity,
        intent.entryPrice,
        strategyId
      );
    } catch (error: any) {
      console.error(`执行卖出失败 (${intent.symbol}):`, error);
      return {
        success: false,
        error: error.message || '未知错误',
      };
    }
  }

  /**
   * 提交订单（基础实现）
   * 参照 orders.ts 的实现，添加完善的错误处理和参数验证
   */
  private async submitOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
    strategyId: number
  ): Promise<ExecutionResult> {
    try {
      const tradeCtx = await getTradeContext();

      // 1. 验证最小交易单位（lot size）
      try {
        const quoteCtx = await getQuoteContext();
        const staticInfoList = await quoteCtx.staticInfo([symbol]);
        
        if (staticInfoList && staticInfoList.length > 0) {
          const lotSize = staticInfoList[0].lotSize;
          if (lotSize > 0 && quantity % lotSize !== 0) {
            const adjustedQuantity = Math.floor(quantity / lotSize) * lotSize;
            if (adjustedQuantity === 0) {
              return {
                success: false,
                error: `数量不符合最小交易单位要求。最小交易单位为 ${lotSize}，当前数量 ${quantity} 太小`,
              };
            }
            console.warn(`数量 ${quantity} 不符合最小交易单位 ${lotSize}，调整为 ${adjustedQuantity}`);
            quantity = adjustedQuantity;
          }
        }
      } catch (lotSizeError: any) {
        console.warn('获取最小交易单位失败，跳过验证:', lotSizeError.message);
        // 如果获取lot size失败，不阻止订单提交，只记录警告
      }

      // 2. 构建订单参数（参照 orders.ts）
      const orderOptions: any = {
        symbol,
        orderType: OrderType.LO, // 限价单
        side: side === 'BUY' ? OrderSide.Buy : OrderSide.Sell,
        submittedQuantity: quantity,
        submittedPrice: new Decimal(price.toString()),
        timeInForce: TimeInForceType.Day,
      };

      // 3. 添加盘前盘后选项（美股订单需要）
      const market = detectMarket(symbol);
      if (market === 'US') {
        // 美股订单默认允许盘前盘后交易
        orderOptions.outsideRth = OutsideRTH.AnyTime;
      }

      console.log(`策略 ${strategyId} 提交订单:`, {
        symbol,
        side,
        quantity,
        price,
        market,
      });

      // 4. 提交订单
      const response = await tradeCtx.submitOrder(orderOptions);
      
      if (!response || !response.orderId) {
        return {
          success: false,
          error: '订单提交失败：未返回订单ID',
        };
      }

      const orderId = response.orderId;
      console.log(`策略 ${strategyId} 订单提交成功，订单ID: ${orderId}`);

      // 5. 记录订单到数据库
      try {
        await this.recordOrder(strategyId, symbol, side, quantity, price, orderId);
      } catch (dbError: any) {
        console.error(`记录订单到数据库失败 (${orderId}):`, dbError.message);
        // 不阻止后续流程，因为订单已经提交成功
      }

      // 6. 等待订单成交（异步，不阻塞）
      // 注意：这里不等待订单成交，因为订单可能不会立即成交
      // 后续通过定时任务同步订单状态
      const orderDetail = await this.waitForOrderFill(orderId, 10000); // 10秒超时

      // 7. 获取实际手续费
      const fees = await this.getOrderFees(orderId);

      // 8. 记录交易到数据库（如果已成交）
      const normalizedStatus = this.normalizeStatus(orderDetail.status);
      if (normalizedStatus === 'FilledStatus' || normalizedStatus === 'PartialFilledStatus') {
        try {
          await this.recordTrade(strategyId, symbol, side, orderDetail, fees);
        } catch (tradeError: any) {
          console.error(`记录交易到数据库失败 (${orderId}):`, tradeError.message);
        }
      }

      return {
        success: normalizedStatus === 'FilledStatus',
        orderId,
        avgPrice: parseFloat(orderDetail.executedPrice?.toString() || orderDetail.executed_price?.toString() || '0'),
        filledQuantity: parseInt(orderDetail.executedQuantity?.toString() || orderDetail.executed_quantity?.toString() || '0'),
        fees,
      };
    } catch (error: any) {
      console.error(`策略 ${strategyId} 提交订单失败 (${symbol}):`, error);
      
      // 提取错误信息
      let errorMessage = '未知错误';
      if (error.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error.toString) {
        errorMessage = error.toString();
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 获取订单实际手续费
   */
  private async getOrderFees(orderId: string): Promise<number> {
    try {
      const tradeCtx = await getTradeContext();
      const orderDetail = await tradeCtx.orderDetail(orderId);

      // 从 charge_detail 中提取总手续费
      const chargeDetail = (orderDetail as any).chargeDetail || (orderDetail as any).charge_detail;
      if (chargeDetail && chargeDetail.total_amount) {
        return parseFloat(chargeDetail.total_amount.toString());
      }

      // 如果没有 charge_detail，返回 0（后续会通过估算补充）
      return 0;
    } catch (error: any) {
      console.error(`获取订单手续费失败 (${orderId}):`, error);
      return 0;
    }
  }

  /**
   * 等待订单成交
   */
  private async waitForOrderFill(
    orderId: string,
    timeout: number = 10000 // 10秒超时（减少等待时间，避免阻塞）
  ): Promise<any> {
    try {
      const tradeCtx = await getTradeContext();
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        try {
          const order = await tradeCtx.orderDetail(orderId);
          const status = this.normalizeStatus(order.status);

          if (status === 'FilledStatus' || status === 'PartialFilledStatus') {
            return order;
          }

          if (status === 'CanceledStatus' || status === 'RejectedStatus') {
            // 订单已取消或拒绝，返回订单详情而不是抛出错误
            return order;
          }

          // 等待 2 秒后再次查询
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (queryError: any) {
          // 如果查询订单详情失败，记录错误但继续重试
          console.warn(`查询订单详情失败 (${orderId}):`, queryError.message);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      // 超时，返回当前状态（如果可能）
      try {
        const tradeCtx = await getTradeContext();
        return await tradeCtx.orderDetail(orderId);
      } catch (error: any) {
        // 如果查询失败，返回一个基本结构
        console.warn(`超时后查询订单详情失败 (${orderId}):`, error.message);
        return {
          orderId,
          status: 'NewStatus', // 假设是新订单状态
          executedPrice: null,
          executedQuantity: 0,
        };
      }
    } catch (error: any) {
      console.error(`等待订单成交失败 (${orderId}):`, error);
      // 返回一个基本结构，避免后续代码崩溃
      return {
        orderId,
        status: 'Unknown',
        executedPrice: null,
        executedQuantity: 0,
      };
    }
  }

  /**
   * 标准化订单状态
   */
  private normalizeStatus(status: any): string {
    if (typeof status === 'string') {
      // 如果是简写形式，转换为完整形式
      const statusMap: Record<string, string> = {
        'Filled': 'FilledStatus',
        'PartialFilled': 'PartialFilledStatus',
        'New': 'NewStatus',
        'Canceled': 'CanceledStatus',
        'Rejected': 'RejectedStatus',
      };
      return statusMap[status] || status;
    }
    return String(status);
  }

  /**
   * 记录订单到数据库
   */
  private async recordOrder(
    strategyId: number,
    symbol: string,
    side: string,
    quantity: number,
    price: number,
    orderId: string
  ): Promise<void> {
    await pool.query(
      `INSERT INTO execution_orders 
       (strategy_id, symbol, order_id, side, quantity, price, current_status, execution_stage)
       VALUES ($1, $2, $3, $4, $5, $6, 'SUBMITTED', 1)`,
      [strategyId, symbol, orderId, side, quantity, price]
    );
  }

  /**
   * 记录交易到数据库
   */
  private async recordTrade(
    strategyId: number,
    symbol: string,
    side: string,
    orderDetail: any,
    fees: number
  ): Promise<void> {
    const avgPrice = parseFloat(orderDetail.executedPrice?.toString() || '0');
    const filledQuantity = parseInt(orderDetail.executedQuantity?.toString() || '0');
    const status = this.normalizeStatus(orderDetail.status);
    const orderId = orderDetail.orderId || orderDetail.order_id;

    // 判断是开仓还是平仓
    const existingTrade = await pool.query(
      `SELECT id FROM auto_trades 
       WHERE strategy_id = $1 AND symbol = $2 AND side = $3 AND close_time IS NULL
       ORDER BY open_time DESC LIMIT 1`,
      [strategyId, symbol, side === 'BUY' ? 'SELL' : 'BUY'] // 平仓时 side 相反
    );

    if (existingTrade.rows.length > 0 && side === 'SELL') {
      // 平仓：更新现有交易记录
      const tradeId = existingTrade.rows[0].id;
      const openTrade = await pool.query(
        'SELECT avg_price, quantity FROM auto_trades WHERE id = $1',
        [tradeId]
      );

      if (openTrade.rows.length > 0) {
        const openPrice = parseFloat(openTrade.rows[0].avg_price);
        const openQuantity = parseInt(openTrade.rows[0].quantity);
        const pnl = (avgPrice - openPrice) * Math.min(filledQuantity, openQuantity);

        await pool.query(
          `UPDATE auto_trades 
           SET close_time = NOW(), pnl = $1, fees = $2, status = $3
           WHERE id = $4`,
          [pnl, fees, status === 'FilledStatus' ? 'FILLED' : 'PARTIALLY_FILLED', tradeId]
        );
      }
    } else {
      // 开仓：插入新交易记录
      await pool.query(
        `INSERT INTO auto_trades 
         (strategy_id, symbol, side, quantity, avg_price, fees, status, order_id, open_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          strategyId,
          symbol,
          side,
          filledQuantity,
          avgPrice,
          fees,
          status === 'FilledStatus' ? 'FILLED' : 'PARTIALLY_FILLED',
          orderId,
        ]
      );
    }

    // 更新订单状态
    await pool.query(
      `UPDATE execution_orders 
       SET current_status = $1, updated_at = NOW()
       WHERE order_id = $2`,
      [status, orderId]
    );
  }
}

// 导出单例
export default new BasicExecutionService();

