import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { ErrorCode, ErrorSeverity, ErrorCategory, AppError } from '../utils/errors';

export const healthRouter = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - 系统监控
 *     summary: 系统健康检查
 *     description: 检查 API 服务运行状态及数据库连接是否正常
 *     responses:
 *       200:
 *         description: 服务正常
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
 *                     status:
 *                       type: string
 *                       example: healthy
 *                     timestamp:
 *                       type: string
 *                     services:
 *                       type: object
 *                       properties:
 *                         database:
 *                           type: string
 *                           example: connected
 *       503:
 *         description: 服务异常 (如数据库连接失败)
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


