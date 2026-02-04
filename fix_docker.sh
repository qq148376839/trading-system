#!/bin/bash
# 修复卡住的 Docker 构建

echo "=== 修复 Docker 构建阻塞问题 ==="
echo ""

# 1. 查找卡住的 docker build 进程
echo "1. 查找卡住的 Docker 构建进程:"
ps aux | grep -E "docker.*build|docker-compose.*build" | grep -v grep
echo ""

# 2. 杀掉卡住的进程
echo "2. 终止卡住的进程..."
pkill -9 -f "docker-compose build" || echo "没有找到 docker-compose build 进程"
pkill -9 -f "docker build" || echo "没有找到 docker build 进程"
sleep 2
echo ""

# 3. 检查是否还有残留进程
echo "3. 检查残留进程:"
REMAINING=$(ps aux | grep -E "docker.*build|docker-compose.*build" | grep -v grep | wc -l)
if [ $REMAINING -gt 0 ]; then
    echo "❌ 还有 $REMAINING 个进程残留"
    ps aux | grep -E "docker.*build|docker-compose.*build" | grep -v grep
else
    echo "✓ 所有卡住的进程已清理"
fi
echo ""

# 4. 测试构建
echo "4. 测试快速构建:"
timeout 10 docker build --no-cache -f - . <<'EOF' 2>&1
FROM alpine:latest
RUN echo "Test successful"
EOF

BUILD_RESULT=$?
echo ""
if [ $BUILD_RESULT -eq 0 ]; then
    echo "✓✓✓ 问题已解决！现在可以正常构建了"
elif [ $BUILD_RESULT -eq 124 ]; then
    echo "❌ 还是超时，可能需要重启 Docker daemon"
    echo ""
    echo "请执行以下命令重启 Docker:"
    echo "  sudo synoservicectl --restart pkgctl-ContainerManager"
    echo "或者"
    echo "  sudo systemctl restart docker"
else
    echo "❌ 构建失败，错误码: $BUILD_RESULT"
fi
