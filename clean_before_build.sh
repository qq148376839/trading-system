#!/bin/bash
# 清理脚本 - 在 Docker 构建前执行

echo "=== 清理构建缓存和日志文件 ==="

# 删除 frontend 构建缓存
if [ -d "frontend/.next" ]; then
    echo "删除 frontend/.next/ 缓存..."
    rm -rf frontend/.next
    echo "✓ 已删除 frontend/.next/"
fi

# 删除旧日志文件
echo "删除旧日志文件..."
rm -f logs-*.json
echo "✓ 已删除日志文件"

# 删除其他构建产物
rm -rf dist/ build/ out/ 2>/dev/null
echo "✓ 已删除其他构建产物"

# 显示清理后的目录大小
echo ""
echo "=== 清理后的目录大小 ==="
du -sh .
echo ""
echo "=== 前10大文件/目录 ==="
du -sh * .git 2>/dev/null | sort -hr | head -10

echo ""
echo "✓ 清理完成！现在可以执行 docker build"
