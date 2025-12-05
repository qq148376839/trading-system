/**
 * 策略调度器服务
 * 定时触发策略运行，管理策略生命周期
 */

import pool from '../config/database';
import { StrategyBase } from './strategies/strategy-base';
import { RecommendationStrategy } from './strategies/recommendation-strategy';
import stockSelector from './stock-selector.service';
import capitalManager from './capital-manager.service';
import stateManager from './state-manager.service';
import basicExecutionService from './basic-execution.service';
import dynamicPositionManager from './dynamic-position-manager.service';
import tradingRecommendationService from './trading-recommendation.service';
import { logger } from '../utils/logger';

class StrategyScheduler {
  private runningStrategies: Map<number, NodeJS.Timeout> = new Map();
  private orderMonitorIntervals: Map<number, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  // 持仓缓存：避免频繁调用 stockPositions() API
  private positionCache: Map<string, { positions: any[]; timestamp: number }> = new Map();
  private readonly POSITION_CACHE_TTL = 30000; // 30秒缓存
  // 今日订单缓存：避免频繁调用 todayOrders() API
  private todayOrdersCache: { orders: any[]; timestamp: number } | null = null;
  private readonly TODAY_ORDERS_CACHE_TTL = 60 * 1000; // 60秒缓存（增加缓存时间，减少API请求频率）

  /**
   * 启动策略调度器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('策略调度器已在运行');
      return;
    }

    this.isRunning = true;
    logger.log('策略调度器已启动');

    // 恢复所有运行中策略的状态
    await stateManager.restoreRunningStrategies();

    // 启动所有运行中的策略
    await this.startAllRunningStrategies();
  }

  /**
   * 停止策略调度器
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // 停止所有策略
    for (const [strategyId, intervalId] of this.runningStrategies.entries()) {
      clearInterval(intervalId);
      this.runningStrategies.delete(strategyId);
    }
    
    // 停止所有订单监控
    if (this.orderMonitorIntervals) {
      for (const [strategyId, monitorId] of this.orderMonitorIntervals.entries()) {
        clearInterval(monitorId);
        this.orderMonitorIntervals.delete(strategyId);
      }
    }

    logger.log('策略调度器已停止');
  }

  /**
   * 启动所有运行中的策略
   */
  private async startAllRunningStrategies(): Promise<void> {
    const strategiesResult = await pool.query(
      `SELECT id, name, type, config, symbol_pool_config, status 
       FROM strategies WHERE status = 'RUNNING'`
    );

    for (const strategy of strategiesResult.rows) {
      await this.startStrategy(strategy.id);
    }
  }

