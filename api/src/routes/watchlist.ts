import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { ErrorFactory, normalizeError } from '../utils/errors';

export const watchlistRouter = Router();

/**
 * @openapi
 * /watchlist:
 *   get:
 *     tags:
 *       - 自选股
 *     summary: 获取自选股列表
 *     description: 获取用户关注的股票列表
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: enabled
 *         schema:
 *           type: boolean
 *         description: 筛选启用状态
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
 *                     watchlist:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           enabled:
 *                             type: boolean
 */
watchlistRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled } = req.query;
    
    let query = 'SELECT * FROM watchlist';
    const params: any[] = [];

    if (enabled !== undefined) {
      query += ' WHERE enabled = $1';
      params.push(enabled === 'true');
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        watchlist: result.rows,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /watchlist:
 *   post:
 *     tags:
 *       - 自选股
 *     summary: 添加自选股
 *     description: 添加一个新的股票到关注列表
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
 *             properties:
 *               symbol:
 *                 type: string
 *                 description: 股票代码
 *     responses:
 *       201:
 *         description: 添加成功
 *       409:
 *         description: 股票已存在
 */
watchlistRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return next(ErrorFactory.missingParameter('symbol'));
    }

    // 验证symbol格式（支持 ticker.region 和 .ticker.region 格式）
    // 支持格式：AAPL.US, 700.HK, .SPX.US (标普500指数带前导点)
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (!symbolPattern.test(symbol)) {
      return next(ErrorFactory.validationError('无效的标的代码格式。请使用 ticker.region 格式，例如：700.HK 或 .SPX.US'));
    }

    // 检查是否已存在
    const existing = await pool.query(
      'SELECT * FROM watchlist WHERE symbol = $1',
      [symbol]
    );

    if (existing.rows.length > 0) {
      return next(ErrorFactory.resourceConflict('该股票已在关注列表中'));
    }

    // 插入新记录
    const result = await pool.query(
      'INSERT INTO watchlist (symbol, enabled, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING *',
      [symbol, true]
    );

    res.status(201).json({
      success: true,
      data: {
        watchlist: result.rows[0],
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /watchlist/{symbol}:
 *   delete:
 *     tags:
 *       - 自选股
 *     summary: 移除自选股
 *     description: 从关注列表中删除股票
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: 股票代码
 *     responses:
 *       200:
 *         description: 删除成功
 */
watchlistRouter.delete('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params;

    const result = await pool.query(
      'DELETE FROM watchlist WHERE symbol = $1 RETURNING *',
      [symbol]
    );

    if (result.rows.length === 0) {
      return next(ErrorFactory.notFound('关注股票'));
    }

    res.json({
      success: true,
      data: {
        message: '已移除关注股票',
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /watchlist/{symbol}:
 *   put:
 *     tags:
 *       - 自选股
 *     summary: 更新自选股状态
 *     description: 启用或禁用自选股
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: 股票代码
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: 是否启用
 *     responses:
 *       200:
 *         description: 更新成功
 */
watchlistRouter.put('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return next(ErrorFactory.validationError('enabled参数必须是布尔值'));
    }

    const result = await pool.query(
      'UPDATE watchlist SET enabled = $1, updated_at = NOW() WHERE symbol = $2 RETURNING *',
      [enabled, symbol]
    );

    if (result.rows.length === 0) {
      return next(ErrorFactory.notFound('关注股票'));
    }

    res.json({
      success: true,
      data: {
        watchlist: result.rows[0],
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});


