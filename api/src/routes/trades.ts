import { Router, Request, Response } from 'express';
import pool from '../config/database';

export const tradesRouter = Router();

/**
 * GET /api/trades
 * 查询交易记录
 */
tradesRouter.get('/', async (req: Request, res: Response) => {
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
    console.error('查询交易记录失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  }
});


