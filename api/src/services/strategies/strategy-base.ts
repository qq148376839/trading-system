/**
 * 策略基类
 * 定义所有策略的标准接口和通用功能
 */

import stateManager from '../state-manager.service';
import pool from '../../config/database';

export interface TradingIntent {
  action: 'BUY' | 'SELL' | 'HOLD';
  symbol: string;
  entryPrice?: number;        // 入场价格：买入场景=买入价格，平仓场景=买入价格(用于记录)，做空场景=做空价格
  sellPrice?: number;         // 卖出价格：平仓场景=当前市场价格(用于提交订单)，做空场景=不使用
  entryPriceRange?: { min: number; max: number };
  stopLoss?: number;
  takeProfit?: number;
  quantity?: number;
  reason: string;
  metadata?: Record<string, any>;
}

export abstract class StrategyBase {
  protected strategyId: number;
  protected config: Record<string, any>;
  protected stateManager: typeof stateManager;

  constructor(strategyId: number, config: Record<string, any>) {
    this.strategyId = strategyId;
    this.config = config;
    this.stateManager = stateManager;
  }

  /**
   * 抽象方法：子类必须实现
   * 根据市场数据生成交易信号
   */
  abstract generateSignal(symbol: string, marketData: any): Promise<TradingIntent | null>;

  /**
   * 生命周期钩子：Tick 数据更新时调用
   * 默认空实现，子类可覆盖
   */
  async onTick(_symbol: string, _quote: any): Promise<void> {
    // 默认空实现
  }

  /**
   * 生命周期钩子：K线数据更新时调用
   * 默认空实现，子类可覆盖
   */
  async onBar(_symbol: string, _candlesticks: any[]): Promise<void> {
    // 默认空实现
  }

  /**
   * 获取当前状态
   */
  async getCurrentState(symbol: string): Promise<string> {
    const instance = await this.stateManager.getInstanceState(this.strategyId, symbol);
    return instance?.state || 'IDLE';
  }

  /**
   * 更新状态
   */
  async updateState(symbol: string, newState: string, context?: any): Promise<void> {
    await this.stateManager.updateState(this.strategyId, symbol, newState, context);
  }

  /**
   * 记录信号到数据库
   * @returns signal_id 返回信号ID，用于关联订单
   */
  protected async logSignal(intent: TradingIntent): Promise<number> {
    const result = await pool.query(
      `INSERT INTO strategy_signals 
       (strategy_id, symbol, signal_type, price, reason, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       RETURNING id`,
      [
        this.strategyId,
        intent.symbol,
        intent.action,
        intent.entryPrice || intent.entryPriceRange?.min || null,
        intent.reason,
        intent.metadata ? JSON.stringify(intent.metadata) : null,
      ]
    );
    return result.rows[0].id;
  }

  /**
   * 更新信号状态
   */
  protected async updateSignalStatus(signalId: number, status: 'EXECUTED' | 'REJECTED' | 'IGNORED'): Promise<void> {
    await pool.query(
      'UPDATE strategy_signals SET status = $1 WHERE id = $2',
      [status, signalId]
    );
  }

  /**
   * 获取策略配置值
   */
  protected getConfig<T>(key: string, defaultValue?: T): T | undefined {
    return (this.config[key] as T) ?? defaultValue;
  }
}

