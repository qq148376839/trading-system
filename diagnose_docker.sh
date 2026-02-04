#!/bin/bash
# Docker 构建诊断脚本

echo "=== Docker 构建诊断 ==="
echo ""

# 1. 检查 Docker 版本和状态
echo "1. Docker 版本信息："
docker version 2>&1 | head -10
echo ""

# 2. 检查 Docker daemon 状态
echo "2. Docker 系统信息："
docker info 2>&1 | grep -E "Storage Driver|Logging Driver|Cgroup|Operating System" || echo "Docker daemon 可能有问题"
echo ""

# 3. 模拟构建上下文大小（不实际构建）
echo "3. 构建上下文文件统计："
echo "文件总数: $(find . -type f 2>/dev/null | wc -l)"
echo "目录总数: $(find . -type d 2>/dev/null | wc -l)"
echo "符号链接: $(find . -type l 2>/dev/null | wc -l)"
echo ""

# 4. 检查是否有大文件
echo "4. 检查大文件 (>5M)："
find . -type f -size +5M 2>/dev/null || echo "无大文件"
echo ""

# 5. 测试简单 Dockerfile
echo "5. 测试最小 Dockerfile（10秒超时）："
timeout 10 docker build --no-cache -f - . <<'EOF' 2>&1
FROM alpine:latest
RUN echo "Test successful"
EOF
RESULT=$?
if [ $RESULT -eq 124 ]; then
    echo "❌ 超时！构建上下文发送阶段卡住"
elif [ $RESULT -eq 0 ]; then
    echo "✓ 构建成功"
else
    echo "❌ 构建失败，错误码: $RESULT"
fi
echo ""

# 6. 检查 NAS 挂载点特性
echo "6. 当前目录文件系统信息："
df -h . | tail -1
echo ""

# 7. 尝试使用 BuildKit
echo "7. 测试 BuildKit 模式（10秒超时）："
timeout 10 DOCKER_BUILDKIT=1 docker build --progress=plain --no-cache -f - . <<'EOF' 2>&1 | head -20
FROM alpine:latest
RUN echo "BuildKit test"
EOF
RESULT=$?
if [ $RESULT -eq 124 ]; then
    echo "❌ BuildKit 模式也超时"
elif [ $RESULT -eq 0 ]; then
    echo "✓ BuildKit 模式可用"
fi
echo ""

echo "=== 诊断完成 ==="
