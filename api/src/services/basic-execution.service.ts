/**
 * 基础执行器服务
 * 直接调用 Longbridge SDK 进行实盘交易（模拟盘环境）
 */

import { getTradeContext, getQuoteContext, OrderType, OrderSide, TimeInForceType, Decimal, OutsideRTH } from '../config/longport';
import pool from '../config/database';
import { TradingIntent } from './strategies/strategy-base';
import { detectMarket } from '../utils/order-validation';
import { logger } from '../utils/logger';
import { normalizeSide } from '../routes/orders';

export interface ExecutionResult {
  success: boolean;
  orderId?: string;
  avgPrice?: number;
  filledQuantity?: number;
  fees?: number; // 实际手续费（从订单详情获取）
  error?: string;
  orderStatus?: string; // 订单状态：FilledStatus, NewStatus, RejectedStatus 等
  submitted?: boolean; // 订单是否已成功提交到交易所
}

class BasicExecutionService {
  /**
   * 验证买入价格的合理性
   * @param buyPrice 买入价格
   * @param currentPrice 当前市场价格
   * @param symbol 标的代码
   * @returns 验证结果
   */
  private validateBuyPrice(
    buyPrice: number,
    currentPrice: number | null,
    symbol: string
  ): { valid: boolean; warning?: string; error?: string } {
    // 基础验证：价格必须大于0
    if (buyPrice <= 0) {
      return {
        valid: false,
        error: `买入价格无效: ${buyPrice}`,
      };
    }

    // 如果无法获取当前市场价格，跳过价格偏差验证（记录警告）
    if (currentPrice === null || currentPrice <= 0) {
      logger.warn(`无法获取${symbol}的当前市场价格，跳过价格偏差验证`);
      return { valid: true };
    }

    // 计算价格偏差百分比
    const priceDeviation = Math.abs((buyPrice - currentPrice) / currentPrice) * 100;

    // 偏差超过5%：拒绝订单（买入价格偏差应该更严格）
    if (priceDeviation > 5) {
      return {
        valid: false,
        error: `买入价格偏差过大: ${buyPrice.toFixed(2)} vs 市场价格 ${currentPrice.toFixed(2)} (偏差${priceDeviation.toFixed(2)}%)`,
      };
    }

    // 偏差在1%-5%之间：记录警告，但仍允许提交（限价单允许一定偏差）
    if (priceDeviation > 1) {
      return {
        valid: true,
        warning: `买入价格偏差较大: ${buyPrice.toFixed(2)} vs 市场价格 ${currentPrice.toFixed(2)} (偏差${priceDeviation.toFixed(2)}%)`,
      };
    }

    return { valid: true };
  }

