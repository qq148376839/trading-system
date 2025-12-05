# 数据库初始化脚本使用说明

> **重要更新**：所有历史迁移脚本（001-007）已移动到 `archive/` 目录。  
> **新项目请使用 `000_init_schema.sql` 统一初始化脚本。**

## 快速开始

### 新项目初始化

**只需运行一个脚本即可完成所有数据库初始化：**

```bash
# 1. 创建数据库
createdb trading_db

# 2. 运行统一初始化脚本
psql -d trading_db -f migrations/000_init_schema.sql

# 3. 创建管理员账户
cd api
node scripts/create-admin.js admin your_password
```

### 已有项目更新

**统一初始化脚本使用 `IF NOT EXISTS` 和 `ON CONFLICT`，可安全重复运行：**

```bash
# 直接运行，不会影响已有数据
psql -d trading_db -f migrations/000_init_schema.sql
```

## 脚本说明

### 000_init_schema.sql（推荐使用）

**统一初始化脚本**，包含所有表结构和配置：
- ✅ 新项目：直接运行即可完成初始化
- ✅ 已有项目：可安全重复运行，不会影响已有数据
- ✅ 包含所有迁移内容（001-009）

**特点：**
- 所有 `CREATE TABLE` 使用 `IF NOT EXISTS`
- 所有 `CREATE INDEX` 使用 `IF NOT EXISTS`
- 所有 `INSERT` 使用 `ON CONFLICT DO NOTHING` 或 `ON CONFLICT DO UPDATE`
- 触发器使用 `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`

### 历史迁移脚本（已归档）

开发过程中的迭代迁移脚本（001-007）已移动到 `archive/` 目录：
- `archive/001_initial_schema.sql` - 基础表结构
- `archive/002_add_positions_and_trading_rules.sql` - 持仓和交易规则表
- `archive/003_config_management.sql` - 配置管理表
- `archive/004_add_token_auto_refresh_config.sql` - Token自动刷新配置
- `archive/005_quant_trading_schema.sql` - 量化交易系统表
- `archive/006_add_option_quote_config.sql` - 期权行情配置
- `archive/007_add_futunn_search_cookies.sql` - 富途搜索Cookies配置

**注意：** 
- 新项目请使用 `000_init_schema.sql`，不要使用归档目录中的脚本
- 归档脚本仅作为历史记录保留，不建议在新项目中使用
- 008和009（回测相关）已合并到 `000_init_schema.sql` 中

## 表结构说明

### 基础表

#### watchlist（关注股票列表）
- `id`: 主键
- `symbol`: 标的代码（唯一索引）
- `enabled`: 是否启用
- `created_at`: 创建时间
- `updated_at`: 更新时间

#### quotes（行情数据历史）
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

#### trades（交易记录）
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

#### settings（用户配置）
- `id`: 主键
- `key`: 配置键（唯一索引）
- `value`: 配置值
- `updated_at`: 更新时间

#### positions（持仓表）
- `id`: 主键
- `symbol`: 标的代码（唯一索引）
- `symbol_name`: 标的名称
- `quantity`: 持仓数量
- `available_quantity`: 可用数量
- `cost_price`: 成本价
- `current_price`: 当前价
- `market_value`: 市值
- `unrealized_pl`: 未实现盈亏
- `unrealized_pl_ratio`: 未实现盈亏比例
- `currency`: 币种
- `position_side`: 持仓方向（Long/Short）

#### trading_rules（交易规则表）
- `id`: 主键
- `symbol`: 标的代码
- `rule_name`: 规则名称
- `rule_type`: 规则类型
- `enabled`: 是否启用
- `config`: 规则配置（JSONB）
- `created_at`: 创建时间
- `updated_at`: 更新时间

### 配置管理表

#### system_config（系统配置表）
- `id`: 主键
- `config_key`: 配置键（唯一索引）
- `config_value`: 配置值
- `encrypted`: 是否加密
- `description`: 描述
- `updated_at`: 更新时间
- `updated_by`: 更新人

**默认配置项：**
- `longport_app_key`: LongPort API App Key
- `longport_app_secret`: LongPort API App Secret
- `longport_access_token`: LongPort API Access Token
- `longport_token_expired_at`: Token过期时间
- `longport_token_issued_at`: Token签发时间
- `longport_enable_overnight`: 是否启用美股盘后交易
- `longport_token_auto_refresh`: 是否启用Token自动刷新
- `longport_enable_option_quote`: 是否启用长桥API期权查询
- `futunn_csrf_token`: 富途API CSRF Token
- `futunn_cookies`: 富途API Cookies
- `futunn_search_cookies`: 富途搜索API Cookies
- `server_port`: API服务器端口

#### admin_users（管理员账户表）
- `id`: 主键
- `username`: 用户名（唯一索引）
- `password_hash`: 密码哈希
- `created_at`: 创建时间
- `last_login_at`: 最后登录时间
- `is_active`: 是否激活

