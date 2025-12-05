# 数据库迁移快速开始指南

## 快速开始（推荐）

### 1. 创建数据库

```bash
createdb trading_db
```

### 2. 运行统一初始化脚本

**只需运行一个脚本即可完成所有数据库初始化：**

```bash
cd api/migrations
psql -d trading_db -f 000_init_schema.sql
```

**特点：**
- ✅ 包含所有表结构和配置（001-007的所有内容）
- ✅ 可安全重复运行（使用 IF NOT EXISTS 和 ON CONFLICT）
- ✅ 新项目和已有项目都适用

### 3. 创建管理员账户

```bash
cd api
node scripts/create-admin.js admin your_password
```

### 4. 验证迁移

```bash
psql -d trading_db -c "\dt"  # 列出所有表
psql -d trading_db -c "SELECT config_key FROM system_config LIMIT 5;"  # 检查配置表
```

## Mac 环境（Homebrew 安装）

### 重要提示

Mac 上使用 Homebrew 安装的 PostgreSQL，默认使用当前系统用户，**不需要指定 `-U` 参数**。

```bash
# ✅ 正确的方式
psql -d trading_db -f migrations/000_init_schema.sql

# ❌ 错误的方式（会报错：role "postgres" does not exist）
psql -U postgres -d trading_db -f migrations/000_init_schema.sql
```

## 历史迁移脚本（已归档）

旧迁移脚本（001-007）已移动到 `archive/` 目录，**不建议使用**。

如果需要查看历史记录：

```bash
cd api/migrations/archive
ls  # 查看归档的脚本
```

**注意：** 
- 新项目请使用 `000_init_schema.sql` 统一初始化脚本
- 归档脚本仅作为历史记录保留，不建议在新项目中使用
- Docker 会自动执行 `migrations/` 目录下的所有 `.sql` 文件，归档目录中的脚本不会被自动执行

## Docker 环境

如果使用 Docker，迁移脚本会在数据库容器首次启动时自动执行（通过 `docker-entrypoint-initdb.d` 目录）。

手动运行迁移：

```bash
# 使用统一初始化脚本
docker-compose exec postgres psql -U trading_user -d trading_db -f /docker-entrypoint-initdb.d/000_init_schema.sql

# 或使用旧迁移脚本
docker-compose exec postgres psql -U trading_user -d trading_db -f /docker-entrypoint-initdb.d/006_add_option_quote_config.sql
```

创建管理员账户：

```bash
docker-compose exec api node scripts/create-admin.js admin your_password
```

## 常见问题

### 问题 1: `role "postgres" does not exist`

**原因：** Homebrew 安装的 PostgreSQL 不使用 `postgres` 用户

**解决：** 使用当前系统用户，省略 `-U` 参数：

```bash
# ✅ 正确的方式
psql -d trading_db -f migrations/000_init_schema.sql

# ❌ 错误的方式
psql -U postgres -d trading_db -f migrations/000_init_schema.sql
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

### 问题 4: 如何更新已有数据库？

**解决：** 直接运行 `000_init_schema.sql`，脚本使用 `IF NOT EXISTS` 和 `ON CONFLICT`，不会影响已有数据：

```bash
psql -d trading_db -f migrations/000_init_schema.sql
```

## 验证配置

检查配置项：

```bash
psql -d trading_db -c "SELECT config_key, config_value, description FROM system_config ORDER BY config_key;"
```

应该看到所有配置项，包括：
- `longport_app_key`
- `longport_app_secret`
- `longport_access_token`
- `longport_token_auto_refresh`
- `longport_enable_option_quote`
- `futunn_csrf_token`
- `futunn_cookies`
- `futunn_search_cookies`
- 等等
