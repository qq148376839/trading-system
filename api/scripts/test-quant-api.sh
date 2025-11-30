#!/bin/bash

# 量化交易 API 测试脚本 (curl 版本)
# 用于快速测试 API 端点

BASE_URL="${API_URL:-http://localhost:3001}"
API_PREFIX="/api/quant"

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() {
    echo -e "${1}${2}${NC}"
}

log_info() {
    log "${CYAN}" "ℹ $1"
}

log_success() {
    log "${GREEN}" "✓ $1"
}

log_error() {
    log "${RED}" "✗ $1"
}

log_warning() {
    log "${YELLOW}" "⚠ $1"
}

log_section() {
    echo ""
    log "${YELLOW}" "--- $1 ---"
    echo ""
}

# 测试函数
test_api() {
    local name=$1
    local method=$2
    local url=$3
    local data=$4
    
    log_info "Testing: $name"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "${BASE_URL}${url}")
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}${url}" \
            -H "Content-Type: application/json" \
            -d "$data")
    elif [ "$method" = "DELETE" ]; then
        response=$(curl -s -w "\n%{http_code}" -X DELETE "${BASE_URL}${url}")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        log_success "$name - Status: $http_code"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
        return 0
    else
        log_error "$name - Status: $http_code"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
        return 1
    fi
}

echo ""
log "${BLUE}" "=== 量化交易 API 测试工具 ==="
echo ""
log_info "Base URL: $BASE_URL"
echo ""

# 资金管理 API
log_section "资金管理 API"

test_api "GET /capital/allocations" "GET" "${API_PREFIX}/capital/allocations"

ALLOCATION_DATA='{"name":"TEST_STRATEGY_A","parentId":null,"allocationType":"PERCENTAGE","allocationValue":0.3}'
test_api "POST /capital/allocations" "POST" "${API_PREFIX}/capital/allocations" "$ALLOCATION_DATA"

test_api "GET /capital/usage" "GET" "${API_PREFIX}/capital/usage"
test_api "POST /capital/sync-balance" "POST" "${API_PREFIX}/capital/sync-balance"
test_api "GET /capital/balance-discrepancies" "GET" "${API_PREFIX}/capital/balance-discrepancies"

# 选股器 API
log_section "选股器 API"

test_api "GET /stock-selector/blacklist" "GET" "${API_PREFIX}/stock-selector/blacklist"

BLACKLIST_DATA='{"symbol":"TEST.US","reason":"Test blacklist entry"}'
test_api "POST /stock-selector/blacklist" "POST" "${API_PREFIX}/stock-selector/blacklist" "$BLACKLIST_DATA"

test_api "DELETE /stock-selector/blacklist/TEST.US" "DELETE" "${API_PREFIX}/stock-selector/blacklist/TEST.US"

# 策略管理 API
log_section "策略管理 API"

test_api "GET /strategies" "GET" "${API_PREFIX}/strategies"

STRATEGY_DATA='{
  "name":"Test Recommendation Strategy",
  "type":"RECOMMENDATION_V1",
  "symbolPoolConfig":{"mode":"STATIC","symbols":["AAPL.US","MSFT.US"]},
  "config":{"atrPeriod":14,"atrMultiplier":2.0,"riskRewardRatio":1.5}
}'
test_api "POST /strategies" "POST" "${API_PREFIX}/strategies" "$STRATEGY_DATA"

# 信号日志 API
log_section "信号日志 API"

test_api "GET /signals" "GET" "${API_PREFIX}/signals?limit=10"

# 交易记录 API
log_section "交易记录 API"

test_api "GET /trades" "GET" "${API_PREFIX}/trades?limit=10"

echo ""
log "${BLUE}" "=== 测试完成 ==="
echo ""

