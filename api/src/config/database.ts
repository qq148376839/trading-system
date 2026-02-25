import { Pool } from 'pg';
import dotenv from 'dotenv';
import { infraLogger } from '../utils/infra-logger';

// 简单加载.env文件（与旧版本保持一致）
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 40, // 增加到40，支持更多并发连接（20个标的 + 其他服务）
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // 增加到10秒，避免连接超时
});

// 测试数据库连接
let dbFirstConnect = true;
pool.on('connect', () => {
  // 只在非测试环境输出日志，避免测试完成后输出日志
  if (process.env.NODE_ENV !== 'test') {
    if (dbFirstConnect) {
      infraLogger.info('Database connected');
      dbFirstConnect = false;
    } else {
      infraLogger.debug('Database new connection established');
    }
  }
});

pool.on('error', (err) => {
  infraLogger.error('Unexpected error on idle client', err);
  // H12 修复：不再直接 process.exit — 瞬断不应杀死整个进程
  // pg Pool 会自动移除出错的连接并在下次请求时创建新连接
  // 仅记录错误，让连接池自愈
});

export default pool;


