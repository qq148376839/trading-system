import { Router, Request, Response } from 'express';
import pool from '../config/database';

export const tradingRulesRouter = Router();

/**
 * GET /api/trading-rules
 * 获取交易规则列表
 */
tradingRulesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { symbol, enabled } = req.query;

    let query = 'SELECT * FROM trading_rules WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (symbol) {
      query += ` AND symbol = $${paramIndex++}`;
      params.push(symbol);
    }

    if (enabled !== undefined) {
      query += ` AND enabled = $${paramIndex++}`;
      params.push(enabled === 'true');
    }

    query += ' ORDER BY symbol, created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        rules: result.rows,
      },
    });
  } catch (error: any) {
    console.error('获取交易规则失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  }
});

/**
 * GET /api/trading-rules/:id
 * 获取单个交易规则详情
 */
tradingRulesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM trading_rules WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '未找到该交易规则',
        },
      });
    }

    res.json({
      success: true,
      data: {
        rule: result.rows[0],
      },
    });
  } catch (error: any) {
    console.error('获取交易规则详情失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  }
});

/**
 * POST /api/trading-rules
 * 创建交易规则
 */
tradingRulesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      rule_name,
      rule_type,
      enabled = true,
      config = {},
    } = req.body;

    if (!symbol || !rule_name || !rule_type) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: symbol, rule_name, rule_type',
        },
      });
    }

    // 验证symbol格式（支持 ticker.region 和 .ticker.region 格式）
    // 支持格式：AAPL.US, 700.HK, .SPX.US (标普500指数带前导点)
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (!symbolPattern.test(symbol)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SYMBOL_FORMAT',
          message: '无效的标的代码格式。请使用 ticker.region 格式，例如：AAPL.US 或 .SPX.US',
        },
      });
    }

    // 验证rule_type
    const validRuleTypes = [
      'price_alert',      // 价格提醒
      'auto_trade',       // 自动交易
      'stop_loss',        // 止损
      'take_profit',      // 止盈
      'trailing_stop',    // 跟踪止损
      'dca',              // 定投
    ];
    if (!validRuleTypes.includes(rule_type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_RULE_TYPE',
          message: `无效的规则类型。支持的类型: ${validRuleTypes.join(', ')}`,
        },
      });
    }

    // 插入新记录
    const result = await pool.query(
      `INSERT INTO trading_rules (symbol, rule_name, rule_type, enabled, config, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [symbol, rule_name, rule_type, enabled, JSON.stringify(config)]
    );

    res.status(201).json({
      success: true,
      data: {
        rule: result.rows[0],
      },
    });
  } catch (error: any) {
    // 处理唯一约束冲突
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_RULE',
          message: '该股票已存在同名交易规则',
        },
      });
    }

    console.error('创建交易规则失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  }
});

/**
 * PUT /api/trading-rules/:id
 * 更新交易规则
 */
tradingRulesRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rule_name, rule_type, enabled, config } = req.body;

    // 构建更新语句
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (rule_name !== undefined) {
      updates.push(`rule_name = $${paramIndex++}`);
      params.push(rule_name);
    }
    if (rule_type !== undefined) {
      updates.push(`rule_type = $${paramIndex++}`);
      params.push(rule_type);
    }
    if (enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      params.push(enabled);
    }
    if (config !== undefined) {
      updates.push(`config = $${paramIndex++}`);
      params.push(JSON.stringify(config));
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '至少需要提供一个更新字段',
        },
      });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `
      UPDATE trading_rules 
      SET ${updates.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '未找到该交易规则',
        },
      });
    }

    res.json({
      success: true,
      data: {
        rule: result.rows[0],
      },
    });
  } catch (error: any) {
    console.error('更新交易规则失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  }
});

/**
 * DELETE /api/trading-rules/:id
 * 删除交易规则
 */
tradingRulesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM trading_rules WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '未找到该交易规则',
        },
      });
    }

    res.json({
      success: true,
      data: {
        message: '交易规则已删除',
      },
    });
  } catch (error: any) {
    console.error('删除交易规则失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  }
});

