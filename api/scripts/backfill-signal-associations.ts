/**
 * Script: backfill-signal-associations.ts
 * Purpose: Backfill signal_id for historical orders and update signal statuses
 * 
 * This script:
 * 1. Matches historical orders to signals using time window matching
 * 2. Updates signal statuses based on order statuses
 * 3. Provides detailed logging and statistics
 * 
 * Usage:
 *   tsx api/scripts/backfill-signal-associations.ts [--dry-run] [--time-window-minutes=5]
 */

import pool from '../src/config/database';
import { logger } from '../src/utils/logger';

interface BackfillStats {
  ordersMatched: number;
  signalsUpdated: number;
  signalsExecuted: number;
  signalsIgnored: number;
  signalsRejected: number;
  ordersWithoutSignals: number;
  signalsWithoutOrders: number;
}

async function normalizeSide(side: string | number): string {
  if (side === 'BUY' || side === 1 || side === '1') return 'BUY';
  if (side === 'SELL' || side === 2 || side === '2') return 'SELL';
  return side.toString();
}

async function normalizeStatus(status: string): string {
  // Normalize various status formats to standard format
  const statusStr = status?.toString() || '';
  if (statusStr === 'FilledStatus' || statusStr === 'FILLED') return 'FILLED';
  if (statusStr === 'PartialFilledStatus' || statusStr === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  if (statusStr === 'CanceledStatus' || statusStr === 'CANCELLED') return 'CANCELLED';
  if (statusStr === 'PendingCancelStatus' || statusStr === 'WaitToCancel') return 'CANCELLED';
  if (statusStr === 'RejectedStatus' || statusStr === 'REJECTED' || statusStr === 'FAILED') return 'REJECTED';
  return statusStr;
}

async function backfillSignalAssociations(
  dryRun: boolean = false,
  timeWindowMinutes: number = 5
): Promise<BackfillStats> {
  const stats: BackfillStats = {
    ordersMatched: 0,
    signalsUpdated: 0,
    signalsExecuted: 0,
    signalsIgnored: 0,
    signalsRejected: 0,
    ordersWithoutSignals: 0,
    signalsWithoutOrders: 0,
  };

  try {
    logger.info(`开始回填信号关联数据 (dry-run: ${dryRun}, 时间窗口: ±${timeWindowMinutes}分钟)`);

    // Step 1: Find orders without signal_id
    const ordersWithoutSignal = await pool.query(`
      SELECT id, strategy_id, symbol, side, created_at, current_status, order_id
      FROM execution_orders
      WHERE signal_id IS NULL
      ORDER BY created_at DESC
    `);

    logger.info(`找到 ${ordersWithoutSignal.rows.length} 个未关联信号的订单`);

    // Also check how many orders already have signal_id
    const ordersWithSignal = await pool.query(`
      SELECT COUNT(*) as count
      FROM execution_orders
      WHERE signal_id IS NOT NULL
    `);
    logger.info(`已有 ${ordersWithSignal.rows[0]?.count || 0} 个订单已关联信号`);

    // Step 2: Match each order to a signal
    for (const order of ordersWithoutSignal.rows) {
      const orderSide = await normalizeSide(order.side);
      const orderTime = new Date(order.created_at);
      const timeWindowStart = new Date(orderTime.getTime() - timeWindowMinutes * 60 * 1000);
      const timeWindowEnd = new Date(orderTime.getTime() + timeWindowMinutes * 60 * 1000);

      // Find matching signal
      // For BUY orders: match the last PENDING signal before or at order creation time
      // For SELL orders: match the last PENDING SELL signal (usually triggered by stop loss/take profit, not signals)
      // Priority: 1) Signal created before order (most recent), 2) Signal created after order (closest time)
      const signalResult = await pool.query(`
        SELECT id, status, created_at
        FROM strategy_signals
        WHERE strategy_id = $1
          AND symbol = $2
          AND signal_type = $3
          AND created_at >= $4
          AND created_at <= $5
          AND status = 'PENDING'
        ORDER BY 
          CASE 
            WHEN created_at <= $6 THEN 0  -- Prefer signals before order creation
            ELSE 1  -- Then signals after order creation
          END,
          ABS(EXTRACT(EPOCH FROM (created_at - $6)))  -- Among same priority, choose closest
        LIMIT 1
      `, [
        order.strategy_id,
        order.symbol,
        orderSide,
        timeWindowStart,
        timeWindowEnd,
        order.created_at,
      ]);

      if (signalResult.rows.length > 0) {
        const signal = signalResult.rows[0];
        const timeDiff = Math.abs(
          new Date(signal.created_at).getTime() - orderTime.getTime()
        ) / 1000 / 60; // minutes

        logger.debug(
          `匹配订单 ${order.order_id} (${order.symbol}, ${orderSide}) ` +
          `到信号 ${signal.id} (时间差: ${timeDiff.toFixed(2)}分钟)`
        );

        if (!dryRun) {
          // Update order with signal_id
          await pool.query(
            `UPDATE execution_orders SET signal_id = $1 WHERE id = $2`,
            [signal.id, order.id]
          );
        }

        stats.ordersMatched++;

        // Update signal status based on order status
        const normalizedStatus = await normalizeStatus(order.current_status);
        let newSignalStatus: 'EXECUTED' | 'IGNORED' | 'REJECTED' | null = null;

        if (normalizedStatus === 'FILLED' || normalizedStatus === 'PARTIALLY_FILLED') {
          newSignalStatus = 'EXECUTED';
          stats.signalsExecuted++;
        } else if (normalizedStatus === 'CANCELLED') {
          newSignalStatus = 'IGNORED';
          stats.signalsIgnored++;
        } else if (normalizedStatus === 'REJECTED') {
          newSignalStatus = 'REJECTED';
          stats.signalsRejected++;
        }

        if (newSignalStatus && !dryRun) {
          await pool.query(
            `UPDATE strategy_signals SET status = $1 WHERE id = $2`,
            [newSignalStatus, signal.id]
          );
          stats.signalsUpdated++;
        }
      } else {
        stats.ordersWithoutSignals++;
        logger.debug(
          `未找到匹配信号的订单: ${order.order_id} ` +
          `(strategy_id=${order.strategy_id}, symbol=${order.symbol}, side=${orderSide})`
        );
      }
    }

    // Step 3: Find signals without orders
    // Check both PENDING signals and EXECUTED signals that might not be linked
    const pendingSignals = await pool.query(`
      SELECT id, strategy_id, symbol, signal_type, created_at, status
      FROM strategy_signals
      WHERE status IN ('PENDING', 'EXECUTED')
        AND id NOT IN (
          SELECT DISTINCT signal_id
          FROM execution_orders
          WHERE signal_id IS NOT NULL
        )
      ORDER BY created_at DESC
    `);

    const pendingCount = pendingSignals.rows.filter(s => s.status === 'PENDING').length;
    const executedCount = pendingSignals.rows.filter(s => s.status === 'EXECUTED').length;
    logger.info(`找到 ${pendingSignals.rows.length} 个未关联订单的信号 (PENDING: ${pendingCount}, EXECUTED: ${executedCount})`);

    // Try to match signals to orders (reverse lookup)
    let matchedCount = 0;
    for (const signal of pendingSignals.rows) {
      const signalTime = new Date(signal.created_at);
      const timeWindowStart = new Date(signalTime.getTime() - timeWindowMinutes * 60 * 1000);
      const timeWindowEnd = new Date(signalTime.getTime() + timeWindowMinutes * 60 * 1000);

      // Convert signal_type to order side format (BUY -> 'BUY' or 'Buy' or 1, SELL -> 'SELL' or 'Sell' or 2)
      // Use CASE statement to match various side formats
      // Note: side column can be VARCHAR or INTEGER, so we need to handle both
      // Use CAST to safely convert to text for comparison
      const orderResult = await pool.query(`
        SELECT id, current_status, order_id, created_at, side
        FROM execution_orders
        WHERE strategy_id = $1
          AND symbol = $2
          AND (
            ($3 = 'BUY' AND (
              CAST(side AS TEXT) IN ('BUY', 'Buy', '1') OR 
              (CAST(side AS TEXT) ~ '^[0-9]+$' AND CAST(side AS INTEGER) = 1)
            ))
            OR
            ($3 = 'SELL' AND (
              CAST(side AS TEXT) IN ('SELL', 'Sell', '2') OR 
              (CAST(side AS TEXT) ~ '^[0-9]+$' AND CAST(side AS INTEGER) = 2)
            ))
          )
          AND created_at >= $4
          AND created_at <= $5
          AND signal_id IS NULL
        ORDER BY 
          CASE 
            WHEN created_at <= $6 THEN 0  -- Prefer orders created after signal (signal triggered order)
            ELSE 1  -- Then orders created before signal
          END,
          ABS(EXTRACT(EPOCH FROM (created_at - $6)))  -- Among same priority, choose closest
        LIMIT 1
      `, [
        signal.strategy_id,
        signal.symbol,
        signal.signal_type,
        timeWindowStart,
        timeWindowEnd,
        signal.created_at,
      ]);

      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        const orderSide = await normalizeSide(order.side);
        const timeDiff = Math.abs(
          new Date(order.created_at).getTime() - signalTime.getTime()
        ) / 1000 / 60; // minutes

        // Verify the side matches
        const signalSide = signal.signal_type; // 'BUY' or 'SELL'
        if (orderSide !== signalSide) {
          logger.debug(
            `跳过不匹配的信号 ${signal.id} (${signal.symbol}, ${signalSide}) ` +
            `和订单 ${order.order_id} (side=${orderSide})`
          );
          stats.signalsWithoutOrders++;
          continue;
        }

        matchedCount++;
        logger.debug(
          `匹配信号 ${signal.id} (${signal.symbol}, ${signal.signal_type}, 状态: ${signal.status}) ` +
          `到订单 ${order.order_id} (时间差: ${timeDiff.toFixed(2)}分钟)`
        );

        if (!dryRun) {
          // Update order with signal_id
          await pool.query(
            `UPDATE execution_orders SET signal_id = $1 WHERE id = $2`,
            [signal.id, order.id]
          );
          stats.ordersMatched++;

          // Update signal status (only if signal is still PENDING)
          if (signal.status === 'PENDING') {
            const normalizedStatus = await normalizeStatus(order.current_status);
            let newSignalStatus: 'EXECUTED' | 'IGNORED' | 'REJECTED' | null = null;

            if (normalizedStatus === 'FILLED' || normalizedStatus === 'PARTIALLY_FILLED') {
              newSignalStatus = 'EXECUTED';
              stats.signalsExecuted++;
            } else if (normalizedStatus === 'CANCELLED') {
              newSignalStatus = 'IGNORED';
              stats.signalsIgnored++;
            } else if (normalizedStatus === 'REJECTED') {
              newSignalStatus = 'REJECTED';
              stats.signalsRejected++;
            }

            if (newSignalStatus) {
              await pool.query(
                `UPDATE strategy_signals SET status = $1 WHERE id = $2`,
                [newSignalStatus, signal.id]
              );
              stats.signalsUpdated++;
            }
          } else {
            // Signal is already EXECUTED, just link it to the order
            logger.debug(`信号 ${signal.id} 已经是 ${signal.status} 状态，仅关联订单 ${order.order_id}`);
          }
        } else {
          // In dry-run mode, still count the match
          stats.ordersMatched++;
          if (signal.status === 'PENDING') {
            const normalizedStatus = await normalizeStatus(order.current_status);
            if (normalizedStatus === 'FILLED' || normalizedStatus === 'PARTIALLY_FILLED') {
              stats.signalsExecuted++;
            } else if (normalizedStatus === 'CANCELLED') {
              stats.signalsIgnored++;
            } else if (normalizedStatus === 'REJECTED') {
              stats.signalsRejected++;
            }
            stats.signalsUpdated++;
          }
        }
      } else {
        stats.signalsWithoutOrders++;
      }
    }

    logger.info('回填完成！统计信息:');
    logger.info(`  - 匹配的订单数: ${stats.ordersMatched}`);
    logger.info(`  - 更新的信号数: ${stats.signalsUpdated}`);
    logger.info(`  - 信号状态: EXECUTED=${stats.signalsExecuted}, IGNORED=${stats.signalsIgnored}, REJECTED=${stats.signalsRejected}`);
    logger.info(`  - 未找到信号的订单数: ${stats.ordersWithoutSignals}`);
    logger.info(`  - 未找到订单的信号数: ${stats.signalsWithoutOrders}`);
    logger.info(`  - Step 3 匹配的信号数: ${matchedCount}`);

    return stats;
  } catch (error: any) {
    logger.error('回填信号关联数据失败:', error);
    throw error;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const timeWindowArg = args.find(arg => arg.startsWith('--time-window-minutes='));
  const timeWindowMinutes = timeWindowArg
    ? parseInt(timeWindowArg.split('=')[1]) || 5
    : 5;

  try {
    await backfillSignalAssociations(dryRun, timeWindowMinutes);
    process.exit(0);
  } catch (error) {
    logger.error('脚本执行失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { backfillSignalAssociations };

