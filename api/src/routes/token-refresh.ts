/**
 * Token刷新API路由
 * 实现长桥API的Access Token刷新功能
 */

import { Router, Request, Response, NextFunction } from 'express';
import tokenRefreshService from '../services/token-refresh.service';
import configService from '../services/config.service';
import { normalizeError } from '../utils/errors';

export const tokenRefreshRouter = Router();

/**
 * @openapi
 * /token-refresh/refresh:
 *   post:
 *     tags:
 *       - 认证管理
 *     summary: 手动刷新 Token
 *     description: 强制刷新长桥 API 的 Access Token，并更新数据库
 *     responses:
 *       200:
 *         description: 刷新成功
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
 *                     message:
 *                       type: string
 *                     expiredAt:
 *                       type: string
 *                       description: 新Token过期时间
 *                     issuedAt:
 *                       type: string
 *                       description: 新Token签发时间
 */
tokenRefreshRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await tokenRefreshService.refreshToken();
    res.json({
      success: true,
      data: {
        message: 'Token刷新成功',
        expiredAt: result.expiredAt,
        issuedAt: result.issuedAt,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /token-refresh/status:
 *   get:
 *     tags:
 *       - 认证管理
 *     summary: 检查 Token 状态
 *     description: 查看当前 Token 的有效期、剩余时间及是否需要刷新
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
 *                     isValid:
 *                       type: boolean
 *                       description: Token是否有效
 *                     expiredAt:
 *                       type: string
 *                       description: 过期时间
 *                     remainingHours:
 *                       type: number
 *                       description: 剩余有效期(小时)
 *                     needsRefresh:
 *                       type: boolean
 *                       description: 建议是否刷新
 */
tokenRefreshRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await tokenRefreshService.getTokenStatus();
    
    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /token-refresh/auto-refresh:
 *   post:
 *     tags:
 *       - 认证管理
 *     summary: 触发自动刷新检查
 *     description: 智能判断 Token 是否即将过期，仅在必要时执行刷新
 *     responses:
 *       200:
 *         description: 检查完成
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
 *                     refreshed:
 *                       type: boolean
 *                       description: 本次是否执行了刷新操作
 *                     message:
 *                       type: string
 */
tokenRefreshRouter.post('/auto-refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshed = await tokenRefreshService.autoRefreshIfNeeded();
    
    res.json({
      success: true,
      data: {
        refreshed,
        message: refreshed ? 'Token已自动刷新' : 'Token尚未到期，无需刷新',
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

