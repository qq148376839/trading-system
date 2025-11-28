import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { quoteRouter } from './routes/quote';
import { candlesticksRouter } from './routes/candlesticks';
import { watchlistRouter } from './routes/watchlist';
import { tradesRouter } from './routes/trades';
import { healthRouter } from './routes/health';
import { positionsRouter } from './routes/positions';
import { tradingRulesRouter } from './routes/trading-rules';
import { ordersRouter } from './routes/orders';
import { forexRouter } from './routes/forex';
import { tradingRecommendationRouter } from './routes/trading-recommendation';
import { futunnTestRouter } from './routes/futunn-test';
import { configRouter } from './routes/config';
import { tokenRefreshRouter } from './routes/token-refresh';
import { optionsRouter } from './routes/options';
import { quantRouter } from './routes/quant';
import { errorHandler } from './middleware/errorHandler';

// 加载环境变量（明确指定路径）
const envPath = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('警告: 无法加载.env文件:', result.error.message);
  console.warn('尝试使用系统环境变量...');
} else {
  console.log('成功加载.env文件:', envPath);
}

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 路由
app.use('/api/quote', quoteRouter);
app.use('/api/candlesticks', candlesticksRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/positions', positionsRouter);
app.use('/api/trading-rules', tradingRulesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/forex', forexRouter);
app.use('/api/trading-recommendation', tradingRecommendationRouter);
app.use('/api/futunn-test', futunnTestRouter);
app.use('/api/config', configRouter);
app.use('/api/token-refresh', tokenRefreshRouter);
app.use('/api/options', optionsRouter);
app.use('/api/quant', quantRouter);
app.use('/api/health', healthRouter);

// 错误处理中间件
app.use(errorHandler);

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
  
  // 启动时检查并自动刷新Token（如果需要）
  // 延迟执行，确保数据库连接已建立
  setTimeout(async () => {
    try {
      const tokenRefreshService = (await import('./services/token-refresh.service')).default;
      await tokenRefreshService.autoRefreshIfNeeded();
    } catch (error: any) {
      console.warn('启动时Token刷新检查失败:', error.message);
    }
  }, 2000);

  // 设置定时任务：每天凌晨2点检查Token状态
  // 注意：如果使用Docker，确保容器内有时区设置（设置TZ环境变量）
  try {
    const cron = require('node-cron');
    // 使用UTC时间，避免时区问题
    // 如果需要特定时区，可以在Docker中设置TZ环境变量
    cron.schedule('0 2 * * *', async () => {
      try {
        console.log('执行定时Token刷新检查...');
        const tokenRefreshService = (await import('./services/token-refresh.service')).default;
        const refreshed = await tokenRefreshService.autoRefreshIfNeeded();
        if (refreshed) {
          console.log('Token已通过定时任务自动刷新');
        }
      } catch (error: any) {
        console.error('定时Token刷新失败:', error.message);
      }
    }, {
      timezone: process.env.TZ || 'UTC', // 支持时区设置
    });
    console.log(`Token自动刷新任务已启动（每天凌晨2点检查，时区: ${process.env.TZ || 'UTC'}）`);
  } catch (error: any) {
    console.warn('无法启动定时任务（node-cron未安装）:', error.message);
    console.warn('请运行: npm install node-cron @types/node-cron');
  }

  // 启动账户余额同步服务（每5分钟同步一次）
  setTimeout(async () => {
    try {
      const accountBalanceSyncService = (await import('./services/account-balance-sync.service')).default;
      accountBalanceSyncService.startPeriodicSync(5); // 5分钟间隔
    } catch (error: any) {
      console.warn('启动账户余额同步服务失败:', error.message);
    }
  }, 3000);

  // 启动策略调度器
  setTimeout(async () => {
    try {
      const strategyScheduler = (await import('./services/strategy-scheduler.service')).default;
      await strategyScheduler.start();
    } catch (error: any) {
      console.warn('启动策略调度器失败:', error.message);
    }
  }, 5000);
});

export default app;