### 量化交易系统表

#### capital_allocations（资金分配表）
- `id`: 主键
- `name`: 账户名称
- `parent_id`: 父账户ID（支持层级结构）
- `allocation_type`: 分配类型（PERCENTAGE/FIXED_AMOUNT）
- `allocation_value`: 分配值
- `current_usage`: 当前使用量
- `created_at`: 创建时间
- `updated_at`: 更新时间

#### strategies（策略配置表）
- `id`: 主键
- `name`: 策略名称
- `type`: 策略类型
- `capital_allocation_id`: 资金分配账户ID
- `symbol_pool_config`: 标的池配置（JSONB）
- `config`: 策略配置（JSONB）
- `status`: 状态（RUNNING/STOPPED/PAUSED/ERROR）
- `created_at`: 创建时间
- `updated_at`: 更新时间

#### strategy_instances（策略实例状态表）
- `id`: 主键
- `strategy_id`: 策略ID
- `symbol`: 标的代码
- `current_state`: 当前状态（IDLE/OPENING/HOLDING/CLOSING/COOLDOWN）
- `context`: 上下文数据（JSONB）
- `last_updated`: 最后更新时间

#### strategy_signals（策略信号日志表）
- `id`: 主键
- `strategy_id`: 策略ID
- `symbol`: 标的代码
- `signal_type`: 信号类型（BUY/SELL）
- `price`: 价格
- `reason`: 原因
- `metadata`: 元数据（JSONB）
- `status`: 状态（PENDING/EXECUTED/REJECTED/IGNORED）
- `created_at`: 创建时间

#### auto_trades（自动交易记录表）
- `id`: 主键
- `strategy_id`: 策略ID
- `symbol`: 标的代码
- `side`: 交易方向（BUY/SELL）
- `quantity`: 数量
- `avg_price`: 平均价格
- `pnl`: 盈亏
- `fees`: 手续费
- `estimated_fees`: 预估手续费
- `status`: 状态（FILLED/PARTIALLY_FILLED）
- `open_time`: 开仓时间
- `close_time`: 平仓时间
- `order_id`: 订单ID
- `charge_detail`: 费用详情（JSONB）

#### execution_orders（执行订单状态表）
- `id`: 主键
- `strategy_id`: 策略ID
- `symbol`: 标的代码
- `order_id`: 订单ID（唯一）
- `client_order_id`: 客户端订单ID
- `side`: 交易方向
- `quantity`: 数量
- `price`: 价格
- `current_status`: 当前状态
- `execution_stage`: 执行阶段
- `created_at`: 创建时间
- `updated_at`: 更新时间

#### stock_blacklist（股票黑名单表）
- `id`: 主键
- `symbol`: 标的代码（唯一）
- `reason`: 原因
- `created_at`: 创建时间
- `created_by`: 创建人

#### backtest_results（回测结果表）
- `id`: 主键
- `strategy_id`: 策略ID（外键，级联删除）
- `start_date`: 回测开始日期
- `end_date`: 回测结束日期
- `config`: 回测配置（JSONB）
- `result`: 回测结果（JSONB）
- `status`: 回测状态（PENDING/RUNNING/COMPLETED/FAILED）
- `error_message`: 错误信息（如果失败）
- `started_at`: 回测开始时间戳
- `completed_at`: 回测完成时间戳
- `created_at`: 创建时间（索引）
- `updated_at`: 更新时间

## Docker 环境

如果使用 Docker，迁移脚本会在数据库容器首次启动时自动执行（通过 `docker-entrypoint-initdb.d` 目录）。

创建管理员账户：
```bash
docker-compose exec api node scripts/create-admin.js admin your_password
```

## 常见问题

### Q: 如何更新已有数据库？

A: 直接运行 `000_init_schema.sql`，脚本使用 `IF NOT EXISTS` 和 `ON CONFLICT`，不会影响已有数据。

### Q: 旧的迁移脚本（001-007）在哪里？

A: 已移动到 `archive/` 目录，仅作为历史记录保留。新项目只需使用 `000_init_schema.sql`。

### Q: Docker 会自动执行归档目录中的脚本吗？

A: 不会。Docker 的 `docker-entrypoint-initdb.d` 只会执行 `migrations/` 目录下的 `.sql` 文件，不会递归执行子目录。归档目录中的脚本不会被自动执行。

### Q: 如何重置数据库？

A: 
```bash
# 删除数据库
dropdb trading_db

# 重新创建并初始化
createdb trading_db
psql -d trading_db -f migrations/000_init_schema.sql
node scripts/create-admin.js admin your_password
```

### Q: 如何查看数据库版本？

A: 目前没有版本号机制，但可以通过检查表是否存在来判断：
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```
