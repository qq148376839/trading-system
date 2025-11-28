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
    // 1. 获取股票池
    const symbols = await stockSelector.getSymbolPool(symbolPoolConfig);

    // 2. 并行处理多个股票
    await Promise.all(
      symbols.map((symbol) => this.processSymbol(strategyInstance, strategyId, symbol))
    );
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

      // 生成信号
      const intent = await strategyInstance.generateSignal(symbol);

      if (!intent || intent.action === 'HOLD') {
        return;
      }

      // 如果是买入信号，执行交易
      if (intent.action === 'BUY') {
        // 申请资金额度
        const availableCapital = await capitalManager.getAvailableCapital(strategyId);
        
        // 计算数量（如果没有指定）
        if (!intent.quantity && intent.entryPrice) {
          // 使用可用资金的 10% 计算数量（可根据配置调整）
          const tradeAmount = availableCapital * 0.1;
          intent.quantity = Math.floor(tradeAmount / intent.entryPrice);
        }

        if (!intent.quantity || intent.quantity <= 0) {
          console.warn(`策略 ${strategyId} 标的 ${symbol} 资金不足，无法买入`);
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

