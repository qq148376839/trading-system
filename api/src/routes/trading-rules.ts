import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { ErrorFactory, normalizeError } from '../utils/errors';

export const tradingRulesRouter = Router();

/**
 * @openapi
 * /trading-rules:
 *   get:
 *     tags:
 *       - 交易规则
 *     summary: 获取交易规则列表
 *     description: 查询系统配置的自动交易规则或预警规则
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *         description: 股票代码过滤
 *       - in: query
 *         name: enabled
 *         schema:
 *           type: boolean
 *         description: 是否只查询启用的规则
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
 *                     rules:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             description: 规则ID
 *                           symbol:
 *                             type: string
 *                             description: 股票代码
 *                           rule_name:
 *                             type: string
 *                             description: 规则名称
 *                           rule_type:
 *                             type: string
 *                             description: 规则类型
 *                           enabled:
 *                             type: boolean
 *                             description: 是否启用
 *                           config:
 *                             type: object
 *                             description: 规则配置详情
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
 * @openapi
 * /trading-rules/{id}:
 *   get:
 *     tags:
 *       - 交易规则
 *     summary: 获取单个交易规则
 *     description: 根据ID获取规则详情
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 规则ID
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
 *                     rule:
 *                       type: object
 *                       description: 规则详情对象
 *       404:
 *         description: 规则不存在
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
 * @openapi
 * /trading-rules:
 *   post:
 *     tags:
 *       - 交易规则
 *     summary: 创建交易规则
 *     description: 新增一条自动交易或预警规则
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - symbol
 *               - rule_name
 *               - rule_type
 *             properties:
 *               symbol:
 *                 type: string
 *                 description: 股票代码
 *               rule_name:
 *                 type: string
 *                 description: 规则名称
 *               rule_type:
 *                 type: string
 *                 enum: [price_alert, auto_trade, stop_loss, take_profit, trailing_stop, dca]
 *                 description: 规则类型
 *               enabled:
 *                 type: boolean
 *                 default: true
 *                 description: 是否启用
 *               config:
 *                 type: object
 *                 description: 规则的具体参数 (JSON格式)
 *     responses:
 *       201:
 *         description: 创建成功
 *       400:
 *         description: 参数错误
 *       409:
 *         description: 规则冲突
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
 * @openapi
 * /trading-rules/{id}:
 *   put:
 *     tags:
 *       - 交易规则
 *     summary: 更新交易规则
 *     description: 修改现有规则的配置或状态
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 规则ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rule_name:
 *                 type: string
 *               rule_type:
 *                 type: string
 *               enabled:
 *                 type: boolean
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: 更新成功
 *       404:
 *         description: 规则不存在
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
 * @openapi
 * /trading-rules/{id}:
 *   delete:
 *     tags:
 *       - 交易规则
 *     summary: 删除交易规则
 *     description: 永久删除一条规则
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 规则ID
 *     responses:
 *       200:
 *         description: 删除成功
 *       404:
 *         description: 规则不存在
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

