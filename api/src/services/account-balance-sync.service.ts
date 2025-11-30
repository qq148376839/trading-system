/**
 * 账户余额同步服务
 * 定期同步账户余额，确保资金分配数据与实际账户一致
 */

import { getTradeContext } from '../config/longport';
import pool from '../config/database';

interface BalanceDiscrepancy {
  strategyId: number;
  expected: number;
  actual: number;
  difference: number;
}

interface SyncResult {
  success: boolean;
  totalCapital: number;
  discrepancies?: BalanceDiscrepancy[];
  error?: string;
}

class AccountBalanceSyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;

  /**
   * 同步账户余额
   * 1. 从 Longbridge SDK 获取实时余额
   * 2. 查询数据库中所有策略的资金分配和使用情况
   * 3. 对比实际持仓价值与数据库记录
   * 4. 返回差异报告
   */
  async syncAccountBalance(): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        success: false,
        totalCapital: 0,
        error: '同步正在进行中，请稍后再试',
      };
    }

    this.isSyncing = true;

    try {
      // 1. 获取实时账户余额
      const tradeCtx = await getTradeContext();
      const balances = await tradeCtx.accountBalance();

      // 提取 USD 余额（如果没有 USD，使用第一个币种）
      let totalCapital = 0;
      const usdBalance = balances.find((bal: any) => bal.currency === 'USD');
      if (usdBalance) {
        // 优先使用 netAssets（净资产），如果没有则使用 totalCash
        totalCapital = parseFloat(usdBalance.netAssets?.toString() || usdBalance.totalCash?.toString() || '0');
      } else if (balances.length > 0) {
        // 如果没有 USD，使用第一个币种（需要转换为 USD，这里简化处理）
        const firstBalance = balances[0];
        totalCapital = parseFloat(firstBalance.netAssets?.toString() || firstBalance.totalCash?.toString() || '0');
        console.warn(`未找到 USD 余额，使用 ${firstBalance.currency} 余额: ${totalCapital}`);
      }

      // 2. 查询数据库中所有策略的资金分配和使用情况
      const strategiesQuery = await pool.query(`
        SELECT 
          s.id as strategy_id,
          s.name as strategy_name,
          ca.id as allocation_id,
          ca.allocation_type,
          ca.allocation_value,
          ca.current_usage,
          ca.name as allocation_name
        FROM strategies s
        LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
        WHERE s.status = 'RUNNING'
      `);

      // 3. 获取实际持仓（从 SDK）
      const positions = await tradeCtx.stockPositions();
      const positionMap = new Map<string, number>();
      
      if (positions && positions.positions) {
        for (const pos of positions.positions) {
          const symbol = pos.symbol;
          const quantity = parseInt(pos.quantity?.toString() || '0');
          const price = parseFloat(pos.currentPrice?.toString() || '0');
          const positionValue = quantity * price;
          
          if (positionValue > 0) {
            positionMap.set(symbol, positionValue);
          }
        }
      }

      // 4. 对比数据库记录与实际持仓
      const discrepancies: BalanceDiscrepancy[] = [];
      
      for (const strategy of strategiesQuery.rows) {
        if (!strategy.allocation_id) continue;

        // 计算策略应该分配的资金
        let expectedAllocation = 0;
        if (strategy.allocation_type === 'PERCENTAGE') {
          expectedAllocation = totalCapital * parseFloat(strategy.allocation_value.toString());
        } else {
          expectedAllocation = parseFloat(strategy.allocation_value.toString());
        }

        // 计算策略实际使用的资金（从持仓）
        let actualUsage = 0;
        const strategyPositions = await pool.query(`
          SELECT symbol FROM strategy_instances 
          WHERE strategy_id = $1 AND current_state = 'HOLDING'
        `, [strategy.strategy_id]);

        for (const instance of strategyPositions.rows) {
          const positionValue = positionMap.get(instance.symbol) || 0;
          actualUsage += positionValue;
        }

        // 对比数据库记录的使用量
        const recordedUsage = parseFloat(strategy.current_usage?.toString() || '0');
        const difference = Math.abs(actualUsage - recordedUsage);

        // 如果差异超过 1%（或 $10），记录为差异
        const threshold = Math.max(expectedAllocation * 0.01, 10);
        if (difference > threshold) {
          discrepancies.push({
            strategyId: strategy.strategy_id,
            expected: recordedUsage,
            actual: actualUsage,
            difference,
          });

          console.warn(
            `策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) 资金使用差异: ` +
            `记录值 ${recordedUsage.toFixed(2)}, 实际值 ${actualUsage.toFixed(2)}, ` +
            `差异 ${difference.toFixed(2)}`
          );
        }
      }

      // 5. 更新根账户的总资金（可选，仅记录日志）
      console.log(`账户余额同步完成: 总资金 ${totalCapital.toFixed(2)} USD`);

      return {
        success: true,
        totalCapital,
        discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
      };
    } catch (error: any) {
      console.error('账户余额同步失败:', error);
      return {
        success: false,
        totalCapital: 0,
        error: error.message || '未知错误',
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 启动定时同步任务
   * @param intervalMinutes 同步间隔（分钟），默认 5 分钟
   */
  startPeriodicSync(intervalMinutes: number = 5): void {
    if (this.syncInterval) {
      console.warn('账户余额同步任务已在运行');
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    
    // 立即执行一次同步
    this.syncAccountBalance().catch((err) => {
      console.error('初始账户余额同步失败:', err);
    });

    // 设置定时任务
    this.syncInterval = setInterval(() => {
      this.syncAccountBalance().catch((err) => {
        console.error('定时账户余额同步失败:', err);
      });
    }, intervalMs);

    console.log(`账户余额定时同步已启动，间隔: ${intervalMinutes} 分钟`);
  }

  /**
   * 停止定时同步任务
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('账户余额定时同步已停止');
    }
  }
}

// 导出单例
export default new AccountBalanceSyncService();

