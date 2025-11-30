# 数据库迁移快速开始指南

## Mac 环境（Homebrew 安装）

### 1. 检查数据库是否存在

```bash
psql -l | grep trading_db
```

如果不存在，创建数据库：

```bash
createdb trading_db
```

### 2. 运行迁移脚本

**重要：** Mac 上使用 Homebrew 安装的 PostgreSQL，默认使用当前系统用户，不需要指定 `-U` 参数。

```bash
cd api/migrations

# 运行所有迁移脚本
psql -d trading_db -f 001_initial_schema.sql
psql -d trading_db -f 002_add_positions_and_trading_rules.sql
psql -d trading_db -f 003_config_management.sql
psql -d trading_db -f 004_add_token_auto_refresh_config.sql
psql -d trading_db -f 005_quant_trading_schema.sql
psql -d trading_db -f 006_add_option_quote_config.sql
```

### 3. 验证迁移

```bash
psql -d trading_db -c "\dt"  # 列出所有表
psql -d trading_db -c "SELECT config_key FROM system_config LIMIT 5;"  # 检查配置表
```

## 常见问题

### 问题 1: `role "postgres" does not exist`

**原因：** Homebrew 安装的 PostgreSQL 不使用 `postgres` 用户

**解决：** 使用当前系统用户，省略 `-U` 参数：

```bash
# 错误的方式
psql -U postgres -d trading_db  # ❌

# 正确的方式
psql -d trading_db  # ✅ 自动使用当前用户
```

### 问题 2: `database "trading_db" does not exist`

**解决：** 创建数据库

```bash
createdb trading_db
```

### 问题 3: 权限错误

**解决：** 确保当前用户有权限访问数据库

```bash
# 检查当前用户
whoami

# 检查数据库所有者
psql -d trading_db -c "\l trading_db"
```

## Docker 环境

如果使用 Docker，迁移脚本会在数据库容器首次启动时自动执行（通过 `docker-entrypoint-initdb.d` 目录）。

手动运行迁移：

```bash
docker-compose exec postgres psql -U trading_user -d trading_db -f /docker-entrypoint-initdb.d/006_add_option_quote_config.sql
```

## 验证配置

检查新添加的配置项：

```bash
psql -d trading_db -c "SELECT config_key, config_value, description FROM system_config WHERE config_key = 'longport_enable_option_quote';"
```

应该看到：

```
          config_key          | config_value |                                  description                                   
------------------------------+--------------+--------------------------------------------------------------------------------
 longport_enable_option_quote | false        | Enable LongPort API for option quotes (default: false, use Futunn API instead)
```

