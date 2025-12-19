/**
 * Script: cleanup-historical-data.ts
 * Purpose: 清理历史数据，只保留当前持仓相关的数据
 * 
 * 清理策略：
 * 1. 清理过期的PENDING信号（超过N天未执行）
 * 2. 清理已完成的订单（超过N天）
 * 3. 清理已完成的交易记录（超过N天）
 * 4. 保留当前持仓相关的所有数据
 * 
 * Usage:
 *   tsx scripts/cleanup-historical-data.ts [--dry-run] [--days=30] [--keep-pending-days=7]
 */

import pool from '../src/config/database';
import { logger } from '../src/utils/logger';

interface CleanupStats {
  pendingSignalsDeleted: number;
  completedOrdersDeleted: number;
  completedTradesDeleted: number;
  signalsIgnored: number;
  ordersIgnored: number;
  tradesIgnored: number;
}

/**
 * 获取当前持仓的标的列表
 */
async function getCurrentPositions(): Promise<Set<string>> {
  const result = await pool.query(`
    SELECT DISTINCT symbol
    FROM strategy_instances
    WHERE current_state = 'HOLDING'
  `);
  
  const symbols = new Set<string>();
  result.rows.forEach(row => {
    symbols.add(row.symbol);
  });
  
  return symbols;
}

/**
 * 清理过期的PENDING信号
 */
async function cleanupPendingSignals(
  keepPendingDays: number,
  currentPositions: Set<string>,
  dryRun: boolean
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepPendingDays);
  
  // 构建SQL：排除当前持仓的标的
  const symbolsArray = Array.from(currentPositions);
  const symbolsCondition = symbolsArray.length > 0 
    ? `AND symbol NOT IN (${symbolsArray.map((_, i) => `$${i + 2}`).join(', ')})`
    : '';
  
  const params = [cutoffDate.toISOString(), ...symbolsArray];
  
  if (dryRun) {
    const countResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM strategy_signals
      WHERE status = 'PENDING'
        AND created_at < $1
        ${symbolsCondition}
    `, params);
    
    return parseInt(countResult.rows[0].count, 10);
  }
  
  const result = await pool.query(`
    UPDATE strategy_signals
    SET status = 'IGNORED'
    WHERE status = 'PENDING'
      AND created_at < $1
      ${symbolsCondition}
  `, params);
  
  return result.rowCount || 0;
}

/**
 * 清理已完成的订单
 */
async function cleanupCompletedOrders(
  days: number,
  currentPositions: Set<string>,
  dryRun: boolean
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const symbolsArray = Array.from(currentPositions);
  const symbolsCondition = symbolsArray.length > 0 
    ? `AND symbol NOT IN (${symbolsArray.map((_, i) => `$${i + 2}`).join(', ')})`
    : '';
  
  const params = [cutoffDate.toISOString(), ...symbolsArray];
  
  if (dryRun) {
    const countResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM execution_orders
      WHERE current_status IN ('FilledStatus', 'CanceledStatus', 'RejectedStatus')
        AND updated_at < $1
        ${symbolsCondition}
    `, params);
    
    return parseInt(countResult.rows[0].count, 10);
  }
  
  const result = await pool.query(`
    DELETE FROM execution_orders
    WHERE current_status IN ('FilledStatus', 'CanceledStatus', 'RejectedStatus')
      AND updated_at < $1
      ${symbolsCondition}
  `, params);
  
  return result.rowCount || 0;
}

/**
 * 清理已完成的交易记录（auto_trades表）
 */
