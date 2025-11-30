#!/bin/bash

# 交易系统依赖安装脚本
# 适用于 Mac 和 Linux 环境

set -e

echo "🚀 开始安装交易系统依赖..."

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js (推荐 v20+)"
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"
echo "✅ npm 版本: $(npm -v)"

# 安装 API 依赖
echo ""
echo "📦 安装 API 依赖..."
cd api
if [ -f "package-lock.json" ]; then
    npm ci
else
    npm install
fi
cd ..

# 安装 Frontend 依赖
echo ""
echo "📦 安装 Frontend 依赖..."
cd frontend
if [ -f "package-lock.json" ]; then
    npm ci
else
    npm install
fi
cd ..

echo ""
echo "✅ 所有依赖安装完成！"
echo ""
echo "📝 下一步："
echo "   1. 配置数据库连接（api/.env）"
echo "   2. 配置 API 地址（frontend/.env.local）"
echo "   3. 运行数据库迁移脚本"
echo "   4. 启动服务: cd api && npm run dev"
echo ""

