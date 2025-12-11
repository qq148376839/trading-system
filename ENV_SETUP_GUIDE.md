# 环境变量配置指南

本文档说明如何配置项目的环境变量，特别是数据库账号密码的配置。

## 📋 目录

- [环境变量文件说明](#环境变量文件说明)
- [数据库配置](#数据库配置)
- [配置步骤](#配置步骤)
- [常见问题](#常见问题)

---

## 📁 环境变量文件说明

项目中有两个 `.env` 文件位置：

### 1. 项目根目录的 `.env`（用于 Docker Compose）

**位置**：`trading-system/.env`

**用途**：
- Docker Compose 读取，用于数据库初始化
- 设置数据库账号密码（`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`）
- 可选：设置长桥API配置（也可以只在 `api/.env` 中设置）

**示例**：
```bash
# 数据库配置（Docker Compose 会读取）
POSTGRES_USER=my_secure_username
POSTGRES_PASSWORD=my_secure_password_123
POSTGRES_DB=trading_db

# 长桥API配置（可选）
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token
```

### 2. API 服务目录的 `api/.env`（用于 API 服务）

**位置**：`trading-system/api/.env`

**用途**：
- API 服务读取，用于应用配置
- 设置数据库连接URL、长桥API密钥等

**示例**：
```bash
# 数据库连接（可以使用环境变量或直接写）
DATABASE_URL=postgresql://my_secure_username:my_secure_password_123@postgres:5432/trading_db

# 长桥API配置
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token
PORT=3001
NODE_ENV=production
```

---

## 💾 数据库配置

### 工作原理

1. **Docker Compose 读取项目根目录的 `.env`**
   ```yaml
   # docker-compose.yml
   postgres:
     environment:
       POSTGRES_USER: ${POSTGRES_USER:-trading_user}      # 从 .env 读取，默认 trading_user
       POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-trading_password}  # 从 .env 读取，默认 trading_password
       POSTGRES_DB: ${POSTGRES_DB:-trading_db}            # 从 .env 读取，默认 trading_db
   ```

2. **PostgreSQL 容器启动时**
   - 如果 `.env` 中设置了 `POSTGRES_USER` 和 `POSTGRES_PASSWORD`
   - **会使用这些账号密码创建数据库和用户**
   - 如果没有设置，使用默认值（`trading_user`/`trading_password`）

3. **API 服务连接数据库**
   ```yaml
   api:
     environment:
       DATABASE_URL: postgresql://${POSTGRES_USER:-trading_user}:${POSTGRES_PASSWORD:-trading_password}@postgres:5432/${POSTGRES_DB:-trading_db}
   ```

### ✅ 答案：是的，数据库初始化时会使用您设置的账号密码！

**如果您在项目根目录的 `.env` 文件中设置了：**
```bash
POSTGRES_USER=my_custom_user
POSTGRES_PASSWORD=my_secure_password_123
POSTGRES_DB=trading_db
```

**那么：**
- ✅ Docker Compose 会读取这些环境变量
- ✅ PostgreSQL 容器启动时会使用 `my_custom_user`/`my_secure_password_123` 创建数据库
- ✅ API 服务也会使用这些账号密码连接数据库
- ✅ 初始化脚本 `000_init_schema.sql` 会在使用这些账号密码创建的数据库中执行

---

## 🚀 配置步骤

### 步骤1：创建项目根目录的 `.env` 文件

```bash
# 在项目根目录创建 .env
cat > .env << 'EOF'
# 数据库配置（Docker Compose 会读取）
POSTGRES_USER=my_secure_username
POSTGRES_PASSWORD=my_secure_password_123
POSTGRES_DB=trading_db
EOF
```

### 步骤2：创建 API 服务的 `.env` 文件

```bash
# 复制示例文件
cp api/env.example api/.env

# 编辑 api/.env，设置数据库连接和API密钥
# DATABASE_URL=postgresql://my_secure_username:my_secure_password_123@postgres:5432/trading_db
# LONGPORT_APP_KEY=your_app_key
# ...
```

### 步骤3：启动服务

```bash
# 启动服务（数据库会使用 .env 中的账号密码创建）
docker-compose up -d

# 查看日志确认
docker-compose logs postgres
```

---

## ❓ 常见问题

### Q1: 如果我没有创建 `.env` 文件会怎样？

**A**: 会使用 `docker-compose.yml` 中的默认值：
- `POSTGRES_USER=trading_user`
- `POSTGRES_PASSWORD=trading_password`
- `POSTGRES_DB=trading_db`

数据库会使用这些默认值创建。

### Q2: 我可以在 `.env` 中只设置密码，不设置用户名吗？

**A**: 可以！
```bash
# .env
POSTGRES_PASSWORD=my_secure_password_123
# POSTGRES_USER 不设置，会使用默认值 trading_user
```

数据库会使用 `trading_user`/`my_secure_password_123` 创建。

### Q3: 修改 `.env` 后需要重新创建数据库吗？

**A**: 取决于情况：

**情况1：数据库还未创建**
- ✅ 直接修改 `.env`，然后运行 `docker-compose up -d`
- ✅ 数据库会使用新的账号密码创建

**情况2：数据库已创建**
- ⚠️ 修改 `.env` 不会自动更新已有数据库的账号密码
- ⚠️ 需要手动更新数据库密码，或重置数据库

**重置数据库（会删除所有数据）**：
```bash
docker-compose down
docker volume rm trading-system_postgres_data
# 修改 .env 文件
docker-compose up -d  # 使用新密码创建
```

### Q4: `.env` 文件会被提交到 Git 吗？

**A**: 不会！

- ✅ `.env` 已在 `.gitignore` 中
- ✅ 不会被提交到 Git
- ✅ 可以安全地存储密码

### Q5: 如何验证数据库使用了正确的账号密码？

```bash
# 方法1：查看容器环境变量
docker-compose exec postgres env | grep POSTGRES

# 方法2：尝试连接数据库
docker-compose exec postgres psql -U my_secure_username -d trading_db
# 输入密码：my_secure_password_123

# 方法3：查看日志
docker-compose logs postgres | grep "database system is ready"
```

---

## 📝 总结

### 关键点

1. **项目根目录的 `.env`**：Docker Compose 读取，用于数据库初始化
2. **`api/.env`**：API 服务读取，用于应用配置
3. **数据库初始化**：如果在 `.env` 中设置了账号密码，**数据库会使用这些账号密码创建**
4. **安全**：`.env` 文件不会被提交到 Git

### 推荐配置流程

```bash
# 1. 创建项目根目录的 .env（设置数据库账号密码）
echo "POSTGRES_USER=my_user" > .env
echo "POSTGRES_PASSWORD=my_password" >> .env
echo "POSTGRES_DB=trading_db" >> .env

# 2. 创建 API 服务的 .env（设置API密钥等）
cp api/env.example api/.env
# 编辑 api/.env

# 3. 启动服务（数据库会使用 .env 中的账号密码创建）
docker-compose up -d
```

---

**需要更多帮助？** 查看 [NAS Docker 部署指南](docs/guides/NAS_DOCKER_DEPLOYMENT.md)

