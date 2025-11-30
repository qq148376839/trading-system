import rateLimit from 'express-rate-limit';

/**
 * API请求限流中间件
 * 防止API被过度调用
 */
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 限制每个IP最多100次请求
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: '请求过于频繁，请稍后再试',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});