  /**
   * 执行买入意图
   * 
   * 价格使用逻辑：
   * - entryPrice: 买入价格（限价单价格）
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

    // 价格验证：获取当前市场价格并验证合理性
    const currentPrice = await this.getCurrentMarketPrice(intent.symbol);
    const priceValidation = this.validateBuyPrice(intent.entryPrice, currentPrice, intent.symbol);
    
    if (!priceValidation.valid) {
      logger.error(`策略 ${strategyId} 标的 ${intent.symbol}: 价格验证失败 - ${priceValidation.error}`);
      // 如果价格验证失败，更新信号状态为REJECTED
      const signalId = (intent.metadata as any)?.signalId;
      if (signalId) {
        await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
      }
      return {
        success: false,
        error: priceValidation.error || '价格验证失败',
      };
    }

    // 如果有警告，记录日志
    if (priceValidation.warning) {
      logger.warn(`策略 ${strategyId} 标的 ${intent.symbol}: ${priceValidation.warning}`);
    }

    // 记录价格信息，便于调试和问题追踪
    logger.log(`策略 ${strategyId} 执行买入意图: ` +
      `标的=${intent.symbol}, ` +
      `数量=${intent.quantity}, ` +
      `买入价(entryPrice)=${intent.entryPrice.toFixed(2)}, ` +
      `市场价格=${currentPrice?.toFixed(2) || 'N/A'}, ` +
      `原因=${intent.reason}`);

    // 从intent.metadata中获取signal_id
    const signalId = (intent.metadata as any)?.signalId;

    try {
      return await this.submitOrder(
        intent.symbol,
        'BUY',
        intent.quantity,
        intent.entryPrice, // ✅ 买入时entryPrice就是买入价格
        strategyId,
        signalId  // 新增参数：信号ID
      );
    } catch (error: any) {
      logger.error(`执行买入失败 (${intent.symbol}):`, error);
      // 如果订单提交失败，更新信号状态为REJECTED
      if (signalId) {
        await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
      }
      return {
        success: false,
        error: error.message || '未知错误',
      };
    }
  }

  /**
   * 验证卖出价格的合理性
   * @param sellPrice 卖出价格
   * @param currentPrice 当前市场价格
   * @param symbol 标的代码
   * @returns 验证结果
   */
  private validateSellPrice(
    sellPrice: number,
    currentPrice: number | null,
    symbol: string
  ): { valid: boolean; warning?: string; error?: string } {
    // 基础验证：价格必须大于0
    if (sellPrice <= 0) {
      return {
        valid: false,
        error: `卖出价格无效: ${sellPrice}`,
      };
    }

    // 如果无法获取当前市场价格，跳过价格偏差验证（记录警告）
    if (currentPrice === null || currentPrice <= 0) {
      logger.warn(`无法获取${symbol}的当前市场价格，跳过价格偏差验证`);
      return { valid: true };
    }

    // 计算价格偏差百分比
    const priceDeviation = Math.abs((sellPrice - currentPrice) / currentPrice) * 100;

    // 偏差超过20%：拒绝订单
    if (priceDeviation > 20) {
      return {
        valid: false,
        error: `卖出价格偏差过大: ${sellPrice.toFixed(2)} vs 市场价格 ${currentPrice.toFixed(2)} (偏差${priceDeviation.toFixed(2)}%)`,
      };
    }

    // 偏差在5%-20%之间：记录警告，但仍允许提交
    if (priceDeviation > 5) {
      return {
        valid: true,
        warning: `卖出价格偏差较大: ${sellPrice.toFixed(2)} vs 市场价格 ${currentPrice.toFixed(2)} (偏差${priceDeviation.toFixed(2)}%)`,
      };
    }

    return { valid: true };
  }

  /**
   * 获取当前市场价格（用于价格验证）
   */
  private async getCurrentMarketPrice(symbol: string): Promise<number | null> {
    try {
      const { getQuoteContext } = await import('../config/longport');
      const quoteCtx = await getQuoteContext();
      const quotes = await quoteCtx.quote([symbol]);
      
      if (quotes && quotes.length > 0) {
        const quote = quotes[0];
        const price = parseFloat(quote.lastDone?.toString() || quote.last_done?.toString() || '0');
        if (price > 0) {
          return price;
        }
      }
      return null;
    } catch (error: any) {
      logger.warn(`获取${symbol}当前市场价格失败:`, error.message);
      return null;
    }
  }

