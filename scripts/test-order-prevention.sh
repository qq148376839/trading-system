#!/bin/bash

# 订单重复提交防护机制 - 快速测试脚本
# 使用方法: ./scripts/test-order-prevention.sh

API_BASE="${API_BASE:-http://localhost:3001}"
TEST_SYMBOL="${TEST_SYMBOL:-ACHR.US}"

echo "=========================================="
echo "订单重复提交防护机制 - 快速测试"
echo "=========================================="
echo ""
echo "API Base: $API_BASE"
echo "Test Symbol: $TEST_SYMBOL"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查命令是否存在
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}错误: $1 命令未找到${NC}"
        exit 1
    fi
}

# 检查 API 服务
check_api() {
    echo "1. 检查 API 服务..."
    response=$(curl -s "$API_BASE/api/health")
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ API 服务运行正常${NC}"
        echo "$response" | jq '.' 2>/dev/null || echo "$response"
    else
        echo -e "${RED}✗ API 服务不可用${NC}"
        exit 1
    fi
    echo ""
}

# 查看监控指标
check_metrics() {
    echo "2. 查看监控指标..."
    response=$(curl -s "$API_BASE/api/order-prevention-metrics")
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ 监控指标 API 可用${NC}"
        echo "$response" | jq '.data.metrics' 2>/dev/null || echo "$response"
    else
        echo -e "${YELLOW}⚠ 监控指标 API 不可用（可能未启动）${NC}"
    fi
    echo ""
}

# 查看当前持仓
check_positions() {
    echo "3. 查看当前持仓..."
    response=$(curl -s "$API_BASE/api/positions")
    if [ $? -eq 0 ]; then
        position=$(echo "$response" | jq ".[] | select(.symbol == \"$TEST_SYMBOL\")" 2>/dev/null)
        if [ -n "$position" ]; then
            echo -e "${GREEN}✓ 找到测试标的持仓: $TEST_SYMBOL${NC}"
            echo "$position" | jq '.'
        else
            echo -e "${YELLOW}⚠ 未找到测试标的持仓: $TEST_SYMBOL${NC}"
            echo "可用持仓列表:"
            echo "$response" | jq '.[] | {symbol: .symbol, quantity: .quantity}' 2>/dev/null | head -10
        fi
    else
        echo -e "${RED}✗ 无法获取持仓信息${NC}"
    fi
    echo ""
}

# 查看今日订单
check_orders() {
    echo "4. 查看今日订单（$TEST_SYMBOL）..."
    response=$(curl -s "$API_BASE/api/orders/today")
    if [ $? -eq 0 ]; then
        orders=$(echo "$response" | jq "[.[] | select(.symbol == \"$TEST_SYMBOL\")]" 2>/dev/null)
        if [ -n "$orders" ] && [ "$orders" != "[]" ]; then
            echo -e "${GREEN}✓ 找到相关订单${NC}"
            echo "$orders" | jq '.[] | {order_id: .order_id, symbol: .symbol, side: .side, quantity: .quantity, status: .status}'
        else
            echo -e "${YELLOW}⚠ 未找到相关订单${NC}"
        fi
    else
        echo -e "${RED}✗ 无法获取订单信息${NC}"
    fi
    echo ""
}

# 检查数据库表
check_database() {
    echo "5. 检查数据库表..."
    if command -v psql &> /dev/null; then
        result=$(psql -U postgres -d trading_db -t -c "SELECT COUNT(*) FROM order_prevention_metrics;" 2>/dev/null)
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ 数据库表存在${NC}"
            echo "记录数: $result"
        else
            echo -e "${YELLOW}⚠ 无法连接数据库或表不存在${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ psql 命令不可用，跳过数据库检查${NC}"
    fi
    echo ""
}

# 主函数
main() {
    # 检查必要命令
    check_command curl
    check_command jq 2>/dev/null || echo -e "${YELLOW}警告: jq 未安装，JSON 输出可能不美观${NC}"
    
    # 执行检查
    check_api
    check_metrics
    check_positions
    check_orders
    check_database
    
    echo "=========================================="
    echo "测试完成"
    echo "=========================================="
    echo ""
    echo "下一步："
    echo "1. 执行功能测试用例（参考测试指南）"
    echo "2. 查看监控指标: curl $API_BASE/api/order-prevention-metrics"
    echo "3. 查看日志: grep '持仓验证\\|卖空持仓\\|交易推送' log.log"
}

# 运行主函数
main

