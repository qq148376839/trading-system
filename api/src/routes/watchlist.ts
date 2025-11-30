import { Router, Request, Response } from 'express';
import pool from '../config/database';

export const watchlistRouter = Router();

/**
 * GET /api/watchlist
 * 获取关注股票列表
 */
watchlistRouter.get('/', async (req: Request, res: Response) => {
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
    console.error('获取关注列表失败:', error);
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
 * POST /api/watchlist
 * 添加关注股票
 */
watchlistRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: symbol',
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
          message: '无效的标的代码格式。请使用 ticker.region 格式，例如：700.HK 或 .SPX.US',
        },
      });
    }

    // 检查是否已存在
    const existing = await pool.query(
      'SELECT * FROM watchlist WHERE symbol = $1',
      [symbol]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_SYMBOL',
          message: '该股票已在关注列表中',
        },
      });
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
    console.error('添加关注股票失败:', error);
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
 * DELETE /api/watchlist/:symbol
 * 移除关注股票
 */
watchlistRouter.delete('/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    const result = await pool.query(
      'DELETE FROM watchlist WHERE symbol = $1 RETURNING *',
      [symbol]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '未找到该关注股票',
        },
      });
    }

    res.json({
      success: true,
      data: {
        message: '已移除关注股票',
      },
    });
  } catch (error: any) {
    console.error('移除关注股票失败:', error);
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
 * PUT /api/watchlist/:symbol
 * 启用/禁用关注股票
 */
watchlistRouter.put('/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'enabled参数必须是布尔值',
        },
      });
    }

    const result = await pool.query(
      'UPDATE watchlist SET enabled = $1, updated_at = NOW() WHERE symbol = $2 RETURNING *',
      [enabled, symbol]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '未找到该关注股票',
        },
      });
    }

    res.json({
      success: true,
      data: {
        watchlist: result.rows[0],
      },
    });
  } catch (error: any) {
    console.error('更新关注股票失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  }
});


