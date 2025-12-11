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
 * POST /api/token-refresh/refresh
 * 手动刷新Token
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
 * GET /api/token-refresh/status
 * 检查Token状态
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
 * POST /api/token-refresh/auto-refresh
 * 触发自动刷新检查（如果需要）
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