  /**
   * 启动单个策略
   */
  async startStrategy(strategyId: number): Promise<void> {
    // 检查策略是否已在运行
    if (this.runningStrategies.has(strategyId)) {
      logger.warn(`策略 ${strategyId} 已在运行`);
      return;
    }

    // 查询策略配置
    const strategyResult = await pool.query(
      `SELECT id, name, type, config, symbol_pool_config, status 
       FROM strategies WHERE id = $1`,
      [strategyId]
    );

    if (strategyResult.rows.length === 0) {
      throw new Error(`策略 ${strategyId} 不存在`);
    }

    const strategy = strategyResult.rows[0];

    if (strategy.status !== 'RUNNING') {
      throw new Error(`策略 ${strategy.name} 状态不是 RUNNING`);
    }

    // 创建策略实例
    const strategyInstance = this.createStrategyInstance(
      strategy.type,
      strategyId,
      strategy.config
    );

    // 启动定时任务（默认每分钟运行一次）
    const intervalMs = 60 * 1000; // 1分钟
    const intervalId = setInterval(async () => {
      try {
        await this.runStrategyCycle(strategyInstance, strategyId, strategy.symbol_pool_config);
      } catch (error: any) {
        logger.error(`策略 ${strategyId} 运行出错:`, error);
        // 更新策略状态为 ERROR
        await pool.query(
          'UPDATE strategies SET status = $1 WHERE id = $2',
          ['ERROR', strategyId]
        );
        // 停止该策略
        this.stopStrategy(strategyId);
      }
    }, intervalMs);

    this.runningStrategies.set(strategyId, intervalId);
    
    // 启动订单监控任务（每30秒监控一次未成交订单）
    const orderMonitorIntervalMs = 30 * 1000; // 30秒
    const orderMonitorId = setInterval(async () => {
      try {
        await this.trackPendingOrders(strategyId);
      } catch (error: any) {
        logger.error(`策略 ${strategyId} 订单监控出错:`, error);
      }
    }, orderMonitorIntervalMs);
    
    // 存储订单监控定时器ID（用于停止时清理）
    this.orderMonitorIntervals.set(strategyId, orderMonitorId);
    
    logger.log(`策略 ${strategy.name} (ID: ${strategyId}) 已启动（策略周期: 1分钟，订单监控: 30秒）`);

    // 立即执行一次策略周期
    try {
      await this.runStrategyCycle(strategyInstance, strategyId, strategy.symbol_pool_config);
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 初始运行出错:`, error);
    }
    
    // 立即执行一次订单监控（延迟执行，避免与策略周期冲突）
    // 注意：订单监控定时器会在30秒后自动执行，这里不需要立即执行，避免频繁请求
    // try {
    //   await this.trackPendingOrders(strategyId);
    // } catch (error: any) {
    //   logger.error(`策略 ${strategyId} 初始订单监控出错:`, error);
    // }
  }

  /**
   * 停止单个策略
   */
  async stopStrategy(strategyId: number): Promise<void> {
    const intervalId = this.runningStrategies.get(strategyId);
    if (intervalId) {
      clearInterval(intervalId);
      this.runningStrategies.delete(strategyId);
    }
    
    // 停止订单监控
    const orderMonitorId = this.orderMonitorIntervals?.get(strategyId);
    if (orderMonitorId) {
      clearInterval(orderMonitorId);
      this.orderMonitorIntervals.delete(strategyId);
    }
    
    logger.log(`策略 ${strategyId} 已停止`);

    // 更新数据库状态
    await pool.query('UPDATE strategies SET status = $1 WHERE id = $2', ['STOPPED', strategyId]);
  }

  /**
   * 运行策略周期
   */
  private async runStrategyCycle(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbolPoolConfig: any
  ): Promise<void> {
    // 1. 追踪并更新未成交订单（使用缓存，避免频繁请求）
    // 注意：订单监控定时器已经在独立运行，这里不需要重复调用
    // await this.trackPendingOrders(strategyId);

    // 2. 获取股票池
    const symbols = await stockSelector.getSymbolPool(symbolPoolConfig);
    
    if (!symbols || symbols.length === 0) {
      logger.log(`策略 ${strategyId}: 股票池为空，跳过本次运行`);
      return;
    }

    logger.log(`策略 ${strategyId}: 开始处理 ${symbols.length} 个标的: ${symbols.join(', ')}`);

    // 3. 并行处理多个股票
    await Promise.all(
      symbols.map((symbol) => this.processSymbol(strategyInstance, strategyId, symbol))
    );
  }

  /**
   * 追踪未成交订单，根据市场变化更新价格和状态
   * 修订：使用 todayOrders() API 获取订单，实时监控订单状态
   */
  private async trackPendingOrders(strategyId: number): Promise<void> {
    try {
      // 1. 获取今日订单（使用缓存，避免频繁请求导致频率限制）
      // 注意：60秒缓存已经足够实时，不需要每次都强制刷新
      const todayOrders = await this.getTodayOrders(false);
      
      // 2. 查询策略的所有订单（买入和卖出，用于价格更新和状态同步）
      // 方案二：查询所有订单，不限制状态，完全基于API实时状态筛选
      const strategyOrders = await pool.query(
        `SELECT eo.order_id, eo.symbol, eo.side, eo.price, eo.quantity, eo.created_at, eo.current_status
         FROM execution_orders eo
         WHERE eo.strategy_id = $1 
         AND eo.created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY eo.created_at DESC
         LIMIT 40`,
        [strategyId]
      );

      if (strategyOrders.rows.length === 0) {
        return;
      }

      // 3. 先筛选出未成交的订单（基于API实时状态，不依赖数据库状态）
      // 这是方案二的核心：完全基于API状态筛选，避免数据库状态滞后问题
      const pendingStatuses = [
        'NotReported',
        'NewStatus',
        'WaitToNew',
        'PendingReplaceStatus',
        'WaitToReplace',
      ];
      
      // 严格排除所有已完成的订单状态
      const completedStatuses = [
        'FilledStatus',           // 已成交
        'PartialFilledStatus',    // 部分成交（虽然部分成交可能还需要更新，但已成交部分不能修改）
        'CanceledStatus',         // 已取消
        'PendingCancelStatus',    // 取消中
        'WaitToCancel',           // 等待取消
        'RejectedStatus',         // 已拒绝
        'ExpiredStatus',          // 已过期
      ];
      
      // 筛选出未成交的订单（完全基于API状态）
      const pendingOrders = strategyOrders.rows.filter((dbOrder: any) => {
        const apiOrder = todayOrders.find((o: any) => 
          (o.orderId || o.order_id) === dbOrder.order_id
        );
        
        if (!apiOrder) {
          // 订单不在今日订单列表中，可能已过期或已删除，排除
          logger.debug(`策略 ${strategyId} 标的 ${dbOrder.symbol} 订单 ${dbOrder.order_id} 不在今日订单列表中，排除`);
          return false;
        }
        
        const rawStatus = apiOrder.status;
        const status = this.normalizeOrderStatus(rawStatus);
        
        // 调试日志：记录每个订单的状态检查过程
        logger.debug(`策略 ${strategyId} 标的 ${dbOrder.symbol} 订单 ${dbOrder.order_id} 状态检查: 原始=${rawStatus}, 规范化=${status}`);
        
        // 严格排除所有已完成的订单
        if (completedStatuses.includes(status)) {
          // 已完成的订单，记录日志并排除（使用log级别，便于调试）
          logger.log(`策略 ${strategyId} 标的 ${dbOrder.symbol} 订单 ${dbOrder.order_id} 已完成（状态=${status}，原始=${rawStatus}），从待监控列表中排除`);
          return false;
        }
        
        // 只包含未成交的订单状态
        const isPending = pendingStatuses.includes(status);
        if (!isPending) {
          // 未知状态，记录警告并排除
          logger.warn(`策略 ${strategyId} 标的 ${dbOrder.symbol} 订单 ${dbOrder.order_id} 状态未知（状态=${status}，原始=${rawStatus}），排除`);
        } else {
          // 记录通过筛选的订单
          logger.debug(`策略 ${strategyId} 标的 ${dbOrder.symbol} 订单 ${dbOrder.order_id} 通过筛选（状态=${status}），将进入价格更新流程`);
        }
        return isPending;
      });

      // 4. 同步订单状态到数据库并更新策略实例状态（在筛选之后）
      const filledOrders: Array<{ orderId: string; symbol: string; avgPrice: number; filledQuantity: number }> = [];
      
      for (const dbOrder of strategyOrders.rows) {
        const apiOrder = todayOrders.find((o: any) => 
          (o.orderId || o.order_id) === dbOrder.order_id
        );
        
        if (apiOrder) {
          const status = this.normalizeOrderStatus(apiOrder.status);
          
          // 更新数据库状态
          let dbStatus = 'SUBMITTED';
          if (status === 'FilledStatus') {
            dbStatus = 'FILLED';
            // 记录已成交订单，后续更新策略实例状态
            const avgPrice = parseFloat(apiOrder.executedPrice?.toString() || apiOrder.executed_price?.toString() || '0');
            const filledQuantity = parseInt(apiOrder.executedQuantity?.toString() || apiOrder.executed_quantity?.toString() || '0');
            if (avgPrice > 0 && filledQuantity > 0) {
              filledOrders.push({
                orderId: dbOrder.order_id,
                symbol: dbOrder.symbol,
                avgPrice,
                filledQuantity,
              });
            }
          } else if (status === 'CanceledStatus' || status === 'PendingCancelStatus' || status === 'WaitToCancel') {
            dbStatus = 'CANCELLED';
            // 只有在状态发生变化时才处理（避免重复处理）
            if (dbOrder.current_status !== 'CANCELLED') {
              await this.handleOrderCancelled(strategyId, dbOrder.symbol, dbOrder.order_id);
            }
          } else if (status === 'RejectedStatus') {
            dbStatus = 'FAILED';
            // 只有在状态发生变化时才处理（避免重复处理）
            if (dbOrder.current_status !== 'FAILED') {
              await this.handleOrderRejected(strategyId, dbOrder.symbol, dbOrder.order_id);
            }
          } else if (pendingStatuses.includes(status)) {
            dbStatus = 'NEW';
          }
          
          // 只有在状态发生变化时才更新数据库
          if (dbOrder.current_status !== dbStatus) {
            await pool.query(
              `UPDATE execution_orders 
               SET current_status = $1, updated_at = NOW()
               WHERE order_id = $2`,
              [dbStatus, dbOrder.order_id]
            );
          }
        }
      }

      // 5. 处理已成交订单，更新策略实例状态
      if (filledOrders.length > 0) {
        // 查询策略配置（一次性查询，避免重复查询）
        const strategyConfigResult = await pool.query(
          'SELECT type, config FROM strategies WHERE id = $1',
          [strategyId]
        );
        const strategyType = strategyConfigResult.rows[0]?.type || 'RECOMMENDATION_V1';
        const strategyConfig = strategyConfigResult.rows[0]?.config || {};
        const strategyInstance = this.createStrategyInstance(strategyType, strategyId, strategyConfig);
        
        for (const dbOrder of strategyOrders.rows) {
          const apiOrder = todayOrders.find((o: any) => 
            (o.orderId || o.order_id) === dbOrder.order_id
          );
          
          if (!apiOrder) continue;
          
          const status = this.normalizeOrderStatus(apiOrder.status);
          const isBuy = dbOrder.side === 'BUY' || dbOrder.side === 'Buy' || dbOrder.side === 1;
          const isSell = dbOrder.side === 'SELL' || dbOrder.side === 'Sell' || dbOrder.side === 2;
          
          if (status === 'FilledStatus' && dbOrder.current_status !== 'FILLED') {
            const avgPrice = parseFloat(apiOrder.executedPrice?.toString() || apiOrder.executed_price?.toString() || '0');
            const filledQuantity = parseInt(apiOrder.executedQuantity?.toString() || apiOrder.executed_quantity?.toString() || '0');
            
            if (avgPrice > 0 && filledQuantity > 0) {
              try {
                // 记录交易到数据库（如果之前没有记录）
                try {
                  // 获取订单详情和手续费
                  const { getTradeContext } = await import('../config/longport');
                  const tradeCtx = await getTradeContext();
                  const orderDetail = await tradeCtx.orderDetail(dbOrder.order_id);
                  
                  // 计算手续费
                  const chargeDetail = (orderDetail as any).chargeDetail || (orderDetail as any).charge_detail;
                  const fees = chargeDetail && chargeDetail.total_amount 
                    ? parseFloat(chargeDetail.total_amount.toString()) 
                    : 0;
                  
                  // 记录交易
                  await basicExecutionService.recordTrade(
                    strategyId,
                    dbOrder.symbol,
                    isBuy ? 'BUY' : 'SELL',
                    orderDetail,
                    fees
                  );
                } catch (recordError: any) {
                  logger.warn(`记录交易失败 (${dbOrder.order_id}):`, recordError.message);
                  // 继续处理状态更新，不因记录失败而中断
                }
                
                if (isBuy) {
                  // 买入订单成交：更新状态为HOLDING
                  const instanceResult = await pool.query(
                    `SELECT context FROM strategy_instances 
                     WHERE strategy_id = $1 AND symbol = $2`,
                    [strategyId, dbOrder.symbol]
                  );
                  
                  let context: any = {};
                  if (instanceResult.rows.length > 0 && instanceResult.rows[0].context) {
                    try {
                      context = typeof instanceResult.rows[0].context === 'string' 
                        ? JSON.parse(instanceResult.rows[0].context)
                        : instanceResult.rows[0].context;
                    } catch (e) {
                      // 忽略JSON解析错误
                    }
                  }
                  
                  await strategyInstance.updateState(dbOrder.symbol, 'HOLDING', {
                    entryPrice: avgPrice,
                    quantity: filledQuantity,
                    stopLoss: context.stopLoss,
                    takeProfit: context.takeProfit,
                    orderId: dbOrder.order_id,
                  });
                  
                  logger.log(`策略 ${strategyId} 标的 ${dbOrder.symbol} 买入订单已成交，更新状态为HOLDING，订单ID: ${dbOrder.order_id}`);
                } else if (isSell) {
                  // 卖出订单成交：更新状态为IDLE，释放资金
                  await strategyInstance.updateState(dbOrder.symbol, 'IDLE');
                  
                  // 释放资金（从持仓金额中扣除）
                  const instanceResult = await pool.query(
                    `SELECT context FROM strategy_instances 
                     WHERE strategy_id = $1 AND symbol = $2`,
                    [strategyId, dbOrder.symbol]
                  );
                  
                  if (instanceResult.rows.length > 0 && instanceResult.rows[0].context) {
                    let context: any = {};
                    try {
                      context = typeof instanceResult.rows[0].context === 'string' 
                        ? JSON.parse(instanceResult.rows[0].context)
                        : instanceResult.rows[0].context;
                      
                      if (context.allocationAmount) {
                        await capitalManager.releaseAllocation(
                          strategyId,
                          context.allocationAmount,
                          dbOrder.symbol
                        );
                      }
                    } catch (e) {
                      // 忽略JSON解析错误
                    }
                  }
                  
                  logger.log(`策略 ${strategyId} 标的 ${dbOrder.symbol} 卖出订单已成交，更新状态为IDLE，订单ID: ${dbOrder.order_id}`);
                }
              } catch (error: any) {
                logger.error(`更新已成交订单状态失败 (${dbOrder.order_id}):`, error);
              }
            }
          }
        }
      }

      // 6. 如果没有待监控的订单，直接返回（避免不必要的API调用）
      if (pendingOrders.length === 0) {
        logger.debug(`策略 ${strategyId}: 没有需要监控的未成交订单`);
        return;
      }

      logger.log(`策略 ${strategyId}: 监控 ${pendingOrders.length} 个未成交订单`);

      // 7. 获取当前行情并评估是否需要调整订单价格
      const { getQuoteContext } = await import('../config/longport');
      const quoteCtx = await getQuoteContext();
      const symbols = pendingOrders.map((row: any) => row.symbol);
      const quotes = await quoteCtx.quote(symbols);

      // 创建symbol到quote的映射
      const quoteMap = new Map<string, any>();
      for (const quote of quotes) {
        quoteMap.set(quote.symbol, quote);
      }

      // 处理每个订单
      for (const order of pendingOrders) {
        try {
          // 1. 从API获取订单最新状态（避免数据库状态滞后）
          const apiOrder = todayOrders.find((o: any) => 
            (o.orderId || o.order_id) === order.order_id
          );
          
          if (!apiOrder) {
            // 订单不在今日订单列表中，可能已过期或已删除，跳过
            continue;
          }
          
          // 2. 检查订单状态：如果已成交、已取消、已拒绝，跳过价格更新
          // 注意：这里应该不会执行到，因为筛选时已经排除了这些订单，但作为双重保险
          const rawStatus = apiOrder.status;
          const orderStatus = this.normalizeOrderStatus(rawStatus);
          
          // 调试日志：记录订单状态检查
          logger.debug(`策略 ${strategyId} 标的 ${order.symbol} 订单 ${order.order_id} 价格更新前状态检查: 原始=${rawStatus}, 规范化=${orderStatus}`);
          
          const filledStatuses = ['FilledStatus', 'PartialFilledStatus'];
          const finalStatuses = ['CanceledStatus', 'RejectedStatus', 'ExpiredStatus'];
          
          if (filledStatuses.includes(orderStatus)) {
            // 订单已成交，不应该进入这里（筛选时应该已排除）
            logger.warn(`策略 ${strategyId} 标的 ${order.symbol} 订单 ${order.order_id} 已成交（状态=${orderStatus}，原始=${rawStatus}），但进入了价格更新流程，这不应该发生！跳过价格更新`);
            continue;
          }
          
          if (finalStatuses.includes(orderStatus)) {
            // 订单已取消/拒绝/过期，不应该进入这里（筛选时应该已排除）
            logger.warn(`策略 ${strategyId} 标的 ${order.symbol} 订单 ${order.order_id} 状态为 ${orderStatus}（原始=${rawStatus}），但进入了价格更新流程，这不应该发生！跳过价格更新`);
            continue;
          }
          
          // 3. 检查订单是否支持修改（某些订单类型不支持修改）
          // 根据实际API返回，orderType 已经是字符串格式（'LO', 'MO'等）
          const orderType = apiOrder.orderType || apiOrder.order_type;
          
          // 只有市价单（MO）不支持修改
          if (orderType === 'MO') {
            logger.debug(`策略 ${strategyId} 标的 ${order.symbol} 订单 ${order.order_id} 是市价单，不支持修改，跳过价格更新`);
            continue;
          }
          
          // 其他不支持修改的订单类型（如特殊限价单SLO）
          if (orderType === 'SLO') {
            logger.debug(`策略 ${strategyId} 标的 ${order.symbol} 订单 ${order.order_id} 是特殊限价单，不支持修改，跳过价格更新`);
            continue;
          }
          
          // 如果遇到数字格式（防御性编程，虽然实际不会发生）
          if (typeof orderType === 'number') {
            // 根据 Longbridge SDK：1=LO限价单, 2=MO市价单
            if (orderType === 2) { // MO 市价单
              logger.debug(`策略 ${strategyId} 标的 ${order.symbol} 订单 ${order.order_id} 是市价单（数字格式），不支持修改，跳过价格更新`);
              continue;
            }
            // 其他数字格式的订单类型，继续处理（限价单等）
          }
          
          const quote = quoteMap.get(order.symbol);
          if (!quote) {
            continue;
          }

          // Longbridge SDK返回的是驼峰命名：lastDone
          const currentPrice = parseFloat(quote.lastDone?.toString() || quote.last_done?.toString() || '0');
          const orderPrice = parseFloat(order.price);
          
          if (currentPrice <= 0) {
            continue;
          }

          // 计算价格差异百分比
          const priceDiff = Math.abs(currentPrice - orderPrice) / orderPrice;
          
          // 如果当前价格与订单价格差异超过2%，更新订单价格
          if (priceDiff > 0.02) {
            // 更新订单价格（向上调整，确保能成交）
            const newPrice = currentPrice * 1.01; // 比当前价格高1%，确保能成交
            
            // 格式化价格
            const { detectMarket } = await import('../utils/order-validation');
            const market = detectMarket(order.symbol);
            let formattedPrice: number;
            if (market === 'US') {
              formattedPrice = Math.round(newPrice * 100) / 100;
            } else if (market === 'HK') {
              formattedPrice = Math.round(newPrice * 1000) / 1000;
            } else {
              formattedPrice = Math.round(newPrice * 100) / 100;
            }

            // 调用SDK更新订单
            // 注意：即使只更新价格，Longbridge SDK也要求提供quantity字段（使用原始数量）
            const { getTradeContext, Decimal } = await import('../config/longport');
            const tradeCtx = await getTradeContext();
            const orderQuantity = parseInt(order.quantity?.toString() || '0');
            
            if (orderQuantity <= 0) {
              logger.warn(`策略 ${strategyId} 标的 ${order.symbol} 订单数量无效 (${order.quantity})，跳过价格更新`);
              continue;
            }
            
            await tradeCtx.replaceOrder({
              orderId: order.order_id,
              quantity: orderQuantity,
              price: new Decimal(formattedPrice.toString()),
            });

            // 更新数据库
            await pool.query(
              `UPDATE execution_orders 
               SET price = $1, updated_at = NOW() 
               WHERE order_id = $2`,
              [formattedPrice, order.order_id]
            );
            
            logger.log(`策略 ${strategyId} 标的 ${order.symbol} 订单价格已更新: ${orderPrice.toFixed(2)} -> ${formattedPrice.toFixed(2)} (当前价格: ${currentPrice.toFixed(2)}, 差异: ${(priceDiff * 100).toFixed(2)}%)`);
          } else {
            // 价格差异在2%以内，记录监控日志（可选，减少日志量）
            // logger.debug(`策略 ${strategyId} 标的 ${order.symbol} 订单价格正常，当前价格: ${currentPrice.toFixed(2)}, 订单价格: ${orderPrice.toFixed(2)}, 差异: ${(priceDiff * 100).toFixed(2)}%`);
          }
        } catch (orderError: any) {
          // 区分不同类型的错误
          const errorMessage = orderError.message || '';
          const errorCode = orderError.code || '';
          
          // 错误码602012：订单类型不支持修改
          if (errorCode === '602012' || errorMessage.includes('602012') || errorMessage.includes('Order amendment is not supported')) {
            logger.debug(`策略 ${strategyId} 标的 ${order.symbol} 订单 ${order.order_id} 不支持修改（错误码602012），跳过价格更新`);
            continue;
          }
          
          // 其他错误：记录警告
          logger.warn(`策略 ${strategyId} 标的 ${order.symbol} 订单价格更新失败 (${order.order_id}): ${errorMessage}`);
        }
      }
    } catch (error: any) {
      logger.error(`追踪未成交订单失败 (策略 ${strategyId}):`, error);
    }
  }

  /**
   * 处理订单已取消的情况
   */
  private async handleOrderCancelled(strategyId: number, symbol: string, orderId: string): Promise<void> {
    try {
      // 检查订单是否已经处理过（避免重复处理）
      const checkResult = await pool.query(
        `SELECT current_status FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (checkResult.rows.length === 0) {
        return; // 订单不存在，跳过
      }
      
      // 如果订单状态已经是CANCELLED，说明已经处理过，跳过
      if (checkResult.rows[0].current_status === 'CANCELLED') {
        return;
      }
      
      // 查询订单金额
      const orderResult = await pool.query(
        `SELECT quantity, price FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        const amount = parseFloat(order.quantity) * parseFloat(order.price);
        
        // 释放资金
        await capitalManager.releaseAllocation(strategyId, amount, symbol);
        
        // 更新策略实例状态为IDLE
        const strategyConfigResult = await pool.query(
          'SELECT type, config FROM strategies WHERE id = $1',
          [strategyId]
        );
        const strategyType = strategyConfigResult.rows[0]?.type || 'RECOMMENDATION_V1';
        const strategyConfig = strategyConfigResult.rows[0]?.config || {};
        const strategyInstance = this.createStrategyInstance(strategyType, strategyId, strategyConfig);
        await strategyInstance.updateState(symbol, 'IDLE');
        
        logger.log(`策略 ${strategyId} 标的 ${symbol} 订单已取消，已释放资金 ${amount.toFixed(2)}，订单ID: ${orderId}`);
      }
    } catch (error: any) {
      logger.error(`处理订单取消失败 (${orderId}):`, error);
    }
  }

  /**
   * 处理订单被拒绝的情况
   */
  private async handleOrderRejected(strategyId: number, symbol: string, orderId: string): Promise<void> {
    try {
      // 检查订单是否已经处理过（避免重复处理）
      const checkResult = await pool.query(
        `SELECT current_status FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (checkResult.rows.length === 0) {
        return; // 订单不存在，跳过
      }
      
      // 如果订单状态已经是FAILED，说明已经处理过，跳过
      if (checkResult.rows[0].current_status === 'FAILED') {
        return;
      }
      
      // 查询订单金额
      const orderResult = await pool.query(
        `SELECT quantity, price FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        const amount = parseFloat(order.quantity) * parseFloat(order.price);
        
        // 释放资金
        await capitalManager.releaseAllocation(strategyId, amount, symbol);
        
        // 更新策略实例状态为IDLE
        const strategyConfigResult = await pool.query(
          'SELECT type, config FROM strategies WHERE id = $1',
          [strategyId]
        );
        const strategyType = strategyConfigResult.rows[0]?.type || 'RECOMMENDATION_V1';
        const strategyConfig = strategyConfigResult.rows[0]?.config || {};
        const strategyInstance = this.createStrategyInstance(strategyType, strategyId, strategyConfig);
        await strategyInstance.updateState(symbol, 'IDLE');
        
        logger.warn(`策略 ${strategyId} 标的 ${symbol} 订单被拒绝，已释放资金 ${amount.toFixed(2)}，订单ID: ${orderId}`);
      }
    } catch (error: any) {
      logger.error(`处理订单拒绝失败 (${orderId}):`, error);
    }
  }

  /**
   * 处理单个股票
   */
  private async processSymbol(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    try {
      // 检查当前状态
      const currentState = await strategyInstance.getCurrentState(symbol);
      logger.debug(`策略 ${strategyId} 标的 ${symbol}: 当前状态=${currentState}`);

      // 根据状态进行不同处理
      if (currentState === 'HOLDING') {
        // 持仓状态：检查是否需要卖出（止盈/止损）
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 持仓监控 - 检查止盈/止损`);
        await this.processHoldingPosition(strategyInstance, strategyId, symbol);
        return;
      } else if (currentState === 'CLOSING') {
        // 平仓状态：检查卖出订单状态
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 平仓监控 - 检查卖出订单状态`);
        await this.processClosingPosition(strategyInstance, strategyId, symbol);
        return;
      } else if (currentState === 'OPENING' || currentState === 'COOLDOWN') {
        // 开仓中或冷却期：跳过处理
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 状态为 ${currentState}，跳过处理`);
        return;
      } else if (currentState !== 'IDLE') {
        // 其他未知状态：跳过处理
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 状态为 ${currentState}，跳过处理`);
        return;
      }

      // IDLE 状态：处理买入逻辑

      // 检查是否已有持仓（避免重复买入）
      const hasPosition = await this.checkExistingPosition(strategyId, symbol);
      if (hasPosition) {
        // 如果状态是IDLE但实际有持仓，需要同步状态
        await this.syncPositionState(strategyInstance, strategyId, symbol);
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 已有持仓，跳过买入`);
        return;
      }

