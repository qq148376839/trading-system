#!/bin/bash
# 测试环境数据同步脚本
# 从生产 DB 导出配置表数据 → 导入测试 DB
#
# 用法: bash scripts/sync-test-db.sh
#
# 前提条件:
#   1. 生产容器 trading-postgres 正在运行
#   2. 测试容器 trading-postgres-test 正在运行（已通过 000_init_schema.sql 初始化）

set -euo pipefail

PROD_CONTAINER="trading-postgres"
TEST_CONTAINER="trading-postgres-test"
DB_USER="${POSTGRES_USER:-trading_user}"
DB_NAME="${POSTGRES_DB:-trading_db}"
DUMP_FILE="/tmp/test-db-seed.sql"

# 需要同步的配置表
CONFIG_TABLES=(
  "system_config"
  "admin_users"
  "capital_allocations"
  "strategies"
  "trading_rules"
  "watchlist"
  "stock_blacklist"
)

echo "=== 测试环境数据同步 ==="
echo ""

# 检查容器状态
for container in "$PROD_CONTAINER" "$TEST_CONTAINER"; do
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "[ERROR] 容器 ${container} 未运行"
    exit 1
  fi
done

echo "[1/4] 从生产 DB 导出配置表..."

TABLE_ARGS=""
for table in "${CONFIG_TABLES[@]}"; do
  TABLE_ARGS="$TABLE_ARGS -t $table"
done

docker exec "$PROD_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --data-only --disable-triggers $TABLE_ARGS > "$DUMP_FILE"

ROW_COUNT=$(wc -l < "$DUMP_FILE")
echo "   导出完成: ${ROW_COUNT} 行 SQL"

echo "[2/4] 清空测试 DB 配置表（保留表结构）..."

# 按外键依赖顺序清空（strategies 依赖 capital_allocations）
TRUNCATE_SQL="TRUNCATE TABLE strategies, trading_rules, watchlist, stock_blacklist, system_config, admin_users CASCADE; TRUNCATE TABLE capital_allocations CASCADE;"
docker exec "$TEST_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "$TRUNCATE_SQL" > /dev/null

echo "   清空完成"

echo "[3/4] 导入配置数据到测试 DB..."

docker exec -i "$TEST_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$DUMP_FILE" > /dev/null

echo "   导入完成"

echo "[4/4] 清理临时文件..."
rm -f "$DUMP_FILE"

echo ""
echo "=== 同步完成 ==="
echo ""
echo "!! 重要: 以下配置需要手动更新为模拟盘值 !!"
echo "   访问测试环境配置页面: http://<NAS_IP>:3003/config"
echo "   需要更新的 system_config 项:"
echo "     - longport_app_key"
echo "     - longport_app_secret"
echo "     - longport_access_token"
echo ""
echo "   或者通过 API 批量更新:"
echo "   curl -X POST http://<NAS_IP>:3003/api/config/batch \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Cookie: <admin_session>' \\"
echo "     -d '{\"configs\": [{\"key\": \"longport_app_key\", \"value\": \"<模拟盘key>\", \"encrypted\": true}, ...]}'"
echo ""
