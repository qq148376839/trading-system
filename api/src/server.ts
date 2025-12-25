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
import backtestRouter from './routes/backtest';
import { orderPreventionMetricsRouter } from './routes/order-prevention-metrics';
import { logsRouter } from './routes/logs';
import { tradingDaysRouter } from './routes/trading-days';
import { errorHandler } from './middleware/errorHandler';

// Swagger 文档配置
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';

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
// 增加 JSON 解析限制，支持更大的回测结果
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 路由
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
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
app.use('/api/quant/backtest', backtestRouter);
app.use('/api/order-prevention-metrics', orderPreventionMetricsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/trading-days', tradingDaysRouter);
app.use('/api/health', healthRouter);

// 错误处理中间件
app.use(errorHandler);

// 启动服务器
const server = app.listen(PORT, '0.0.0.0', () => {
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

  // 启动交易推送服务（推荐，解决竞态条件）
  setTimeout(async () => {
    try {
      const tradePushService = (await import('./services/trade-push.service')).default;
      await tradePushService.initialize();
      if (tradePushService.isActive()) {
        console.log('交易推送服务已启动（实时订单状态更新）');
      } else {
        console.warn('交易推送服务启动失败，将降级到轮询模式');
      }
    } catch (error: any) {
      console.warn('启动交易推送服务失败:', error.message);
      console.warn('系统将降级到轮询模式（trackPendingOrders）');
    }
  }, 6000);

  // 启动日志系统
  setTimeout(async () => {
    try {
      const logService = (await import('./services/log.service')).default;
      const logWorkerService = (await import('./services/log-worker.service')).default;
      const logCleanupService = (await import('./services/log-cleanup.service')).default;
      
      // 设置工作线程的队列获取器
      logWorkerService.setLogQueueGetter(() => logService.getQueue());
      
      // 启动日志工作线程（异步加载配置）
      await logWorkerService.start();
      
      // 初始化日志清理服务（异步加载配置）
      await logCleanupService.init();
      
      console.log('日志系统已启动（非阻塞、结构化、持久化）');
    } catch (error: any) {
      console.error('启动日志系统失败:', error.message);
      console.error('日志将仅输出到控制台，不会持久化到数据库');
    }
  }, 1000);
});

// 优雅关闭处理
const gracefulShutdown = async (signal: string) => {
  console.log(`\n收到 ${signal} 信号，开始优雅关闭...`);
  
  // 1. 停止接受新请求
  server.close(() => {
    console.log('HTTP服务器已关闭');
  });

  // 2. 取消订阅交易推送
  try {
    const tradePushService = (await import('./services/trade-push.service')).default;
    if (tradePushService.isActive()) {
      await tradePushService.unsubscribe();
      console.log('交易推送服务已取消订阅');
    }
  } catch (error: any) {
    console.error('取消订阅交易推送失败:', error.message);
  }

  // 3. 停止策略调度器
  try {
    const strategyScheduler = (await import('./services/strategy-scheduler.service')).default;
    await strategyScheduler.stop();
    console.log('策略调度器已停止');
  } catch (error: any) {
    console.error('停止策略调度器失败:', error.message);
  }

  // 4. 停止日志工作线程
  try {
    const logWorkerService = (await import('./services/log-worker.service')).default;
    logWorkerService.stop();
    console.log('日志工作线程已停止');
  } catch (error: any) {
    console.error('停止日志工作线程失败:', error.message);
  }

  // 5. 关闭数据库连接
  try {
    const pool = (await import('./config/database')).default;
    await pool.end();
    console.log('数据库连接已关闭');
  } catch (error: any) {
    console.error('关闭数据库连接失败:', error.message);
  }

  console.log('优雅关闭完成');
  process.exit(0);
};

// 注册信号处理器
process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch(err => {
    console.error('优雅关闭失败:', err);
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch(err => {
    console.error('优雅关闭失败:', err);
    process.exit(1);
  });
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  gracefulShutdown('uncaughtException').catch(err => {
    console.error('优雅关闭失败:', err);
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  gracefulShutdown('unhandledRejection').catch(err => {
    console.error('优雅关闭失败:', err);
    process.exit(1);
  });
});

export default app;

