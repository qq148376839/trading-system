/**
 * 状态管理器服务
 * 管理策略实例状态，支持故障恢复
 */

import pool from '../config/database';
import { logger } from '../utils/logger';

export interface StrategyInstanceState {
  state: string;
  context: any;
}

class StateManager {
  /**
   * 获取策略实例状态
   */
  async getInstanceState(strategyId: number, symbol: string): Promise<StrategyInstanceState | null> {
    const result = await pool.query(
      `SELECT current_state, context FROM strategy_instances 
       WHERE strategy_id = $1 AND symbol = $2`,
      [strategyId, symbol]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      state: row.current_state,
      context: row.context || {},
    };
  }

  /**
   * 更新状态
   */
  async updateState(
    strategyId: number,
    symbol: string,
    newState: string,
    context?: any
  ): Promise<void> {
    // 使用 UPSERT 语法（PostgreSQL 9.5+）
    await pool.query(
      `INSERT INTO strategy_instances (strategy_id, symbol, current_state, context, last_updated)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (strategy_id, symbol) 
       DO UPDATE SET 
         current_state = $3,
         context = $4,
         last_updated = NOW()`,
      [strategyId, symbol, newState, context ? JSON.stringify(context) : null]
    );
  }

  /**
   * 恢复所有运行中策略的状态
   * 在服务启动时调用，从数据库恢复状态
   */
  async restoreRunningStrategies(): Promise<void> {
    // 查询所有运行中的策略及其实例状态
    const strategiesResult = await pool.query(`
      SELECT s.id as strategy_id, s.name, s.config, s.symbol_pool_config,
             si.symbol, si.current_state, si.context
      FROM strategies s
      LEFT JOIN strategy_instances si ON s.id = si.strategy_id
      WHERE s.status = 'RUNNING'
    `);

    const restoredInstances = strategiesResult.rows
      .filter((row: any) => row.symbol && row.current_state)
      .map((row: any) => `${row.name}(${row.strategy_id})/${row.symbol}:${row.current_state}`);
    logger.info(
      `恢复 ${strategiesResult.rows.length} 个策略实例状态` +
      (restoredInstances.length > 0 ? ` [${restoredInstances.join(', ')}]` : ''),
      { dbWrite: false }
    );

    // 返回恢复的状态信息（供调用方使用）
    return;
  }

  /**
   * 获取策略的所有实例状态
   */
  async getStrategyInstances(strategyId: number): Promise<Array<{
    symbol: string;
    state: string;
    context: any;
    lastUpdated: Date;
  }>> {
    const result = await pool.query(
      `SELECT symbol, current_state, context, last_updated 
       FROM strategy_instances 
       WHERE strategy_id = $1
       ORDER BY last_updated DESC`,
      [strategyId]
    );

    return result.rows.map((row) => ({
      symbol: row.symbol,
      state: row.current_state,
      context: row.context || {},
      lastUpdated: row.last_updated,
    }));
  }

  /**
   * 删除策略实例状态（用于清理）
   */
  async deleteInstance(strategyId: number, symbol: string): Promise<void> {
    await pool.query(
      'DELETE FROM strategy_instances WHERE strategy_id = $1 AND symbol = $2',
      [strategyId, symbol]
    );
  }

  /**
   * 清理所有已停止策略的实例状态
   */
  async cleanupStoppedStrategies(): Promise<void> {
    await pool.query(`
      DELETE FROM strategy_instances 
      WHERE strategy_id IN (
        SELECT id FROM strategies WHERE status = 'STOPPED'
      )
    `);
  }
}

// 导出单例
export default new StateManager();

