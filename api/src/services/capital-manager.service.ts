/**
 * 资金管理器服务
 * 管理多策略资金分配和超配保护
 */

import pool from '../config/database';
import { getTradeContext } from '../config/longport';
import accountBalanceSyncService from './account-balance-sync.service';
import { logger } from '../utils/logger';
import { isLikelyOptionSymbol, getOptionPrefixesForUnderlying } from '../utils/options-symbol';

export interface CapitalAllocation {
  id: number;
  name: string;
  parentId: number | null;
  allocationType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  allocationValue: number;
  currentUsage: number;
  isSystem?: boolean;
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
  // 账户余额缓存：避免频繁调用 accountBalance() API
  private balanceCache: { amount: number; timestamp: number } | null = null;
  private readonly BALANCE_CACHE_TTL = 10000; // 10秒缓存
  private lastBalanceCallTime: number = 0;
  private readonly MIN_BALANCE_CALL_INTERVAL = 2000; // 最小调用间隔2秒（交易API限制：30秒内不超过30次，每次间隔>=0.02秒）

  /**
   * 获取账户总资金（从实时账户获取）
   * 根据SDK文档，使用 available_cash（可用现金）作为实际可用金额
   * 添加缓存机制，避免频繁调用导致频率限制
   */
  async getTotalCapital(): Promise<number> {
    const now = Date.now();
    
    // 检查缓存是否有效
    if (this.balanceCache && (now - this.balanceCache.timestamp) < this.BALANCE_CACHE_TTL) {
      return this.balanceCache.amount;
    }

    // 检查调用间隔（交易API频率限制：30秒内不超过30次，每次间隔>=0.02秒）
    const timeSinceLastCall = now - this.lastBalanceCallTime;
    if (timeSinceLastCall < this.MIN_BALANCE_CALL_INTERVAL) {
      const waitTime = this.MIN_BALANCE_CALL_INTERVAL - timeSinceLastCall;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    try {
      this.lastBalanceCallTime = Date.now();
      const tradeCtx = await getTradeContext();
      
      // 首先尝试直接获取 USD 余额（如果SDK支持按币种查询）
      try {
        const usdBalances = await tradeCtx.accountBalance('USD');
        if (usdBalances && usdBalances.length > 0) {
          const usdBalance = usdBalances[0];
          // 优先使用 cashInfos 中的 availableCash
          if (usdBalance.cashInfos && Array.isArray(usdBalance.cashInfos) && usdBalance.cashInfos.length > 0) {
            const usdCashInfo = usdBalance.cashInfos.find((ci: any) => ci.currency === 'USD');
            if (usdCashInfo && usdCashInfo.availableCash) {
              const amount = parseFloat(usdCashInfo.availableCash.toString());
              this.balanceCache = { amount, timestamp: Date.now() };
              return amount;
            }
          }
          // 如果没有 cashInfos，使用 buyPower 或 netAssets
          if (usdBalance.buyPower) {
            const amount = parseFloat(usdBalance.buyPower.toString());
            this.balanceCache = { amount, timestamp: Date.now() };
            return amount;
          }
          if (usdBalance.netAssets) {
            const amount = parseFloat(usdBalance.netAssets.toString());
            this.balanceCache = { amount, timestamp: Date.now() };
            return amount;
          }
          if (usdBalance.totalCash) {
            const amount = parseFloat(usdBalance.totalCash.toString());
            this.balanceCache = { amount, timestamp: Date.now() };
            return amount;
          }
        }
      } catch (usdError: any) {
        // 如果按币种查询失败，继续使用通用查询方式
        logger.debug('按USD币种查询失败，使用通用查询:', usdError.message);
      }
      
      // 通用查询方式：获取所有币种余额
      const balances = await tradeCtx.accountBalance();

      // 优先查找 USD 余额：遍历所有账户的 cashInfos 数组
      for (const balance of balances) {
        if (balance.cashInfos && Array.isArray(balance.cashInfos)) {
          const usdCashInfo = balance.cashInfos.find((ci: any) => ci.currency === 'USD');
          if (usdCashInfo && usdCashInfo.availableCash) {
            const amount = parseFloat(usdCashInfo.availableCash.toString());
            // 更新缓存
            this.balanceCache = { amount, timestamp: Date.now() };
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
          this.balanceCache = { amount, timestamp: Date.now() };
          return amount;
        }
        // 使用 netAssets（净资产）
        if (usdBalance.netAssets) {
          const amount = parseFloat(usdBalance.netAssets.toString());
          this.balanceCache = { amount, timestamp: Date.now() };
          return amount;
        }
        // 最后使用 totalCash
        if (usdBalance.totalCash) {
          const amount = parseFloat(usdBalance.totalCash.toString());
          this.balanceCache = { amount, timestamp: Date.now() };
          return amount;
        }
      }
      
      // 调试日志：输出所有账户信息，帮助诊断问题
      logger.debug('账户余额详情:', JSON.stringify(balances.map((bal: any) => ({
        currency: bal.currency,
        cashInfos: bal.cashInfos?.map((ci: any) => ({
          currency: ci.currency,
          availableCash: ci.availableCash?.toString(),
        })),
        buyPower: bal.buyPower?.toString(),
        netAssets: bal.netAssets?.toString(),
        totalCash: bal.totalCash?.toString(),
      })), null, 2));

      // 如果没有找到 USD，使用第一个币种的可用现金（但记录警告）
      if (balances.length > 0) {
        const firstBalance = balances[0];
        let amount = 0;
        
        // 优先使用 cashInfos 中的 availableCash
        if (firstBalance.cashInfos && Array.isArray(firstBalance.cashInfos) && firstBalance.cashInfos.length > 0) {
          const firstCashInfo = firstBalance.cashInfos[0];
          if (firstCashInfo.availableCash) {
            amount = parseFloat(firstCashInfo.availableCash.toString());
          } else {
            amount = parseFloat(firstBalance.netAssets?.toString() || firstBalance.totalCash?.toString() || '0');
          }
        } else {
          // 如果没有 cashInfos，使用 buyPower 或 netAssets
          if (firstBalance.buyPower) {
            amount = parseFloat(firstBalance.buyPower.toString());
          } else {
            amount = parseFloat(firstBalance.netAssets?.toString() || firstBalance.totalCash?.toString() || '0');
          }
        }
        
        // 记录警告
        logger.warn(`未找到 USD 余额，使用 ${firstBalance.currency} 余额: ${amount.toFixed(2)}`);
        this.balanceCache = { amount, timestamp: Date.now() };
        return amount;
      }

      throw new Error('无法获取账户余额');
    } catch (error: any) {
      // 如果是API限流错误，使用缓存（如果存在）
      if (error.message && error.message.includes('429002')) {
        if (this.balanceCache) {
          logger.warn(`[资金管理] API限流，使用缓存余额: ${this.balanceCache.amount.toFixed(2)}`);
          return this.balanceCache.amount;
        }
        // 等待后重试
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      
      try {
        this.lastBalanceCallTime = Date.now();
        const tradeCtx = await getTradeContext();
        const balances = await tradeCtx.accountBalance();
        
        // 优先查找 USD 余额：遍历所有账户的 cashInfos 数组
        for (const balance of balances) {
          if (balance.cashInfos && Array.isArray(balance.cashInfos)) {
            const usdCashInfo = balance.cashInfos.find((ci: any) => ci.currency === 'USD');
            if (usdCashInfo && usdCashInfo.availableCash) {
              const amount = parseFloat(usdCashInfo.availableCash.toString());
              this.balanceCache = { amount, timestamp: Date.now() };
              return amount;
            }
          }
        }
        
        // 如果 cashInfos 中没有 USD，查找顶层 currency 为 USD 的账户
        const usdBalance = balances.find((bal: any) => bal.currency === 'USD');
        if (usdBalance) {
          if (usdBalance.buyPower) {
            const amount = parseFloat(usdBalance.buyPower.toString());
            this.balanceCache = { amount, timestamp: Date.now() };
            return amount;
          }
          const amount = parseFloat(usdBalance.netAssets?.toString() || usdBalance.totalCash?.toString() || '0');
          this.balanceCache = { amount, timestamp: Date.now() };
          return amount;
        }
      } catch (retryError: any) {
        // 重试失败，如果有缓存则使用缓存
        if (this.balanceCache) {
          logger.warn(`[资金管理] 重试失败，使用缓存余额: ${this.balanceCache.amount.toFixed(2)}`);
          return this.balanceCache.amount;
        }
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

    // 插入数据库（新增账户默认不是系统账户）
    const result = await pool.query(
      `INSERT INTO capital_allocations (name, parent_id, allocation_type, allocation_value, is_system)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, name, parent_id, allocation_type, allocation_value, current_usage, is_system`,
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
      isSystem: row.is_system || false,
    };
  }

  /**
   * 获取标的级限制（每个标的的最大持仓金额）
   */
  async getMaxPositionPerSymbol(strategyId: number): Promise<number> {
    try {
      // 查询策略关联的资金分配账户
      const strategyResult = await pool.query(
        `SELECT s.symbol_pool_config, ca.allocation_type, ca.allocation_value
         FROM strategies s
         LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
         WHERE s.id = $1`,
        [strategyId]
      );

      if (strategyResult.rows.length === 0 || !strategyResult.rows[0].allocation_type) {
        return 0;
      }

      const strategy = strategyResult.rows[0];
      
      // 计算策略总资金（与 requestAllocation 一致，应用资金保护）
      const totalCapital = await this.getTotalCapital();
      let allocatedAmount = 0;
      if (strategy.allocation_type === 'PERCENTAGE') {
        allocatedAmount = totalCapital * parseFloat(strategy.allocation_value.toString());
      } else {
        const configuredAmount = parseFloat(strategy.allocation_value.toString());
        allocatedAmount = Math.min(configuredAmount, totalCapital);
      }

      // 获取标的池中的标的数量
      let symbolCount = 1;
      try {
        const stockSelector = (await import('./stock-selector.service')).default;
        const symbols = await stockSelector.getSymbolPool(strategy.symbol_pool_config || {});
        symbolCount = Math.max(1, symbols.length);
      } catch (error: any) {
        logger.warn(`无法获取策略 ${strategyId} 的标的池，使用默认限制:`, error.message);
        symbolCount = 20; // 假设20个标的
      }

      // 计算每个标的的最大持仓金额
      return allocatedAmount / symbolCount;
    } catch (error: any) {
      logger.error(`获取标的级限制失败 (策略 ${strategyId}):`, error);
      return 0;
    }
  }

  /**
   * 申请资金额度
   * 使用数据库事务 + SELECT FOR UPDATE 防止并发超配
   */
  async requestAllocation(request: AllocationRequest): Promise<AllocationResult> {
    // 1. 前置检查：获取最新账户余额（在事务外获取，避免长时间持锁）
    const totalCapital = await this.getTotalCapital();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      logger.debug(`[资金事务] requestAllocation BEGIN: 策略${request.strategyId}, 金额${request.amount.toFixed(2)}`);

      // 2. 查询策略关联的资金分配账户和标的池配置
      const strategyResult = await client.query(
        `SELECT s.id, s.name, s.symbol_pool_config, ca.id as allocation_id, ca.allocation_type,
                ca.allocation_value, ca.current_usage, ca.parent_id
         FROM strategies s
         LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
         WHERE s.id = $1`,
        [request.strategyId]
      );

      if (strategyResult.rows.length === 0) {
        await client.query('ROLLBACK');
        logger.debug(`[资金事务] requestAllocation ROLLBACK: 策略${request.strategyId}不存在`);
        return {
          approved: false,
          allocatedAmount: 0,
          reason: `策略 ${request.strategyId} 不存在`,
        };
      }

      const strategy = strategyResult.rows[0];
      if (!strategy.allocation_id) {
        await client.query('ROLLBACK');
        logger.debug(`[资金事务] requestAllocation ROLLBACK: 策略${strategy.name}未配置资金分配账户`);
        return {
          approved: false,
          allocatedAmount: 0,
          reason: `策略 ${strategy.name} 未配置资金分配账户`,
        };
      }

      // 3. 锁定资金分配行，防止并发修改（SELECT FOR UPDATE）
      const allocationLockResult = await client.query(
        `SELECT id, allocation_type, allocation_value, current_usage
         FROM capital_allocations
         WHERE id = $1
         FOR UPDATE`,
        [strategy.allocation_id]
      );

      if (allocationLockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        logger.debug(`[资金事务] requestAllocation ROLLBACK: 资金分配账户${strategy.allocation_id}不存在`);
        return {
          approved: false,
          allocatedAmount: 0,
          reason: `资金分配账户 ${strategy.allocation_id} 不存在`,
        };
      }

      const lockedAllocation = allocationLockResult.rows[0];

      // 4. 计算可用额度（使用锁定后的最新 current_usage）
      let allocatedAmount = 0;
      if (lockedAllocation.allocation_type === 'PERCENTAGE') {
        allocatedAmount = totalCapital * parseFloat(lockedAllocation.allocation_value.toString());
      } else {
        // 固定金额不得超过实际账户可用余额
        const configuredAmount = parseFloat(lockedAllocation.allocation_value.toString());
        allocatedAmount = Math.min(configuredAmount, totalCapital);
        if (allocatedAmount < configuredAmount) {
          logger.warn(
            `[资金保护] 策略 ${strategy.name}: 配置金额 ${configuredAmount.toFixed(2)} > 账户可用 ${totalCapital.toFixed(2)}，` +
            `实际分配上限降为 ${allocatedAmount.toFixed(2)}`
          );
        }
      }

      const currentUsage = parseFloat(lockedAllocation.current_usage || '0');
      const availableAmount = allocatedAmount - currentUsage;

      // 5. 检查标的级限制（如果提供 symbol）
      if (request.symbol) {
        let positionValue = 0;

        // 判断是否为期权合约 symbol
        const isOption = isLikelyOptionSymbol(request.symbol);

        if (isOption) {
          // 期权合约：通过 strategy_instances 查询该 underlying 下所有合约的已用资金
          const underlyingPrefix = request.symbol.replace(/\d{6}[CP]\d+\.US$/i, '');
          const prefixes = getOptionPrefixesForUnderlying(underlyingPrefix + '.US');

          // 查询该 underlying 下所有状态为 HOLDING/OPENING 的期权合约的 allocationAmount
          const optionPositionResult = await client.query(
            `SELECT
               COALESCE((context->>'tradedSymbol')::text, symbol) as traded_symbol,
               COALESCE((context->>'allocationAmount')::numeric, 0) as allocation_amount,
               current_state
             FROM strategy_instances
             WHERE strategy_id = $1
               AND current_state IN ('HOLDING', 'OPENING')`,
            [request.strategyId]
          );

          for (const row of optionPositionResult.rows) {
            const tradedSym = String(row.traded_symbol || '').toUpperCase();
            if (!isLikelyOptionSymbol(tradedSym)) continue;
            if (prefixes.some((p: string) => tradedSym.toUpperCase().startsWith(p.toUpperCase()))) {
              positionValue += parseFloat(row.allocation_amount || '0');
            }
          }
        } else {
          // 股票：使用 auto_trades 查询（原逻辑）
          const positionResult = await client.query(
            `SELECT SUM(quantity * avg_price) as total_value
             FROM auto_trades
             WHERE strategy_id = $1 AND symbol = $2 AND side = 'BUY' AND status = 'FILLED'
             AND close_time IS NULL`,
            [request.strategyId, request.symbol]
          );
          positionValue = parseFloat(positionResult.rows[0]?.total_value || '0');
        }

        // 动态计算标的级限制：策略总资金 / 标的数量
        let symbolCount = 1;
        try {
          const stockSelector = (await import('./stock-selector.service')).default;
          const symbols = await stockSelector.getSymbolPool(strategy.symbol_pool_config || {});
          symbolCount = Math.max(1, symbols.length);
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.warn(`无法获取策略 ${request.strategyId} 的标的池，使用默认限制:`, errMsg);
          symbolCount = 20;
        }

        // 动态分配：策略总资金平均分配给所有标的
        const maxPositionPerSymbol = allocatedAmount / symbolCount;
        const newPositionValue = positionValue + request.amount;

        if (newPositionValue > maxPositionPerSymbol) {
          await client.query('ROLLBACK');
          logger.debug(`[资金事务] requestAllocation ROLLBACK: 标的${request.symbol}持仓超限`);
          return {
            approved: false,
            allocatedAmount: 0,
            reason: `标的 ${request.symbol} 持仓超过限制: 已用${positionValue.toFixed(2)} + 申请${request.amount.toFixed(2)} = ${newPositionValue.toFixed(2)} > 上限${maxPositionPerSymbol.toFixed(2)} (策略总资金 ${allocatedAmount.toFixed(2)} / ${symbolCount} 个标的)`,
          };
        }
      }

      // 6. 检查可用额度
      if (request.amount > availableAmount) {
        await client.query('ROLLBACK');
        logger.debug(`[资金事务] requestAllocation ROLLBACK: 资金不足`);
        return {
          approved: false,
          allocatedAmount: 0,
          reason: `资金不足: 申请 ${request.amount.toFixed(2)}, 可用 ${availableAmount.toFixed(2)}`,
        };
      }

      // 7. 更新 current_usage（行已被 FOR UPDATE 锁定，安全更新）
      const updateResult = await client.query(
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
        await client.query('ROLLBACK');
        logger.debug(`[资金事务] requestAllocation ROLLBACK: 资金分配更新失败`);
        return {
          approved: false,
          allocatedAmount: 0,
          reason: '资金分配更新失败，可能已被其他请求占用',
        };
      }

      await client.query('COMMIT');
      logger.debug(`[资金事务] requestAllocation COMMIT: 策略${request.strategyId}, 分配${request.amount.toFixed(2)}`);

      return {
        approved: true,
        allocatedAmount: request.amount,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`[资金事务] requestAllocation ROLLBACK (异常): 策略${request.strategyId}`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 释放资金额度
   * 使用数据库事务 + SELECT FOR UPDATE 防止并发释放导致数据不一致
   */
  async releaseAllocation(strategyId: number, amount: number, _symbol?: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      logger.debug(`[资金事务] releaseAllocation BEGIN: 策略${strategyId}, 金额${amount.toFixed(2)}`);

      const strategyResult = await client.query(
        `SELECT ca.id as allocation_id, ca.current_usage, ca.name as allocation_name
         FROM strategies s
         LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
         WHERE s.id = $1`,
        [strategyId]
      );

      if (strategyResult.rows.length === 0 || !strategyResult.rows[0].allocation_id) {
        await client.query('ROLLBACK');
        logger.debug(`[资金事务] releaseAllocation ROLLBACK: 策略${strategyId}不存在或未配置资金分配账户`);
        throw new Error(`策略 ${strategyId} 不存在或未配置资金分配账户`);
      }

      const allocationId = strategyResult.rows[0].allocation_id;
      const allocationName = strategyResult.rows[0].allocation_name || '未知';

      // 锁定资金分配行，获取最新 current_usage
      const lockResult = await client.query(
        `SELECT id, current_usage
         FROM capital_allocations
         WHERE id = $1
         FOR UPDATE`,
        [allocationId]
      );

      const beforeUsage = parseFloat(lockResult.rows[0]?.current_usage?.toString() || '0');

      logger.debug(
        `[资金释放] 策略 ${strategyId}, 标的 ${_symbol || 'N/A'}, ` +
        `释放金额=${amount.toFixed(2)}, 释放前current_usage=${beforeUsage.toFixed(2)}`
      );

      const updateResult = await client.query(
        `UPDATE capital_allocations
         SET current_usage = GREATEST(0, current_usage - $1), updated_at = NOW()
         WHERE id = $2
         RETURNING current_usage`,
        [amount, allocationId]
      );

      if (updateResult.rows.length > 0) {
        const afterUsage = parseFloat(updateResult.rows[0].current_usage?.toString() || '0');
        logger.debug(
          `[资金释放] 策略 ${strategyId}, 分配账户 ${allocationName} (ID: ${allocationId}), ` +
          `释放后current_usage=${afterUsage.toFixed(2)}`
        );
      } else {
        logger.error(`[资金释放] 策略 ${strategyId} 资金释放失败，更新结果为空`);
      }

      await client.query('COMMIT');
      logger.debug(`[资金事务] releaseAllocation COMMIT: 策略${strategyId}, 释放${amount.toFixed(2)}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`[资金事务] releaseAllocation ROLLBACK (异常): 策略${strategyId}`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 获取策略可用资金
   */
  async getAvailableCapital(strategyId: number): Promise<number> {
    // 前置：先获取实时账户余额（带缓存）
    const totalCapital = await this.getTotalCapital();

    const strategyResult = await pool.query(
      `SELECT s.name as strategy_name, s.capital_allocation_id, 
              ca.id as allocation_id, ca.allocation_type, ca.allocation_value, ca.current_usage
       FROM strategies s
       LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
       WHERE s.id = $1`,
      [strategyId]
    );

    if (strategyResult.rows.length === 0) {
      return 0;
    }

    const strategy = strategyResult.rows[0];
    
    // 检查策略是否配置了资金分配
    if (!strategy.capital_allocation_id || !strategy.allocation_id || !strategy.allocation_type) {
      return 0;
    }

    const allocation = strategy;
    let allocatedAmount = 0;

    if (allocation.allocation_type === 'PERCENTAGE') {
      allocatedAmount = totalCapital * parseFloat(allocation.allocation_value.toString());
    } else {
      allocatedAmount = parseFloat(allocation.allocation_value.toString());
    }

    const currentUsage = parseFloat(allocation.current_usage || '0');
    const availableAmount = Math.max(0, allocatedAmount - currentUsage);
    
    return availableAmount;
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
      
      // 处理不同的数据结构：可能是 positions.positions 或 positions.channels[].positions
      let positionsArray: any[] = [];
      
      if (positions) {
        // 尝试直接访问 positions.positions
        if (positions.positions && Array.isArray(positions.positions)) {
          positionsArray = positions.positions;
        }
        // 尝试访问 positions.channels[].positions
        else if (positions.channels && Array.isArray(positions.channels)) {
          for (const channel of positions.channels) {
            if (channel.positions && Array.isArray(channel.positions)) {
              positionsArray.push(...channel.positions);
            }
          }
        }
      }
      
      if (positionsArray.length > 0) {
        for (const pos of positionsArray) {
          const symbol = pos.symbol;
          const quantity = parseInt(pos.quantity?.toString() || '0');
          // 尝试多种价格字段：currentPrice, costPrice, avgPrice, lastPrice
          const price = parseFloat(
            pos.currentPrice?.toString() || 
            pos.costPrice?.toString() || 
            pos.avgPrice?.toString() ||
            pos.lastPrice?.toString() ||
            '0'
          );
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

  /**
   * 获取有效标的池（均分资金到所有标的）
   * @param strategyId 策略ID
   * @param symbols 全量标的池
   * @param allocatedAmount 策略分配的总资金
   * @returns 有效标的、排除标的、每标的最大额度
   */
  async getEffectiveSymbolPool(
    _strategyId: number,
    symbols: string[],
    allocatedAmount: number
  ): Promise<{ effectiveSymbols: string[]; excludedSymbols: string[]; maxPerSymbol: number }> {
    if (symbols.length === 0 || allocatedAmount <= 0) {
      return { effectiveSymbols: [], excludedSymbols: symbols, maxPerSymbol: 0 };
    }

    // 所有标的均分预算，实际资金保护由 requestAllocation() 事务级关卡负责
    return {
      effectiveSymbols: [...symbols],
      excludedSymbols: [],
      maxPerSymbol: allocatedAmount / symbols.length,
    };
  }

  /**
   * 重置策略已用资金为0（当所有持仓已平仓时调用）
   * 使用数据库事务 + SELECT FOR UPDATE 防止并发重置导致数据不一致
   * @param strategyId 策略ID
   */
  async resetUsedAmount(strategyId: number): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      logger.debug(`[资金事务] resetUsedAmount BEGIN: 策略${strategyId}`);

      const strategyResult = await client.query(
        `SELECT ca.id as allocation_id, ca.current_usage, ca.name as allocation_name
         FROM strategies s
         LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
         WHERE s.id = $1`,
        [strategyId]
      );

      if (strategyResult.rows.length === 0 || !strategyResult.rows[0].allocation_id) {
        await client.query('ROLLBACK');
        logger.debug(`[资金事务] resetUsedAmount ROLLBACK: 策略${strategyId}无资金分配账户，无需重置`);
        return;
      }

      const allocationId = strategyResult.rows[0].allocation_id;
      const allocationName = strategyResult.rows[0].allocation_name;

      // 锁定资金分配行，获取最新 current_usage
      const lockResult = await client.query(
        `SELECT id, current_usage
         FROM capital_allocations
         WHERE id = $1
         FOR UPDATE`,
        [allocationId]
      );

      const currentUsage = parseFloat(lockResult.rows[0]?.current_usage?.toString() || '0');

      if (currentUsage > 0) {
        await client.query(
          `UPDATE capital_allocations SET current_usage = 0, updated_at = NOW() WHERE id = $1`,
          [allocationId]
        );
        logger.info(
          `[资金同步] 策略${strategyId} (${allocationName}) 所有持仓已平仓，重置已用资金为0（原值=${currentUsage.toFixed(2)}）`
        );
      }

      await client.query('COMMIT');
      logger.debug(`[资金事务] resetUsedAmount COMMIT: 策略${strategyId}`);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[资金同步] 策略${strategyId} 重置已用资金失败: ${errMsg}`);
    } finally {
      client.release();
    }
  }
}

// 导出单例
export default new CapitalManager();

