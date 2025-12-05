# 历史迁移脚本归档

本目录包含开发过程中的历史迁移脚本（001-007），已合并到 `000_init_schema.sql` 统一初始化脚本中。

## 说明

- **新项目**：请使用 `../000_init_schema.sql` 统一初始化脚本
- **已有项目**：如果已经使用这些脚本初始化，可以安全忽略此目录
- **历史记录**：这些脚本保留作为历史记录，不建议在新项目中使用

## 脚本列表

- `001_initial_schema.sql` - 基础表结构
- `002_add_positions_and_trading_rules.sql` - 持仓和交易规则表
- `003_config_management.sql` - 配置管理表
- `004_add_token_auto_refresh_config.sql` - Token自动刷新配置
- `005_quant_trading_schema.sql` - 量化交易系统表
- `006_add_option_quote_config.sql` - 期权行情配置
- `007_add_futunn_search_cookies.sql` - 富途搜索Cookies配置

## 迁移到统一脚本

所有上述脚本的内容已合并到 `../000_init_schema.sql` 中，包括：
- 所有表结构
- 所有索引
- 所有触发器
- 所有默认配置项


