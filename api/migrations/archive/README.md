# 历史迁移脚本归档

本目录包含开发过程中的历史迁移脚本（001-011），已合并到 `000_init_schema.sql` 统一初始化脚本中。

## 说明

- **新项目**：请使用 `../000_init_schema.sql` 统一初始化脚本
- **已有项目**：如果已经使用这些脚本初始化，可以安全忽略此目录
- **历史记录**：这些脚本保留作为历史记录，不建议在新项目中使用

## 脚本列表

### 基础迁移脚本（001-007）
- `001_initial_schema.sql` - 基础表结构
- `002_add_positions_and_trading_rules.sql` - 持仓和交易规则表
- `003_config_management.sql` - 配置管理表
- `004_add_token_auto_refresh_config.sql` - Token自动刷新配置
- `005_quant_trading_schema.sql` - 量化交易系统表
- `006_add_option_quote_config.sql` - 期权行情配置
- `007_add_futunn_search_cookies.sql` - 富途搜索Cookies配置

### 回测功能迁移脚本（008-009）
- `008_add_backtest_results.sql` - 回测结果表（已合并到000_init_schema.sql）
- `009_add_backtest_status.sql` - 回测状态字段（已合并到000_init_schema.sql）

### 量化交易优化迁移脚本（010-011）
- `010_add_is_system_to_capital_allocations.sql` - 资金分配表is_system字段（已合并到000_init_schema.sql）
- `011_add_signal_id_to_execution_orders.sql` - 执行订单表signal_id字段（已合并到000_init_schema.sql）

## 迁移到统一脚本

所有上述脚本的内容已合并到 `../000_init_schema.sql` 中，包括：
- 所有表结构
- 所有索引
- 所有触发器
- 所有默认配置项
- 所有字段和约束

## 归档时间

- **001-007**: 2025-12-05（初始归档）
- **008-009**: 2025-12-05（回测功能合并）
- **010-011**: 2025-12-11（量化交易优化合并）


