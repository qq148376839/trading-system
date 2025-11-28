import { Router, Request, Response } from 'express';
import pool from '../config/database';

export const healthRouter = Router();

/**
 * GET /api/health
 * 健康检查接口
 */
healthRouter.get('/', async (req: Request, res: Response) => {
  try {
    // 检查数据库连接
    await pool.query('SELECT 1');

    res.json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
        },
      },
    });
  } catch (error: any) {
    res.status(503).json({
      success: false,
      data: {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'disconnected',
        },
        error: error.message,
      },
    });
  }
});


