import rateLimit from 'express-rate-limit';

/**
 * API请求限流中间件
 * 防止API被过度调用
 *
 * 配额说明：前端回测页面轮询状态 (~2次/s) + 正常操作，
 * 15分钟内轻松达到 500+ 请求，100 的旧值会导致回测期间全站 429。
 * 1000/15min ≈ 1.1 req/s 平均，足以防爬虫/滥用，不影响正常使用。
 */
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 1000, // 限制每个IP最多1000次请求
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


