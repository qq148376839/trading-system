/**
 * Script: analyze-signal-order-timing.ts
 * Purpose: 分析订单和信号的时间差分布，帮助确定回填脚本的时间窗口
 * 
 * Usage:
 *   tsx scripts/analyze-signal-order-timing.ts
 */

import pool from '../src/config/database';
import { logger } from '../src/utils/logger';

async function normalizeSide(side: string | number): string {
  if (side === 'BUY' || side === 1 || side === '1') return 'BUY';
  if (side === 'SELL' || side === 2 || side === '2') return 'SELL';
  return side.toString();
}

async function analyzeTiming() {
  try {
    logger.info('开始分析订单和信号的时间差分布...');
    
    // 1. 检查未关联订单的数量
    const ordersWithoutSignal = await pool.query(`
      SELECT COUNT(*) as count
      FROM execution_orders
      WHERE signal_id IS NULL
    `);
    logger.info(`未关联信号的订单数: ${ordersWithoutSignal.rows[0].count}`);
    
    // 2. 检查PENDING信号的数量
    const pendingSignals = await pool.query(`
      SELECT COUNT(*) as count
      FROM strategy_signals
      WHERE status = 'PENDING'
    `);
    logger.info(`PENDING信号数: ${pendingSignals.rows[0].count}`);
    
    // 3. 分析时间差分布
    const timeDiffResult = await pool.query(`
      SELECT 
        CASE 
          WHEN time_diff <= 5 THEN '0-5分钟'
          WHEN time_diff <= 15 THEN '5-15分钟'
          WHEN time_diff <= 30 THEN '15-30分钟'
          WHEN time_diff <= 60 THEN '30-60分钟'
          WHEN time_diff <= 120 THEN '60-120分钟'
          WHEN time_diff <= 240 THEN '120-240分钟'
          ELSE '240分钟以上'
        END as time_range,
        COUNT(*) as count,
        MIN(time_diff) as min_diff,
        MAX(time_diff) as max_diff,
        AVG(time_diff) as avg_diff
      FROM (
        SELECT 
          eo.order_id,
          eo.symbol,
          eo.side,
          eo.created_at as order_time,
          ss.id as signal_id,
          ss.created_at as signal_time,
          ABS(EXTRACT(EPOCH FROM (eo.created_at - ss.created_at))) / 60 as time_diff
        FROM execution_orders eo
        CROSS JOIN strategy_signals ss
        WHERE eo.strategy_id = ss.strategy_id
          AND eo.symbol = ss.symbol
          AND (
            (eo.side = 'BUY' AND ss.signal_type = 'BUY')
            OR (eo.side = 'SELL' AND ss.signal_type = 'SELL')
          )
          AND eo.signal_id IS NULL
          AND ss.status = 'PENDING'
      ) t
      GROUP BY time_range
      ORDER BY 
        CASE time_range
          WHEN '0-5分钟' THEN 1
          WHEN '5-15分钟' THEN 2
          WHEN '15-30分钟' THEN 3
          WHEN '30-60分钟' THEN 4
          WHEN '60-120分钟' THEN 5
          WHEN '120-240分钟' THEN 6
          ELSE 7
        END
    `);
    
    console.log('\n' + '='.repeat(80));
    console.log('时间差分布分析:');
    console.log('='.repeat(80));
    console.log('时间范围\t\t数量\t\t最小差\t\t最大差\t\t平均差');
    console.log('-'.repeat(80));
    
    let totalCount = 0;
    for (const row of timeDiffResult.rows) {
      const count = parseInt(row.count, 10);
      totalCount += count;
      console.log(
        `${row.time_range.padEnd(20)}\t${count}\t\t${row.min_diff?.toFixed(2) || 'N/A'}\t\t${row.max_diff?.toFixed(2) || 'N/A'}\t\t${row.avg_diff?.toFixed(2) || 'N/A'}`
      );
    }
    
    console.log('-'.repeat(80));
    console.log(`总计: ${totalCount} 个可能的匹配`);
    console.log('='.repeat(80));
    
    // 4. 分析side格式
    const sideFormatResult = await pool.query(`
      SELECT 
        '订单side格式' as type,
        side,
        COUNT(*) as count
      FROM execution_orders
      WHERE signal_id IS NULL
      GROUP BY side
      UNION ALL
      SELECT 
        '信号signal_type格式' as type,
        signal_type as side,
        COUNT(*) as count
      FROM strategy_signals
      WHERE status = 'PENDING'
      GROUP BY signal_type
      ORDER BY type, side
    `);
    
    console.log('\n' + '='.repeat(80));
    console.log('Side格式分析:');
    console.log('='.repeat(80));
    for (const row of sideFormatResult.rows) {
      console.log(`${row.type}: ${row.side} - ${row.count} 个`);
    }
    console.log('='.repeat(80));
    
    // 5. 分析订单和信号的创建时间分布
    const orderTimeResult = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM execution_orders
      WHERE signal_id IS NULL
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 10
    `);
    
    console.log('\n' + '='.repeat(80));
    console.log('未关联订单的创建时间分布（最近10天）:');
    console.log('='.repeat(80));
    for (const row of orderTimeResult.rows) {
      console.log(`${row.date}: ${row.count} 个订单`);
    }
    console.log('='.repeat(80));
    
    const signalTimeResult = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM strategy_signals
      WHERE status = 'PENDING'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 10
    `);
    
    console.log('\n' + '='.repeat(80));
    console.log('PENDING信号的创建时间分布（最近10天）:');
    console.log('='.repeat(80));
    for (const row of signalTimeResult.rows) {
      console.log(`${row.date}: ${row.count} 个信号`);
    }
    console.log('='.repeat(80));
    
    // 6. 推荐时间窗口
    console.log('\n' + '='.repeat(80));
    console.log('推荐时间窗口:');
    console.log('='.repeat(80));
    
    if (totalCount === 0) {
      console.log('⚠️  没有找到可能的匹配，建议：');
      console.log('1. 检查订单和信号的strategy_id、symbol、side是否匹配');
      console.log('2. 检查订单和信号的创建时间是否在同一时间段');
      console.log('3. 考虑这些订单和信号可能不匹配（手动订单、系统订单等）');
    } else {
      // 计算各时间段的占比
      const ranges = timeDiffResult.rows;
      const range5 = ranges.find(r => r.time_range === '0-5分钟');
      const range30 = ranges.find(r => r.time_range === '15-30分钟');
      const range60 = ranges.find(r => r.time_range === '30-60分钟');
      const range120 = ranges.find(r => r.time_range === '60-120分钟');
      
      const count5 = range5 ? parseInt(range5.count, 10) : 0;
      const count30 = ranges.filter(r => 
        ['0-5分钟', '5-15分钟', '15-30分钟'].includes(r.time_range)
      ).reduce((sum, r) => sum + parseInt(r.count, 10), 0);
      const count60 = ranges.filter(r => 
        ['0-5分钟', '5-15分钟', '15-30分钟', '30-60分钟'].includes(r.time_range)
      ).reduce((sum, r) => sum + parseInt(r.count, 10), 0);
      const count120 = ranges.filter(r => 
        ['0-5分钟', '5-15分钟', '15-30分钟', '30-60分钟', '60-120分钟'].includes(r.time_range)
      ).reduce((sum, r) => sum + parseInt(r.count, 10), 0);
      
      console.log(`5分钟窗口: 可匹配 ${count5} 个 (${((count5/totalCount)*100).toFixed(1)}%)`);
      console.log(`30分钟窗口: 可匹配 ${count30} 个 (${((count30/totalCount)*100).toFixed(1)}%)`);
      console.log(`60分钟窗口: 可匹配 ${count60} 个 (${((count60/totalCount)*100).toFixed(1)}%)`);
      console.log(`120分钟窗口: 可匹配 ${count120} 个 (${((count120/totalCount)*100).toFixed(1)}%)`);
      
      if (count30 > count5 * 2) {
        console.log('\n💡 推荐使用30分钟时间窗口');
      } else if (count60 > count30 * 1.5) {
        console.log('\n💡 推荐使用60分钟时间窗口');
      } else if (count120 > count60 * 1.5) {
        console.log('\n💡 推荐使用120分钟时间窗口');
      } else {
        console.log('\n💡 推荐使用30-60分钟时间窗口');
      }
    }
    
    console.log('='.repeat(80));
    
  } catch (error: any) {
    logger.error('分析失败:', error);
    throw error;
  }
}

async function main() {
  try {
    await analyzeTiming();
    process.exit(0);
  } catch (error) {
    logger.error('脚本执行失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { analyzeTiming };

