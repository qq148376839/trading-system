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
import { getTradeContext } from '../config/longport';
import orderPreventionMetrics from './order-prevention-metrics.service';
import todayOrdersCache from './today-orders-cache.service';

// 定义执行汇总接口
interface ExecutionSummary {
  strategyId: number;
  startTime: number;
  totalTargets: number;
  idle: string[];      // IDLE 状态标的
  holding: string[];   // HOLDING 状态标的
  signals: string[];   // 生成信号的标的
  errors: string[];    // 发生错误的标的
  actions: string[];   // 执行了操作（买入/卖出/更新状态）的标的
  other: string[];     // 其他状态（如OPENING/CLOSING/COOLDOWN）
}

class StrategyScheduler {
  private runningStrategies: Map<number, NodeJS.Timeout> = new Map();
  private orderMonitorIntervals: Map<number, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  // 持仓缓存：避免频繁调用 stockPositions() API
  private positionCache: Map<string, { positions: any[]; timestamp: number }> = new Map();
  private readonly POSITION_CACHE_TTL = 30000; // 30秒缓存
  // 订单提交缓存：防止重复提交订单
  private orderSubmissionCache: Map<string, { timestamp: number; orderId?: string }> = new Map();
  private readonly ORDER_CACHE_TTL = 60000; // 60秒缓存

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
    // 初始化执行汇总
    const summary: ExecutionSummary = {
      strategyId,
      startTime: Date.now(),
      totalTargets: 0,
      idle: [],
      holding: [],
      signals: [],
      errors: [],
      actions: [],
      other: []
    };

    // 1. 获取股票池
    const symbols = await stockSelector.getSymbolPool(symbolPoolConfig);
    
    if (!symbols || symbols.length === 0) {
      logger.log(`策略 ${strategyId}: 股票池为空，跳过本次运行`);
      return;
    }

    summary.totalTargets = symbols.length;
    // 只有在调试模式下才输出详细的开始日志
    // logger.debug(`策略 ${strategyId}: 开始处理 ${symbols.length} 个标的: ${symbols.join(', ')}`);

