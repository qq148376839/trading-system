#!/bin/bash
# 统一启动脚本 - 同时运行前端和后端服务

set -e

echo "==================================="
echo "启动 Trading System (单容器模式)"
echo "==================================="

# 设置环境变量
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-3001}
export FRONTEND_PORT=${FRONTEND_PORT:-3000}

# 启动前端服务（Next.js standalone 模式）
echo "启动前端服务 (端口 $FRONTEND_PORT)..."
cd /app/frontend

# 检查 server.js 是否存在
if [ ! -f "server.js" ]; then
  echo "错误: /app/frontend/server.js 不存在"
  echo "尝试列出前端目录内容:"
  ls -la /app/frontend/
  exit 1
fi

# HOSTNAME=0.0.0.0 让 Next.js 监听所有接口，包括 localhost
HOSTNAME=0.0.0.0 PORT=$FRONTEND_PORT node server.js 2>&1 | tee /tmp/frontend.log &
FRONTEND_PID=$!
echo "前端服务已启动 (PID: $FRONTEND_PID)"

# 等待前端服务启动
sleep 3

# 检查前端是否启动成功
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
  echo "错误: 前端服务启动失败"
  echo "前端日志:"
  cat /tmp/frontend.log
  exit 1
fi

# 自动增量更新数据库表结构
# 000_init_schema.sql 全部使用 IF NOT EXISTS，可安全重复执行
# 已有表/索引会被跳过，新增的表会自动创建
echo "执行数据库表结构自动更新..."
cd /app/api
if [ -f "migrations/000_init_schema.sql" ] && [ -n "$DATABASE_URL" ]; then
  node -e "
    const { Pool } = require('pg');
    const fs = require('fs');
    (async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const sql = fs.readFileSync('migrations/000_init_schema.sql', 'utf8');
        await pool.query(sql);
        console.log('数据库表结构更新完成');
      } catch (err) {
        console.warn('数据库表结构更新失败（非致命）:', err.message);
      } finally {
        await pool.end();
      }
    })();
  "
else
  echo "跳过数据库更新（缺少迁移文件或 DATABASE_URL）"
fi

# 启动后端服务
echo "启动后端服务 (端口 $PORT)..."

# 如果存在 conditional-longport.js，使用它启动（兼容长桥SDK）
if [ -f "conditional-longport.js" ]; then
  echo "使用 conditional-longport.js 启动后端..."
  node conditional-longport.js 2>&1 | tee /tmp/api.log &
else
  # 否则直接启动
  echo "使用标准方式启动后端..."
  node dist/server.js 2>&1 | tee /tmp/api.log &
fi

API_PID=$!
echo "后端服务已启动 (PID: $API_PID)"

# 等待后端服务启动
sleep 2

# 检查后端是否启动成功
if ! kill -0 $API_PID 2>/dev/null; then
  echo "错误: 后端服务启动失败"
  echo "后端日志:"
  cat /tmp/api.log
  exit 1
fi

echo "==================================="
echo "所有服务已启动"
echo "前端: http://localhost:$FRONTEND_PORT"
echo "后端: http://localhost:$PORT"
echo "==================================="

# 信号处理函数
cleanup() {
  echo ""
  echo "接收到停止信号，关闭服务..."
  kill $FRONTEND_PID 2>/dev/null || true
  kill $API_PID 2>/dev/null || true
  echo "服务已停止"
  exit 0
}

# 注册信号处理
trap cleanup SIGTERM SIGINT

# 监控进程，如果任一服务退出，则退出容器
while true; do
  # 检查前端进程
  if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "前端服务已停止，退出容器"
    kill $API_PID 2>/dev/null || true
    exit 1
  fi

  # 检查后端进程
  if ! kill -0 $API_PID 2>/dev/null; then
    echo "后端服务已停止，退出容器"
    kill $FRONTEND_PID 2>/dev/null || true
    exit 1
  fi

  sleep 5
done
