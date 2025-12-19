import { Pool } from 'pg';
import dotenv from 'dotenv';

// 简单加载.env文件（与旧版本保持一致）
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 40, // 增加到40，支持更多并发连接（20个标的 + 其他服务）
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // 增加到10秒，避免连接超时
});

// 测试数据库连接
pool.on('connect', () => {
  // 只在非测试环境输出日志，避免测试完成后输出日志
  if (process.env.NODE_ENV !== 'test') {
    console.log('Database connected');
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // 在测试环境中不退出进程
  if (process.env.NODE_ENV !== 'test') {
    process.exit(-1);
  }
});

export default pool;


