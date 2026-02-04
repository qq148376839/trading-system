#!/bin/bash
# 深度诊断脚本

echo "=== 深度诊断 Docker 构建问题 ==="
echo ""

# 1. 检查 Docker daemon 日志
echo "1. 检查 Docker daemon 最近日志："
journalctl -u docker --no-pager -n 20 2>/dev/null || \
cat /var/log/docker.log 2>/dev/null | tail -20 || \
echo "无法访问 Docker 日志（可能需要 sudo）"
echo ""

# 2. 尝试在 /tmp 构建最小镜像
echo "2. 测试在 /tmp 目录构建（排除文件系统问题）："
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"
cat > Dockerfile <<'EOF'
FROM alpine:latest
RUN echo "Test"
EOF
echo "临时目录: $TMP_DIR"
timeout 5 docker build --no-cache . 2>&1
BUILD_RESULT=$?
cd - > /dev/null
rm -rf "$TMP_DIR"

if [ $BUILD_RESULT -eq 0 ]; then
    echo "✓ /tmp 目录构建成功 - 说明是原目录的问题"
elif [ $BUILD_RESULT -eq 124 ]; then
    echo "❌ /tmp 目录也超时 - 说明是 Docker daemon 的问题"
else
    echo "❌ 构建失败，错误码: $BUILD_RESULT"
fi
echo ""

# 3. 检查 Docker daemon 状态
echo "3. Docker daemon 详细状态："
docker info 2>&1 | grep -A 5 "Server Version\|Runtimes\|Default Runtime"
echo ""

# 4. 检查是否有其他 Docker 进程卡住
echo "4. 检查 Docker 相关进程："
ps aux | grep docker | grep -v grep
echo ""

# 5. 使用 strace 追踪（如果可用）
echo "5. 尝试追踪 docker build 调用："
if command -v strace > /dev/null; then
    timeout 3 strace -e trace=open,openat,stat -c docker build --no-cache -f - . <<'EOF' 2>&1 | tail -30
FROM alpine:latest
EOF
else
    echo "strace 不可用，跳过"
fi
echo ""

# 6. 检查文件描述符限制
echo "6. 检查系统限制："
ulimit -n
echo ""

# 7. 测试直接传递 tar 给 docker
echo "7. 测试直接传递构建上下文："
timeout 5 bash -c 'tar -czf - . 2>/dev/null | docker build --no-cache -f - - <<EOF
FROM alpine:latest
RUN echo "tar test"
EOF' 2>&1
echo ""

echo "=== 诊断完成 ==="
