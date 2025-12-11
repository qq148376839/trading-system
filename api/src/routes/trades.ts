import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { normalizeError } from '../utils/errors';

export const tradesRouter = Router();

/**
 * GET /api/trades
 * 查询交易记录
 */
tradesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol, status, start_date, end_date, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM trades WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (symbol) {
      query += ` AND symbol = $${paramIndex}`;
      params.push(symbol);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (start_date) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(Number(limit), Number(offset));

    const result = await pool.query(query, params);

    // 获取总数
    const countQuery = 'SELECT COUNT(*) FROM trades';
    const countResult = await pool.query(countQuery);

    res.json({
      success: true,
      data: {
        trades: result.rows,
        total: parseInt(countResult.rows[0].count),
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});


