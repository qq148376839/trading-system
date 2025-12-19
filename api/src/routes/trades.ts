import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { normalizeError } from '../utils/errors';

export const tradesRouter = Router();

/**
 * @openapi
 * /trades:
 *   get:
 *     tags:
 *       - 交易记录
 *     summary: 查询交易记录
 *     description: 查询系统的交易历史记录，支持分页和筛选
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *         description: 股票代码
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: 订单状态
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *         description: 开始日期 (YYYY-MM-DD)
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *         description: 结束日期 (YYYY-MM-DD)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: 每页数量
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: 偏移量
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
 *                     trades:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           side:
 *                             type: string
 *                           quantity:
 *                             type: number
 *                           price:
 *                             type: string
 *                           status:
 *                             type: string
 *                           created_at:
 *                             type: string
 *                     total:
 *                       type: number
 *                     limit:
 *                       type: number
 *                     offset:
 *                       type: number
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


