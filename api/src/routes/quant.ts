/**
 * 量化交易 API 路由
 * Phase 1: 核心引擎与选股/资金框架
 */

import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import capitalManager, { CapitalAllocation, AllocationRequest } from '../services/capital-manager.service';
import stockSelector from '../services/stock-selector.service';
import accountBalanceSyncService from '../services/account-balance-sync.service';
import strategyScheduler from '../services/strategy-scheduler.service';
import stateManager from '../services/state-manager.service';
import { ErrorFactory, normalizeError } from '../utils/errors';
import {
  getPopularInstitutions,
  getInstitutionList,
  getInstitutionHoldings,
  selectStocksByInstitution,
  InstitutionHolding,
} from '../services/institution-stock-selector.service';
import { getTradeContext } from '../config/longport';
import { logger } from '../utils/logger';
import optionRecommendationService from '../services/option-recommendation.service';
import { selectOptionContract } from '../services/options-contract-selector.service';
import { estimateOptionOrderTotalCost } from '../services/options-fee.service';
import { optionDynamicExitService, PositionContext, ExitRulesOverride } from '../services/option-dynamic-exit.service';
import basicExecutionService from '../services/basic-execution.service';
import { ENTRY_THRESHOLDS, OptionIntradayStrategyConfig } from '../services/strategies/option-intraday-strategy';
import { TradingIntent } from '../services/strategies/strategy-base';

export const quantRouter = Router();

// ==================== 资金管理 API ====================

/**
 * @openapi
 * /quant/capital/allocations:
 *   get:
 *     tags:
 *       - 量化交易-资金管理
 *     summary: 获取资金分配账户
 *     description: 获取所有资金分配账户及其使用情况
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 查询成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       allocationValue:
 *                         type: number
 *                         description: 分配值 (金额或百分比)
 *                       currentUsage:
 *                         type: number
 *                         description: 当前已用金额
 */