  /**
   * 执行卖出意图
   * 
   * 价格使用逻辑：
   * - 平仓场景：优先使用sellPrice（当前市场价格），entryPrice用于记录买入价格
   * - 做空场景：使用entryPrice（做空价格），sellPrice不使用
   */
  async executeSellIntent(
    intent: TradingIntent,
    strategyId: number
  ): Promise<ExecutionResult> {
    // 验证必要参数
    if (!intent.quantity) {
      return {
        success: false,
        error: '缺少数量信息',
      };
    }

    // 确定卖出价格
    // 优先级：sellPrice > entryPrice
    // sellPrice: 用于平仓场景（推荐）
    // entryPrice: 用于做空场景（fallback）
    const sellPrice = intent.sellPrice || intent.entryPrice;
    
    if (!sellPrice || sellPrice <= 0) {
      return {
        success: false,
        error: `缺少有效的卖出价格信息 (sellPrice=${intent.sellPrice}, entryPrice=${intent.entryPrice})`,
      };
    }

    // 价格验证：获取当前市场价格并验证合理性
    const currentPrice = await this.getCurrentMarketPrice(intent.symbol);
    const priceValidation = this.validateSellPrice(sellPrice, currentPrice, intent.symbol);
    
    if (!priceValidation.valid) {
      logger.error(`策略 ${strategyId} 标的 ${intent.symbol}: 价格验证失败 - ${priceValidation.error}`);
      return {
        success: false,
        error: priceValidation.error || '价格验证失败',
      };
    }

    // 如果有警告，记录日志
    if (priceValidation.warning) {
      logger.warn(`策略 ${strategyId} 标的 ${intent.symbol}: ${priceValidation.warning}`);
    }

    // 记录价格信息，便于调试和问题追踪
    logger.log(`策略 ${strategyId} 执行卖出意图: ` +
      `标的=${intent.symbol}, ` +
      `数量=${intent.quantity}, ` +
      `卖出价=${sellPrice.toFixed(2)}, ` +
      `买入价(entryPrice)=${intent.entryPrice?.toFixed(2) || 'N/A'}, ` +
      `市场价格=${currentPrice?.toFixed(2) || 'N/A'}, ` +
      `原因=${intent.reason}`);

    // 从intent.metadata中获取signal_id
    const signalId = (intent.metadata as any)?.signalId;

    try {
      return await this.submitOrder(
        intent.symbol,
        'SELL',
        intent.quantity,
        sellPrice, // ✅ 使用正确的卖出价格
        strategyId,
        signalId  // 新增参数：信号ID
      );
    } catch (error: any) {
      logger.error(`执行卖出失败 (${intent.symbol}):`, error);
      // 如果订单提交失败，更新信号状态为REJECTED
      if (signalId) {
        await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
      }
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
            logger.warn(`数量 ${quantity} 不符合最小交易单位 ${lotSize}，调整为 ${adjustedQuantity}`);
            quantity = adjustedQuantity;
          }
        }
      } catch (lotSizeError: any) {
        logger.warn('获取最小交易单位失败，跳过验证:', lotSizeError.message);
        // 如果获取lot size失败，不阻止订单提交，只记录警告
      }

      // 2. 格式化价格（根据市场确定小数位数）
      const market = detectMarket(symbol);
      let formattedPrice: number;
      
      if (market === 'US') {
        // 美股：保留2位小数
        formattedPrice = Math.round(price * 100) / 100;
      } else if (market === 'HK') {
        // 港股：保留3位小数
        formattedPrice = Math.round(price * 1000) / 1000;
      } else {
        // 其他市场：保留2位小数
        formattedPrice = Math.round(price * 100) / 100;
      }

      // 确保价格大于0
      if (formattedPrice <= 0) {
        return {
          success: false,
          error: `价格无效: ${price} -> ${formattedPrice}`,
        };
      }

      // 3. 构建订单参数（参照 orders.ts）
      const orderOptions: any = {
        symbol,
        orderType: OrderType.LO, // 限价单
        side: side === 'BUY' ? OrderSide.Buy : OrderSide.Sell,
        submittedQuantity: quantity,
        submittedPrice: new Decimal(formattedPrice.toString()),
        timeInForce: TimeInForceType.Day,
      };

      // 4. 添加盘前盘后选项（美股订单需要）
      if (market === 'US') {
        // 美股订单默认允许盘前盘后交易
        orderOptions.outsideRth = OutsideRTH.AnyTime;
      }

      logger.log(`策略 ${strategyId} 提交订单:`, {
        symbol,
        side,
        quantity,
        originalPrice: price,
        formattedPrice: formattedPrice,
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
      logger.log(`策略 ${strategyId} 订单提交成功，订单ID: ${orderId}`);

      // 5. 记录订单到数据库
      try {
        await this.recordOrder(strategyId, symbol, side, quantity, price, orderId, signalId);
      } catch (dbError: any) {
        logger.error(`记录订单到数据库失败 (${orderId}):`, dbError.message);
        // 不阻止后续流程，因为订单已经提交成功
      }

      // 6. 如果订单提交成功，更新信号状态为EXECUTED
      if (signalId) {
        try {
          await this.updateSignalStatusBySignalId(signalId, 'EXECUTED');
        } catch (signalError: any) {
          logger.warn(`更新信号状态失败 (signalId: ${signalId}, orderId: ${orderId}):`, signalError.message);
          // 不阻止后续流程
        }
      }

      // 7. 等待订单成交（异步，不阻塞）
      // 注意：这里不等待订单成交，因为订单可能不会立即成交
      // 后续通过定时任务同步订单状态
      const orderDetail = await this.waitForOrderFill(orderId, 10000); // 10秒超时

      // 8. 如果订单已成交，确认信号状态为EXECUTED
      const normalizedStatus = this.normalizeStatus(orderDetail.status);
      if (normalizedStatus === 'FilledStatus' || normalizedStatus === 'PartialFilledStatus') {
        if (signalId) {
          try {
            await this.updateSignalStatusBySignalId(signalId, 'EXECUTED');
          } catch (signalError: any) {
            logger.warn(`确认信号状态失败 (signalId: ${signalId}, orderId: ${orderId}):`, signalError.message);
          }
        }
      } else if (normalizedStatus === 'RejectedStatus') {
        // 如果订单被拒绝，更新信号状态为REJECTED
        if (signalId) {
          try {
            await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
          } catch (signalError: any) {
            logger.warn(`更新信号状态为REJECTED失败 (signalId: ${signalId}, orderId: ${orderId}):`, signalError.message);
          }
        }
      } else if (normalizedStatus === 'CanceledStatus' || normalizedStatus === 'PendingCancelStatus') {
        // 如果订单被取消，更新信号状态为IGNORED
        if (signalId) {
          try {
            await this.updateSignalStatusBySignalId(signalId, 'IGNORED');
          } catch (signalError: any) {
            logger.warn(`更新信号状态为IGNORED失败 (signalId: ${signalId}, orderId: ${orderId}):`, signalError.message);
          }
        }
      }

      // 9. 获取实际手续费
      const fees = await this.getOrderFees(orderId);

      // 10. 记录交易到数据库（如果已成交）
      if (normalizedStatus === 'FilledStatus' || normalizedStatus === 'PartialFilledStatus') {
        try {
          await this.recordTrade(strategyId, symbol, side, orderDetail, fees);
        } catch (tradeError: any) {
          logger.error(`记录交易到数据库失败 (${orderId}):`, tradeError.message);
        }
      }

      // 判断订单是否已成交
      const isFilled = normalizedStatus === 'FilledStatus';
      const isRejected = normalizedStatus === 'RejectedStatus' || normalizedStatus === 'CanceledStatus';
      
      return {
        success: isFilled,
        orderId,
        avgPrice: parseFloat(orderDetail.executedPrice?.toString() || orderDetail.executed_price?.toString() || '0'),
        filledQuantity: parseInt(orderDetail.executedQuantity?.toString() || orderDetail.executed_quantity?.toString() || '0'),
        fees,
        orderStatus: normalizedStatus,
        submitted: true, // 订单已成功提交到交易所
        // 如果订单被拒绝或取消，设置错误信息
        error: isRejected ? `订单状态: ${normalizedStatus}` : undefined,
      };
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 提交订单失败 (${symbol}):`, error);
      
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
      logger.error(`获取订单手续费失败 (${orderId}):`, error);
      return 0;
    }
  }

  /**
   * 等待订单成交
   * 使用 todayOrders() 批量查询，避免频率限制
   */
  private async waitForOrderFill(
    orderId: string,
    timeout: number = 10000 // 10秒超时（减少等待时间，避免阻塞）
  ): Promise<any> {
    try {
      const tradeCtx = await getTradeContext();
      const startTime = Date.now();
      let lastError: any = null;

      while (Date.now() - startTime < timeout) {
        try {
          // 使用批量查询 todayOrders() 替代单个订单查询，避免频率限制
          const todayOrders = await tradeCtx.todayOrders({});
          
          // 从批量结果中查找目标订单
          const order = this.findOrderInList(todayOrders, orderId);
          
          if (order) {
            const status = this.normalizeStatus(order.status);

            if (status === 'FilledStatus' || status === 'PartialFilledStatus') {
              return order;
            }

            if (status === 'CanceledStatus' || status === 'RejectedStatus') {
              // 订单已取消或拒绝，返回订单详情而不是抛出错误
              return order;
            }
          } else {
            // 订单不在今日订单列表中，可能是新订单还未同步，继续等待
            logger.log(`订单 ${orderId} 尚未出现在今日订单列表中，继续等待...`);
          }

          // 等待 2 秒后再次查询
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (queryError: any) {
          // 如果查询失败，记录错误但继续重试
          lastError = queryError;
          
          // 如果是频率限制错误，延长等待时间
          if (queryError.message && (queryError.message.includes('429') || queryError.message.includes('429002'))) {
            logger.warn(`订单查询频率限制，等待更长时间后重试 (${orderId})`);
            await new Promise((resolve) => setTimeout(resolve, 5000)); // 等待5秒
          } else {
            logger.warn(`批量查询今日订单失败 (${orderId}):`, queryError.message);
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      // 超时，尝试最后一次批量查询
      try {
        const tradeCtx = await getTradeContext();
        const todayOrders = await tradeCtx.todayOrders({});
        const order = this.findOrderInList(todayOrders, orderId);
        
        if (order) {
          return order;
        }
      } catch (error: any) {
        logger.warn(`超时后批量查询订单失败 (${orderId}):`, error.message);
      }

      // 如果查询失败，返回一个基本结构
      logger.warn(`订单 ${orderId} 查询超时，返回默认状态`);
      return {
        orderId,
        status: 'NewStatus', // 假设是新订单状态
        executedPrice: null,
        executedQuantity: 0,
      };
    } catch (error: any) {
      logger.error(`等待订单成交失败 (${orderId}):`, error);
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
   * 从订单列表中查找指定订单
   */
  private findOrderInList(orders: any, orderId: string): any | null {
    if (!orders) return null;

    // 处理不同的返回格式
    let orderList: any[] = [];
    
    if (Array.isArray(orders)) {
      orderList = orders;
    } else if (orders.orders && Array.isArray(orders.orders)) {
      orderList = orders.orders;
    } else if (orders.list && Array.isArray(orders.list)) {
      orderList = orders.list;
    }

    // 查找匹配的订单
    for (const order of orderList) {
      const id = order.orderId || order.order_id || order.id;
      if (id && id.toString() === orderId.toString()) {
        return order;
      }
    }

    return null;
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
    orderId: string,
    signalId?: number
  ): Promise<void> {
    await pool.query(
      `INSERT INTO execution_orders 
       (strategy_id, symbol, order_id, side, quantity, price, current_status, execution_stage, signal_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'SUBMITTED', 1, $7)`,
      [strategyId, symbol, orderId, side, quantity, price, signalId || null]
    );
  }

  /**
   * 根据信号ID更新信号状态
   */
  private async updateSignalStatusBySignalId(
    signalId: number,
    status: 'EXECUTED' | 'REJECTED' | 'IGNORED'
  ): Promise<void> {
    try {
      const result = await pool.query(
        'UPDATE strategy_signals SET status = $1 WHERE id = $2',
        [status, signalId]
      );
      
      if (result.rowCount === 0) {
        logger.warn(`未找到信号 ${signalId}`);
      } else {
        logger.debug(`信号 ${signalId} 状态已更新为 ${status}`);
      }
    } catch (error: any) {
      logger.error(`更新信号状态失败 (signalId: ${signalId}):`, error);
      throw error;
    }
  }

  /**
   * 根据订单ID更新信号状态（通过signal_id关联）
   */
  async updateSignalStatusByOrderId(
    orderId: string,
    status: 'EXECUTED' | 'REJECTED' | 'IGNORED'
  ): Promise<void> {
    try {
      // First, try to update using signal_id (for new orders)
      let result = await pool.query(
        `UPDATE strategy_signals 
         SET status = $1 
         WHERE id IN (
           SELECT signal_id FROM execution_orders 
           WHERE order_id = $2 AND signal_id IS NOT NULL
         )`,
        [status, orderId]
      );
      
      // If no signal was updated and order doesn't have signal_id, try time window matching (for historical orders)
      if (result.rowCount === 0) {
        // Get order information
        const orderResult = await pool.query(
          `SELECT strategy_id, symbol, side, created_at, signal_id
           FROM execution_orders 
           WHERE order_id = $1`,
          [orderId]
        );
        
        if (orderResult.rows.length === 0) {
          logger.warn(`未找到订单 ${orderId}`);
          return;
        }
        
        const order = orderResult.rows[0];
        
        // If order already has signal_id but signal wasn't found, skip
        if (order.signal_id) {
          logger.warn(`订单 ${orderId} 有 signal_id=${order.signal_id}，但信号不存在`);
          return;
        }
        
        // Try time window matching (fallback for historical orders)
        const orderSide = normalizeSide(order.side);
        const orderTime = new Date(order.created_at);
        const timeWindowStart = new Date(orderTime.getTime() - 5 * 60 * 1000); // 5 minutes before
        const timeWindowEnd = new Date(orderTime.getTime() + 5 * 60 * 1000); // 5 minutes after
        
        const signalType = orderSide === 'Buy' ? 'BUY' : 'SELL';
        
        result = await pool.query(
          `UPDATE strategy_signals 
           SET status = $1 
           WHERE id = (
             SELECT id
             FROM strategy_signals
             WHERE strategy_id = $2 
               AND symbol = $3 
               AND signal_type = $4
               AND created_at >= $5 
               AND created_at <= $6
               AND status = 'PENDING'
             ORDER BY 
               CASE 
                 WHEN created_at <= $7 THEN 0  -- Prefer signals before order creation
                 ELSE 1  -- Then signals after order creation
               END,
               ABS(EXTRACT(EPOCH FROM (created_at - $7)))  -- Among same priority, choose closest
             LIMIT 1
           )
           RETURNING id`,
          [
            status,
            order.strategy_id,
            order.symbol,
            signalType,
            timeWindowStart,
            timeWindowEnd,
            order.created_at,  // Add order creation time for priority sorting
          ]
        );
        
        if (result.rowCount > 0) {
          const signalIds = result.rows.map(r => r.id);
          logger.debug(`订单 ${orderId} 通过时间窗口匹配更新了信号状态: ${signalIds.join(',')}`);
          
          // Optionally, backfill signal_id for future use
          if (signalIds.length === 1) {
            await pool.query(
              `UPDATE execution_orders SET signal_id = $1 WHERE order_id = $2`,
              [signalIds[0], orderId]
            );
            logger.debug(`已回填订单 ${orderId} 的 signal_id=${signalIds[0]}`);
          }
        } else {
          logger.warn(
            `未找到订单 ${orderId} 关联的信号 ` +
            `(strategy_id=${order.strategy_id}, symbol=${order.symbol}, side=${orderSide})`
          );
        }
      } else {
        logger.debug(`订单 ${orderId} 关联的信号状态已更新为 ${status}`);
      }
    } catch (error: any) {
      logger.error(`更新信号状态失败 (订单: ${orderId}):`, error);
      throw error;
    }
  }

  /**
   * 记录交易到数据库（公开方法，供订单追踪调用）
   */
  async recordTrade(
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

    // 更新订单状态（将API状态转换为数据库状态格式）
    // API状态: FilledStatus, PartialFilledStatus
    // 数据库状态: FILLED, PARTIALLY_FILLED
    let dbStatus = 'SUBMITTED';
    if (status === 'FilledStatus') {
      dbStatus = 'FILLED';
    } else if (status === 'PartialFilledStatus') {
      dbStatus = 'PARTIALLY_FILLED';
    } else if (status === 'CanceledStatus' || status === 'PendingCancelStatus' || status === 'WaitToCancel') {
      dbStatus = 'CANCELLED';
    } else if (status === 'RejectedStatus') {
      dbStatus = 'REJECTED';
    } else {
      dbStatus = status; // 其他状态保持原样
    }
    
    await pool.query(
      `UPDATE execution_orders 
       SET current_status = $1, updated_at = NOW()
       WHERE order_id = $2`,
      [dbStatus, orderId]
    );
  }
}

// 导出单例
export default new BasicExecutionService();

