# 统一数据库迁移说明

## 📋 概述

所有数据库结构变更已合并到 `000_init_schema.sql` 文件中。该文件既可以用于新项目初始化，也可以用于已有项目的更新。

## 🎯 使用方法

### 新项目初始化

```bash
psql -U postgres -d trading_db -f api\migrations\000_init_schema.sql
```

### 已有项目更新

同样的命令可以安全地重复运行，脚本使用 `IF NOT EXISTS` 和 `ON CONFLICT` 确保幂等性：

```bash
psql -U postgres -d trading_db -f api\migrations\000_init_schema.sql
```

## 🔧 编码问题解决

如果遇到编码错误（GBK vs UTF-8），文件开头已包含：

```sql
SET client_encoding = 'UTF8';
```

或者可以设置环境变量：

```bash
# Windows PowerShell
$env:PGCLIENTENCODING="UTF8"
psql -U postgres -d trading_db -f api\migrations\000_init_schema.sql

# Windows CMD
set PGCLIENTENCODING=UTF8
psql -U postgres -d trading_db -f api\migrations\000_init_schema.sql
```

## 📁 文件结构

- `000_init_schema.sql` - **唯一需要的迁移文件**，包含所有表结构定义
- `archive/` - 历史迁移文件（已合并到000中）
  - `012_backfill_signal_id_and_status.sql` - 数据修复脚本（非结构变更）

## ⚠️ 注意事项

1. **数据修复脚本**：`archive/012_backfill_signal_id_and_status.sql` 是数据回填脚本，不是结构变更，仅在需要修复历史数据时运行。

2. **编码要求**：文件使用 UTF-8 编码，确保 PostgreSQL 客户端也使用 UTF-8 编码。

3. **幂等性**：脚本可以安全地重复运行，不会重复创建已存在的对象。

4. **管理员账户**：运行脚本后，需要创建管理员账户：
   ```bash
   node scripts/create-admin.js admin your_password
   ```

## 📝 已合并的迁移

以下迁移文件的内容已合并到 `000_init_schema.sql`：

- ✅ `001_initial_schema.sql` - 基础表结构
- ✅ `002_add_positions_and_trading_rules.sql` - 持仓和交易规则表
- ✅ `003_config_management.sql` - 配置管理表
- ✅ `004_add_token_auto_refresh_config.sql` - Token自动刷新配置
- ✅ `005_quant_trading_schema.sql` - 量化交易系统表
- ✅ `006_add_option_quote_config.sql` - 期权行情配置
- ✅ `007_add_futunn_search_cookies.sql` - Futunn搜索Cookies
- ✅ `008_add_backtest_results.sql` - 回测结果表
- ✅ `009_add_backtest_status.sql` - 回测状态字段
- ✅ `010_add_is_system_to_capital_allocations.sql` - 系统账户标记
- ✅ `011_add_signal_id_to_execution_orders.sql` - 信号ID关联
- ✅ `014_add_backtest_diagnostic_log.sql` - 回测诊断日志字段

## 🔄 后续迁移

如果需要添加新的数据库结构变更：

1. 直接修改 `000_init_schema.sql` 文件
2. 使用 `IF NOT EXISTS` 或 `DO $$ ... END $$;` 块确保幂等性
3. 更新本文档说明变更内容

