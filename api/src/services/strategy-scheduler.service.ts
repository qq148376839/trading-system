/**
 * 策略调度器服务
 * 定时触发策略运行，管理策略生命周期
 */

import pool from '../config/database';
import { StrategyBase, TradingIntent } from './strategies/strategy-base';
import { RecommendationStrategy } from './strategies/recommendation-strategy';
import stockSelector from './stock-selector.service';
import capitalManager from './capital-manager.service';
import stateManager from './state-manager.service';
import basicExecutionService from './basic-execution.service';

class StrategyScheduler {
  private runningStrategies: Map<number, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  /**
   * 启动策略调度器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('策略调度器已在运行');
      return;
    }

    this.isRunning = true;
    console.log('策略调度器已启动');

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

    console.log('策略调度器已停止');
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
      console.warn(`策略 ${strategyId} 已在运行`);
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
        console.error(`策略 ${strategyId} 运行出错:`, error);
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
    console.log(`策略 ${strategy.name} (ID: ${strategyId}) 已启动`);

    // 立即执行一次
    try {
      await this.runStrategyCycle(strategyInstance, strategyId, strategy.symbol_pool_config);
    } catch (error: any) {
      console.error(`策略 ${strategyId} 初始运行出错:`, error);
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
      console.log(`策略 ${strategyId} 已停止`);
    }

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
    // 1. 追踪并更新未成交订单
    await this.trackPendingOrders(strategyId);

    // 2. 获取股票池
    const symbols = await stockSelector.getSymbolPool(symbolPoolConfig);

    // 3. 并行处理多个股票
    await Promise.all(
      symbols.map((symbol) => this.processSymbol(strategyInstance, strategyId, symbol))
    );
  }

  /**
   * 追踪未成交订单，根据市场变化更新价格
   */
  private async trackPendingOrders(strategyId: number): Promise<void> {
    try {
      // 查询未成交的买入订单
      const pendingOrders = await pool.query(
        `SELECT eo.order_id, eo.symbol, eo.price, eo.quantity, eo.created_at
         FROM execution_orders eo
         WHERE eo.strategy_id = $1 
         AND eo.side = 'BUY'
         AND eo.current_status IN ('SUBMITTED', 'NEW', 'PARTIALLY_FILLED')
         AND eo.created_at >= NOW() - INTERVAL '1 hour'
         ORDER BY eo.created_at DESC
         LIMIT 10`,
        [strategyId]
      );

      if (pendingOrders.rows.length === 0) {
        return;
      }

      console.log(`策略 ${strategyId} 发现 ${pendingOrders.rows.length} 个未成交订单，开始追踪...`);

      // 获取当前行情
      const { getQuoteContext } = await import('../config/longport');
      const quoteCtx = await getQuoteContext();
      const symbols = pendingOrders.rows.map((row: any) => row.symbol);
      const quotes = await quoteCtx.quote(symbols);

      // 创建symbol到quote的映射
      const quoteMap = new Map<string, any>();
      for (const quote of quotes) {
        quoteMap.set(quote.symbol, quote);
      }

      // 处理每个订单
      for (const order of pendingOrders.rows) {
        try {
          const quote = quoteMap.get(order.symbol);
          if (!quote) {
            console.warn(`策略 ${strategyId} 订单 ${order.order_id} 无法获取行情: ${order.symbol}`);
            continue;
          }

          const currentPrice = parseFloat(quote.last_done?.toString() || '0');
          const orderPrice = parseFloat(order.price);
          
          if (currentPrice <= 0) {
            continue;
          }

          // 如果当前价格与订单价格差异超过2%，更新订单价格
          const priceDiff = Math.abs(currentPrice - orderPrice) / orderPrice;
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

            console.log(`策略 ${strategyId} 更新订单 ${order.order_id} 价格: ${orderPrice} -> ${formattedPrice} (当前价格: ${currentPrice})`);

            // 调用SDK更新订单
            const { getTradeContext, Decimal } = await import('../config/longport');
            const tradeCtx = await getTradeContext();
            await tradeCtx.replaceOrder({
              orderId: order.order_id,
              price: new Decimal(formattedPrice.toString()),
            });

            // 更新数据库
            await pool.query(
              `UPDATE execution_orders 
               SET price = $1, updated_at = NOW() 
               WHERE order_id = $2`,
              [formattedPrice, order.order_id]
            );
          }
        } catch (orderError: any) {
          console.error(`策略 ${strategyId} 更新订单 ${order.order_id} 失败:`, orderError.message);
          // 继续处理下一个订单
        }
      }
    } catch (error: any) {
      console.error(`策略 ${strategyId} 追踪订单失败:`, error.message);
      // 不抛出异常，避免影响策略运行
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

      // 如果不在 IDLE 状态，跳过（可能正在开仓、持仓中或冷却期）
      if (currentState !== 'IDLE') {
        return;
      }

      // 检查是否已有持仓（避免重复买入）
      const hasPosition = await this.checkExistingPosition(strategyId, symbol);
      if (hasPosition) {
        console.log(`策略 ${strategyId} 标的 ${symbol} 已有持仓，跳过买入`);
        return;
      }

      // 检查是否有未成交的订单
      const hasPendingOrder = await this.checkPendingOrder(strategyId, symbol);
      if (hasPendingOrder) {
        console.log(`策略 ${strategyId} 标的 ${symbol} 有未成交订单，跳过买入`);
        return;
      }

      // 生成信号
      const intent = await strategyInstance.generateSignal(symbol);

      if (!intent || intent.action === 'HOLD') {
        return;
      }

      // 如果是买入信号，执行交易
      if (intent.action === 'BUY') {
        // 申请资金额度
        const availableCapital = await capitalManager.getAvailableCapital(strategyId);
        
        if (availableCapital <= 0) {
          console.warn(`策略 ${strategyId} 标的 ${symbol} 可用资金不足: ${availableCapital}`);
          return;
        }

        // 计算数量（如果没有指定）
        if (!intent.quantity && intent.entryPrice) {
          // 使用可用资金的 10% 计算数量（可根据配置调整）
          const tradeAmount = availableCapital * 0.1;
          const calculatedQuantity = Math.floor(tradeAmount / intent.entryPrice);
          
          // 确保数量至少为1
          intent.quantity = Math.max(1, calculatedQuantity);
          
          console.log(`策略 ${strategyId} 标的 ${symbol} 计算数量: 可用资金=${availableCapital.toFixed(2)}, 交易金额=${tradeAmount.toFixed(2)}, 价格=${intent.entryPrice}, 数量=${intent.quantity}`);
        }

        if (!intent.quantity || intent.quantity <= 0) {
          console.warn(`策略 ${strategyId} 标的 ${symbol} 资金不足，无法买入（数量=${intent.quantity}）`);
          return;
        }

        // 申请资金
        const allocationResult = await capitalManager.requestAllocation({
          strategyId,
          amount: intent.quantity * (intent.entryPrice || 0),
          symbol,
        });

        if (!allocationResult.approved) {
          console.warn(`策略 ${strategyId} 标的 ${symbol} 资金申请被拒绝: ${allocationResult.reason}`);
          return;
        }

        // 更新状态为 OPENING
        await strategyInstance.updateState(symbol, 'OPENING', {
          intent,
          allocationAmount: allocationResult.allocatedAmount,
        });

        // 执行买入
        const executionResult = await basicExecutionService.executeBuyIntent(intent, strategyId);

        if (executionResult.success) {
          // 更新状态为 HOLDING
          await strategyInstance.updateState(symbol, 'HOLDING', {
            entryPrice: executionResult.avgPrice,
            quantity: executionResult.filledQuantity,
            stopLoss: intent.stopLoss,
            takeProfit: intent.takeProfit,
            orderId: executionResult.orderId,
          });
          console.log(`策略 ${strategyId} 标的 ${symbol} 买入成功，订单ID: ${executionResult.orderId}`);
        } else {
          // 执行失败，释放资金并恢复 IDLE 状态
          await capitalManager.releaseAllocation(
            strategyId,
            allocationResult.allocatedAmount,
            symbol
          );
          await strategyInstance.updateState(symbol, 'IDLE');
          const errorMsg = executionResult.error || '未知错误';
          console.error(`策略 ${strategyId} 标的 ${symbol} 买入失败: ${errorMsg}`);
        }
      }
    } catch (error: any) {
      console.error(`策略 ${strategyId} 处理标的 ${symbol} 出错:`, error);
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

      // 检查实际持仓（从SDK）
      try {
        const { getTradeContext } = await import('../config/longport');
        const tradeCtx = await getTradeContext();
        const positions = await tradeCtx.stockPositions();
        
        if (positions && typeof positions === 'object') {
          let allPositions: any[] = [];
          
          if (positions.channels && Array.isArray(positions.channels)) {
            for (const channel of positions.channels) {
              if (channel.positions && Array.isArray(channel.positions)) {
                allPositions.push(...channel.positions);
              }
            }
          }
          
          for (const pos of allPositions) {
            if (pos.symbol === symbol) {
              const quantity = parseInt(pos.quantity?.toString() || '0');
              if (quantity > 0) {
                return true;
              }
            }
          }
        }
      } catch (sdkError: any) {
        console.warn(`检查实际持仓失败 (${symbol}):`, sdkError.message);
        // 如果SDK调用失败，只依赖数据库检查
      }

      return false;
    } catch (error: any) {
      console.error(`检查持仓失败 (${symbol}):`, error);
      return false; // 出错时返回false，允许继续执行
    }
  }

  /**
   * 检查是否有未成交的订单
   */
  private async checkPendingOrder(strategyId: number, symbol: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT order_id FROM execution_orders 
         WHERE strategy_id = $1 AND symbol = $2 
         AND current_status IN ('SUBMITTED', 'NEW', 'PARTIALLY_FILLED')
         AND side = 'BUY'
         ORDER BY created_at DESC LIMIT 1`,
        [strategyId, symbol]
      );

      return result.rows.length > 0;
    } catch (error: any) {
      console.error(`检查未成交订单失败 (${symbol}):`, error);
      return false;
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

