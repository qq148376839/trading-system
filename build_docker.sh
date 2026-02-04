#!/bin/bash
# Docker 构建脚本 - 避开 .git 目录问题

set -e

echo "=== 准备 Docker 构建环境 ==="

# 备份 .git
if [ -d ".git" ]; then
    echo "临时重命名 .git 目录..."
    mv .git .git.backup
    GIT_RENAMED=1
fi

# 捕获退出信号，确保恢复 .git
trap 'if [ "$GIT_RENAMED" = "1" ]; then echo "恢复 .git 目录..."; mv .git.backup .git; fi' EXIT

echo ""
echo "=== 开始 Docker 构建 ==="
docker build --no-cache -t trading-system:latest .

echo ""
echo "✓ 构建成功！"
docker images | grep trading-system