async function cleanupCompletedTrades(
  days: number,
  currentPositions: Set<string>,
  dryRun: boolean
): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const symbolsArray = Array.from(currentPositions);
    const symbolsCondition = symbolsArray.length > 0 
      ? `AND symbol NOT IN (${symbolsArray.map((_, i) => `$${i + 2}`).join(', ')})`
      : '';
    
    const params = [cutoffDate.toISOString(), ...symbolsArray];
    
    if (dryRun) {
      // 检查表是否存在
      const tableExists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'auto_trades'
        )
      `);
      
      if (!tableExists.rows[0].exists) {
        logger.info('auto_trades表不存在，跳过清理');
        return 0;
      }
      
      const countResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM auto_trades
        WHERE close_time IS NOT NULL
          AND close_time < $1
          ${symbolsCondition}
      `, params);
      
      return parseInt(countResult.rows[0].count, 10);
    }
    
    // 检查表是否存在
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'auto_trades'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      logger.info('auto_trades表不存在，跳过清理');
      return 0;
    }
    
    const result = await pool.query(`
      DELETE FROM auto_trades
      WHERE close_time IS NOT NULL
        AND close_time < $1
        ${symbolsCondition}
    `, params);
    
    return result.rowCount || 0;
  } catch (error: any) {
    // 如果表不存在或其他错误，记录日志但不抛出异常
    logger.warn(`清理交易记录时出错: ${error.message}`);
    return 0;
  }
}

/**
 * 主清理函数
 */
async function cleanupHistoricalData(
  dryRun: boolean = false,
  days: number = 30,
  keepPendingDays: number = 7
): Promise<CleanupStats> {
  const stats: CleanupStats = {
    pendingSignalsDeleted: 0,
    completedOrdersDeleted: 0,
    completedTradesDeleted: 0,
    signalsIgnored: 0,
    ordersIgnored: 0,
    tradesIgnored: 0,
  };
  
  try {
    logger.info(`开始清理历史数据 (dry-run: ${dryRun}, 保留天数: ${days}, PENDING信号保留天数: ${keepPendingDays})`);
    
    // 获取当前持仓的标的
    const currentPositions = await getCurrentPositions();
    logger.info(`当前持仓标的数: ${currentPositions.size}`);
    if (currentPositions.size > 0) {
      logger.info(`当前持仓标的: ${Array.from(currentPositions).join(', ')}`);
    }
    
    // 1. 清理过期的PENDING信号
    logger.info('清理过期的PENDING信号...');
    stats.pendingSignalsDeleted = await cleanupPendingSignals(
      keepPendingDays,
      currentPositions,
      dryRun
    );
    logger.info(`将${dryRun ? '会' : '已'}清理 ${stats.pendingSignalsDeleted} 个过期的PENDING信号`);
    
    // 2. 清理已完成的订单
    logger.info('清理已完成的订单...');
    stats.completedOrdersDeleted = await cleanupCompletedOrders(
      days,
      currentPositions,
      dryRun
    );
    logger.info(`将${dryRun ? '会' : '已'}清理 ${stats.completedOrdersDeleted} 个已完成的订单`);
    
    // 3. 清理已完成的交易记录
    logger.info('清理已完成的交易记录...');
    stats.completedTradesDeleted = await cleanupCompletedTrades(
      days,
      currentPositions,
      dryRun
    );
    logger.info(`将${dryRun ? '会' : '已'}清理 ${stats.completedTradesDeleted} 个已完成的交易记录`);
    
    return stats;
  } catch (error: any) {
    logger.error('清理历史数据失败:', error);
    throw error;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const daysArg = args.find(arg => arg.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) || 30 : 30;
  const keepPendingDaysArg = args.find(arg => arg.startsWith('--keep-pending-days='));
  const keepPendingDays = keepPendingDaysArg 
    ? parseInt(keepPendingDaysArg.split('=')[1]) || 7 
    : 7;
  
  try {
    const stats = await cleanupHistoricalData(dryRun, days, keepPendingDays);
    
    console.log('\n' + '='.repeat(80));
    console.log('清理完成！统计信息:');
    console.log('='.repeat(80));
    console.log(`  - ${dryRun ? '将清理' : '已清理'}的PENDING信号数: ${stats.pendingSignalsDeleted}`);
    console.log(`  - ${dryRun ? '将清理' : '已清理'}的已完成订单数: ${stats.completedOrdersDeleted}`);
    console.log(`  - ${dryRun ? '将清理' : '已清理'}的已完成交易记录数: ${stats.completedTradesDeleted}`);
    console.log('='.repeat(80));
    
    if (dryRun) {
      console.log('\n⚠️  这是预览模式，没有实际删除数据');
      console.log('如需实际执行，请运行: npm run cleanup-data');
    }
    
    process.exit(0);
  } catch (error) {
    logger.error('脚本执行失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { cleanupHistoricalData };

