# 数据库初始化脚本使用说明

## 使用方法

1. 确保PostgreSQL数据库已创建：
```bash
createdb trading_db
```

2. 按顺序运行所有迁移脚本：

**注意：** 根据你的 PostgreSQL 安装方式，可能需要使用不同的用户名：
- **Homebrew 安装（Mac）：** 使用当前系统用户（通常是你的用户名，如 `rio`）
- **标准安装：** 使用 `postgres` 用户
- **Docker：** 使用容器内配置的用户（通常是 `trading_user`）

```bash
# 方式 1：使用 psql 命令行（自动使用当前系统用户）
psql -d trading_db -f migrations/001_initial_schema.sql
psql -d trading_db -f migrations/002_add_positions_and_trading_rules.sql
psql -d trading_db -f migrations/003_config_management.sql
psql -d trading_db -f migrations/004_add_token_auto_refresh_config.sql
psql -d trading_db -f migrations/005_quant_trading_schema.sql
psql -d trading_db -f migrations/006_add_option_quote_config.sql

# 方式 2：指定用户名（如果需要）
psql -U your_username -d trading_db -f migrations/001_initial_schema.sql
# ... 其他脚本

# 方式 3：在 psql 中执行
psql -d trading_db
\i migrations/001_initial_schema.sql
\i migrations/002_add_positions_and_trading_rules.sql
\i migrations/003_config_management.sql
\i migrations/004_add_token_auto_refresh_config.sql
\i migrations/005_quant_trading_schema.sql
\i migrations/006_add_option_quote_config.sql
```

**常见错误：**
- `role "postgres" does not exist`：使用当前系统用户，省略 `-U` 参数，或使用 `psql -U $(whoami) -d trading_db`
- `database "trading_db" does not exist`：先创建数据库：`createdb trading_db`

3. **创建管理员账户**（运行 `003_config_management.sql` 后必须执行）：
```bash
# 本地环境
cd api
node scripts/create-admin.js admin your_password

# Docker 环境
docker-compose exec api node scripts/create-admin.js admin your_password
```

**详细说明请参考：** `api/scripts/CREATE_ADMIN.md`

## 表结构说明

### watchlist（关注股票列表）
- `id`: 主键
- `symbol`: 标的代码（唯一索引）
- `enabled`: 是否启用
- `created_at`: 创建时间
- `updated_at`: 更新时间

### quotes（行情数据历史）
- `id`: 主键
- `symbol`: 标的代码（索引）
- `last_done`: 最新价
- `prev_close`: 昨收价
- `open`: 开盘价
- `high`: 最高价
- `low`: 最低价
- `volume`: 成交量
- `turnover`: 成交额
- `timestamp`: 时间戳（索引）
- `trade_status`: 交易状态

### trades（交易记录）
- `id`: 主键
- `symbol`: 标的代码（索引）
- `side`: 交易方向（BUY/SELL）
- `quantity`: 数量
- `price`: 价格
- `status`: 状态（PENDING/SUCCESS/FAILED/CANCELLED）
- `order_id`: 订单ID
- `error_message`: 错误信息
- `created_at`: 创建时间（索引）
- `updated_at`: 更新时间

### settings（用户配置）
- `id`: 主键
- `key`: 配置键（唯一索引）
- `value`: 配置值
- `updated_at`: 更新时间

## 迁移脚本说明

### 001_initial_schema.sql
创建基础表结构：watchlist、quotes、trades、settings

### 002_add_positions_and_trading_rules.sql
添加持仓表和交易规则表

### 003_config_management.sql ⚠️ 重要
创建配置管理和管理员账户表：
- `system_config`: 系统配置表
- `admin_users`: 管理员账户表

**运行此脚本后，必须创建管理员账户才能使用配置管理功能！**

### 004_add_token_auto_refresh_config.sql
添加 Token 自动刷新配置项

### 005_quant_trading_schema.sql
创建量化交易相关表结构

### 006_add_option_quote_config.sql
添加期权行情查询配置项：
- `longport_enable_option_quote`: 控制是否启用长桥 API 的期权查询（默认 false，使用富途 API）

## Docker 环境

如果使用 Docker，迁移脚本会在数据库容器首次启动时自动执行（通过 `docker-entrypoint-initdb.d` 目录）。

创建管理员账户：
```bash
docker-compose exec api node scripts/create-admin.js admin your_password
```


