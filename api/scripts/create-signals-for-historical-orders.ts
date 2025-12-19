/**
 * Script: create-signals-for-historical-orders.ts
 * Purpose: 为历史订单创建信号数据
 * 
 * 功能：
 * 1. 查找没有signal_id的已成交订单（信号功能开发前的数据）
 * 2. 为这些订单创建对应的信号记录
 * 3. 将订单关联到新创建的信号
 * 4. 设置信号状态为EXECUTED（因为订单已成交）
 * 
 * Usage:
 *   tsx scripts/create-signals-for-historical-orders.ts [--dry-run] [--only-filled]
 */

import pool from '../src/config/database';
import { logger } from '../src/utils/logger';

interface CreateStats {
  ordersProcessed: number;
  signalsCreated: number;
  ordersLinked: number;
  errors: number;
}

async function normalizeSide(side: string | number): string {
  if (side === 'BUY' || side === 1 || side === '1' || side === 'Buy') return 'BUY';
  if (side === 'SELL' || side === 2 || side === '2' || side === 'Sell') return 'SELL';
  return side.toString().toUpperCase();
}

async function normalizeStatus(status: string): string {
  const statusStr = status?.toString() || '';
  if (statusStr === 'FilledStatus' || statusStr === 'FILLED') return 'FILLED';
  if (statusStr === 'PartialFilledStatus' || statusStr === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  if (statusStr === 'CanceledStatus' || statusStr === 'CANCELLED') return 'CANCELLED';
  if (statusStr === 'PendingCancelStatus' || statusStr === 'WaitToCancel') return 'CANCELLED';
  if (statusStr === 'RejectedStatus' || statusStr === 'REJECTED' || statusStr === 'FAILED') return 'REJECTED';
  return statusStr;
}

/**
 * 为历史订单创建信号数据
 */
async function createSignalsForHistoricalOrders(
  dryRun: boolean = false,
  onlyFilled: boolean = true
): Promise<CreateStats> {
  const stats: CreateStats = {
    ordersProcessed: 0,
    signalsCreated: 0,
    ordersLinked: 0,
    errors: 0,
  };
  
  try {
    logger.info(`开始为历史订单创建信号数据 (dry-run: ${dryRun}, 仅已成交: ${onlyFilled})`);
    
    // Step 1: 查找没有signal_id的订单
    let ordersQuery = `
      SELECT 
        id, 
        strategy_id, 
        symbol, 
        side, 
        created_at, 
        current_status,
        order_id,
        quantity,
        price
      FROM execution_orders
      WHERE signal_id IS NULL
    `;
    
    if (onlyFilled) {
      // 数据库中的状态是规范化后的值：FILLED, CANCELLED, FAILED等
      // API返回的状态是原始值：FilledStatus, PartialFilledStatus等
      // 这里查询数据库，所以使用规范化后的状态值
      ordersQuery += ` AND current_status IN ('FILLED', 'PARTIALLY_FILLED')`;
    }
    
    ordersQuery += ` ORDER BY created_at ASC`;
    
    const ordersResult = await pool.query(ordersQuery);
    const orders = ordersResult.rows;
    
    logger.info(`找到 ${orders.length} 个未关联信号的订单`);
    
    if (orders.length === 0) {
      logger.info('没有需要处理的订单');
      return stats;
    }
    
    // Step 2: 为每个订单创建信号
    for (const order of orders) {
      try {
        stats.ordersProcessed++;
        
        const orderSide = await normalizeSide(order.side);
        const normalizedStatus = await normalizeStatus(order.current_status);
        
        // 确定信号状态
        let signalStatus: 'EXECUTED' | 'REJECTED' | 'IGNORED' = 'EXECUTED';
        if (normalizedStatus === 'REJECTED') {
          signalStatus = 'REJECTED';
        } else if (normalizedStatus === 'CANCELLED') {
          signalStatus = 'IGNORED';
        }
        
        // 确定信号价格（使用订单价格）
        const signalPrice = parseFloat(order.price || '0');
        
        // 构建信号原因
        const reason = `历史订单补充信号 - 订单ID: ${order.order_id}, 状态: ${normalizedStatus}`;
        
        // 构建metadata
        const metadata = {
          source: 'historical_order_backfill',
          order_id: order.order_id,
          order_created_at: order.created_at,
          order_status: normalizedStatus,
          quantity: order.quantity,
          price: order.price,
        };
        
        if (dryRun) {
          logger.debug(
            `[预览] 将为订单 ${order.order_id} (${order.symbol}, ${orderSide}) ` +
            `创建信号: 价格=${signalPrice.toFixed(2)}, 状态=${signalStatus}`
          );
          stats.signalsCreated++;
          stats.ordersLinked++;
        } else {
          // 创建信号
          const signalResult = await pool.query(
            `INSERT INTO strategy_signals 
             (strategy_id, symbol, signal_type, price, reason, metadata, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              order.strategy_id,
              order.symbol,
              orderSide,
              signalPrice > 0 ? signalPrice : null,
              reason,
              JSON.stringify(metadata),
              signalStatus,
              order.created_at, // 使用订单创建时间作为信号创建时间
            ]
          );
          
          const signalId = signalResult.rows[0].id;
          stats.signalsCreated++;
          
          // 关联订单到信号
          await pool.query(
            `UPDATE execution_orders SET signal_id = $1 WHERE id = $2`,
            [signalId, order.id]
          );
          
          stats.ordersLinked++;
          
          if (stats.ordersLinked % 100 === 0) {
            logger.info(`已处理 ${stats.ordersLinked}/${orders.length} 个订单`);
          }
        }
      } catch (error: any) {
        stats.errors++;
        logger.error(`处理订单 ${order.order_id} 失败:`, error.message);
      }
    }
    
    return stats;
  } catch (error: any) {
    logger.error('为历史订单创建信号数据失败:', error);
    throw error;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyFilled = !args.includes('--include-all'); // 默认只处理已成交订单
  
  try {
    const stats = await createSignalsForHistoricalOrders(dryRun, onlyFilled);
    
    console.log('\n' + '='.repeat(80));
    console.log('创建信号完成！统计信息:');
    console.log('='.repeat(80));
    console.log(`  - 处理的订单数: ${stats.ordersProcessed}`);
    console.log(`  - ${dryRun ? '将创建' : '已创建'}的信号数: ${stats.signalsCreated}`);
    console.log(`  - ${dryRun ? '将关联' : '已关联'}的订单数: ${stats.ordersLinked}`);
    console.log(`  - 错误数: ${stats.errors}`);
    console.log('='.repeat(80));
    
    if (dryRun) {
      console.log('\n⚠️  这是预览模式，没有实际创建数据');
      console.log('如需实际执行，请运行: npm run create-signals-for-orders');
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

export { createSignalsForHistoricalOrders };