      // 检查是否有未成交的订单
      const hasPendingOrder = await this.checkPendingOrder(strategyId, symbol);
      if (hasPendingOrder) {
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 有未成交订单，跳过买入`);
        return;
      }

      // 生成信号（marketData 参数可选，策略内部会自行获取）
      const intent = await strategyInstance.generateSignal(symbol, undefined);

      if (!intent) {
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 未生成信号（返回null）`);
        return;
      }

      if (intent.action === 'HOLD') {
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 信号为 HOLD，跳过交易`);
        return;
      }

      logger.log(`策略 ${strategyId} 标的 ${symbol}: 生成信号 ${intent.action}, 价格=${intent.entryPrice?.toFixed(2) || 'N/A'}, 原因=${intent.reason?.substring(0, 50) || 'N/A'}`);

      // 如果是买入信号，执行交易
      if (intent.action === 'BUY') {
        // 申请资金额度
        const availableCapital = await capitalManager.getAvailableCapital(strategyId);
        
        if (availableCapital <= 0) {
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 可用资金不足 (${availableCapital.toFixed(2)})，跳过买入`);
          return;
        }

        logger.log(`策略 ${strategyId} 标的 ${symbol}: 可用资金=${availableCapital.toFixed(2)}`);

        // 计算数量（如果没有指定）
        if (!intent.quantity && intent.entryPrice) {
          // 获取标的级限制（每个标的的最大持仓金额）
          const maxPositionPerSymbol = await capitalManager.getMaxPositionPerSymbol(strategyId);
          
          // 使用标的级限制和可用资金中的较小值来计算数量
          // 这样可以确保不超过标的级限制，同时也不超过可用资金
          const maxAmountForThisSymbol = Math.min(availableCapital, maxPositionPerSymbol);
          const maxAffordableQuantity = Math.floor(maxAmountForThisSymbol / intent.entryPrice);
          intent.quantity = Math.max(1, maxAffordableQuantity);
          
          // 只在数量大于1时输出日志，减少干扰
          if (intent.quantity > 1) {
            logger.log(`策略 ${strategyId} 标的 ${symbol}: 可用资金=${availableCapital.toFixed(2)}, 标的级限制=${maxPositionPerSymbol.toFixed(2)}, 价格=${intent.entryPrice.toFixed(2)}, 数量=${intent.quantity}`);
          }
        }

        if (!intent.quantity || intent.quantity <= 0) {
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 计算数量失败 (数量=${intent.quantity})，跳过买入`);
          return;
        }

        logger.log(`策略 ${strategyId} 标的 ${symbol}: 准备买入，数量=${intent.quantity}, 价格=${intent.entryPrice?.toFixed(2)}`);

        // 申请资金
        const allocationResult = await capitalManager.requestAllocation({
          strategyId,
          amount: intent.quantity * (intent.entryPrice || 0),
          symbol,
        });

        if (!allocationResult.approved) {
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 资金申请被拒绝 - ${allocationResult.reason || '未知原因'}`);
          return;
        }

        logger.log(`策略 ${strategyId} 标的 ${symbol}: 资金申请通过，分配金额=${allocationResult.allocatedAmount.toFixed(2)}`);

        // 更新状态为 OPENING
        await strategyInstance.updateState(symbol, 'OPENING', {
          intent,
          allocationAmount: allocationResult.allocatedAmount,
        });

        // 执行买入
        const executionResult = await basicExecutionService.executeBuyIntent(intent, strategyId);

        if (executionResult.success) {
          // 获取当前市场环境（用于保存到上下文）
          const marketEnv = await dynamicPositionManager.getCurrentMarketEnvironment(symbol);
          
          // 获取当前ATR（如果可用）
          let originalATR: number | undefined;
          try {
            const recommendation = await tradingRecommendationService.calculateRecommendation(symbol);
            originalATR = recommendation.atr;
          } catch (error: any) {
            logger.warn(`获取ATR失败 (${symbol}):`, error.message);
          }

          // 订单已成交，更新状态为 HOLDING，保存完整的持仓上下文
          const holdingContext = {
            entryPrice: executionResult.avgPrice,
            quantity: executionResult.filledQuantity,
            entryTime: new Date().toISOString(),
            originalStopLoss: intent.stopLoss,
            originalTakeProfit: intent.takeProfit,
            currentStopLoss: intent.stopLoss,
            currentTakeProfit: intent.takeProfit,
            entryMarketEnv: marketEnv.marketEnv,
            entryMarketStrength: marketEnv.marketStrength,
            previousMarketEnv: marketEnv.marketEnv,
            previousMarketStrength: marketEnv.marketStrength,
            originalATR: originalATR,
            currentATR: originalATR,
            adjustmentHistory: [],
            orderId: executionResult.orderId,
            allocationAmount: allocationResult.allocatedAmount,
          };
          
          await strategyInstance.updateState(symbol, 'HOLDING', holdingContext);
          logger.log(`策略 ${strategyId} 标的 ${symbol} 买入成功，订单ID: ${executionResult.orderId}`);
        } else if (executionResult.submitted && executionResult.orderId) {
          // 订单已提交但未成交，保持 OPENING 状态
          // 订单状态可能是 NewStatus, WaitToNew, NotReported 等
          // 资金已锁定，状态保持 OPENING，等待后续订单追踪更新状态
          logger.log(`策略 ${strategyId} 标的 ${symbol} 订单已提交，等待成交，订单ID: ${executionResult.orderId}, 状态: ${executionResult.orderStatus || 'Unknown'}`);
        } else {
          // 订单提交失败或被拒绝，释放资金并恢复 IDLE 状态
          await capitalManager.releaseAllocation(
            strategyId,
            allocationResult.allocatedAmount,
            symbol
          );
          await strategyInstance.updateState(symbol, 'IDLE');
          const errorMsg = executionResult.error || '订单提交失败';
          logger.error(`策略 ${strategyId} 标的 ${symbol} 买入失败: ${errorMsg}`);
        }
      }
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理标的 ${symbol} 出错:`, error);
    }
  }

  /**
   * 获取持仓缓存（批量查询，避免频率限制）
   */
  private async getCachedPositions(): Promise<any[]> {
    const cacheKey = 'all_positions';
    const cached = this.positionCache.get(cacheKey);
    const now = Date.now();

    // 如果缓存有效，直接返回
    if (cached && (now - cached.timestamp) < this.POSITION_CACHE_TTL) {
      return cached.positions;
    }

    // 缓存过期或不存在，重新查询
    try {
      const { getTradeContext } = await import('../config/longport');
      const tradeCtx = await getTradeContext();
      const positions = await tradeCtx.stockPositions();
      
      let allPositions: any[] = [];
      
      if (positions && typeof positions === 'object') {
        if (positions.channels && Array.isArray(positions.channels)) {
          for (const channel of positions.channels) {
            if (channel.positions && Array.isArray(channel.positions)) {
              allPositions.push(...channel.positions);
            }
          }
        }
      }

      // 更新缓存
      this.positionCache.set(cacheKey, {
        positions: allPositions,
        timestamp: now,
      });

      return allPositions;
    } catch (sdkError: any) {
      // 如果查询失败，尝试使用缓存（即使过期）
      if (cached) {
      return cached.positions;
      }
      return [];
    }
  }

  /**
   * 检查是否已有持仓
   */
  private async checkExistingPosition(strategyId: number, symbol: string): Promise<boolean> {
    try {
      // 检查策略实例状态
      const instanceResult = await pool.query(
        `SELECT current_state FROM strategy_instances 
         WHERE strategy_id = $1 AND symbol = $2 AND current_state = 'HOLDING'`,
        [strategyId, symbol]
      );

      if (instanceResult.rows.length > 0) {
        return true;
      }

      // 检查实际持仓（使用缓存，避免频繁API调用）
      const allPositions = await this.getCachedPositions();
      
      for (const pos of allPositions) {
        if (pos.symbol === symbol) {
          const quantity = parseInt(pos.quantity?.toString() || '0');
          if (quantity > 0) {
            return true;
          }
        }
      }

      return false;
    } catch (error: any) {
      logger.error(`检查持仓失败 (${symbol}):`, error);
      return false; // 出错时返回false，允许继续执行
    }
  }

  /**
   * 获取今日订单（带缓存）
   * 直接调用 todayOrders() API，不使用数据库查询
   * 使用 mapOrderData 处理订单数据，确保状态正确（特别是已成交订单的状态修正）
   */
  private async getTodayOrders(forceRefresh: boolean = false): Promise<any[]> {
    const now = Date.now();
    
    // 如果缓存有效且不强制刷新，直接返回缓存
    if (!forceRefresh && this.todayOrdersCache && 
        (now - this.todayOrdersCache.timestamp) < this.TODAY_ORDERS_CACHE_TTL) {
      return this.todayOrdersCache.orders;
    }

    try {
      // 调用内部API获取今日订单（直接调用SDK，不是HTTP请求）
      const { getTradeContext } = await import('../config/longport');
      const tradeCtx = await getTradeContext();
      const rawOrders = await tradeCtx.todayOrders({});
      
      // 使用 mapOrderData 处理订单数据，确保状态正确
      // 特别是已成交订单的状态修正（根据 executedQuantity 自动修正状态）
      const { mapOrderData } = await import('../routes/orders');
      const mappedOrders = Array.isArray(rawOrders) 
        ? rawOrders.map((order: any) => mapOrderData(order))
        : [];
      
      // 更新缓存
      this.todayOrdersCache = {
        orders: mappedOrders,
        timestamp: now,
      };
      
      return this.todayOrdersCache.orders;
    } catch (error: any) {
      // 如果API调用失败，尝试使用缓存（即使过期）
      if (this.todayOrdersCache) {
        logger.warn(`获取今日订单失败，使用过期缓存: ${error.message}`);
        return this.todayOrdersCache.orders;
      }
      console.error('获取今日订单失败且无缓存:', error);
      return [];
    }
  }

  /**
   * 标准化订单状态（复用 orders.ts 中的逻辑）
   */
  private normalizeOrderStatus(status: any): string {
    if (status === null || status === undefined) return 'Unknown';
    
    // 如果是数字，转换为字符串枚举值
    if (typeof status === 'number') {
      const statusMap: Record<number, string> = {
        0: 'NotReported',
        1: 'NotReported',
        2: 'ReplacedNotReported',
        3: 'ProtectedNotReported',
        4: 'VarietiesNotReported',
        5: 'WaitToNew',
        6: 'NewStatus',
        7: 'WaitToReplace',
        8: 'PendingReplaceStatus',
        9: 'ReplacedStatus',
        10: 'PartialFilledStatus',
        11: 'FilledStatus',
        12: 'WaitToCancel',
        13: 'PendingCancelStatus',
        14: 'CanceledStatus',
        15: 'RejectedStatus',
        16: 'ExpiredStatus',
        17: 'PartialWithdrawal',
      };
      return statusMap[status] || `UnknownStatus_${status}`;
    }
    
    // 如果是字符串
    if (typeof status === 'string') {
      // 如果是数字字符串，先转换为数字再映射
      const numStatus = parseInt(status, 10);
      if (!isNaN(numStatus) && status === numStatus.toString()) {
        const statusMap: Record<number, string> = {
          0: 'NotReported',
          1: 'NotReported',
          2: 'ReplacedNotReported',
          3: 'ProtectedNotReported',
          4: 'VarietiesNotReported',
          5: 'WaitToNew',
          6: 'NewStatus',
          7: 'WaitToReplace',
          8: 'PendingReplaceStatus',
          9: 'ReplacedStatus',
          10: 'PartialFilledStatus',
          11: 'FilledStatus',
          12: 'WaitToCancel',
          13: 'PendingCancelStatus',
          14: 'CanceledStatus',
          15: 'RejectedStatus',
          16: 'ExpiredStatus',
          17: 'PartialWithdrawal',
        };
        return statusMap[numStatus] || status;
      }
      
      // 如果已经是完整的枚举值名称，直接返回
      // 注意：FilledStatus 包含 'Status'，所以会被这里匹配
      if (status.includes('Status') || status.includes('Reported') || status.includes('To') || status === 'PartialWithdrawal') {
        return status;
      }
      
      // 如果是简写形式，映射到完整的枚举值名称
      const statusMap: Record<string, string> = {
        'Filled': 'FilledStatus',
        'PartialFilled': 'PartialFilledStatus',
        'New': 'NewStatus',
        'NotReported': 'NotReported',
        'Canceled': 'CanceledStatus',
        'Cancelled': 'CanceledStatus',
        'Rejected': 'RejectedStatus',
        'Expired': 'ExpiredStatus',
      };
      return statusMap[status] || status;
    }
    
    return status.toString();
  }

  /**
   * 检查是否有未成交的订单
   * 修订：直接使用 todayOrders() API，不使用数据库查询
   * 注意：strategyId 参数保留用于未来扩展（如按策略过滤订单）
   */
  private async checkPendingOrder(_strategyId: number, symbol: string): Promise<boolean> {
    try {
      // 获取今日订单（带缓存）
      const todayOrders = await this.getTodayOrders();
      
      // 未成交订单的状态列表
      const pendingStatuses = [
        'NotReported',
        'NewStatus',
        'WaitToNew',
        'PartialFilledStatus',
        'PendingReplaceStatus',
        'WaitToReplace',
        'ReplacedNotReported',
        'ProtectedNotReported',
        'VarietiesNotReported',
      ];
      
      // 查找该标的的未成交买入订单
      for (const order of todayOrders) {
        // 检查是否匹配标的和方向
        const orderSymbol = order.symbol || order.stock_name;
        const orderSide = order.side;
        
        // 标准化方向：Buy/1/BUY 都视为买入
        const isBuy = orderSide === 'Buy' || orderSide === 1 || orderSide === 'BUY' || orderSide === 'buy';
        
        if (orderSymbol === symbol && isBuy) {
          // 标准化状态
          const status = this.normalizeOrderStatus(order.status);
          
          // 如果是未成交状态，返回true
          if (pendingStatuses.includes(status)) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error: any) {
      logger.error(`检查未成交订单失败 (${symbol}):`, error);
      // 出错时返回false，允许继续执行（避免阻塞策略）
      return false;
    }
  }


  /**
   * 处理持仓状态：检查止盈/止损
   */
  private async processHoldingPosition(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    try {
      // 1. 获取策略实例上下文（包含入场价、止损、止盈）
      const instanceResult = await pool.query(
        `SELECT context FROM strategy_instances 
         WHERE strategy_id = $1 AND symbol = $2`,
        [strategyId, symbol]
      );

      if (instanceResult.rows.length === 0) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 持仓状态但无上下文，重置为IDLE`);
        await strategyInstance.updateState(symbol, 'IDLE');
        return;
      }

      let context: any = {};
      try {
        context = typeof instanceResult.rows[0].context === 'string' 
          ? JSON.parse(instanceResult.rows[0].context)
          : instanceResult.rows[0].context;
      } catch (e) {
        logger.error(`策略 ${strategyId} 标的 ${symbol}: 解析上下文失败`, e);
        return;
      }

      const entryPrice = context.entryPrice;
      const stopLoss = context.stopLoss;
      const takeProfit = context.takeProfit;
      const quantity = context.quantity;

      if (!entryPrice || !quantity) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 持仓状态但缺少入场价或数量`);
        return;
      }

      logger.log(`策略 ${strategyId} 标的 ${symbol}: 持仓监控 - 入场价=${entryPrice.toFixed(2)}, 止损=${stopLoss?.toFixed(2) || '未设置'}, 止盈=${takeProfit?.toFixed(2) || '未设置'}, 数量=${quantity}`);

      // 2. 获取当前价格（优先从行情API，失败则从持仓数据获取）
      let currentPrice = 0;
      
      try {
        const { getQuoteContext } = await import('../config/longport');
        const quoteCtx = await getQuoteContext();
        const quotes = await quoteCtx.quote([symbol]);
        
        if (quotes && quotes.length > 0) {
          // Longbridge SDK返回的是驼峰命名：lastDone
          const price = parseFloat(quotes[0].lastDone?.toString() || quotes[0].last_done?.toString() || '0');
          if (price > 0) {
            currentPrice = price;
          }
        }
      } catch (error: any) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 从行情API获取价格失败: ${error.message}`);
      }

      // 如果行情API获取失败，尝试从持仓数据中获取
      if (currentPrice <= 0) {
        try {
          const allPositions = await this.getCachedPositions();
          const position = allPositions.find((pos: any) => {
            const posSymbol = pos.symbol || pos.stock_name;
            return posSymbol === symbol;
          });
          
          if (position) {
            // 尝试多个可能的字段名
            const price = parseFloat(
              position.lastPrice?.toString() || 
              position.last_price?.toString() || 
              position.currentPrice?.toString() || 
              position.current_price?.toString() || 
              '0'
            );
            if (price > 0) {
              currentPrice = price;
              logger.log(`策略 ${strategyId} 标的 ${symbol}: 从持仓数据获取当前价格=${currentPrice.toFixed(2)}`);
            }
          }
        } catch (error: any) {
          logger.warn(`策略 ${strategyId} 标的 ${symbol}: 从持仓数据获取价格失败: ${error.message}`);
        }
      }

      if (currentPrice <= 0) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 无法获取当前价格（已尝试行情API和持仓数据），跳过本次监控`);
        return;
      }

      // 计算盈亏
      const pnl = (currentPrice - entryPrice) * quantity;
      const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

      logger.log(`策略 ${strategyId} 标的 ${symbol}: 持仓监控 - 当前价=${currentPrice.toFixed(2)}, 盈亏=${pnl.toFixed(2)} (${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);

      // 3. 获取完整的持仓上下文
      const positionContext = await dynamicPositionManager.getPositionContext(
        strategyId,
        symbol,
        context
      );

      // 4. 获取当前市场环境
      const marketEnv = await dynamicPositionManager.getCurrentMarketEnvironment(symbol);

      // 5. 检查固定止盈/止损（使用当前调整后的值）
      const currentStopLoss = positionContext.currentStopLoss || stopLoss;
      const currentTakeProfit = positionContext.currentTakeProfit || takeProfit;

      let shouldSell = false;
      let exitReason = '';
      let exitPrice = currentPrice;

      if (currentStopLoss && currentPrice <= currentStopLoss) {
        shouldSell = true;
        exitReason = 'STOP_LOSS';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 触发止损 (当前价=${currentPrice.toFixed(2)}, 止损价=${currentStopLoss.toFixed(2)})`);
      } else if (currentTakeProfit && currentPrice >= currentTakeProfit) {
        shouldSell = true;
        exitReason = 'TAKE_PROFIT';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 触发止盈 (当前价=${currentPrice.toFixed(2)}, 止盈价=${currentTakeProfit.toFixed(2)})`);
      } else {
        // 6. 动态调整止盈/止损
        const adjustmentResult = await dynamicPositionManager.adjustStopLossTakeProfit(
          positionContext,
          currentPrice,
          marketEnv.marketEnv,
          marketEnv.marketStrength,
          symbol
        );

        // 如果动态调整建议卖出
        if (adjustmentResult.shouldSell) {
          shouldSell = true;
          exitReason = adjustmentResult.exitReason || 'DYNAMIC_ADJUSTMENT';
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 动态调整建议卖出 - ${exitReason}`);
        }

        // 更新上下文（保存调整后的止盈/止损）
        // 使用安全的比较，处理 undefined 情况
        const stopLossChanged = adjustmentResult.context.currentStopLoss !== undefined &&
          adjustmentResult.context.currentStopLoss !== positionContext.currentStopLoss;
        const takeProfitChanged = adjustmentResult.context.currentTakeProfit !== undefined &&
          adjustmentResult.context.currentTakeProfit !== positionContext.currentTakeProfit;
        
        if (stopLossChanged || takeProfitChanged) {
          // 更新数据库中的上下文
          await strategyInstance.updateState(symbol, 'HOLDING', adjustmentResult.context);
          const oldStopLoss = positionContext.currentStopLoss ?? positionContext.originalStopLoss;
          const oldTakeProfit = positionContext.currentTakeProfit ?? positionContext.originalTakeProfit;
          const newStopLoss = adjustmentResult.context.currentStopLoss;
          const newTakeProfit = adjustmentResult.context.currentTakeProfit;
          
          logger.log(
            `策略 ${strategyId} 标的 ${symbol}: 动态调整止盈/止损 - ` +
            `止损: ${oldStopLoss ? oldStopLoss.toFixed(2) : 'N/A'} -> ${newStopLoss ? newStopLoss.toFixed(2) : 'N/A'}, ` +
            `止盈: ${oldTakeProfit ? oldTakeProfit.toFixed(2) : 'N/A'} -> ${newTakeProfit ? newTakeProfit.toFixed(2) : 'N/A'}`
          );
        } else {
          // 没有调整，记录监控状态
          logger.debug(
            `策略 ${strategyId} 标的 ${symbol}: 持仓监控 - 未触发卖出条件 ` +
            `(当前价=${currentPrice.toFixed(2)}, 止损=${currentStopLoss?.toFixed(2) || 'N/A'}, ` +
            `止盈=${currentTakeProfit?.toFixed(2) || 'N/A'}, 市场环境=${marketEnv.marketEnv})`
          );
        }
      }

      // 4. 如果需要卖出，执行卖出
      if (shouldSell) {
        // 检查是否有未成交的卖出订单（强制刷新缓存，避免重复提交）
        const hasPendingSellOrder = await this.checkPendingSellOrder(strategyId, symbol, true);
        if (hasPendingSellOrder) {
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 已有未成交卖出订单，跳过`);
          return;
        }

        // 双重检查：在更新状态前再次检查（防止竞态条件）
        // 使用数据库查询检查是否有未成交的卖出订单
        const dbCheckResult = await pool.query(
          `SELECT eo.order_id, eo.current_status 
           FROM execution_orders eo
           WHERE eo.strategy_id = $1 
           AND eo.symbol = $2 
           AND eo.side IN ('SELL', 'Sell', '2')
           AND eo.current_status IN ('SUBMITTED', 'NEW', 'PARTIALLY_FILLED')
           AND eo.created_at >= NOW() - INTERVAL '1 hour'
           ORDER BY eo.created_at DESC
           LIMIT 1`,
          [strategyId, symbol]
        );
        
        if (dbCheckResult.rows.length > 0) {
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 数据库检查发现已有未成交卖出订单 (${dbCheckResult.rows[0].order_id})，跳过`);
          return;
        }

        // 更新状态为CLOSING
        await strategyInstance.updateState(symbol, 'CLOSING', {
          ...context,
          exitReason,
          exitPrice,
        });

        // 创建卖出意图
        const sellIntent = {
          action: 'SELL' as const,
          symbol,
          entryPrice: exitPrice,
          quantity: quantity,
          reason: `自动卖出: ${exitReason}`,
        };

        // 执行卖出
        const executionResult = await basicExecutionService.executeSellIntent(sellIntent, strategyId);

        if (executionResult.success) {
          // 卖出成功，状态会在订单追踪中更新为IDLE
          logger.log(`策略 ${strategyId} 标的 ${symbol} 卖出成功，订单ID: ${executionResult.orderId}`);
        } else if (executionResult.submitted && executionResult.orderId) {
          // 订单已提交但未成交，保持CLOSING状态
          logger.log(`策略 ${strategyId} 标的 ${symbol} 卖出订单已提交，等待成交，订单ID: ${executionResult.orderId}`);
        } else {
          // 卖出失败，恢复HOLDING状态
          await strategyInstance.updateState(symbol, 'HOLDING', context);
          const errorMsg = executionResult.error || '卖出失败';
          logger.error(`策略 ${strategyId} 标的 ${symbol} 卖出失败: ${errorMsg}`);
        }
      }
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理持仓状态失败 (${symbol}):`, error);
    }
  }

  /**
   * 处理平仓状态：检查卖出订单状态
   */
  private async processClosingPosition(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    try {
      // 检查是否有未成交的卖出订单
      const hasPendingSellOrder = await this.checkPendingSellOrder(strategyId, symbol);
      
      if (!hasPendingSellOrder) {
        // 没有未成交订单，可能是已成交或已取消，检查实际持仓
        const hasPosition = await this.checkExistingPosition(strategyId, symbol);
        if (!hasPosition) {
          // 没有持仓，说明已卖出，更新状态为IDLE
          await strategyInstance.updateState(symbol, 'IDLE');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 平仓完成，更新状态为IDLE`);
        } else {
          // 仍有持仓，恢复HOLDING状态
          await strategyInstance.updateState(symbol, 'HOLDING');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 仍有持仓，恢复HOLDING状态`);
        }
      }
      // 如果有未成交订单，保持CLOSING状态，等待订单追踪更新
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理平仓状态失败 (${symbol}):`, error);
    }
  }

  /**
   * 同步持仓状态：当检测到有实际持仓但状态是IDLE时，更新状态为HOLDING
   */
  private async syncPositionState(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    try {
      // 1. 检查当前状态（应该是IDLE）
      const currentState = await strategyInstance.getCurrentState(symbol);
      if (currentState !== 'IDLE') {
        return; // 不是IDLE状态，不需要同步
      }

      // 2. 获取实际持仓信息
      const allPositions = await this.getCachedPositions();
      const actualPosition = allPositions.find((pos: any) => {
        const posSymbol = pos.symbol || pos.stock_name;
        return posSymbol === symbol;
      });

      if (!actualPosition) {
        return; // 没有实际持仓，不需要同步
      }

      const quantity = parseInt(actualPosition.quantity?.toString() || '0');
      if (quantity <= 0) {
        return; // 持仓数量为0，不需要同步
      }

      // 3. 获取成本价（如果没有，使用当前价格）
      let costPrice = parseFloat(actualPosition.costPrice?.toString() || actualPosition.cost_price?.toString() || '0');
      
      // 如果成本价为0，尝试获取当前价格
      if (costPrice <= 0) {
        try {
          const { getQuoteContext } = await import('../config/longport');
          const quoteCtx = await getQuoteContext();
          const quotes = await quoteCtx.quote([symbol]);
          if (quotes && quotes.length > 0) {
            // Longbridge SDK返回的是驼峰命名：lastDone
            costPrice = parseFloat(quotes[0].lastDone?.toString() || quotes[0].last_done?.toString() || '0');
          }
        } catch (error: any) {
          logger.warn(`策略 ${strategyId} 标的 ${symbol}: 无法获取价格，使用默认值`, error.message);
          costPrice = 0; // 如果无法获取价格，设置为0，后续会通过持仓监控更新
        }
      }

      // 4. 检查是否已有上下文（避免覆盖）
      const instanceResult = await pool.query(
        `SELECT context FROM strategy_instances 
         WHERE strategy_id = $1 AND symbol = $2`,
        [strategyId, symbol]
      );

      let existingContext: any = {};
      if (instanceResult.rows.length > 0 && instanceResult.rows[0].context) {
        try {
          existingContext = typeof instanceResult.rows[0].context === 'string' 
            ? JSON.parse(instanceResult.rows[0].context)
            : instanceResult.rows[0].context;
        } catch (e) {
          // 忽略JSON解析错误
        }
      }

      // 5. 如果已有入场价和数量，说明之前已经同步过，只需要更新状态
      if (existingContext.entryPrice && existingContext.quantity) {
        // 但状态可能不对，更新状态为HOLDING
        if (currentState === 'IDLE') {
          await strategyInstance.updateState(symbol, 'HOLDING', existingContext);
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 状态同步 - 从IDLE更新为HOLDING（已有上下文）`);
        }
        return;
      }

      // 6. 生成信号以获取止盈/止损（如果策略支持）
      let stopLoss: number | undefined;
      let takeProfit: number | undefined;
      
      try {
        const intent = await strategyInstance.generateSignal(symbol, undefined);
        if (intent) {
          stopLoss = intent.stopLoss;
          takeProfit = intent.takeProfit;
        }
      } catch (error: any) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 生成信号失败，无法获取止盈/止损`, error.message);
      }

      // 7. 如果没有止盈/止损，使用默认值（基于成本价的百分比）
      // 默认止损：成本价的 -5%
      // 默认止盈：成本价的 +10%
      if (!stopLoss && costPrice > 0) {
        stopLoss = costPrice * 0.95; // -5%
      }
      if (!takeProfit && costPrice > 0) {
        takeProfit = costPrice * 1.10; // +10%
      }

      // 8. 更新状态为HOLDING，并保存持仓信息
      const context = {
        entryPrice: costPrice > 0 ? costPrice : undefined,
        quantity: quantity,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        syncedFromPosition: true, // 标记这是从实际持仓同步的
        syncedAt: new Date().toISOString(),
      };

      await strategyInstance.updateState(symbol, 'HOLDING', context);
      
      logger.log(
        `策略 ${strategyId} 标的 ${symbol}: 状态同步完成 - ` +
        `从IDLE更新为HOLDING, 数量=${quantity}, ` +
        `成本价=${costPrice > 0 ? costPrice.toFixed(2) : '未知'}, ` +
        `止损=${stopLoss?.toFixed(2) || '未设置'}, ` +
        `止盈=${takeProfit?.toFixed(2) || '未设置'}`
      );
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 同步持仓状态失败 (${symbol}):`, error);
    }
  }

  /**
   * 检查是否有未成交的卖出订单
   * @param strategyId 策略ID（保留用于未来扩展）
   * @param symbol 标的代码
   * @param forceRefresh 是否强制刷新缓存（用于避免重复提交订单）
   */
  private async checkPendingSellOrder(_strategyId: number, symbol: string, forceRefresh: boolean = false): Promise<boolean> {
    try {
      // 如果强制刷新，清除缓存并重新获取订单
      const todayOrders = await this.getTodayOrders(forceRefresh);
      
      const pendingStatuses = [
        'NotReported',
        'NewStatus',
        'WaitToNew',
        'PartialFilledStatus',
        'PendingReplaceStatus',
        'WaitToReplace',
        'ReplacedNotReported',
        'ProtectedNotReported',
        'VarietiesNotReported',
      ];
      
      for (const order of todayOrders) {
        const orderSymbol = order.symbol || order.stock_name;
        const orderSide = order.side;
        
        // 标准化方向：Sell/2/SELL 都视为卖出
        const isSell = orderSide === 'Sell' || orderSide === 2 || orderSide === 'SELL' || orderSide === 'sell';
        
        if (orderSymbol === symbol && isSell) {
          const status = this.normalizeOrderStatus(order.status);
          
          if (pendingStatuses.includes(status)) {
            logger.log(`检查到未成交卖出订单: ${symbol}, 订单ID: ${order.orderId || order.order_id}, 状态: ${status}`);
            return true;
          }
        }
      }
      
      return false;
    } catch (error: any) {
      logger.error(`检查未成交卖出订单失败 (${symbol}):`, error);
      // 出错时返回true，保守处理，避免重复提交
      return true;
    }
  }

  /**
   * 创建策略实例
   */
  private createStrategyInstance(
    strategyType: string,
    strategyId: number,
    config: any
  ): StrategyBase {
    switch (strategyType) {
      case 'RECOMMENDATION_V1':
        return new RecommendationStrategy(strategyId, config);
      default:
        throw new Error(`未知的策略类型: ${strategyType}`);
    }
  }
}

// 导出单例
export default new StrategyScheduler();