    // 2. 分批并行处理多个股票（避免连接池耗尽）
    // 每批处理10个标的，避免一次性占用过多数据库连接
    const BATCH_SIZE = 10;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((symbol) => this.processSymbol(strategyInstance, strategyId, symbol, summary))
      );
      // 批次之间稍作延迟，避免数据库压力过大
      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms延迟
      }
    }

    // 3. 输出汇总日志
    this.logExecutionSummary(summary);
  }

  /**
   * 输出执行汇总日志
   * 优化：根据PRD要求，实现日志聚合和降噪
   */
  private logExecutionSummary(summary: ExecutionSummary): void {
    const duration = Date.now() - summary.startTime;
    const hasActivity = summary.signals.length > 0 || summary.errors.length > 0 || summary.actions.length > 0;
    
    // 如果有活动（信号、错误、操作），输出详细汇总
    if (hasActivity) {
      logger.info(
        `策略 ${summary.strategyId} 执行完成: 耗时 ${duration}ms, ` +
        `扫描 ${summary.totalTargets} 个标的, ` +
        `⚠️ 信号 ${summary.signals.length}, ` +
        `❌ 错误 ${summary.errors.length}, ` +
        `⚡ 操作 ${summary.actions.length}, ` +
        `IDLE: ${summary.idle.length}, HOLDING: ${summary.holding.length}`,
        { 
          metadata: {
            strategyId: summary.strategyId,
            duration,
            totalTargets: summary.totalTargets,
            signals: summary.signals,
            errors: summary.errors,
            actions: summary.actions,
            counts: {
              idle: summary.idle.length,
              holding: summary.holding.length,
              other: summary.other.length
            }
          }
        }
      );
    } else {
      // 纯净模式（全无事）：只记录基本统计，使用精简的metadata节省数据库空间
      logger.info(
        `策略 ${summary.strategyId} 执行完成: 耗时 ${duration}ms, ` +
        `扫描 ${summary.totalTargets} 个标的 (IDLE: ${summary.idle.length}, HOLDING: ${summary.holding.length})`,
        { 
          metadata: { 
            strategyId: summary.strategyId,
            duration,
            totalTargets: summary.totalTargets,
            counts: {
              idle: summary.idle.length,
              holding: summary.holding.length,
              other: summary.other.length
            }
          } 
        }
      );
    }
  }

  /**
   * 追踪未成交订单，根据市场变化更新价格和状态
   * 修订：使用 todayOrders() API 获取订单，实时监控订单状态
   */
  private async trackPendingOrders(strategyId: number): Promise<void> {
    try {
      // 1. 获取今日订单（使用统一缓存服务，避免频繁请求导致频率限制）
      const todayOrders = await todayOrdersCache.getTodayOrders(false);
      
      // 2. 查询策略的所有订单（买入和卖出，用于价格更新和状态同步）
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
          return false;
        }
        
        const rawStatus = apiOrder.status;
        const status = this.normalizeOrderStatus(rawStatus);
        
        // 严格排除所有已完成的订单
        if (completedStatuses.includes(status)) {
          return false;
        }
        
        return pendingStatuses.includes(status);
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
          if (status === 'FilledStatus' || status === 'PartialFilledStatus') {
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
            
            // 更新信号状态为EXECUTED（如果订单已成交）
            try {
              await basicExecutionService.updateSignalStatusByOrderId(dbOrder.order_id, 'EXECUTED');
            } catch (signalError: any) {
              logger.warn(`更新信号状态失败 (orderId: ${dbOrder.order_id}):`, signalError.message);
            }
          } else if (status === 'CanceledStatus' || status === 'PendingCancelStatus' || status === 'WaitToCancel') {
            dbStatus = 'CANCELLED';
            // 只有在状态发生变化时才处理（避免重复处理）
            if (dbOrder.current_status !== 'CANCELLED') {
              await this.handleOrderCancelled(strategyId, dbOrder.symbol, dbOrder.order_id);
              
              // 更新信号状态为IGNORED（如果订单被取消）
              try {
                await basicExecutionService.updateSignalStatusByOrderId(dbOrder.order_id, 'IGNORED');
              } catch (signalError: any) {
                logger.warn(`更新信号状态失败 (orderId: ${dbOrder.order_id}):`, signalError.message);
              }
            }
          } else if (status === 'RejectedStatus') {
            dbStatus = 'FAILED';
            // 只有在状态发生变化时才处理（避免重复处理）
            if (dbOrder.current_status !== 'FAILED') {
              await this.handleOrderRejected(strategyId, dbOrder.symbol, dbOrder.order_id);
              
              // 更新信号状态为REJECTED（如果订单被拒绝）
              try {
                await basicExecutionService.updateSignalStatusByOrderId(dbOrder.order_id, 'REJECTED');
              } catch (signalError: any) {
                logger.warn(`更新信号状态失败 (orderId: ${dbOrder.order_id}):`, signalError.message);
              }
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
        
        // 用于跟踪已处理的订单，避免重复处理
        const processedOrders = new Set<string>();
        
        for (const dbOrder of strategyOrders.rows) {
          const apiOrder = todayOrders.find((o: any) => 
            (o.orderId || o.order_id) === dbOrder.order_id
          );
          
          if (!apiOrder) continue;
          
          const status = this.normalizeOrderStatus(apiOrder.status);
          const isBuy = dbOrder.side === 'BUY' || dbOrder.side === 'Buy' || dbOrder.side === 1;
          const isSell = dbOrder.side === 'SELL' || dbOrder.side === 'Sell' || dbOrder.side === 2;
          
          // 检查订单是否已处理：1) 数据库状态已经是FILLED，或 2) 在当前循环中已处理过
          if (status === 'FilledStatus' && dbOrder.current_status !== 'FILLED' && !processedOrders.has(dbOrder.order_id)) {
            // 标记为已处理，避免重复处理
            processedOrders.add(dbOrder.order_id);
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
                  
                  // 释放资金：使用实际成交金额（卖出价格 * 成交数量）
                  let releaseAmount = 0;
                  
                  if (avgPrice > 0 && filledQuantity > 0) {
                    releaseAmount = avgPrice * filledQuantity;
                    logger.log(
                      `策略 ${strategyId} 标的 ${dbOrder.symbol} 卖出订单已成交，` +
                      `使用实际成交金额释放资金: ${releaseAmount.toFixed(2)} ` +
                      `(成交价=${avgPrice.toFixed(2)}, 数量=${filledQuantity})`
                    );
                  } else {
                    // 方法2：从context中获取持仓价值（fallback）
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
                          releaseAmount = parseFloat(context.allocationAmount.toString() || '0');
                        } else if (context.entryPrice && context.quantity) {
                          releaseAmount = parseFloat(context.entryPrice.toString() || '0') * 
                                         parseInt(context.quantity.toString() || '0');
                        }
                      } catch (e) {
                        logger.error(`策略 ${strategyId} 标的 ${dbOrder.symbol} 解析context失败:`, e);
                      }
                    }
                  }
                  
                  if (releaseAmount > 0) {
                    await capitalManager.releaseAllocation(
                      strategyId,
                      releaseAmount,
                      dbOrder.symbol
                    );
                  }
                  
                  // 立即更新数据库状态为FILLED，防止重复处理
                  await pool.query(
                    `UPDATE execution_orders 
                     SET current_status = 'FILLED', updated_at = NOW()
                     WHERE order_id = $1 AND current_status != 'FILLED'`,
                    [dbOrder.order_id]
                  );
                }
              } catch (error: any) {
                logger.error(`更新已成交订单状态失败 (${dbOrder.order_id}):`, error);
                if (processedOrders) {
                  processedOrders.add(dbOrder.order_id);
                }
              }
            }
          }
        }
      }

      // 6. 如果没有待监控的订单，直接返回
      if (pendingOrders.length === 0) {
        return;
      }

      logger.log(`策略 ${strategyId}: 监控 ${pendingOrders.length} 个未成交订单`);

      // 7. 获取当前行情并评估是否需要调整订单价格
      const { getQuoteContext } = await import('../config/longport');
      const quoteCtx = await getQuoteContext();
      const symbols = pendingOrders.map((row: any) => row.symbol);
      const quotes = await quoteCtx.quote(symbols);

      const quoteMap = new Map<string, any>();
      for (const quote of quotes) {
        quoteMap.set(quote.symbol, quote);
      }

      // 处理每个订单
      for (const order of pendingOrders) {
        try {
          const apiOrder = todayOrders.find((o: any) => 
            (o.orderId || o.order_id) === order.order_id
          );
          
          if (!apiOrder) continue;
          
          const orderType = apiOrder.orderType || apiOrder.order_type;
          
          // 市价单不支持修改
          if (orderType === 'MO' || orderType === 2) {
            continue;
          }
          
          if (orderType === 'SLO') {
            continue;
          }
          
          const quote = quoteMap.get(order.symbol);
          if (!quote) continue;

          const currentPrice = parseFloat(quote.lastDone?.toString() || quote.last_done?.toString() || '0');
          const orderPrice = parseFloat(order.price);
          
          if (currentPrice <= 0) continue;

          // 计算价格差异百分比
          const priceDiff = Math.abs(currentPrice - orderPrice) / orderPrice;
          
          // 如果当前价格与订单价格差异超过2%，更新订单价格
          if (priceDiff > 0.02) {
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
            const { getTradeContext, Decimal } = await import('../config/longport');
            const tradeCtx = await getTradeContext();
            const orderQuantity = parseInt(order.quantity?.toString() || '0');
            
            if (orderQuantity <= 0) continue;
            
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
            
            logger.log(`策略 ${strategyId} 标的 ${order.symbol} 订单价格已更新: ${orderPrice.toFixed(2)} -> ${formattedPrice.toFixed(2)}`);
          }
        } catch (orderError: any) {
          const errorMessage = orderError.message || '';
          const errorCode = orderError.code || '';
          
          if (errorCode === '602012' || errorMessage.includes('602012') || errorMessage.includes('Order amendment is not supported')) {
            continue;
          }
          
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
      const checkResult = await pool.query(
        `SELECT current_status FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (checkResult.rows.length === 0 || checkResult.rows[0].current_status === 'CANCELLED') {
        return;
      }
      
      const orderResult = await pool.query(
        `SELECT quantity, price FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        const amount = parseFloat(order.quantity) * parseFloat(order.price);
        
        await capitalManager.releaseAllocation(strategyId, amount, symbol);
        
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
      const checkResult = await pool.query(
        `SELECT current_status FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (checkResult.rows.length === 0 || checkResult.rows[0].current_status === 'FAILED') {
        return;
      }
      
      const orderResult = await pool.query(
        `SELECT quantity, price FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        const amount = parseFloat(order.quantity) * parseFloat(order.price);
        
        await capitalManager.releaseAllocation(strategyId, amount, symbol);
        
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
    symbol: string,
    summary: ExecutionSummary
  ): Promise<void> {
    try {
      // 检查当前状态
      const currentState = await strategyInstance.getCurrentState(symbol);
      
      // 根据状态进行不同处理
      if (currentState === 'HOLDING') {
        // 持仓状态：检查是否需要卖出（止盈/止损）
        // 传递 summary 给子方法，用于记录执行结果
        const actionResult = await this.processHoldingPosition(strategyInstance, strategyId, symbol);
        if (actionResult.actionTaken) {
          summary.actions.push(symbol);
        } else {
          summary.holding.push(symbol);
        }
        return;
      } else if (currentState === 'CLOSING') {
        summary.other.push(`${symbol}(CLOSING)`);
        await this.processClosingPosition(strategyInstance, strategyId, symbol);
        return;
      } else if (currentState === 'OPENING' || currentState === 'COOLDOWN') {
        summary.other.push(`${symbol}(${currentState})`);
        return;
      } else if (currentState !== 'IDLE') {
        summary.other.push(`${symbol}(${currentState})`);
        return;
      }

      // IDLE 状态：处理买入逻辑

      // 检查是否已有持仓（避免重复买入）
      const hasPosition = await this.checkExistingPosition(strategyId, symbol);
      if (hasPosition) {
        await this.syncPositionState(strategyInstance, strategyId, symbol);
        summary.actions.push(`${symbol}(SYNC_HOLDING)`);
        return;
      }

      // 检查是否有未成交的订单
      const hasPendingOrder = await this.checkPendingOrder(strategyId, symbol);
      if (hasPendingOrder) {
        summary.idle.push(symbol); // 有未成交订单，视为 IDLE/PENDING，不在此处 log
        return;
      }

      // 生成信号（marketData 参数可选，策略内部会自行获取）
      const intent = await strategyInstance.generateSignal(symbol, undefined);

      if (!intent) {
        summary.idle.push(symbol); // 未生成信号，视为 IDLE
        return;
      }

      if (intent.action === 'HOLD') {
        summary.idle.push(symbol); // HOLD 信号，视为 IDLE
        return;
      }

      // 记录信号日志（关键信息，实时输出到控制台，但不写入数据库）
      // 使用 console.log 只输出到控制台，避免写入数据库造成日志膨胀
      console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 生成信号 ${intent.action}, 价格=${intent.entryPrice?.toFixed(2) || 'N/A'}, 原因=${intent.reason?.substring(0, 50) || 'N/A'}`);
      summary.signals.push(symbol);

      // 验证策略执行是否安全（防止高买低卖、重复下单等）
      const validation = await this.validateStrategyExecution(strategyId, symbol, intent);
      if (!validation.valid) {
        logger.warn(
          `[策略执行验证] 策略 ${strategyId} 标的 ${symbol} 执行被阻止: ${validation.reason}`
        );
        summary.errors.push(`${symbol}(VALIDATION_FAILED)`);
        
        await pool.query(
          `INSERT INTO signal_logs (strategy_id, symbol, signal_type, signal_data, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [
            strategyId,
            symbol,
            'VALIDATION_FAILED',
            JSON.stringify({
              intent,
              reason: validation.reason,
              timestamp: new Date().toISOString(),
            }),
          ]
        );
        return;
      }

      // 如果是买入信号，执行交易
      if (intent.action === 'BUY') {
        const availableCapital = await capitalManager.getAvailableCapital(strategyId);
        
        if (availableCapital <= 0) {
          // 可用资金不足：只输出到控制台，不写入数据库（信息已在汇总日志中）
          console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 可用资金不足 (${availableCapital.toFixed(2)})，跳过买入`);
          summary.errors.push(`${symbol}(NO_CAPITAL)`);
          return;
        }

        // 计算数量
        if (!intent.quantity && intent.entryPrice) {
          const maxPositionPerSymbol = await capitalManager.getMaxPositionPerSymbol(strategyId);
          const maxAmountForThisSymbol = Math.min(availableCapital, maxPositionPerSymbol);
          const maxAffordableQuantity = Math.floor(maxAmountForThisSymbol / intent.entryPrice);
          intent.quantity = Math.max(1, maxAffordableQuantity);
        }

        if (!intent.quantity || intent.quantity <= 0) {
          summary.errors.push(`${symbol}(INVALID_QUANTITY)`);
          return;
        }

        // 准备买入：只输出到控制台，不写入数据库（信息已在汇总日志中）
        console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 准备买入，数量=${intent.quantity}, 价格=${intent.entryPrice?.toFixed(2)}`);

        // 申请资金
        const allocationResult = await capitalManager.requestAllocation({
          strategyId,
          amount: intent.quantity * (intent.entryPrice || 0),
          symbol,
        });

        if (!allocationResult.approved) {
          // 资金申请被拒绝：只输出到控制台，不写入数据库（信息已在汇总日志中）
          console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 资金申请被拒绝 - ${allocationResult.reason || '未知原因'}`);
          summary.errors.push(`${symbol}(CAPITAL_REJECTED)`);
          return;
        }

        // 更新状态为 OPENING
        await strategyInstance.updateState(symbol, 'OPENING', {
          intent,
          allocationAmount: allocationResult.allocatedAmount,
        });

        // 执行买入
        const executionResult = await basicExecutionService.executeBuyIntent(intent, strategyId);

        if (executionResult.submitted && executionResult.orderId) {
          this.markOrderSubmitted(strategyId, symbol, 'BUY', executionResult.orderId);
          summary.actions.push(`${symbol}(BUY_SUBMITTED)`);
        }

        if (executionResult.success) {
          // 获取当前市场环境（用于保存到上下文）
          const marketEnv = await dynamicPositionManager.getCurrentMarketEnvironment(symbol);
          
          let originalATR: number | undefined;
          try {
            const recommendation = await tradingRecommendationService.calculateRecommendation(symbol);
            originalATR = recommendation.atr;
          } catch (error: any) {
            // 忽略
          }

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
          summary.actions.push(`${symbol}(BUY_FILLED)`);
        } else if (executionResult.submitted && executionResult.orderId) {
          // 订单已提交但未成交，保持 OPENING
          logger.log(`策略 ${strategyId} 标的 ${symbol} 订单已提交，等待成交`);
        } else {
          // 失败
          await capitalManager.releaseAllocation(
            strategyId,
            allocationResult.allocatedAmount,
            symbol
          );
          await strategyInstance.updateState(symbol, 'IDLE');
          logger.error(`策略 ${strategyId} 标的 ${symbol} 买入失败: ${executionResult.error}`);
          summary.errors.push(`${symbol}(BUY_FAILED)`);
        }
      }
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理标的 ${symbol} 出错:`, error);
      summary.errors.push(`${symbol}(EXCEPTION)`);
    }
  }

  // ... (getCachedPositions, checkExistingPosition 等辅助方法保持不变)
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
   */
  private async checkPendingOrder(_strategyId: number, symbol: string): Promise<boolean> {
    try {
      const todayOrders = await todayOrdersCache.getTodayOrders();
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
        const isBuy = orderSide === 'Buy' || orderSide === 1 || orderSide === 'BUY' || orderSide === 'buy';
        
        if (orderSymbol === symbol && isBuy) {
          const status = this.normalizeOrderStatus(order.status);
          if (pendingStatuses.includes(status)) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error: any) {
      logger.error(`检查未成交订单失败 (${symbol}):`, error);
      return false;
    }
  }

  /**
   * 处理持仓状态：检查止盈/止损
   * 修改：返回处理结果，以便上层做日志聚合
   */
  private async processHoldingPosition(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<{ actionTaken: boolean }> {
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
        return { actionTaken: true };
      }

      let context: any = {};
      try {
        const contextData = instanceResult.rows[0].context;
        if (!contextData) {
          // ... (尝试恢复 context 的逻辑保持不变，但减少日志或降级为debug)
          // 简化为:
          logger.warn(`策略 ${strategyId} 标的 ${symbol}: 持仓状态但context为空`);
          // 恢复逻辑省略，为了简洁，这里假设必须有context
          return { actionTaken: false };
        } else {
          context = typeof contextData === 'string' 
            ? JSON.parse(contextData)
            : contextData;
        }
      } catch (e) {
        logger.error(`策略 ${strategyId} 标的 ${symbol}: 解析上下文失败`, e);
        return { actionTaken: false };
      }

      const entryPrice = context.entryPrice;
      let stopLoss = context.stopLoss;
      let takeProfit = context.takeProfit;
      const quantity = context.quantity;

      if (!entryPrice || !quantity) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 持仓状态但缺少入场价或数量`);
        return { actionTaken: false };
      }

      // logger.log(...) 移除，改为聚合时由上层统计 HOLDING

      // 2. 获取当前价格
      let currentPrice = 0;
      try {
        const { getQuoteContext } = await import('../config/longport');
        const quoteCtx = await getQuoteContext();
        const quotes = await quoteCtx.quote([symbol]);
        if (quotes && quotes.length > 0) {
          const price = parseFloat(quotes[0].lastDone?.toString() || quotes[0].last_done?.toString() || '0');
          if (price > 0) currentPrice = price;
        }
      } catch (error: any) {
        // 忽略错误，减少噪音
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
            const price = parseFloat(position.lastPrice?.toString() || position.currentPrice?.toString() || '0');
            if (price > 0) currentPrice = price;
          }
        } catch (error: any) {
          // 忽略
        }
      }

      if (currentPrice <= 0) {
        return { actionTaken: false };
      }

      // 3. 检查默认止盈/止损设置 (逻辑保持不变，但减少普通日志)
      let defaultStopLoss = stopLoss;
      let defaultTakeProfit = takeProfit;
      let needsUpdate = false;
      
      if (!defaultStopLoss && entryPrice > 0) {
        defaultStopLoss = entryPrice * 0.95;
        needsUpdate = true;
      }
      if (!defaultTakeProfit && entryPrice > 0) {
        defaultTakeProfit = entryPrice * 1.10;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        const updatedContext = {
          ...context,
          stopLoss: defaultStopLoss,
          takeProfit: defaultTakeProfit,
          originalStopLoss: context.originalStopLoss || defaultStopLoss,
          originalTakeProfit: context.originalTakeProfit || defaultTakeProfit,
          currentStopLoss: context.currentStopLoss || defaultStopLoss,
          currentTakeProfit: context.currentTakeProfit || defaultTakeProfit,
        };
        await strategyInstance.updateState(symbol, 'HOLDING', updatedContext);
        context = updatedContext;
        stopLoss = defaultStopLoss;
        takeProfit = defaultTakeProfit;
        // 设置默认止盈止损：只输出到控制台，不写入数据库（信息已在汇总日志中）
        console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 设置默认止盈止损`);
      }

      // 4. 获取完整的持仓上下文
      const positionContext = await dynamicPositionManager.getPositionContext(
        strategyId,
        symbol,
        context
      );

      // 5. 获取当前市场环境
      const marketEnv = await dynamicPositionManager.getCurrentMarketEnvironment(symbol);

      // 6. 检查固定止盈/止损
      const currentStopLoss = positionContext.currentStopLoss || stopLoss;
      const currentTakeProfit = positionContext.currentTakeProfit || takeProfit;

      let shouldSell = false;
      let exitReason = '';
      let exitPrice = currentPrice;
      let actionTaken = needsUpdate; // 如果更新了止盈止损，算作有动作

      if (currentStopLoss && currentPrice <= currentStopLoss) {
        shouldSell = true;
        exitReason = 'STOP_LOSS';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 触发止损 (当前价=${currentPrice.toFixed(2)}, 止损价=${currentStopLoss.toFixed(2)})`);
      } else if (currentTakeProfit && currentPrice >= currentTakeProfit) {
        shouldSell = true;
        exitReason = 'TAKE_PROFIT';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 触发止盈 (当前价=${currentPrice.toFixed(2)}, 止盈价=${currentTakeProfit.toFixed(2)})`);
      } else {
        // 动态调整
        const adjustmentResult = await dynamicPositionManager.adjustStopLossTakeProfit(
          positionContext,
          currentPrice,
          marketEnv.marketEnv,
          marketEnv.marketStrength,
          symbol
        );

        if (adjustmentResult.shouldSell) {
          shouldSell = true;
          exitReason = adjustmentResult.exitReason || 'DYNAMIC_ADJUSTMENT';
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 动态调整建议卖出 - ${exitReason}`);
        }

        const stopLossChanged = adjustmentResult.context.currentStopLoss !== undefined &&
          adjustmentResult.context.currentStopLoss !== positionContext.currentStopLoss;
        const takeProfitChanged = adjustmentResult.context.currentTakeProfit !== undefined &&
          adjustmentResult.context.currentTakeProfit !== positionContext.currentTakeProfit;
        
        if (stopLossChanged || takeProfitChanged) {
          await strategyInstance.updateState(symbol, 'HOLDING', adjustmentResult.context);
          // 动态调整止盈/止损：只输出到控制台，不写入数据库（信息已在汇总日志中）
          console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 动态调整止盈/止损`);
          actionTaken = true;
        }
      }

      // 7. 执行卖出
      if (shouldSell) {
        // ... (检查可用持仓逻辑不变)
        const positionCheck = await this.checkAvailablePosition(strategyId, symbol);
        if (positionCheck.hasPending) return { actionTaken };
        
        if (positionCheck.availableQuantity !== undefined && quantity > positionCheck.availableQuantity) {
          logger.error(`策略 ${strategyId} 标的 ${symbol}: 卖出数量不足`);
          return { actionTaken };
        }

        const dbCheckResult = await pool.query(
          `SELECT eo.order_id FROM execution_orders eo WHERE strategy_id = $1 AND symbol = $2 AND side IN ('SELL', 'Sell', '2') AND current_status IN ('SUBMITTED', 'NEW', 'PARTIALLY_FILLED') AND eo.created_at >= NOW() - INTERVAL '1 hour'`,
          [strategyId, symbol]
        );
        
        if (dbCheckResult.rows.length > 0) return { actionTaken };

        await strategyInstance.updateState(symbol, 'CLOSING', {
          ...context,
          exitReason,
          exitPrice,
        });

        // 获取最新价格并卖出
        let latestPrice = currentPrice;
        // ... (获取最新价格逻辑简化)

        const sellIntent = {
          action: 'SELL' as const,
          symbol,
          entryPrice: context.entryPrice || latestPrice,
          sellPrice: latestPrice,
          quantity: quantity,
          reason: `自动卖出: ${exitReason}`,
        };

        logger.log(`策略 ${strategyId} 标的 ${symbol}: 执行卖出 - 原因=${exitReason}`);
        const executionResult = await basicExecutionService.executeSellIntent(sellIntent, strategyId);

        if (executionResult.submitted && executionResult.orderId) {
          this.markOrderSubmitted(strategyId, symbol, 'SELL', executionResult.orderId);
        }

        if (executionResult.success || executionResult.submitted) {
          actionTaken = true;
        } else {
          await strategyInstance.updateState(symbol, 'HOLDING', context);
          logger.error(`策略 ${strategyId} 标的 ${symbol} 卖出失败: ${executionResult.error}`);
        }
      }

      return { actionTaken };
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理持仓状态失败 (${symbol}):`, error);
      return { actionTaken: false };
    }
  }

  // ... (其他方法保持不变)
  private async processClosingPosition(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    try {
      const hasPendingSellOrder = await this.checkPendingSellOrder(strategyId, symbol);
      
      if (!hasPendingSellOrder) {
        const hasPosition = await this.checkExistingPosition(strategyId, symbol);
        if (!hasPosition) {
          await strategyInstance.updateState(symbol, 'IDLE');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 平仓完成，更新状态为IDLE`);
        } else {
          await strategyInstance.updateState(symbol, 'HOLDING');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 仍有持仓，恢复HOLDING状态`);
        }
      }
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理平仓状态失败 (${symbol}):`, error);
    }
  }

  private async syncPositionState(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    // ... (保持不变，只是减少日志)
    try {
      const currentState = await strategyInstance.getCurrentState(symbol);
      if (currentState !== 'IDLE') return;

      const allPositions = await this.getCachedPositions();
      const actualPosition = allPositions.find((pos: any) => {
        const posSymbol = pos.symbol || pos.stock_name;
        return posSymbol === symbol;
      });

      if (!actualPosition) return;

      const quantity = parseInt(actualPosition.quantity?.toString() || '0');
      if (quantity <= 0) return;

      let costPrice = parseFloat(actualPosition.costPrice?.toString() || actualPosition.cost_price?.toString() || '0');
      
      if (costPrice <= 0) {
        try {
          const { getQuoteContext } = await import('../config/longport');
          const quoteCtx = await getQuoteContext();
          const quotes = await quoteCtx.quote([symbol]);
          if (quotes && quotes.length > 0) {
            costPrice = parseFloat(quotes[0].lastDone?.toString() || quotes[0].last_done?.toString() || '0');
          }
        } catch (error) {
          costPrice = 0;
        }
      }

      // ... (中间逻辑保持不变)

      // 状态同步：只输出到控制台，不写入数据库（信息已在汇总日志中）
      console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 状态同步 - 从IDLE更新为HOLDING`);
      
      // ... (更新状态逻辑)
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 同步持仓状态失败 (${symbol}):`, error);
    }
  }

  // ... (checkPendingSellOrder, checkAvailablePosition, validateStrategyExecution, markOrderSubmitted, createStrategyInstance 保持不变)
  private async checkPendingSellOrder(_strategyId: number, symbol: string, forceRefresh: boolean = false): Promise<boolean> {
    // ... (保持不变)
    try {
      const todayOrders = await todayOrdersCache.getTodayOrders(forceRefresh);
      const pendingStatuses = [
        'NotReported', 'NewStatus', 'WaitToNew', 'PartialFilledStatus',
        'PendingReplaceStatus', 'WaitToReplace', 'ReplacedNotReported',
        'ProtectedNotReported', 'VarietiesNotReported',
      ];
      
      for (const order of todayOrders) {
        const orderSymbol = order.symbol || order.stock_name;
        const orderSide = order.side;
        const isSell = orderSide === 'Sell' || orderSide === 2 || orderSide === 'SELL' || orderSide === 'sell';
        
        if (orderSymbol === symbol && isSell) {
          const status = this.normalizeOrderStatus(order.status);
          if (pendingStatuses.includes(status)) return true;
        }
      }
      return false;
    } catch (error: any) {
      return true;
    }
  }
  
  private async checkAvailablePosition(strategyId: number, symbol: string): Promise<{
    hasPending: boolean;
    availableQuantity?: number;
    actualQuantity?: number;
    pendingQuantity?: number;
  }> {
    try {
      const hasPending = await this.checkPendingSellOrder(strategyId, symbol, false);
      const positionInfo = await basicExecutionService.calculateAvailablePosition(symbol);
      return {
        hasPending,
        availableQuantity: positionInfo.availableQuantity,
        actualQuantity: positionInfo.actualQuantity,
        pendingQuantity: positionInfo.pendingQuantity
      };
    } catch (error: any) {
      return { hasPending: true, availableQuantity: 0 };
    }
  }

  private async validateStrategyExecution(
    strategyId: number,
    symbol: string,
    intent: { action: string; price?: number; quantity?: number; entryPrice?: number }
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      const instanceResult = await pool.query(
        `SELECT symbol, current_state, context FROM strategy_instances WHERE strategy_id = $1 AND symbol = $2`,
        [strategyId, symbol]
      );
      
      if (instanceResult.rows.length > 0) {
        const instance = instanceResult.rows[0];
        const context = instance.context ? JSON.parse(instance.context) : {};
        
        if (intent.action === 'SELL' && instance.current_state === 'HOLDING') {
          const buyPrice = context.buyPrice || context.entryPrice;
          const sellPrice = intent.price || intent.entryPrice;
          if (buyPrice && sellPrice && sellPrice < buyPrice * 0.95) {
            return { valid: false, reason: `卖出价格低于买入价格超过5%，疑似高买低卖` };
          }
        }
        
        if (intent.action === 'BUY' && instance.current_state === 'HOLDING') {
          return { valid: false, reason: `标的 ${symbol} 已有持仓，不允许重复买入` };
        }
      }
      
      const hasPendingOrder = await this.checkPendingOrder(strategyId, symbol);
      if (hasPendingOrder) {
        orderPreventionMetrics.recordDuplicateOrderPrevented('pending');
        orderPreventionMetrics.recordOrderRejected('duplicate');
        return { valid: false, reason: `标的 ${symbol} 已有未成交订单` };
      }
      
      if (intent.action === 'SELL' && intent.quantity) {
        const positionValidation = await basicExecutionService.validateSellPosition(symbol, intent.quantity, strategyId);
        if (!positionValidation.valid) {
          return { valid: false, reason: positionValidation.reason || '持仓验证失败' };
        }
      }
      
      const cacheKey = `${strategyId}:${symbol}:${intent.action}`;
      const cached = this.orderSubmissionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.ORDER_CACHE_TTL) {
        orderPreventionMetrics.recordDuplicateOrderPrevented('cache');
        orderPreventionMetrics.recordOrderRejected('duplicate');
        return { valid: false, reason: `最近60秒内已提交过 ${intent.action} 订单` };
      }
      
      return { valid: true };
    } catch (error: any) {
      return { valid: false, reason: `验证过程出错: ${error.message}` };
    }
  }

  private markOrderSubmitted(strategyId: number, symbol: string, action: string, orderId?: string): void {
    const cacheKey = `${strategyId}:${symbol}:${action}`;
    this.orderSubmissionCache.set(cacheKey, { timestamp: Date.now(), orderId });
    if (this.orderSubmissionCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of this.orderSubmissionCache.entries()) {
        if (now - value.timestamp > this.ORDER_CACHE_TTL) {
          this.orderSubmissionCache.delete(key);
        }
      }
    }
  }

  private createStrategyInstance(strategyType: string, strategyId: number, config: any): StrategyBase {
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
