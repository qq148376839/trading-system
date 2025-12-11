import { Request, Response, NextFunction } from 'express';
import { AppError, normalizeError, ErrorSeverity } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * 统一错误处理中间件
 * 处理所有路由中的错误，提供统一的错误响应格式
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // 规范化错误
  const appError = normalizeError(err);

  // 根据错误严重程度记录日志
  switch (appError.severity) {
    case ErrorSeverity.CRITICAL:
      logger.error(`[CRITICAL] ${appError.code}: ${appError.message}`, {
        path: req.path,
        method: req.method,
        details: appError.details,
        stack: appError.stack,
      });
      break;
    case ErrorSeverity.HIGH:
      logger.error(`[HIGH] ${appError.code}: ${appError.message}`, {
        path: req.path,
        method: req.method,
        details: appError.details,
      });
      break;
    case ErrorSeverity.MEDIUM:
      logger.warn(`[MEDIUM] ${appError.code}: ${appError.message}`, {
        path: req.path,
        method: req.method,
        details: appError.details,
      });
      break;
    case ErrorSeverity.LOW:
      logger.debug(`[LOW] ${appError.code}: ${appError.message}`, {
        path: req.path,
        method: req.method,
      });
      break;
  }

  // 在生产环境中隐藏敏感错误信息
  const isProduction = process.env.NODE_ENV === 'production';
  const errorMessage = isProduction && !appError.isOperational
    ? '服务器内部错误'
    : appError.message;

  // 返回统一的错误响应格式
  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: errorMessage,
      ...(appError.details && !isProduction && { details: appError.details }),
    },
    ...(process.env.NODE_ENV === 'development' && {
      stack: appError.stack,
      severity: appError.severity,
      category: appError.category,
    }),
  });
}