quantRouter.get('/capital/allocations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      'SELECT * FROM capital_allocations ORDER BY created_at DESC'
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        allocationType: row.allocation_type,
        allocationValue: parseFloat(row.allocation_value),
        currentUsage: parseFloat(row.current_usage || '0'),
        isSystem: row.is_system || false,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error: any) {
    // 使用统一的错误处理
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quant/capital/allocations:
 *   post:
 *     tags:
 *       - 量化交易-资金管理
 *     summary: 创建资金分配账户
 *     description: 创建一个新的资金分配账户
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - allocationType
 *               - allocationValue
 *             properties:
 *               name:
 *                 type: string
 *                 description: 账户名称
 *               parentId:
 *                 type: integer
 *                 description: 父账户ID (可选)
 *               allocationType:
 *                 type: string
 *                 enum: [FIXED_AMOUNT, PERCENTAGE]
 *                 description: 分配类型
 *               allocationValue:
 *                 type: number
 *                 description: 分配值
 *     responses:
 *       200:
 *         description: 创建成功
 */
quantRouter.post('/capital/allocations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, parentId, allocationType, allocationValue } = req.body;

    if (!name || !allocationType || allocationValue === undefined) {
      return next(ErrorFactory.missingParameter('name, allocationType, 或 allocationValue'));
    }

    const allocation = await capitalManager.createAllocation({
      name,
      parentId,
      allocationType,
      allocationValue: parseFloat(allocationValue),
    });

    res.json({
      success: true,
      data: { allocation },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quant/capital/allocations/{id}:
 *   put:
 *     tags:
 *       - 量化交易-资金管理
 *     summary: 更新资金分配账户
 *     description: 更新指定资金分配账户的信息
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 账户ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               allocationType:
 *                 type: string
 *                 enum: [FIXED_AMOUNT, PERCENTAGE]
 *               allocationValue:
 *                 type: number
 *     responses:
 *       200:
 *         description: 更新成功
 */
quantRouter.put('/capital/allocations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, allocationType, allocationValue } = req.body;

    // 检查是否存在
    const checkResult = await pool.query(
      'SELECT id, name, is_system FROM capital_allocations WHERE id = $1',
      [id]
    );
    if (checkResult.rows.length === 0) {
      return next(ErrorFactory.notFound('资金分配账户'));
    }

    // 检查是否是系统账户，系统账户不允许修改名称
    const isSystem = checkResult.rows[0].is_system || false;
    if (isSystem && name !== undefined && name !== checkResult.rows[0].name) {
      return next(ErrorFactory.resourceConflict('系统账户不允许修改名称'));
    }

    // 检查是否有运行中的策略在使用此账户（已停止的策略不阻止编辑）
    const strategiesResult = await pool.query(
      "SELECT COUNT(*) as count FROM strategies WHERE capital_allocation_id = $1 AND status = 'RUNNING'",
      [id]
    );
    const strategyCount = parseInt(strategiesResult.rows[0].count || '0');
    if (strategyCount > 0) {
      return next(ErrorFactory.resourceConflict(
        `该资金分配账户正在被 ${strategyCount} 个运行中的策略使用，无法修改`,
        { strategyCount }
      ));
    }

    // 如果修改名称，检查名称是否已存在
    if (name !== undefined && name !== checkResult.rows[0].name) {
      const nameCheckResult = await pool.query(
        'SELECT id FROM capital_allocations WHERE name = $1 AND id != $2',
        [name, id]
      );
      if (nameCheckResult.rows.length > 0) {
        return next(ErrorFactory.resourceConflict(
          `资金分配账户名称 "${name}" 已存在`,
          { name }
        ));
      }
    }

    // 如果修改百分比，验证百分比总和
    const finalAllocationType = allocationType !== undefined ? allocationType : checkResult.rows[0].allocation_type;
    const finalAllocationValue = allocationValue !== undefined ? parseFloat(allocationValue) : parseFloat(checkResult.rows[0].allocation_value);
    
    if (finalAllocationType === 'PERCENTAGE') {
      const parentIdToCheck = checkResult.rows[0].parent_id;
      const siblingsResult = await pool.query(
        `SELECT SUM(allocation_value) as total FROM capital_allocations 
         WHERE parent_id ${parentIdToCheck ? '= $1' : 'IS NULL'} 
         AND allocation_type = 'PERCENTAGE' 
         AND id != $2`,
        parentIdToCheck ? [parentIdToCheck, id] : [id]
      );
      const existingTotal = parseFloat(siblingsResult.rows[0]?.total || '0');
      if (existingTotal + finalAllocationValue > 1.0) {
        return next(ErrorFactory.validationError(
          `百分比总和超过 100%: ${(existingTotal * 100).toFixed(1)}% + ${(finalAllocationValue * 100).toFixed(1)}%`
        ));
      }
    }

    // 更新
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      updateValues.push(name);
    }
    if (allocationType !== undefined) {
      updateFields.push(`allocation_type = $${paramIndex++}`);
      updateValues.push(allocationType);
    }
    if (allocationValue !== undefined) {
      updateFields.push(`allocation_value = $${paramIndex++}`);
      updateValues.push(parseFloat(allocationValue));
    }

    if (updateFields.length === 0) {
      return next(ErrorFactory.missingParameter('要更新的字段'));
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);

    const result = await pool.query(
      `UPDATE capital_allocations SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
      updateValues
    );

    const updatedResult = await pool.query(
      'SELECT * FROM capital_allocations WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      data: {
        allocation: {
          id: updatedResult.rows[0].id,
          name: updatedResult.rows[0].name,
          parentId: updatedResult.rows[0].parent_id,
          allocationType: updatedResult.rows[0].allocation_type,
          allocationValue: parseFloat(updatedResult.rows[0].allocation_value),
          currentUsage: parseFloat(updatedResult.rows[0].current_usage || '0'),
          isSystem: updatedResult.rows[0].is_system || false,
          createdAt: updatedResult.rows[0].created_at,
          updatedAt: updatedResult.rows[0].updated_at,
        },
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quant/capital/allocations/{id}:
 *   delete:
 *     tags:
 *       - 量化交易-资金管理
 *     summary: 删除资金分配账户
 *     description: 删除指定的资金分配账户 (需无子账户且未被策略使用)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 账户ID
 *     responses:
 *       200:
 *         description: 删除成功
 */
quantRouter.delete('/capital/allocations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // 检查是否存在
    const checkResult = await pool.query(
      'SELECT id, name, is_system FROM capital_allocations WHERE id = $1',
      [id]
    );
    if (checkResult.rows.length === 0) {
      return next(ErrorFactory.notFound('资金分配账户'));
    }

    // 检查是否是系统账户，系统账户不允许删除
    const isSystem = checkResult.rows[0].is_system || false;
    if (isSystem) {
      return next(ErrorFactory.resourceConflict('系统账户无法删除'));
    }

    // 检查是否有运行中的策略在使用此账户（已停止的策略不阻止删除）
    const strategiesResult = await pool.query(
      "SELECT COUNT(*) as count FROM strategies WHERE capital_allocation_id = $1 AND status = 'RUNNING'",
      [id]
    );
    const strategyCount = parseInt(strategiesResult.rows[0].count || '0');
    if (strategyCount > 0) {
      return next(ErrorFactory.resourceConflict(
        `该资金分配账户正在被 ${strategyCount} 个运行中的策略使用，无法删除`,
        { strategyCount }
      ));
    }

    // 检查是否有子账户
    const childrenResult = await pool.query(
      'SELECT COUNT(*) as count FROM capital_allocations WHERE parent_id = $1',
      [id]
    );
    const childrenCount = parseInt(childrenResult.rows[0].count || '0');
    if (childrenCount > 0) {
      return next(ErrorFactory.resourceConflict(
        `该资金分配账户有 ${childrenCount} 个子账户，无法删除`,
        { childrenCount }
      ));
    }

    // 删除
    await pool.query('DELETE FROM capital_allocations WHERE id = $1', [id]);

    res.json({
      success: true,
      data: { message: '资金分配账户已删除' },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/capital/allocations/:id/usage-detail
 * 获取资金分配账户的使用记录详情（调试用）
 */
quantRouter.get('/capital/allocations/:id/usage-detail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    // 查询账户信息
    const accountResult = await pool.query(
      'SELECT * FROM capital_allocations WHERE id = $1',
      [id]
    );
    
    if (accountResult.rows.length === 0) {
      return next(ErrorFactory.notFound('资金分配账户'));
    }
    
    const account = accountResult.rows[0];
    
    // 查询关联的策略
    const strategiesResult = await pool.query(
      `SELECT s.id, s.name, s.status 
       FROM strategies s 
       WHERE s.capital_allocation_id = $1`,
      [id]
    );
    
    // 查询策略实例（持仓）
    const instancesResult = await pool.query(
      `SELECT si.strategy_id, si.symbol, si.current_state, si.context,
              s.name as strategy_name
       FROM strategy_instances si
       JOIN strategies s ON s.id = si.strategy_id
       WHERE s.capital_allocation_id = $1
         AND si.current_state IN ('HOLDING', 'OPENING', 'CLOSING')`,
      [id]
    );
    
    // 查询未成交订单
    const pendingOrdersResult = await pool.query(
      `SELECT eo.order_id, eo.symbol, eo.side, eo.quantity, eo.price, eo.current_status,
              s.name as strategy_name
       FROM execution_orders eo
       JOIN strategies s ON s.id = eo.strategy_id
       WHERE s.capital_allocation_id = $1
         AND eo.current_status NOT IN ('FILLED', 'CANCELLED', 'REJECTED')
         AND eo.created_at >= NOW() - INTERVAL '7 days'`,
      [id]
    );
    
    res.json({
      success: true,
      data: {
        account: {
          id: account.id,
          name: account.name,
          allocationType: account.allocation_type,
          allocationValue: parseFloat(account.allocation_value),
          currentUsage: parseFloat(account.current_usage || '0'),
          isSystem: account.is_system || false,
        },
        strategies: strategiesResult.rows.map((row: any) => ({
          id: row.id,
          name: row.name,
          status: row.status,
        })),
        instances: instancesResult.rows.map((row: any) => ({
          strategyId: row.strategy_id,
          strategyName: row.strategy_name,
          symbol: row.symbol,
          state: row.current_state,
          context: row.context,
        })),
        pendingOrders: pendingOrdersResult.rows.map((row: any) => ({
          orderId: row.order_id,
          strategyName: row.strategy_name,
          symbol: row.symbol,
          side: row.side,
          quantity: row.quantity,
          price: parseFloat(row.price),
          status: row.current_status,
        })),
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quant/capital/usage:
 *   get:
 *     tags:
 *       - 量化交易-资金管理
 *     summary: 获取资金使用概览
 *     description: 获取总资金及各个分配账户的详细使用情况
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 查询成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalCapital:
 *                       type: number
 *                       description: 总资金
 *                     allocations:
 *                       type: array
 *                       items:
 *                         type: object
 */
quantRouter.get('/capital/usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let totalCapital: number;
    try {
      totalCapital = await capitalManager.getTotalCapital();
    } catch (error: any) {
      // 如果是API限流错误，返回0并记录警告
      if (error.message && error.message.includes('429002')) {
        logger.warn('API请求限流，返回0作为总资金');
        totalCapital = 0;
      } else {
        throw error;
      }
    }

    const allocationsResult = await pool.query(`
      SELECT
        ca.*,
        COUNT(DISTINCT s.id) as strategy_count,
        COUNT(DISTINCT child.id) as children_count
      FROM capital_allocations ca
      LEFT JOIN strategies s ON s.capital_allocation_id = ca.id AND s.status = 'RUNNING'
      LEFT JOIN capital_allocations child ON child.parent_id = ca.id
      GROUP BY ca.id
      ORDER BY ca.created_at DESC
    `);

    res.json({
      success: true,
      data: {
        totalCapital,
        allocations: allocationsResult.rows.map((row) => ({
          id: row.id,
          name: row.name,
          allocationType: row.allocation_type,
          allocationValue: parseFloat(row.allocation_value),
          currentUsage: parseFloat(row.current_usage || '0'),
          strategyCount: parseInt(row.strategy_count || '0'),
          childrenCount: parseInt(row.children_count || '0'),
          isSystem: row.is_system || false,
        })),
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/quant/capital/sync-balance
 * 手动触发余额同步
 */
quantRouter.post('/capital/sync-balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await accountBalanceSyncService.syncAccountBalance();
    res.json({
      success: result.success,
      data: result,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/capital/alerts
 * 获取资金差异告警列表
 */
quantRouter.get('/capital/alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const syncResult = await accountBalanceSyncService.syncAccountBalance();
    
    if (!syncResult.success || !syncResult.discrepancies || syncResult.discrepancies.length === 0) {
      return res.json({
        success: true,
        data: {
          alerts: [],
          totalAlerts: 0,
          errorAlerts: 0,
          warningAlerts: 0,
          lastSyncTime: syncResult.lastSyncTime || new Date(),
        },
      });
    }
    
    // 过滤出需要告警的差异（WARNING和ERROR级别）
    const alerts = syncResult.discrepancies
      .filter((d) => d.severity === 'ERROR' || d.severity === 'WARNING')
      .map((d) => {
        const strategy = syncResult.strategies?.find((s) => s.id === d.strategyId);
        return {
          strategyId: d.strategyId,
          strategyName: strategy?.name || `策略 ${d.strategyId}`,
          recordedUsage: d.expected,
          actualUsage: d.actual,
          difference: d.difference,
          differencePercent: d.differencePercent || 0,
          severity: d.severity || 'WARNING',
          expectedAllocation: strategy?.expectedAllocation || 0,
        };
      });
    
    const errorAlerts = alerts.filter((a) => a.severity === 'ERROR').length;
    const warningAlerts = alerts.filter((a) => a.severity === 'WARNING').length;
    
    res.json({
      success: true,
      data: {
        alerts,
        totalAlerts: alerts.length,
        errorAlerts,
        warningAlerts,
        lastSyncTime: syncResult.lastSyncTime || new Date(),
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/capital/balance-discrepancies
 * 查询余额差异
 */
quantRouter.get('/capital/balance-discrepancies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = await capitalManager.validateUsage();
    res.json({
      success: true,
      data: validationResult,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

// ==================== 选股器 API ====================

/**
 * GET /api/quant/stock-selector/blacklist
 * 获取黑名单列表
 */
quantRouter.get('/stock-selector/blacklist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const blacklist = await stockSelector.getBlacklist();
    res.json({
      success: true,
      data: blacklist,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    next(appError);
  }
});

/**
 * POST /api/quant/stock-selector/blacklist
 * 添加股票到黑名单
 */
quantRouter.post('/stock-selector/blacklist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol, reason } = req.body;

    if (!symbol || !reason) {
      return next(ErrorFactory.missingParameter('symbol 或 reason'));
    }

    await stockSelector.addToBlacklist(symbol, reason, 'api');
    res.json({
      success: true,
      message: '已添加到黑名单',
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * DELETE /api/quant/stock-selector/blacklist/:symbol
 * 从黑名单移除股票
 */
quantRouter.delete('/stock-selector/blacklist/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params;
    await stockSelector.removeFromBlacklist(symbol);
    res.json({
      success: true,
      message: '已从黑名单移除',
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

// ==================== 策略管理 API ====================

/**
 * @openapi
 * /quant/strategies:
 *   get:
 *     tags:
 *       - 量化交易-策略管理
 *     summary: 获取所有策略
 *     description: 查询系统中的所有量化策略
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 查询成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [STOPPED, RUNNING, ERROR]
 */
quantRouter.get('/strategies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(`
      SELECT s.*, ca.name as allocation_name
      FROM strategies s
      LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
      ORDER BY s.created_at DESC
    `);

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        capitalAllocationId: row.capital_allocation_id,
        allocationName: row.allocation_name,
        symbolPoolConfig: row.symbol_pool_config,
        config: row.config,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quant/strategies:
 *   post:
 *     tags:
 *       - 量化交易-策略管理
 *     summary: 创建策略
 *     description: 创建一个新的量化策略
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - symbolPoolConfig
 *               - config
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *               capitalAllocationId:
 *                 type: integer
 *               symbolPoolConfig:
 *                 type: object
 *                 properties:
 *                   symbols:
 *                     type: array
 *                     items:
 *                       type: string
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: 创建成功
 */
quantRouter.post('/strategies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, type, capitalAllocationId, symbolPoolConfig, config } = req.body;

    if (!name || !type || !symbolPoolConfig || !config) {
      return next(ErrorFactory.missingParameter('name, type, symbolPoolConfig, 或 config'));
    }

    // 验证股票池配置
    if (!symbolPoolConfig.symbols || !Array.isArray(symbolPoolConfig.symbols)) {
      return next(ErrorFactory.validationError('股票池配置格式错误：symbols必须是数组'));
    }

    if (symbolPoolConfig.symbols.length === 0) {
      return next(ErrorFactory.validationError('股票池不能为空，请至少添加一个股票'));
    }

    // 验证股票代码格式（支持 ticker.region 和 .ticker.region 格式）
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    const invalidSymbols: string[] = [];
    const correctedSymbols: string[] = [];

    for (const symbol of symbolPoolConfig.symbols) {
      const trimmed = String(symbol).trim().toUpperCase();
      
      // 自动修正常见错误：APPL -> AAPL
      let corrected = trimmed;
      if (corrected === 'APPL.US') {
        corrected = 'AAPL.US';
        logger.info(`[策略验证] 自动修正股票代码: ${trimmed} -> ${corrected}`);
      }
      
      if (!symbolPattern.test(corrected)) {
        invalidSymbols.push(trimmed);
      } else {
        correctedSymbols.push(corrected);
      }
    }

    if (invalidSymbols.length > 0) {
      return next(ErrorFactory.validationError(
        `无效的标的代码格式: ${invalidSymbols.join(', ')}。请使用 ticker.region 格式，例如：AAPL.US 或 700.HK`,
        { invalidSymbols }
      ));
    }

    // 去重
    const uniqueSymbols = [...new Set(correctedSymbols)];
    if (uniqueSymbols.length !== correctedSymbols.length) {
      logger.warn(`[策略验证] 检测到重复的股票代码，已自动去重`);
    }

    // 使用修正后的股票代码
    const validatedSymbolPoolConfig = {
      ...symbolPoolConfig,
      symbols: uniqueSymbols,
    };

    const result = await pool.query(
      `INSERT INTO strategies (name, type, capital_allocation_id, symbol_pool_config, config, status)
       VALUES ($1, $2, $3, $4, $5, 'STOPPED')
       RETURNING *`,
      [name, type, capitalAllocationId || null, JSON.stringify(validatedSymbolPoolConfig), JSON.stringify(config)]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/strategies/:id
 * 获取策略详情
 */
quantRouter.get('/strategies/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT s.*, ca.name as allocation_name
       FROM strategies s
       LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
       WHERE s.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return next(ErrorFactory.notFound('策略'));
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        name: row.name,
        type: row.type,
        capitalAllocationId: row.capital_allocation_id,
        allocationName: row.allocation_name,
        symbolPoolConfig: row.symbol_pool_config,
        config: row.config,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * PUT /api/quant/strategies/:id
 * 更新策略
 */
quantRouter.put('/strategies/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, type, capitalAllocationId, symbolPoolConfig, config } = req.body;

    // 检查是否存在
    const checkResult = await pool.query('SELECT id, status FROM strategies WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return next(ErrorFactory.notFound('策略'));
    }

    // 如果策略正在运行，不允许修改
    if (checkResult.rows[0].status === 'RUNNING') {
      return next(ErrorFactory.resourceConflict('策略正在运行中，请先停止策略再修改'));
    }

    // 更新
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      updateValues.push(name);
    }
    if (type !== undefined) {
      updateFields.push(`type = $${paramIndex++}`);
      updateValues.push(type);
    }
    if (capitalAllocationId !== undefined) {
      updateFields.push(`capital_allocation_id = $${paramIndex++}`);
      updateValues.push(capitalAllocationId || null);
    }
    if (symbolPoolConfig !== undefined) {
      // 验证股票池配置
      if (!symbolPoolConfig.symbols || !Array.isArray(symbolPoolConfig.symbols)) {
        return next(ErrorFactory.validationError('股票池配置格式错误：symbols必须是数组'));
      }

      if (symbolPoolConfig.symbols.length === 0) {
        return next(ErrorFactory.validationError('股票池不能为空，请至少添加一个股票'));
      }

      // 验证股票代码格式
      const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
      const invalidSymbols: string[] = [];
      const correctedSymbols: string[] = [];

      for (const symbol of symbolPoolConfig.symbols) {
        const trimmed = String(symbol).trim().toUpperCase();
        
        // 自动修正常见错误：APPL -> AAPL
        let corrected = trimmed;
        if (corrected === 'APPL.US') {
          corrected = 'AAPL.US';
          logger.info(`[策略验证] 自动修正股票代码: ${trimmed} -> ${corrected}`);
        }
        
        if (!symbolPattern.test(corrected)) {
          invalidSymbols.push(trimmed);
        } else {
          correctedSymbols.push(corrected);
        }
      }

      if (invalidSymbols.length > 0) {
        return next(ErrorFactory.validationError(
          `无效的标的代码格式: ${invalidSymbols.join(', ')}。请使用 ticker.region 格式，例如：AAPL.US 或 700.HK`,
          { invalidSymbols }
        ));
      }

      // 去重
      const uniqueSymbols = [...new Set(correctedSymbols)];
      if (uniqueSymbols.length !== correctedSymbols.length) {
        logger.warn(`[策略验证] 检测到重复的股票代码，已自动去重`);
      }

      // 使用修正后的股票代码
      const validatedSymbolPoolConfig = {
        ...symbolPoolConfig,
        symbols: uniqueSymbols,
      };

      updateFields.push(`symbol_pool_config = $${paramIndex++}`);
      updateValues.push(JSON.stringify(validatedSymbolPoolConfig));
    }
    if (config !== undefined) {
      updateFields.push(`config = $${paramIndex++}`);
      updateValues.push(JSON.stringify(config));
    }

    if (updateFields.length === 0) {
      return next(ErrorFactory.missingParameter('要更新的字段'));
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id);

    await pool.query(
      `UPDATE strategies SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
      updateValues
    );

    const updatedResult = await pool.query(
      `SELECT s.*, ca.name as allocation_name
       FROM strategies s
       LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
       WHERE s.id = $1`,
      [id]
    );

    const row = updatedResult.rows[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        name: row.name,
        type: row.type,
        capitalAllocationId: row.capital_allocation_id,
        allocationName: row.allocation_name,
        symbolPoolConfig: row.symbol_pool_config,
        config: row.config,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error: any) {
    logger.error('更新策略失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * DELETE /api/quant/strategies/:id
 * 删除策略
 */
quantRouter.delete('/strategies/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // 检查是否存在
    const checkResult = await pool.query('SELECT id, status FROM strategies WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return next(ErrorFactory.notFound('策略'));
    }

    // 如果策略正在运行，先停止
    if (checkResult.rows[0].status === 'RUNNING') {
      try {
        await strategyScheduler.stopStrategy(parseInt(id));
      } catch (stopError: any) {
        logger.warn('停止策略失败，继续删除:', stopError);
      }
    }

    // 删除策略实例
    await pool.query('DELETE FROM strategy_instances WHERE strategy_id = $1', [id]);

    // 删除策略
    await pool.query('DELETE FROM strategies WHERE id = $1', [id]);

    res.json({
      success: true,
      data: { message: '策略已删除' },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quant/strategies/{id}/start:
 *   post:
 *     tags:
 *       - 量化交易-策略管理
 *     summary: 启动策略
 *     description: 启动指定的量化策略
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 启动成功
 */
quantRouter.post('/strategies/:id/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // 更新状态为 RUNNING
    await pool.query('UPDATE strategies SET status = $1 WHERE id = $2', ['RUNNING', id]);

    // 启动策略调度
    await strategyScheduler.startStrategy(parseInt(id));

    res.json({
      success: true,
      message: '策略已启动',
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quant/strategies/{id}/stop:
 *   post:
 *     tags:
 *       - 量化交易-策略管理
 *     summary: 停止策略
 *     description: 停止运行中的量化策略
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 停止成功
 */
quantRouter.post('/strategies/:id/stop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // 停止策略调度
    await strategyScheduler.stopStrategy(parseInt(id));

    res.json({
      success: true,
      message: '策略已停止',
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/strategies/:id/instances
 * 获取策略实例状态
 */
quantRouter.get('/strategies/:id/instances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const instances = await stateManager.getStrategyInstances(parseInt(id));

    res.json({
      success: true,
      data: instances,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/strategies/:id/holdings
 * 获取策略已有持仓（用于修订策略时的资金计算）
 */
quantRouter.get('/strategies/:id/holdings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const strategyId = parseInt(id);

    if (isNaN(strategyId)) {
      return next(ErrorFactory.validationError('策略ID无效'));
    }

    // 查询策略的已有持仓（状态为HOLDING的实例）
    const instancesResult = await pool.query(
      `SELECT symbol, current_state, context, last_updated
       FROM strategy_instances
       WHERE strategy_id = $1 AND current_state = 'HOLDING'`,
      [strategyId]
    );

    if (instancesResult.rows.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // 获取当前价格并计算持仓价值
    const { getQuoteContext } = await import('../config/longport');
    const quoteCtx = await getQuoteContext();
    const symbols = instancesResult.rows.map((row) => row.symbol);

    let quotes: any[] = [];
    try {
      quotes = await quoteCtx.quote(symbols);
    } catch (error: any) {
      logger.warn(`[策略持仓] 获取股票价格失败:`, error.message);
    }

    const holdings = await Promise.all(
      instancesResult.rows.map(async (row) => {
        const context = row.context || {};
        const quantity = context.quantity || 0;
        const entryPrice = context.entryPrice || 0;

        // 查找当前价格（Longbridge SDK返回的是驼峰命名：lastDone）
        const quote = quotes.find((q) => (q.symbol || q.stock_name) === row.symbol);
        const currentPrice = quote?.lastDone 
          ? parseFloat(quote.lastDone.toString()) 
          : quote?.last_done
          ? parseFloat(quote.last_done.toString())
          : entryPrice || 0;

        return {
          symbol: row.symbol,
          quantity,
          entryPrice,
          currentPrice,
          holdingValue: quantity * currentPrice,
          state: row.current_state,
          context,
          lastUpdated: row.last_updated,
        };
      })
    );

    res.json({
      success: true,
      data: holdings,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/strategies/:id/monitoring-status
 * 获取策略监控状态（诊断用）
 * 显示所有标的的状态、持仓信息、止盈止损设置等
 */
quantRouter.get('/strategies/:id/monitoring-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const strategyId = parseInt(id);

    if (isNaN(strategyId)) {
      return next(ErrorFactory.validationError('策略ID无效'));
    }

    // 1. 获取策略配置
    const strategyResult = await pool.query(
      'SELECT id, name, type, config, symbol_pool_config, status FROM strategies WHERE id = $1',
      [strategyId]
    );

    if (strategyResult.rows.length === 0) {
      return next(ErrorFactory.notFound('策略'));
    }

    const strategy = strategyResult.rows[0];

    // 2. 获取所有策略实例状态
    const instances = await stateManager.getStrategyInstances(strategyId);

    // 3. 获取实际持仓（从Longbridge SDK）
    let actualPositions: any[] = [];
    try {
      const { getTradeContext } = await import('../config/longport');
      const tradeCtx = await getTradeContext();
      const positions = await tradeCtx.stockPositions();
      
      if (positions && typeof positions === 'object') {
        if (positions.channels && Array.isArray(positions.channels)) {
          for (const channel of positions.channels) {
            if (channel.positions && Array.isArray(channel.positions)) {
              actualPositions.push(...channel.positions);
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn('获取实际持仓失败:', error.message);
    }

    // 4. 获取今日订单（用于检查未成交订单）
    let todayOrders: any[] = [];
    try {
      const { getTradeContext } = await import('../config/longport');
      const tradeCtx = await getTradeContext();
      todayOrders = await tradeCtx.todayOrders({});
      todayOrders = Array.isArray(todayOrders) ? todayOrders : [];
    } catch (error: any) {
      logger.warn('获取今日订单失败:', error.message);
    }

    // 5. 获取当前价格（用于计算盈亏）
    const symbols = instances.map(i => i.symbol);
    let currentPrices: Map<string, number> = new Map();
    if (symbols.length > 0) {
      try {
        const { getQuoteContext } = await import('../config/longport');
        const quoteCtx = await getQuoteContext();
        const quotes = await quoteCtx.quote(symbols);
        
        if (quotes && Array.isArray(quotes)) {
          for (const quote of quotes) {
            const symbol = quote.symbol || quote.stock_name;
            // Longbridge SDK返回的是驼峰命名：lastDone
            const price = parseFloat(quote.lastDone?.toString() || quote.last_done?.toString() || '0');
            if (symbol && price > 0) {
              currentPrices.set(symbol, price);
            }
          }
        }
      } catch (error: any) {
        logger.warn('获取当前价格失败:', error.message);
        // 如果批量获取失败，尝试逐个获取
        for (const symbol of symbols) {
          try {
            const { getQuoteContext } = await import('../config/longport');
            const quoteCtx = await getQuoteContext();
            const quotes = await quoteCtx.quote([symbol]);
            if (quotes && quotes.length > 0) {
              // Longbridge SDK返回的是驼峰命名：lastDone
              const price = parseFloat(quotes[0].lastDone?.toString() || quotes[0].last_done?.toString() || '0');
              if (price > 0) {
                currentPrices.set(symbol, price);
              }
            }
          } catch (err: any) {
            // 忽略单个标的的价格获取失败
          }
        }
      }
    }

    // 6. 构建监控状态数据
    const monitoringData = instances.map((instance) => {
      const symbol = instance.symbol;
      const context = instance.context || {};
      const entryPrice = context.entryPrice;
      const stopLoss = context.stopLoss;
      const takeProfit = context.takeProfit;
      const quantity = context.quantity;
      const currentPrice = currentPrices.get(symbol) || 0;

      // 计算盈亏
      let pnl = 0;
      let pnlPercent = 0;
      if (entryPrice && quantity && currentPrice > 0) {
        pnl = (currentPrice - entryPrice) * quantity;
        pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      }

      // 检查实际持仓
      const actualPosition = actualPositions.find(p => (p.symbol || p.stock_name) === symbol);
      const hasActualPosition = actualPosition && parseInt(actualPosition.quantity?.toString() || '0') > 0;

      // 检查未成交订单
      const pendingBuyOrders = todayOrders.filter((o: any) => {
        const orderSymbol = o.symbol || o.stock_name;
        const orderSide = o.side;
        const isBuy = orderSide === 'Buy' || orderSide === 1 || orderSide === 'BUY' || orderSide === 'buy';
        const status = o.status?.toString() || '';
        const pendingStatuses = ['NotReported', 'NewStatus', 'WaitToNew', 'PartialFilledStatus', 'PendingReplaceStatus', 'WaitToReplace'];
        return orderSymbol === symbol && isBuy && pendingStatuses.some(s => status.includes(s));
      });

      const pendingSellOrders = todayOrders.filter((o: any) => {
        const orderSymbol = o.symbol || o.stock_name;
        const orderSide = o.side;
        const isSell = orderSide === 'Sell' || orderSide === 2 || orderSide === 'SELL' || orderSide === 'sell';
        const status = o.status?.toString() || '';
        const pendingStatuses = ['NotReported', 'NewStatus', 'WaitToNew', 'PartialFilledStatus', 'PendingReplaceStatus', 'WaitToReplace'];
        return orderSymbol === symbol && isSell && pendingStatuses.some(s => status.includes(s));
      });

      // 检查是否触发止盈/止损
      let triggerStatus = 'NONE';
      if (currentPrice > 0 && stopLoss && currentPrice <= stopLoss) {
        triggerStatus = 'STOP_LOSS_TRIGGERED';
      } else if (currentPrice > 0 && takeProfit && currentPrice >= takeProfit) {
        triggerStatus = 'TAKE_PROFIT_TRIGGERED';
      }

      return {
        symbol,
        state: instance.state,
        entryPrice,
        stopLoss,
        takeProfit,
        quantity,
        currentPrice: currentPrice > 0 ? currentPrice : null,
        pnl: pnl !== 0 ? pnl : null,
        pnlPercent: pnlPercent !== 0 ? pnlPercent : null,
        hasActualPosition,
        actualPositionQuantity: actualPosition ? parseInt(actualPosition.quantity?.toString() || '0') : 0,
        pendingBuyOrders: pendingBuyOrders.length,
        pendingSellOrders: pendingSellOrders.length,
        triggerStatus,
        lastUpdated: instance.lastUpdated,
        context,
      };
    });

    res.json({
      success: true,
      data: {
        strategy: {
          id: strategy.id,
          name: strategy.name,
          type: strategy.type,
          status: strategy.status,
        },
        instances: monitoringData,
        summary: {
          total: monitoringData.length,
          idle: monitoringData.filter(i => i.state === 'IDLE').length,
          opening: monitoringData.filter(i => i.state === 'OPENING').length,
          holding: monitoringData.filter(i => i.state === 'HOLDING').length,
          closing: monitoringData.filter(i => i.state === 'CLOSING').length,
          cooldown: monitoringData.filter(i => i.state === 'COOLDOWN').length,
          withActualPosition: monitoringData.filter(i => i.hasActualPosition).length,
          pendingBuyOrders: monitoringData.reduce((sum, i) => sum + i.pendingBuyOrders, 0),
          pendingSellOrders: monitoringData.reduce((sum, i) => sum + i.pendingSellOrders, 0),
        },
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

// ==================== 信号日志 API ====================

/**
 * GET /api/quant/signals
 * 获取信号日志
 */
quantRouter.get('/signals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { strategyId, status, limit = 100 } = req.query;

    let query = 'SELECT * FROM strategy_signals WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (strategyId) {
      query += ` AND strategy_id = $${paramIndex++}`;
      params.push(strategyId);
    }

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++}`;
    params.push(parseInt(limit as string));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

// ==================== 交易记录 API ====================

// ==================== Dashboard 统计 API ====================

/**
 * GET /api/quant/dashboard/stats
 * 获取Dashboard统计数据（今日盈亏、今日交易数量等）
 */
quantRouter.get('/dashboard/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.debug('[Dashboard统计API] 开始计算统计数据');
    
    // 1. 获取今日已平仓交易盈亏（主要数据源）
    const closedTradesResult = await pool.query(`
      SELECT COALESCE(SUM(pnl), 0) as total_pnl
      FROM auto_trades
      WHERE DATE(close_time) = CURRENT_DATE
        AND status = 'FILLED'
        AND pnl IS NOT NULL
    `);
    const closedTradesPnl = parseFloat(closedTradesResult.rows[0]?.total_pnl || '0');
    logger.debug(`[Dashboard统计API] 今日已平仓交易盈亏: ${closedTradesPnl}`);

    // 2. 获取持仓盈亏（主要数据源）
    let holdingPnl = 0;
    try {
      logger.debug('[Dashboard统计API] 开始获取持仓盈亏');
      const tradeCtx = await getTradeContext();
      let positions: any;
      try {
        positions = await tradeCtx.stockPositions();
      } catch (rateLimitError: any) {
        // API限流时，记录警告但不阻塞主流程
        if (rateLimitError.message && rateLimitError.message.includes('429002')) {
          logger.warn('[Dashboard统计API] 持仓API限流，跳过持仓盈亏计算');
          positions = null;
        } else {
          throw rateLimitError;
        }
      }
      
      logger.debug(`[Dashboard统计API] 持仓数据类型: ${positions ? (Array.isArray(positions) ? `数组(${positions.length}个)` : typeof positions) : 'null'}`);
      
      // 处理持仓数据：可能是数组或对象（包含channels数组）
      let actualPositions: any[] = [];
      if (Array.isArray(positions)) {
        actualPositions = positions;
      } else if (positions && typeof positions === 'object') {
        // 处理对象格式：{ channels: [{ accountChannel: "...", positions: [...] }] }
        if (positions.channels && Array.isArray(positions.channels) && positions.channels.length > 0) {
          // 从第一个channel中提取positions
          const firstChannel = positions.channels[0];
          if (firstChannel.positions && Array.isArray(firstChannel.positions)) {
            actualPositions = firstChannel.positions;
            logger.debug(`[Dashboard统计API] 从channels[0].positions提取到 ${actualPositions.length} 个持仓`);
          }
        }
        if (actualPositions.length === 0) {
          logger.debug(`[Dashboard统计API] 持仓数据详情: ${JSON.stringify(positions, null, 2)}`);
        }
      }

      if (actualPositions.length > 0) {
        const symbols = actualPositions.map((pos: any) => pos.symbol).filter(Boolean);
        logger.debug(`[Dashboard统计API] 持仓标的列表: ${symbols.join(', ')}`);
        
        if (symbols.length > 0) {
          // 批量获取当前价格
          const { getQuoteContext } = await import('../config/longport');
          const quoteCtx = await getQuoteContext();
          const quotes = await quoteCtx.quote(symbols);
          logger.debug(`[Dashboard统计API] 获取到 ${quotes ? quotes.length : 0} 个行情数据`);

          // 创建symbol到quote的映射
          const quoteMap = new Map<string, any>();
          for (const quote of quotes) {
            const symbol = quote.symbol || (quote as any).stock_name;
            if (symbol) {
              quoteMap.set(symbol, quote);
            }
          }

          // 计算持仓盈亏
          for (const pos of actualPositions) {
            const symbol = pos.symbol;
            // 处理costPrice字段：可能是costPrice或cost_price
            const costPrice = parseFloat(pos.costPrice?.toString() || pos.cost_price?.toString() || '0');
            // 处理quantity字段：可能是quantity或availableQuantity
            const quantity = parseInt(pos.quantity?.toString() || pos.availableQuantity?.toString() || '0');

            // ⚠️ 修复：支持负数持仓（卖空持仓）
            if (costPrice > 0 && quantity !== 0 && symbol) {
              const quote = quoteMap.get(symbol);
              if (quote) {
                const currentPrice = parseFloat(
                  quote.lastPrice?.toString() || 
                  quote.lastDone?.toString() || 
                  quote.last_done?.toString() || 
                  '0'
                );

                if (currentPrice > 0) {
                  // ⚠️ 修复：盈亏计算（区分做多和卖空）
                  let positionPnl: number;
                  if (quantity > 0) {
                    // 做多：价格上涨盈利
                    positionPnl = (currentPrice - costPrice) * quantity;
                  } else {
                    // 卖空：价格下跌盈利
                    positionPnl = (costPrice - currentPrice) * Math.abs(quantity);
                  }
                  
                  holdingPnl += positionPnl;
                  const positionType = quantity > 0 ? '做多' : '卖空';
                  logger.debug(`[Dashboard统计API] 持仓 ${symbol}: 类型=${positionType}, 成本价=${costPrice}, 当前价=${currentPrice}, 数量=${quantity}, 盈亏=${positionPnl.toFixed(2)}`);
                } else {
                  logger.warn(`[Dashboard统计API] 持仓 ${symbol}: 无法获取当前价格`);
                }
              } else {
                logger.warn(`[Dashboard统计API] 持仓 ${symbol}: 未找到行情数据`);
              }
            }
          }
          logger.debug(`[Dashboard统计API] 持仓盈亏总计: ${holdingPnl}`);
        } else {
          logger.debug('[Dashboard统计API] 无持仓标的');
        }
      } else {
        logger.debug('[Dashboard统计API] 无持仓数据');
      }
    } catch (error: any) {
      logger.error('[Dashboard统计API] 获取持仓盈亏失败:', error);
      // 继续执行，不阻塞主流程
    }

    // 3. 计算今日交易数量（使用长桥API todayOrders，更准确）
    let todayTrades = 0;
    let todayBuyOrders = 0;
    let todaySellOrders = 0;
    
    try {
      logger.debug('[Dashboard统计API] 开始获取今日订单（从长桥API）');
      const tradeCtx = await getTradeContext();
      const todayOrders = await tradeCtx.todayOrders({});
      const ordersArray = Array.isArray(todayOrders) ? todayOrders : [];
      
      logger.debug(`[Dashboard统计API] 获取到 ${ordersArray.length} 个今日订单`);
      
      // 导入normalizeStatus和normalizeSide函数（从orders.ts）
      const ordersModule = await import('./orders');
      const normalizeStatus = ordersModule.normalizeStatus;
      const normalizeSide = ordersModule.normalizeSide;
      
      // 筛选已成交订单
      const filledOrders = ordersArray.filter((order: any) => {
        const status = normalizeStatus(order.status);
        // normalizeStatus返回完整形式：FilledStatus, PartialFilledStatus
        return status === 'FilledStatus' || status === 'PartialFilledStatus';
      });
      
      todayTrades = filledOrders.length;
      
      // 区分买入和卖出订单
      todayBuyOrders = filledOrders.filter((order: any) => {
        const side = normalizeSide(order.side);
        return side === 'Buy' || side === 'BUY';
      }).length;
      
      todaySellOrders = filledOrders.filter((order: any) => {
        const side = normalizeSide(order.side);
        return side === 'Sell' || side === 'SELL';
      }).length;
      
      logger.debug(`[Dashboard统计API] 今日交易数量统计: 总计=${todayTrades}, 买入=${todayBuyOrders}, 卖出=${todaySellOrders}`);
    } catch (error: any) {
      logger.error('[Dashboard统计API] 获取今日订单失败，使用数据库统计:', error);
      
      // 降级方案：使用数据库统计（如果API失败）
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setUTCHours(23, 59, 59, 999);
      
      const todayOrdersResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM execution_orders
        WHERE created_at >= $1 
          AND created_at <= $2
          AND current_status IN ('FILLED', 'PARTIALLY_FILLED')
      `, [todayStart, todayEnd]);
      todayTrades = parseInt(todayOrdersResult.rows[0]?.count || '0');
      
      logger.warn(`[Dashboard统计API] 使用数据库统计，今日交易数量: ${todayTrades}`);
    }

    // 4. 验证数据（辅助验证，不阻塞主流程）
    let verificationData = null;
    try {
      logger.debug('[Dashboard统计API] 开始获取账户资金验证数据');
      const tradeCtx = await getTradeContext();
      const accountBalance = await tradeCtx.accountBalance();
      logger.debug(`[Dashboard统计API] accountBalance原始数据: ${JSON.stringify(accountBalance, null, 2)}`);
      
      // accountBalance可能返回数组或单个对象
      let balanceData: any;
      if (Array.isArray(accountBalance)) {
        logger.debug(`[Dashboard统计API] accountBalance是数组，长度: ${accountBalance.length}`);
        // 如果是数组，取第一个USD账户
        balanceData = accountBalance.find((b: any) => b.currency === 'USD') || accountBalance[0] || {};
        logger.debug(`[Dashboard统计API] 选择的账户数据: ${JSON.stringify(balanceData, null, 2)}`);
      } else {
        logger.debug('[Dashboard统计API] accountBalance是对象');
        balanceData = accountBalance || {};
      }
      
      // 尝试多种字段名获取数据
      // totalAssets可能在不同字段：totalAssets, total_assets, netAssets, net_assets
      // 从日志看，accountBalance返回的是数组，且包含netAssets字段
      const totalAssets = parseFloat(
        balanceData.netAssets?.toString() ||
        balanceData.net_assets?.toString() ||
        balanceData.totalAssets?.toString() || 
        balanceData.total_assets?.toString() || 
        '0'
      );
      // availableCash从cashInfos数组中获取USD账户的可用资金
      let availableCash = 0;
      if (balanceData.cashInfos && Array.isArray(balanceData.cashInfos)) {
        const usdCashInfo = balanceData.cashInfos.find((info: any) => info.currency === 'USD');
        if (usdCashInfo) {
          availableCash = parseFloat(usdCashInfo.availableCash?.toString() || '0');
        } else if (balanceData.cashInfos.length > 0) {
          // 如果没有USD账户，使用第一个账户
          availableCash = parseFloat(balanceData.cashInfos[0].availableCash?.toString() || '0');
        }
      } else {
        // 如果没有cashInfos数组，尝试直接获取
        availableCash = parseFloat(
          balanceData.availableCash?.toString() || 
          balanceData.available_cash?.toString() || 
          '0'
        );
      }
      
      logger.debug(`[Dashboard统计API] 解析后的账户资金 - totalAssets: ${totalAssets} (来源: ${balanceData.netAssets ? 'netAssets' : balanceData.totalAssets ? 'totalAssets' : '未找到'}), availableCash: ${availableCash}`);
      
      logger.debug(`[Dashboard统计API] 解析后的账户资金 - totalAssets: ${totalAssets}, availableCash: ${availableCash}`);
      
      verificationData = {
        totalAssets,
        availableCash,
      };
    } catch (error: any) {
      logger.error('[Dashboard统计API] 获取账户资金验证数据失败:', error);
      // 不设置verificationData，保持为null
    }

    const todayPnl = closedTradesPnl + holdingPnl;
    
    logger.debug(`[Dashboard统计API] 最终计算结果 - 今日盈亏: ${todayPnl}, 已平仓盈亏: ${closedTradesPnl}, 持仓盈亏: ${holdingPnl}, 今日交易: ${todayTrades}`);

    res.json({
      success: true,
      data: {
        todayPnl, // 主要数据源计算结果
        todayTrades,
        todayBuyOrders,  // 新增：今日买入订单数量
        todaySellOrders, // 新增：今日卖出订单数量
        closedTradesPnl,
        holdingPnl,
        verificationData, // 验证数据（可选）
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

// ==================== 机构选股 API ====================

/**
 * GET /api/quant/institutions/popular
 * 获取热门机构列表
 */
quantRouter.get('/institutions/popular', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const institutions = await getPopularInstitutions();
    res.json({
      success: true,
      data: institutions,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/institutions/list
 * 获取机构列表（支持分页）
 */
quantRouter.get('/institutions/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 0;
    const pageSize = parseInt(req.query.pageSize as string) || 15;

    const result = await getInstitutionList(page, pageSize);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/quant/institutions/:institutionId/holdings
 * 获取机构持仓列表
 */
quantRouter.get('/institutions/:institutionId/holdings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { institutionId } = req.params;
    const periodId = parseInt(req.query.periodId as string) || 88;
    const page = parseInt(req.query.page as string) || 0;
    const pageSize = parseInt(req.query.pageSize as string) || 50;

    if (!institutionId) {
      return next(ErrorFactory.missingParameter('institutionId'));
    }

    const result = await getInstitutionHoldings(institutionId, periodId, page, pageSize);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/quant/institutions/select-stocks
 * 智能选股：根据机构持仓占比排序并筛选
 */
quantRouter.post('/institutions/select-stocks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { institutionId, minHoldingRatio, maxStocks } = req.body;

    if (!institutionId) {
      return next(ErrorFactory.missingParameter('institutionId'));
    }

    const minRatio = minHoldingRatio ? parseFloat(minHoldingRatio) : 1.0;
    const max = maxStocks ? parseInt(maxStocks) : undefined;

    const stocks = await selectStocksByInstitution(institutionId, minRatio, max);
    
    res.json({
      success: true,
      data: {
        stocks,
        totalSelected: stocks.length,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/quant/institutions/calculate-allocation
 * 计算资金分配方案
 */
quantRouter.post('/institutions/calculate-allocation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      strategyId,
      stocks,
      allocationMode = 'PROPORTIONAL',
      maxPositionPerSymbol,
      minInvestmentAmount = 100,
    } = req.body;

    if (!strategyId || !stocks || !Array.isArray(stocks) || stocks.length === 0) {
      return next(ErrorFactory.missingParameter('strategyId 或 stocks'));
    }

    // 获取策略可用资金
    const availableCapital = await capitalManager.getAvailableCapital(strategyId);
    if (availableCapital <= 0) {
      return res.json({
        success: false,
        error: '可用资金不足',
        data: {
          availableCapital: 0,
          allocations: [],
        },
      });
    }

    // 获取股票当前价格
    const tradeCtx = await getTradeContext();
    const allocations: Array<{
      symbol: string;
      holdingRatio: number;
      allocationRatio: number;
      allocationAmount: number;
      currentPrice: number;
      quantity: number;
    }> = [];

    let totalHoldingRatio = 0;
    const stockPrices: Record<string, number> = {};

    // 获取所有股票的价格
    for (const stock of stocks) {
      try {
        const symbol = stock.symbol || stock;
        const quote = await tradeCtx.quote([symbol]);
        if (quote && quote.length > 0) {
          stockPrices[symbol] = parseFloat(quote[0].lastPrice || '0');
        } else {
          stockPrices[symbol] = 0;
        }
      } catch (error) {
        logger.warn(`[资金分配] 获取股票价格失败: ${stock.symbol || stock}`);
        stockPrices[stock.symbol || stock] = 0;
      }
    }

    // 计算总持仓占比
    for (const stock of stocks) {
      const holdingRatio = parseFloat(stock.holdingRatio || stock.percentOfPortfolio || '0');
      totalHoldingRatio += holdingRatio;
    }

    if (totalHoldingRatio === 0) {
      return next(ErrorFactory.validationError('持仓占比总和为0，无法计算资金分配'));
    }

    // 按持仓占比分配资金
    for (const stock of stocks) {
      const symbol = stock.symbol || stock;
      const holdingRatio = parseFloat(stock.holdingRatio || stock.percentOfPortfolio || '0');
      const currentPrice = stockPrices[symbol] || stock.price || 0;

      if (currentPrice <= 0) {
        logger.warn(`[资金分配] 股票 ${symbol} 价格无效，跳过`);
        continue;
      }

      // 计算分配比例和金额
      const allocationRatio = (holdingRatio / totalHoldingRatio) * 100;
      let allocationAmount = (availableCapital * holdingRatio) / totalHoldingRatio;

      // 应用单只股票上限
      if (maxPositionPerSymbol && allocationAmount > maxPositionPerSymbol) {
        allocationAmount = maxPositionPerSymbol;
      }

      // 应用最小投资金额
      if (allocationAmount < minInvestmentAmount) {
        allocationAmount = minInvestmentAmount;
      }

      // 计算购买数量
      const quantity = Math.max(1, Math.floor(allocationAmount / currentPrice));

      allocations.push({
        symbol,
        holdingRatio,
        allocationRatio,
        allocationAmount: Math.round(allocationAmount * 100) / 100,
        currentPrice,
        quantity,
      });
    }

    // 计算总分配金额
    const totalAllocation = allocations.reduce((sum, item) => sum + item.allocationAmount, 0);
    const totalRatio = allocations.reduce((sum, item) => sum + item.allocationRatio, 0);

    res.json({
      success: true,
      data: {
        availableCapital,
        allocations,
        totalAllocation: Math.round(totalAllocation * 100) / 100,
        totalRatio: Math.round(totalRatio * 100) / 100,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

// ==================== 策略模拟运行 API ====================

/**
 * @openapi
 * /quant/strategies/{id}/simulate:
 *   post:
 *     tags:
 *       - 量化交易-策略模拟
 *     summary: 模拟策略开盘流程
 *     description: |
 *       模拟策略的完整开盘流程：获取实时市场数据 → 生成信号 → 选择期权合约 → 计算入场参数。
 *       调用真实服务链路，跳过交易时间窗口检查，可在非交易时间运行。
 *       可选执行真实下单（用户可手工撤单）。
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 策略ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               executeOrder:
 *                 type: boolean
 *                 description: 是否真实下单，默认 false
 *               symbols:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: 指定标的，默认使用策略 symbol_pool
 *               overrideExpirationMode:
 *                 type: string
 *                 enum: [NEAREST, 0DTE]
 *                 description: 到期模式，默认 NEAREST（非0DTE）
 *     responses:
 *       200:
 *         description: 模拟运行结果
 */
quantRouter.post('/strategies/:id/simulate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const strategyId = parseInt(req.params.id, 10);
    if (isNaN(strategyId)) {
      return next(ErrorFactory.missingParameter('策略ID'));
    }

    const {
      executeOrder = false,
      symbols: requestSymbols,
      overrideExpirationMode = 'NEAREST',
    } = req.body || {};

    // 1) 从 DB 加载策略配置
    const strategyResult = await pool.query(
      'SELECT id, name, type, config, symbol_pool_config, status FROM strategies WHERE id = $1',
      [strategyId]
    );

    if (strategyResult.rows.length === 0) {
      return next(ErrorFactory.notFound(`策略 ${strategyId}`));
    }

    const strategy = strategyResult.rows[0];
    const config: OptionIntradayStrategyConfig = strategy.config || {};
    const symbolPoolConfig = strategy.symbol_pool_config || {};
    const riskPreference = config.riskPreference || 'CONSERVATIVE';
    const exitRules = config.exitRules;
    const entryPriceMode = config.entryPriceMode || 'ASK';
    const positionSizing = config.positionSizing || { mode: 'FIXED_CONTRACTS', fixedContracts: 1 };

    // 确定标的列表
    const symbols: string[] = requestSymbols && requestSymbols.length > 0
      ? requestSymbols
      : (symbolPoolConfig.symbols || []);

    if (symbols.length === 0) {
      return next(ErrorFactory.missingParameter('symbols（策略无标的池且未指定symbols）'));
    }

    // 获取阈值配置（优先使用 entryThresholdOverride）
    const tableThresholds = ENTRY_THRESHOLDS[riskPreference] || ENTRY_THRESHOLDS.CONSERVATIVE;
    const override = config.entryThresholdOverride;
    const thresholds = {
      directionalScoreMin: override?.directionalScoreMin ?? tableThresholds.directionalScoreMin,
      spreadScoreMin: override?.spreadScoreMin ?? tableThresholds.spreadScoreMin,
      straddleIvThreshold: tableThresholds.straddleIvThreshold,
    };

    // 2) 资金分配诊断
    let capitalAllocationInfo: Record<string, unknown> = {};
    try {
      const totalCash = await capitalManager.getTotalCapital();

      // 查询策略的资金分配账户
      const caResult = await pool.query(
        `SELECT ca.id, ca.allocation_type, ca.allocation_value, ca.current_usage
         FROM strategies s
         LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
         WHERE s.id = $1`,
        [strategyId]
      );

      if (caResult.rows.length > 0 && caResult.rows[0].id) {
        const ca = caResult.rows[0];
        const allocationType = ca.allocation_type as string;
        const allocationValue = parseFloat(ca.allocation_value?.toString() || '0');
        const currentUsage = parseFloat(ca.current_usage?.toString() || '0');

        // 计算策略实际可用额度（FIXED_AMOUNT 受账户余额上限保护）
        let strategyBudget: number;
        if (allocationType === 'PERCENTAGE') {
          strategyBudget = totalCash * allocationValue;
        } else {
          strategyBudget = Math.min(allocationValue, totalCash);
        }
        const availableForStrategy = Math.max(0, strategyBudget - currentUsage);

        // 有效标的池过滤
        const poolResult = await capitalManager.getEffectiveSymbolPool(strategyId, symbols, strategyBudget);

        // 查询当前持仓占用明细
        const holdingResult = await pool.query(
          `SELECT symbol,
                  COALESCE((context->>'tradedSymbol')::text, symbol) as traded_symbol,
                  COALESCE((context->>'allocationAmount')::numeric, 0) as allocation_amount,
                  current_state
           FROM strategy_instances
           WHERE strategy_id = $1 AND current_state IN ('HOLDING', 'OPENING', 'CLOSING')`,
          [strategyId]
        );
        const holdingDetails = holdingResult.rows.map((r: Record<string, unknown>) => ({
          symbol: r.symbol,
          tradedSymbol: r.traded_symbol,
          state: r.current_state,
          allocationAmount: parseFloat((r.allocation_amount as string) || '0'),
        }));

        capitalAllocationInfo = {
          accountCash: Math.round(totalCash * 100) / 100,
          strategy: {
            allocationType,
            configuredValue: allocationValue,
            effectiveBudget: Math.round(strategyBudget * 100) / 100,
            currentUsage: Math.round(currentUsage * 100) / 100,
            availableForNewEntry: Math.round(availableForStrategy * 100) / 100,
            budgetCapped: allocationType === 'FIXED_AMOUNT' && allocationValue > totalCash,
          },
          symbolPool: {
            totalSymbols: symbols.length,
            effectiveSymbols: poolResult.effectiveSymbols,
            excludedSymbols: poolResult.excludedSymbols,
            maxPerSymbol: Math.round(poolResult.maxPerSymbol * 100) / 100,
          },
          currentHoldings: holdingDetails,
        };
      } else {
        capitalAllocationInfo = {
          accountCash: Math.round(totalCash * 100) / 100,
          strategy: null,
          note: '策略未配置资金分配账户',
        };
      }
    } catch (capitalError: unknown) {
      const msg = capitalError instanceof Error ? capitalError.message : String(capitalError);
      capitalAllocationInfo = { error: `资金信息获取失败: ${msg}` };
    }

    // 3) 对每个 symbol 执行模拟
    const results = [];

    for (const symbol of symbols) {
      const result: Record<string, unknown> = { symbol };

      // Step 1: 市场数据 — 调用推荐服务
      try {
        const recommendation = await optionRecommendationService.calculateOptionRecommendation(symbol);
        result.marketData = {
          direction: recommendation.direction,
          confidence: recommendation.confidence,
          marketScore: recommendation.marketScore,
          intradayScore: recommendation.intradayScore,
          finalScore: recommendation.finalScore,
          riskLevel: recommendation.riskLevel,
          reasoning: recommendation.reasoning,
          dataCheck: recommendation.dataCheck,
          riskMetrics: recommendation.riskMetrics,
          intradayComponents: recommendation.intradayComponents,
          currentVix: recommendation.currentVix,
          vwapData: recommendation.vwapData,
          structureCheck: recommendation.structureCheck,
        };

        // Step 2: 信号评估 — 用阈值判断是否入场
        // VIX-adaptive threshold calculation
        const currentVix = recommendation?.currentVix;
        const vixFactor = (currentVix && currentVix > 0) ? Math.max(0.5, Math.min(2.5, currentVix / 20)) : 1.0;
        const adaptiveThresholds = {
          directionalScoreMin: Math.round(thresholds.directionalScoreMin * vixFactor),
          spreadScoreMin: Math.round(thresholds.spreadScoreMin * vixFactor),
          straddleIvThreshold: thresholds.straddleIvThreshold,
          vixFactor,
          baseDirectional: thresholds.directionalScoreMin,
          baseSpread: thresholds.spreadScoreMin,
        };

        const absScore = Math.abs(recommendation.finalScore);
        const directionFromScore = recommendation.finalScore >= 0 ? 'CALL' : 'PUT';
        const passed = recommendation.direction !== 'HOLD' && absScore >= adaptiveThresholds.directionalScoreMin;

        let selectedStrategy: string | null = null;
        let signalDirection: 'CALL' | 'PUT' | null = null;

        if (passed) {
          signalDirection = directionFromScore;
          // 确定使用哪种策略类型
          const buyerTypes = config.strategyTypes?.buyer || [];
          if (signalDirection === 'CALL' && buyerTypes.includes('DIRECTIONAL_CALL')) {
            selectedStrategy = 'DIRECTIONAL_CALL';
          } else if (signalDirection === 'PUT' && buyerTypes.includes('DIRECTIONAL_PUT')) {
            selectedStrategy = 'DIRECTIONAL_PUT';
          } else if (buyerTypes.length > 0) {
            selectedStrategy = buyerTypes[0];
          }
        }

        result.signalEvaluation = {
          thresholds: {
            baseDirectional: thresholds.directionalScoreMin,
            baseSpread: thresholds.spreadScoreMin,
            vixFactor,
            effectiveDirectional: adaptiveThresholds.directionalScoreMin,
            effectiveSpread: adaptiveThresholds.spreadScoreMin,
          },
          absScore,
          selectedStrategy,
          direction: signalDirection,
          reason: passed
            ? `得分 ${absScore} >= 阈值 ${adaptiveThresholds.directionalScoreMin} (base=${thresholds.directionalScoreMin} x vix=${vixFactor.toFixed(2)})，方向 ${signalDirection}`
            : `得分 ${absScore} < 阈值 ${adaptiveThresholds.directionalScoreMin} (base=${thresholds.directionalScoreMin} x vix=${vixFactor.toFixed(2)}) 或方向 HOLD，不入场`,
          passed,
        };

        // Step 3+: 仅在信号通过时继续
        if (passed && signalDirection) {
          // Step 3: 合约选择
          try {
            const expirationMode = (overrideExpirationMode === '0DTE' ? '0DTE' : 'NEAREST') as '0DTE' | 'NEAREST';
            const contract = await selectOptionContract({
              underlyingSymbol: symbol,
              expirationMode,
              direction: signalDirection,
              candidateStrikes: 8,
              liquidityFilters: config.liquidityFilters,
              greekFilters: config.greekFilters,
            });

            result.contractSelection = {
              expirationMode,
              selectedContract: contract ? {
                optionSymbol: contract.optionSymbol,
                strikePrice: contract.strikePrice,
                strikeDate: contract.strikeDate,
                optionType: contract.optionType,
                bid: contract.bid,
                ask: contract.ask,
                mid: contract.mid,
                last: contract.last,
                openInterest: contract.openInterest,
                impliedVolatility: contract.impliedVolatility,
                delta: contract.delta,
                theta: contract.theta,
                timeValue: contract.timeValue,
                multiplier: contract.multiplier,
              } : null,
              reason: contract ? '合约选择成功' : '未找到符合条件的合约',
            };

            // Step 4+: 仅在合约选择成功时继续
            if (contract) {
              // Step 4: 入场计算
              const premium = entryPriceMode === 'MID' ? contract.mid : contract.ask;
              const contracts = positionSizing.fixedContracts || 1;
              const costEstimate = estimateOptionOrderTotalCost({
                premium,
                contracts,
                multiplier: contract.multiplier || 100,
                side: 'BUY',
                feeModel: config.feeModel,
              });

              result.entryCalculation = {
                entryPriceMode,
                premium,
                contracts,
                multiplier: contract.multiplier || 100,
                estimatedCost: costEstimate.totalCost,
                estimatedFees: costEstimate.fees,
              };

              // Step 5: 止盈止损参数
              const marketCloseTime = new Date();
              marketCloseTime.setUTCHours(20, 0, 0, 0); // 美东16:00 = UTC 20:00

              const positionCtx: PositionContext = {
                entryPrice: premium,
                currentPrice: premium,
                quantity: contracts,
                multiplier: contract.multiplier || 100,
                entryTime: new Date(),
                marketCloseTime,
                strategySide: 'BUYER',
                entryIV: contract.impliedVolatility || 0,
                currentIV: contract.impliedVolatility || 0,
                entryDelta: contract.delta,
                currentDelta: contract.delta,
                timeValue: contract.timeValue,
                entryFees: costEstimate.fees.totalFees,
                estimatedExitFees: costEstimate.fees.totalFees,
              };

              const exitRulesOverride: ExitRulesOverride | undefined = exitRules
                ? { takeProfitPercent: exitRules.takeProfitPercent, stopLossPercent: exitRules.stopLossPercent }
                : undefined;

              const dynamicParams = optionDynamicExitService.getDynamicExitParams(positionCtx, exitRulesOverride);
              const phase = optionDynamicExitService.getTradingPhase(new Date(), marketCloseTime);

              // 缩放比例（BUYER EARLY 基准: TP=50, SL=35）
              const earlyBaseTP = 50;
              const earlyBaseSL = 35;

              result.exitParams = {
                userConfig: exitRules
                  ? { takeProfitPercent: exitRules.takeProfitPercent, stopLossPercent: exitRules.stopLossPercent }
                  : null,
                dynamicParams: {
                  phase,
                  takeProfitPercent: dynamicParams.takeProfitPercent,
                  stopLossPercent: dynamicParams.stopLossPercent,
                  trailingStopTrigger: dynamicParams.trailingStopTrigger,
                  trailingStopPercent: dynamicParams.trailingStopPercent,
                  adjustmentReason: dynamicParams.adjustmentReason,
                },
                scaling: {
                  earlyBaseTP,
                  earlyBaseSL,
                  currentRatioTP: Math.round((dynamicParams.takeProfitPercent / earlyBaseTP) * 100) / 100,
                  currentRatioSL: Math.round((dynamicParams.stopLossPercent / earlyBaseSL) * 100) / 100,
                },
              };

              // Step 6: 可选真实下单
              if (executeOrder) {
                try {
                  const intent: TradingIntent = {
                    action: 'BUY',
                    symbol: contract.optionSymbol,
                    entryPrice: premium,
                    quantity: contracts,
                    reason: `模拟下单 - 策略${strategyId} ${symbol} ${signalDirection}`,
                    metadata: {
                      strategyId,
                      underlyingSymbol: symbol,
                      optionType: contract.optionType,
                      strikePrice: contract.strikePrice,
                      expirationMode,
                      simulate: true,
                    },
                  };

                  const execResult = await basicExecutionService.executeBuyIntent(intent, strategyId);
                  result.orderExecution = {
                    executed: execResult.success,
                    orderId: execResult.orderId,
                    status: execResult.orderStatus,
                    error: execResult.error,
                    note: execResult.success ? '可在券商APP手工撤单' : undefined,
                  };
                } catch (execError: unknown) {
                  const execErr = execError instanceof Error ? execError : new Error(String(execError));
                  result.orderExecution = {
                    executed: false,
                    error: execErr.message,
                  };
                }
              }
            }
          } catch (contractError: unknown) {
            const contractErr = contractError instanceof Error ? contractError : new Error(String(contractError));
            result.contractSelection = {
              expirationMode: overrideExpirationMode,
              selectedContract: null,
              reason: `合约选择失败: ${contractErr.message}`,
            };
          }
        }
      } catch (marketError: unknown) {
        const marketErr = marketError instanceof Error ? marketError : new Error(String(marketError));
        result.marketData = { error: marketErr.message };
      }

      results.push(result);
    }

    // 4) 返回完整诊断报告
    res.json({
      success: true,
      data: {
        strategyId,
        strategyName: strategy.name,
        config: {
          riskPreference,
          exitRules: exitRules || null,
          entryPriceMode,
          positionSizing,
          strategyTypes: config.strategyTypes || null,
          expirationMode: config.expirationMode,
        },
        capitalAllocation: capitalAllocationInfo,
        simulatedAt: new Date().toISOString(),
        executeOrder,
        symbolCount: symbols.length,
        results,
      },
    });
  } catch (error: unknown) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

