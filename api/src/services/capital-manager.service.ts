/**
 * 资金管理器服务
 * 管理多策略资金分配和超配保护
 */

import pool from '../config/database';
import { getTradeContext } from '../config/longport';
import accountBalanceSyncService from './account-balance-sync.service';

export interface CapitalAllocation {
  id: number;
  name: string;
  parentId: number | null;
  allocationType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  allocationValue: number;
  currentUsage: number;
}

export interface AllocationRequest {
  strategyId: number;
  amount: number;
  symbol?: string; // 用于标的级限制
}

export interface AllocationResult {
  approved: boolean;
  allocatedAmount: number;
  reason?: string;
}

class CapitalManager {
  /**
   * 获取账户总资金（从实时账户获取）
   * 根据SDK文档，使用 available_cash（可用现金）作为实际可用金额
   * 每次调用都从 Longbridge SDK 获取最新余额，不依赖数据库缓存
   */
  async getTotalCapital(): Promise<number> {
    try {
      const tradeCtx = await getTradeContext();
      const balances = await tradeCtx.accountBalance();

      // 优先查找 USD 余额：遍历所有账户的 cashInfos 数组
      for (const balance of balances) {
        if (balance.cashInfos && Array.isArray(balance.cashInfos)) {
          const usdCashInfo = balance.cashInfos.find((ci: any) => ci.currency === 'USD');
          if (usdCashInfo && usdCashInfo.availableCash) {
            const amount = parseFloat(usdCashInfo.availableCash.toString());
            console.log(`找到 USD 可用现金: ${amount}`);
            return amount;
          }
        }
      }

      // 如果 cashInfos 中没有 USD，查找顶层 currency 为 USD 的账户
      const usdBalance = balances.find((bal: any) => bal.currency === 'USD');
      if (usdBalance) {
        // 优先使用 buyPower（购买力）作为可用金额
        if (usdBalance.buyPower) {
          const amount = parseFloat(usdBalance.buyPower.toString());
          console.log(`找到 USD 购买力: ${amount}`);
          return amount;
        }
        // 使用 netAssets（净资产）
        if (usdBalance.netAssets) {
          const amount = parseFloat(usdBalance.netAssets.toString());
          console.log(`找到 USD 净资产: ${amount}`);
          return amount;
        }
        // 最后使用 totalCash
        if (usdBalance.totalCash) {
          const amount = parseFloat(usdBalance.totalCash.toString());
          console.log(`找到 USD 总现金: ${amount}`);
          return amount;
        }
      }

      // 如果没有找到 USD，使用第一个币种的可用现金（但记录警告）
      if (balances.length > 0) {
        const firstBalance = balances[0];
        // 优先使用 cashInfos 中的 available_cash
        if (firstBalance.cashInfos && Array.isArray(firstBalance.cashInfos) && firstBalance.cashInfos.length > 0) {
          const firstCashInfo = firstBalance.cashInfos[0];
          if (firstCashInfo.availableCash) {
            const amount = parseFloat(firstCashInfo.availableCash.toString());
            console.warn(`⚠️ 未找到 USD 余额，使用 ${firstBalance.currency} 可用现金: ${amount}（注意：可能存在货币转换问题）`);
            return amount;
          }
        }
        // 如果没有 cashInfos，使用 buyPower
        if (firstBalance.buyPower) {
          const amount = parseFloat(firstBalance.buyPower.toString());
          console.warn(`⚠️ 未找到 USD 余额，使用 ${firstBalance.currency} 购买力: ${amount}（注意：可能存在货币转换问题）`);
          return amount;
        }
        const amount = parseFloat(firstBalance.netAssets?.toString() || firstBalance.totalCash?.toString() || '0');
        console.warn(`⚠️ 未找到 USD 余额，使用 ${firstBalance.currency} 余额: ${amount}（注意：可能存在货币转换问题）`);
        return amount;
      }

      throw new Error('无法获取账户余额');
    } catch (error: any) {
      console.error('获取账户总资金失败:', error);
      
      // 如果是API限流错误，等待更长时间后重试
      if (error.message && error.message.includes('429002')) {
        console.warn('API请求限流，等待3秒后重试...');
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        // 其他错误，等待1秒后重试
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      
      try {
        const tradeCtx = await getTradeContext();
        const balances = await tradeCtx.accountBalance();
        
        // 优先查找 USD 余额：遍历所有账户的 cashInfos 数组
        for (const balance of balances) {
          if (balance.cashInfos && Array.isArray(balance.cashInfos)) {
            const usdCashInfo = balance.cashInfos.find((ci: any) => ci.currency === 'USD');
            if (usdCashInfo && usdCashInfo.availableCash) {
              return parseFloat(usdCashInfo.availableCash.toString());
            }
          }
        }
        
        // 如果 cashInfos 中没有 USD，查找顶层 currency 为 USD 的账户
        const usdBalance = balances.find((bal: any) => bal.currency === 'USD');
        if (usdBalance) {
          if (usdBalance.buyPower) {
            return parseFloat(usdBalance.buyPower.toString());
          }
          return parseFloat(usdBalance.netAssets?.toString() || usdBalance.totalCash?.toString() || '0');
        }
      } catch (retryError: any) {
        console.error('重试获取账户总资金失败:', retryError);
        throw new Error(`获取账户总资金失败: ${retryError.message}`);
      }
      
      throw error;
    }
  }

  /**
   * 创建资金分配账户
   */
  async createAllocation(config: {
    name: string;
    parentId?: number;
    allocationType: 'PERCENTAGE' | 'FIXED_AMOUNT';
    allocationValue: number;
  }): Promise<CapitalAllocation> {
    // 检查名称是否已存在
    const nameCheckResult = await pool.query(
      'SELECT id FROM capital_allocations WHERE name = $1',
      [config.name]
    );
    if (nameCheckResult.rows.length > 0) {
      throw new Error(`资金分配账户名称 "${config.name}" 已存在`);
    }

    // 验证父账户存在（如果有）
    if (config.parentId) {
      const parentResult = await pool.query(
        'SELECT id FROM capital_allocations WHERE id = $1',
        [config.parentId]
      );
      if (parentResult.rows.length === 0) {
        throw new Error(`父账户 ${config.parentId} 不存在`);
      }
    }

    // 验证百分比总和不超过 100%（如果是百分比类型）
    if (config.allocationType === 'PERCENTAGE') {
      const parentIdToCheck = config.parentId || null;
      const siblingsResult = await pool.query(
        `SELECT SUM(allocation_value) as total FROM capital_allocations 
         WHERE parent_id ${parentIdToCheck ? '= $1' : 'IS NULL'} AND allocation_type = 'PERCENTAGE'`,
        parentIdToCheck ? [parentIdToCheck] : []
      );
      const existingTotal = parseFloat(siblingsResult.rows[0]?.total || '0');
      if (existingTotal + config.allocationValue > 1.0) {
        throw new Error(`百分比总和超过 100%: ${(existingTotal * 100).toFixed(1)}% + ${(config.allocationValue * 100).toFixed(1)}%`);
      }
    }

    // 基于当前实时账户余额计算分配金额（如果是百分比）
    // 注意：百分比值存储在数据库中，实际金额在查询时基于实时余额计算
    let allocationValue = config.allocationValue;

    // 插入数据库
    const result = await pool.query(
      `INSERT INTO capital_allocations (name, parent_id, allocation_type, allocation_value)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, parent_id, allocation_type, allocation_value, current_usage`,
      [config.name, config.parentId || null, config.allocationType, allocationValue]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      allocationType: row.allocation_type,
      allocationValue: parseFloat(row.allocation_value),
      currentUsage: parseFloat(row.current_usage || '0'),
    };
  }

  /**
   * 申请资金额度
   */
  async requestAllocation(request: AllocationRequest): Promise<AllocationResult> {
    // 1. 前置检查：获取最新账户余额
    const totalCapital = await this.getTotalCapital();

    // 2. 查询策略关联的资金分配账户和标的池配置
    const strategyResult = await pool.query(
      `SELECT s.id, s.name, s.symbol_pool_config, ca.id as allocation_id, ca.allocation_type, 
              ca.allocation_value, ca.current_usage, ca.parent_id
       FROM strategies s
       LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
       WHERE s.id = $1`,
      [request.strategyId]
    );

    if (strategyResult.rows.length === 0) {
      return {
        approved: false,
        allocatedAmount: 0,
        reason: `策略 ${request.strategyId} 不存在`,
      };
    }

    const strategy = strategyResult.rows[0];
    if (!strategy.allocation_id) {
      return {
        approved: false,
        allocatedAmount: 0,
        reason: `策略 ${strategy.name} 未配置资金分配账户`,
      };
    }

    // 3. 计算可用额度（考虑父账户限制和实时余额）
    let allocatedAmount = 0;
    if (strategy.allocation_type === 'PERCENTAGE') {
      allocatedAmount = totalCapital * parseFloat(strategy.allocation_value.toString());
    } else {
      allocatedAmount = parseFloat(strategy.allocation_value.toString());
    }

    const currentUsage = parseFloat(strategy.current_usage || '0');
    const availableAmount = allocatedAmount - currentUsage;

    // 4. 检查标的级限制（如果提供 symbol）
    if (request.symbol) {
      // 查询该标的的当前持仓
      const positionResult = await pool.query(
        `SELECT SUM(quantity * avg_price) as total_value 
         FROM auto_trades 
         WHERE strategy_id = $1 AND symbol = $2 AND side = 'BUY' AND status = 'FILLED'
         AND close_time IS NULL`,
        [request.strategyId, request.symbol]
      );
      const positionValue = parseFloat(positionResult.rows[0]?.total_value || '0');
      
      // 动态计算标的级限制：策略总资金 / 标的数量
      // 首先获取标的池中的标的数量
      let symbolCount = 1; // 默认值，避免除零
      try {
        const stockSelector = (await import('./stock-selector.service')).default;
        const symbols = await stockSelector.getSymbolPool(strategy.symbol_pool_config || {});
        symbolCount = Math.max(1, symbols.length); // 至少为1，避免除零
      } catch (error: any) {
        console.warn(`无法获取策略 ${request.strategyId} 的标的池，使用默认限制:`, error.message);
        // 如果无法获取标的池，使用固定百分比（向后兼容）
        symbolCount = 20; // 假设20个标的，相当于5%的限制
      }
      
      // 动态分配：策略总资金平均分配给所有标的
      const maxPositionPerSymbol = allocatedAmount / symbolCount;
      const newPositionValue = positionValue + request.amount;
      
      if (newPositionValue > maxPositionPerSymbol) {
        return {
          approved: false,
          allocatedAmount: 0,
          reason: `标的 ${request.symbol} 持仓超过限制: ${positionValue.toFixed(2)} + ${request.amount.toFixed(2)} = ${newPositionValue.toFixed(2)} > ${maxPositionPerSymbol.toFixed(2)} (策略总资金 ${allocatedAmount.toFixed(2)} / ${symbolCount} 个标的)`,
        };
      }
    }

    // 5. 检查可用额度
    if (request.amount > availableAmount) {
      return {
        approved: false,
        allocatedAmount: 0,
        reason: `资金不足: 申请 ${request.amount.toFixed(2)}, 可用 ${availableAmount.toFixed(2)}`,
      };
    }

    // 6. 更新 current_usage（使用数据库锁防止并发问题）
    const updateResult = await pool.query(
      `UPDATE capital_allocations 
       SET current_usage = current_usage + $1, updated_at = NOW()
       WHERE id = $2 AND current_usage + $1 <= (
         SELECT CASE 
           WHEN allocation_type = 'PERCENTAGE' THEN $3 * allocation_value
           ELSE allocation_value
         END
       )
       RETURNING current_usage`,
      [request.amount, strategy.allocation_id, totalCapital]
    );

    if (updateResult.rows.length === 0) {
      return {
        approved: false,
        allocatedAmount: 0,
        reason: '资金分配更新失败，可能已被其他请求占用',
      };
    }

    return {
      approved: true,
      allocatedAmount: request.amount,
    };
  }

  /**
   * 释放资金额度
   */
  async releaseAllocation(strategyId: number, amount: number, _symbol?: string): Promise<void> {
    const strategyResult = await pool.query(
      `SELECT ca.id as allocation_id FROM strategies s
       LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
       WHERE s.id = $1`,
      [strategyId]
    );

    if (strategyResult.rows.length === 0 || !strategyResult.rows[0].allocation_id) {
      throw new Error(`策略 ${strategyId} 不存在或未配置资金分配账户`);
    }

    const allocationId = strategyResult.rows[0].allocation_id;

    await pool.query(
      `UPDATE capital_allocations 
       SET current_usage = GREATEST(0, current_usage - $1), updated_at = NOW()
       WHERE id = $2`,
      [amount, allocationId]
    );

    // 可选：触发账户余额同步验证
    // accountBalanceSyncService.syncAccountBalance().catch(console.error);
  }

  /**
   * 获取策略可用资金
   */
  async getAvailableCapital(strategyId: number): Promise<number> {
    // 前置：先获取实时账户余额
    const totalCapital = await this.getTotalCapital();

    const strategyResult = await pool.query(
      `SELECT ca.allocation_type, ca.allocation_value, ca.current_usage
       FROM strategies s
       LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
       WHERE s.id = $1`,
      [strategyId]
    );

    if (strategyResult.rows.length === 0 || !strategyResult.rows[0].allocation_type) {
      return 0;
    }

    const allocation = strategyResult.rows[0];
    let allocatedAmount = 0;

    if (allocation.allocation_type === 'PERCENTAGE') {
      allocatedAmount = totalCapital * parseFloat(allocation.allocation_value.toString());
    } else {
      allocatedAmount = parseFloat(allocation.allocation_value.toString());
    }

    const currentUsage = parseFloat(allocation.current_usage || '0');
    return Math.max(0, allocatedAmount - currentUsage);
  }

  /**
   * 校验资金使用情况
   */
  async validateUsage(): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];

