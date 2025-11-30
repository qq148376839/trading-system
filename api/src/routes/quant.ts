/**
 * 量化交易 API 路由
 * Phase 1: 核心引擎与选股/资金框架
 */

import { Router, Request, Response } from 'express';
import pool from '../config/database';
import capitalManager, { CapitalAllocation, AllocationRequest } from '../services/capital-manager.service';
import stockSelector from '../services/stock-selector.service';
import accountBalanceSyncService from '../services/account-balance-sync.service';
import strategyScheduler from '../services/strategy-scheduler.service';
import stateManager from '../services/state-manager.service';

export const quantRouter = Router();

// ==================== 资金管理 API ====================

/**
 * GET /api/quant/capital/allocations
 * 获取所有资金分配账户
 */
quantRouter.get('/capital/allocations', async (req: Request, res: Response) => {
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
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error: any) {
    console.error('获取资金分配失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/quant/capital/allocations
 * 创建资金分配账户
 */
quantRouter.post('/capital/allocations', async (req: Request, res: Response) => {
  try {
    const { name, parentId, allocationType, allocationValue } = req.body;

    if (!name || !allocationType || allocationValue === undefined) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAMETER', message: '缺少必需参数' },
      });
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
    console.error('创建资金分配失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * PUT /api/quant/capital/allocations/:id
 * 更新资金分配账户
 */
quantRouter.put('/capital/allocations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, allocationType, allocationValue } = req.body;

    // 检查是否存在
    const checkResult = await pool.query(
      'SELECT id FROM capital_allocations WHERE id = $1',
      [id]
    );
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '资金分配账户不存在' },
      });
    }

    // 检查是否有策略在使用此账户
    const strategiesResult = await pool.query(
      'SELECT COUNT(*) as count FROM strategies WHERE capital_allocation_id = $1',
      [id]
    );
    const strategyCount = parseInt(strategiesResult.rows[0].count || '0');
    if (strategyCount > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'IN_USE', message: `该资金分配账户正在被 ${strategyCount} 个策略使用，无法修改` },
      });
    }

    // 如果修改名称，检查名称是否已存在
    if (name !== undefined && name !== checkResult.rows[0].name) {
      const nameCheckResult = await pool.query(
        'SELECT id FROM capital_allocations WHERE name = $1 AND id != $2',
        [name, id]
      );
      if (nameCheckResult.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'DUPLICATE_NAME', message: `资金分配账户名称 "${name}" 已存在` },
        });
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
        return res.status(400).json({
          success: false,
          error: {
            code: 'PERCENTAGE_OVERFLOW',
            message: `百分比总和超过 100%: ${(existingTotal * 100).toFixed(1)}% + ${(finalAllocationValue * 100).toFixed(1)}%`,
          },
        });
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
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAMETER', message: '没有提供要更新的字段' },
      });
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
          createdAt: updatedResult.rows[0].created_at,
          updatedAt: updatedResult.rows[0].updated_at,
        },
      },
    });
  } catch (error: any) {
    console.error('更新资金分配失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * DELETE /api/quant/capital/allocations/:id
 * 删除资金分配账户
 */
quantRouter.delete('/capital/allocations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 检查是否存在
    const checkResult = await pool.query(
      'SELECT id, name FROM capital_allocations WHERE id = $1',
      [id]
    );
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '资金分配账户不存在' },
      });
    }

    // 检查是否有策略在使用此账户
    const strategiesResult = await pool.query(
      'SELECT COUNT(*) as count FROM strategies WHERE capital_allocation_id = $1',
      [id]
    );
    const strategyCount = parseInt(strategiesResult.rows[0].count || '0');
    if (strategyCount > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'IN_USE', message: `该资金分配账户正在被 ${strategyCount} 个策略使用，无法删除` },
      });
    }

    // 检查是否有子账户
    const childrenResult = await pool.query(
      'SELECT COUNT(*) as count FROM capital_allocations WHERE parent_id = $1',
      [id]
    );
    const childrenCount = parseInt(childrenResult.rows[0].count || '0');
    if (childrenCount > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'HAS_CHILDREN', message: `该资金分配账户有 ${childrenCount} 个子账户，无法删除` },
      });
    }

    // 检查是否是GLOBAL账户
    if (checkResult.rows[0].name === 'GLOBAL') {
      return res.status(400).json({
        success: false,
        error: { code: 'PROTECTED', message: 'GLOBAL账户是系统根账户，无法删除' },
      });
    }

    // 删除
    await pool.query('DELETE FROM capital_allocations WHERE id = $1', [id]);

    res.json({
      success: true,
      data: { message: '资金分配账户已删除' },
    });
  } catch (error: any) {
    console.error('删除资金分配失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/quant/capital/usage
 * 获取资金使用情况
 */
quantRouter.get('/capital/usage', async (req: Request, res: Response) => {
  try {
    let totalCapital: number;
    try {
      totalCapital = await capitalManager.getTotalCapital();
    } catch (error: any) {
      // 如果是API限流错误，返回0并记录警告
      if (error.message && error.message.includes('429002')) {
        console.warn('API请求限流，返回0作为总资金');
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
      LEFT JOIN strategies s ON s.capital_allocation_id = ca.id
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
        })),
      },
    });
  } catch (error: any) {
    console.error('获取资金使用情况失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/quant/capital/sync-balance
 * 手动触发余额同步
 */
quantRouter.post('/capital/sync-balance', async (req: Request, res: Response) => {
  try {
    const result = await accountBalanceSyncService.syncAccountBalance();
    res.json({
      success: result.success,
      data: result,
    });
  } catch (error: any) {
    console.error('余额同步失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/quant/capital/balance-discrepancies
 * 查询余额差异
 */
quantRouter.get('/capital/balance-discrepancies', async (req: Request, res: Response) => {
  try {
    const validationResult = await capitalManager.validateUsage();
    res.json({
      success: true,
      data: validationResult,
    });
  } catch (error: any) {
    console.error('查询余额差异失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

// ==================== 选股器 API ====================

/**
 * GET /api/quant/stock-selector/blacklist
 * 获取黑名单列表
 */
quantRouter.get('/stock-selector/blacklist', async (req: Request, res: Response) => {
  try {
    const blacklist = await stockSelector.getBlacklist();
    res.json({
      success: true,
      data: blacklist,
    });
  } catch (error: any) {
    console.error('获取黑名单失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/quant/stock-selector/blacklist
 * 添加股票到黑名单
 */
quantRouter.post('/stock-selector/blacklist', async (req: Request, res: Response) => {
  try {
    const { symbol, reason } = req.body;

    if (!symbol || !reason) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAMETER', message: '缺少 symbol 或 reason' },
      });
    }

    await stockSelector.addToBlacklist(symbol, reason, 'api');
    res.json({
      success: true,
      message: '已添加到黑名单',
    });
  } catch (error: any) {
    console.error('添加黑名单失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * DELETE /api/quant/stock-selector/blacklist/:symbol
 * 从黑名单移除股票
 */
quantRouter.delete('/stock-selector/blacklist/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    await stockSelector.removeFromBlacklist(symbol);
    res.json({
      success: true,
      message: '已从黑名单移除',
    });
  } catch (error: any) {
    console.error('移除黑名单失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

// ==================== 策略管理 API ====================

/**
 * GET /api/quant/strategies
 * 获取所有策略
 */
quantRouter.get('/strategies', async (req: Request, res: Response) => {
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
    console.error('获取策略列表失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/quant/strategies
 * 创建策略
 */
quantRouter.post('/strategies', async (req: Request, res: Response) => {
  try {
    const { name, type, capitalAllocationId, symbolPoolConfig, config } = req.body;

    if (!name || !type || !symbolPoolConfig || !config) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAMETER', message: '缺少必需参数' },
      });
    }

    // 验证股票池配置
    if (!symbolPoolConfig.symbols || !Array.isArray(symbolPoolConfig.symbols)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SYMBOL_POOL_CONFIG', message: '股票池配置格式错误：symbols必须是数组' },
      });
    }

    if (symbolPoolConfig.symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'EMPTY_SYMBOL_POOL', message: '股票池不能为空，请至少添加一个股票' },
      });
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
        console.log(`[策略验证] 自动修正股票代码: ${trimmed} -> ${corrected}`);
      }
      
      if (!symbolPattern.test(corrected)) {
        invalidSymbols.push(trimmed);
      } else {
        correctedSymbols.push(corrected);
      }
    }

    if (invalidSymbols.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SYMBOL_FORMAT',
          message: `无效的标的代码格式: ${invalidSymbols.join(', ')}。请使用 ticker.region 格式，例如：AAPL.US 或 700.HK`,
        },
      });
    }

    // 去重
    const uniqueSymbols = [...new Set(correctedSymbols)];
    if (uniqueSymbols.length !== correctedSymbols.length) {
      console.warn(`[策略验证] 检测到重复的股票代码，已自动去重`);
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
    console.error('创建策略失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/quant/strategies/:id
 * 获取策略详情
 */
quantRouter.get('/strategies/:id', async (req: Request, res: Response) => {
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
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '策略不存在' },
      });
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
    console.error('获取策略详情失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * PUT /api/quant/strategies/:id
 * 更新策略
 */
quantRouter.put('/strategies/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, capitalAllocationId, symbolPoolConfig, config } = req.body;

    // 检查是否存在
    const checkResult = await pool.query('SELECT id, status FROM strategies WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '策略不存在' },
      });
    }

    // 如果策略正在运行，不允许修改
    if (checkResult.rows[0].status === 'RUNNING') {
      return res.status(400).json({
        success: false,
        error: { code: 'STRATEGY_RUNNING', message: '策略正在运行中，请先停止策略再修改' },
      });
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
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_SYMBOL_POOL_CONFIG', message: '股票池配置格式错误：symbols必须是数组' },
        });
      }

      if (symbolPoolConfig.symbols.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_SYMBOL_POOL', message: '股票池不能为空，请至少添加一个股票' },
        });
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
          console.log(`[策略验证] 自动修正股票代码: ${trimmed} -> ${corrected}`);
        }
        
        if (!symbolPattern.test(corrected)) {
          invalidSymbols.push(trimmed);
        } else {
          correctedSymbols.push(corrected);
        }
      }

      if (invalidSymbols.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_SYMBOL_FORMAT',
            message: `无效的标的代码格式: ${invalidSymbols.join(', ')}。请使用 ticker.region 格式，例如：AAPL.US 或 700.HK`,
          },
        });
      }

      // 去重
      const uniqueSymbols = [...new Set(correctedSymbols)];
      if (uniqueSymbols.length !== correctedSymbols.length) {
        console.warn(`[策略验证] 检测到重复的股票代码，已自动去重`);
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
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAMETER', message: '没有提供要更新的字段' },
      });
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
    console.error('更新策略失败:', error);
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
quantRouter.delete('/strategies/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 检查是否存在
    const checkResult = await pool.query('SELECT id, status FROM strategies WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '策略不存在' },
      });
    }

    // 如果策略正在运行，先停止
    if (checkResult.rows[0].status === 'RUNNING') {
      try {
        await strategyScheduler.stopStrategy(parseInt(id));
      } catch (stopError: any) {
        console.warn('停止策略失败，继续删除:', stopError);
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
    console.error('删除策略失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/quant/strategies/:id/start
 * 启动策略
 */
quantRouter.post('/strategies/:id/start', async (req: Request, res: Response) => {
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
    console.error('启动策略失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * POST /api/quant/strategies/:id/stop
 * 停止策略
 */
quantRouter.post('/strategies/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 停止策略调度
    await strategyScheduler.stopStrategy(parseInt(id));

    res.json({
      success: true,
      message: '策略已停止',
    });
  } catch (error: any) {
    console.error('停止策略失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

/**
 * GET /api/quant/strategies/:id/instances
 * 获取策略实例状态
 */
quantRouter.get('/strategies/:id/instances', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const instances = await stateManager.getStrategyInstances(parseInt(id));

    res.json({
      success: true,
      data: instances,
    });
  } catch (error: any) {
    console.error('获取策略实例失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

// ==================== 信号日志 API ====================

/**
 * GET /api/quant/signals
 * 获取信号日志
 */
quantRouter.get('/signals', async (req: Request, res: Response) => {
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
    console.error('获取信号日志失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

// ==================== 交易记录 API ====================

/**
 * GET /api/quant/trades
 * 获取自动交易记录
 */
quantRouter.get('/trades', async (req: Request, res: Response) => {
  try {
    const { strategyId, symbol, limit = 100 } = req.query;

    let query = 'SELECT * FROM auto_trades WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (strategyId) {
      query += ` AND strategy_id = $${paramIndex++}`;
      params.push(strategyId);
    }

    if (symbol) {
      query += ` AND symbol = $${paramIndex++}`;
      params.push(symbol);
    }

    query += ` ORDER BY open_time DESC LIMIT $${paramIndex++}`;
    params.push(parseInt(limit as string));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('获取交易记录失败:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
});

