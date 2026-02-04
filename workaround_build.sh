#!/bin/bash
# 绕过问题的构建方案

set -e

echo "=== 方案：复制到临时目录构建 ==="
echo ""

# 创建临时构建目录
BUILD_DIR="/tmp/trading-system-build-$$"
echo "创建临时构建目录: $BUILD_DIR"
mkdir -p "$BUILD_DIR"

# 清理函数
cleanup() {
    echo "清理临时目录..."
    rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

echo "复制必要文件到临时目录..."
# 复制必要的文件，排除不需要的
rsync -av \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='.next/' \
    --exclude='dist/' \
    --exclude='build/' \
    --exclude='logs-*.json' \
    --exclude='*.log' \
    ./ "$BUILD_DIR/" || {
    echo "❌ rsync 不可用，尝试使用 cp"
    cp -r . "$BUILD_DIR/"
    # 删除不需要的目录
    rm -rf "$BUILD_DIR/.git" \
           "$BUILD_DIR/node_modules" \
           "$BUILD_DIR/frontend/.next" \
           "$BUILD_DIR/dist" \
           "$BUILD_DIR/build" \
           "$BUILD_DIR/logs-"*.json 2>/dev/null || true
}

echo "临时目录大小:"
du -sh "$BUILD_DIR"
echo ""

echo "在临时目录构建 Docker 镜像..."
cd "$BUILD_DIR"
docker build --no-cache -t trading-system:latest .

echo ""
echo "✓ 构建成功！"
docker images | grep trading-system

cd - > /dev/null