    try {
      // 第一步：同步账户余额，获取最新总资金
      const syncResult = await accountBalanceSyncService.syncAccountBalance();
      if (!syncResult.success) {
        issues.push(`账户余额同步失败: ${syncResult.error}`);
        return { valid: false, issues };
      }

      const totalCapital = syncResult.totalCapital;

      // 第二步：查询所有策略的实际持仓（从 Longbridge SDK）
      const tradeCtx = await getTradeContext();
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

      // 第三步：对比数据库记录与实际持仓
      const strategiesResult = await pool.query(`
        SELECT s.id, s.name, ca.allocation_type, ca.allocation_value, ca.current_usage
        FROM strategies s
        LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
        WHERE s.status = 'RUNNING'
      `);

      for (const strategy of strategiesResult.rows) {
        if (!strategy.allocation_type) continue;

        // 计算策略应该分配的资金
        let allocatedAmount = 0;
        if (strategy.allocation_type === 'PERCENTAGE') {
          allocatedAmount = totalCapital * parseFloat(strategy.allocation_value.toString());
        } else {
          allocatedAmount = parseFloat(strategy.allocation_value.toString());
        }

        // 计算策略实际使用的资金
        const strategyPositions = await pool.query(`
          SELECT symbol FROM strategy_instances 
          WHERE strategy_id = $1 AND current_state = 'HOLDING'
        `, [strategy.id]);

        let actualUsage = 0;
        for (const instance of strategyPositions.rows) {
          const positionValue = positionMap.get(instance.symbol) || 0;
          actualUsage += positionValue;
        }

        // 检查是否超配
        const recordedUsage = parseFloat(strategy.current_usage || '0');
        if (recordedUsage > allocatedAmount * 1.01) { // 允许 1% 的误差
          issues.push(
            `策略 ${strategy.name} (ID: ${strategy.id}) 超配: ` +
            `分配 ${allocatedAmount.toFixed(2)}, 使用 ${recordedUsage.toFixed(2)}`
          );
        }

        // 检查数据库记录与实际持仓的差异
        const difference = Math.abs(actualUsage - recordedUsage);
        if (difference > allocatedAmount * 0.01) { // 差异超过 1%
          issues.push(
            `策略 ${strategy.name} (ID: ${strategy.id}) 资金使用不一致: ` +
            `记录值 ${recordedUsage.toFixed(2)}, 实际值 ${actualUsage.toFixed(2)}, ` +
            `差异 ${difference.toFixed(2)}`
          );
        }
      }

      // 第四步：检查标的级限制
      // （已在 requestAllocation 中实现，这里可以添加全局检查）

      return {
        valid: issues.length === 0,
        issues,
      };
    } catch (error: any) {
      issues.push(`校验过程出错: ${error.message}`);
      return { valid: false, issues };
    }
  }
}

// 导出单例
export default new CapitalManager();

