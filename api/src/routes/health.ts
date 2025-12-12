import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { ErrorCode, ErrorSeverity, ErrorCategory, AppError } from '../utils/errors';

export const healthRouter = Router();

/**
 * GET /api/health
 * 健康检查接口
 */
healthRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
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
    // 健康检查失败，返回503状态码
    const appError = new AppError(
      ErrorCode.EXTERNAL_API_ERROR, // 使用EXTERNAL_API_ERROR，因为数据库是外部服务
      '数据库连接失败',
      503, // statusCode
      ErrorSeverity.HIGH, // severity
      ErrorCategory.EXTERNAL_ERROR, // category
      { originalError: error.message } // details
    );
    return next(appError);
  }
});


