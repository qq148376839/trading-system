#!/bin/bash

# 简化版部署脚本 - 用于单容器部署架构

set -e

echo "========================================="
echo "开始部署 Trading System (单容器架构)"
echo "========================================="

# 进入项目目录
cd /volume1/docker/trading-system

# 清理可能存在的旧容器
echo "停止并清理旧容器..."
docker-compose down -v || true

# 清理构建缓存
echo "清理构建缓存..."
docker builder prune -f || true

# 删除可能引起冲突的 node_modules 目录
echo "清理 node_modules 目录..."
rm -rf api/node_modules frontend/node_modules api/dist

# 确保日志目录存在
mkdir -p logs

echo "开始构建镜像..."
# 使用 --no-cache 确保从头开始构建
time docker build -t trading-system:latest . --no-cache

echo "启动服务..."
docker-compose up -d

echo "等待服务启动..."
sleep 10

# 检查容器状态
echo "检查容器状态:"
docker-compose ps

echo "显示容器日志:"
docker-compose logs app

echo "========================================="
echo "部署完成"
echo "========================================="