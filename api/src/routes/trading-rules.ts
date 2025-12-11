import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { ErrorFactory, normalizeError } from '../utils/errors';

export const tradingRulesRouter = Router();

/**
 * GET /api/trading-rules
 * 获取交易规则列表
 */
tradingRulesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
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
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/trading-rules/:id
 * 获取单个交易规则详情
 */
tradingRulesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM trading_rules WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return next(ErrorFactory.notFound('交易规则'));
    }

    res.json({
      success: true,
      data: {
        rule: result.rows[0],
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * POST /api/trading-rules
 * 创建交易规则
 */
tradingRulesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      symbol,
      rule_name,
      rule_type,
      enabled = true,
      config = {},
    } = req.body;

    if (!symbol || !rule_name || !rule_type) {
      return next(ErrorFactory.missingParameter('symbol, rule_name, 或 rule_type'));
    }

    // 验证symbol格式（支持 ticker.region 和 .ticker.region 格式）
    // 支持格式：AAPL.US, 700.HK, .SPX.US (标普500指数带前导点)
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (!symbolPattern.test(symbol)) {
      return next(ErrorFactory.validationError('无效的标的代码格式。请使用 ticker.region 格式，例如：AAPL.US 或 .SPX.US'));
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
      return next(ErrorFactory.validationError(`无效的规则类型。支持的类型: ${validRuleTypes.join(', ')}`));
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
      return next(ErrorFactory.resourceConflict('该股票已存在同名交易规则'));
    }

    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * PUT /api/trading-rules/:id
 * 更新交易规则
 */
tradingRulesRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
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
      return next(ErrorFactory.missingParameter('至少一个更新字段'));
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
      return next(ErrorFactory.notFound('交易规则'));
    }

    res.json({
      success: true,
      data: {
        rule: result.rows[0],
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * DELETE /api/trading-rules/:id
 * 删除交易规则
 */
tradingRulesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM trading_rules WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return next(ErrorFactory.notFound('交易规则'));
    }

    res.json({
      success: true,
      data: {
        message: '交易规则已删除',
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

