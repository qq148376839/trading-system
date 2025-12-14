#!/bin/bash
# 初始化本地 PostgreSQL 数据库

echo "正在创建数据库和用户..."

# 创建数据库
psql -h localhost -U postgres -c "CREATE DATABASE trading_db;" 2>&1 | grep -v "already exists" || echo "数据库已存在或创建成功"

# 创建用户（如果不存在）
psql -h localhost -U postgres -c "CREATE USER trading_user WITH PASSWORD 'trading_password';" 2>&1 | grep -v "already exists" || echo "用户已存在或创建成功"

# 授予权限
psql -h localhost -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE trading_db TO trading_user;" 2>&1

# 初始化数据库 schema
echo "正在初始化数据库 schema..."
psql -h localhost -U postgres -d trading_db -f api/migrations/000_init_schema.sql

echo "✅ 数据库初始化完成！"
echo ""
echo "现在可以使用以下 DATABASE_URL："
echo "DATABASE_URL=postgresql://trading_user:trading_password@localhost:5432/trading_db"
