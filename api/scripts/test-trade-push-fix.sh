#!/bin/bash
# 测试交易推送修复脚本

echo "=========================================="
echo "交易推送修复测试"
echo "=========================================="
echo ""

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "错误: 请在 api 目录下运行此脚本"
    exit 1
fi

# 检查 ts-node 是否安装
if ! command -v ts-node &> /dev/null; then
    echo "安装 ts-node..."
    npm install -g ts-node typescript
fi

# 运行测试
echo "运行测试脚本..."
echo ""

npx ts-node scripts/test-trade-push-fix.ts

exit_code=$?

echo ""
if [ $exit_code -eq 0 ]; then
    echo "✅ 所有测试通过！"
else
    echo "❌ 测试失败，退出码: $exit_code"
fi

exit $exit_code




