# NAS Docker 部署指南

本文档详细说明如何在 NAS 上使用 Docker 部署长桥股票交易系统，并解答常见问题。

## 📋 目录

- [部署架构](#部署架构)
- [数据库配置方案](#数据库配置方案)
- [Git 更新与数据安全](#git-更新与数据安全)
- [NAS 部署最佳实践](#nas-部署最佳实践)
- [常见问题](#常见问题)

---

## 🏗️ 部署架构

### 推荐架构（一体化部署）

```
NAS
└── Docker Compose
    ├── PostgreSQL (数据库容器)
    │   └── Volume: postgres_data (数据持久化)
    ├── API (后端服务容器)
    └── Frontend (前端服务容器)
```

**优点**：
- ✅ 简单易管理，一键启动所有服务
- ✅ 数据自动持久化到 Docker Volume
- ✅ 服务间通信高效（同一网络）
- ✅ 适合单机部署

---

## 💾 数据库配置方案

### 方案一：使用 Docker Compose 中的数据库（推荐）⭐

**这是当前项目的默认配置，推荐使用。**

#### 配置说明

1. **数据库自动创建**
   - Docker Compose 会自动创建 PostgreSQL 容器
   - 数据库初始化脚本会自动执行（`000_init_schema.sql`）
   - **无需手动创建数据库**

2. **环境变量配置**

   **方式A：使用 docker-compose.yml 中的默认配置（最简单）**
   
   ```yaml
   # docker-compose.yml 中已配置
   postgres:
     environment:
       POSTGRES_USER: trading_user
       POSTGRES_PASSWORD: trading_password
       POSTGRES_DB: trading_db
   ```
   
   API 服务会自动使用这些配置连接数据库：
   ```yaml
   api:
     environment:
       DATABASE_URL: postgresql://trading_user:trading_password@postgres:5432/trading_db
   ```

   **方式B：使用环境变量覆盖（推荐，更安全）** ⭐
   
   创建 `.env` 文件（在项目根目录）：
   ```bash
   # 复制示例文件
   cp .env.example .env
   
   # 编辑 .env 文件，设置您的数据库账号密码
   POSTGRES_USER=your_secure_username
   POSTGRES_PASSWORD=your_secure_password
   POSTGRES_DB=trading_db
   ```
   
   **重要**：`docker-compose.yml` 已经配置好支持环境变量：
   ```yaml
   postgres:
     environment:
       POSTGRES_USER: ${POSTGRES_USER:-trading_user}      # 从 .env 读取，默认 trading_user
       POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-trading_password}  # 从 .env 读取，默认 trading_password
       POSTGRES_DB: ${POSTGRES_DB:-trading_db}            # 从 .env 读取，默认 trading_db
   
   api:
     environment:
       DATABASE_URL: postgresql://${POSTGRES_USER:-trading_user}:${POSTGRES_PASSWORD:-trading_password}@postgres:5432/${POSTGRES_DB:-trading_db}
   ```
   
   **工作原理**：
   - ✅ Docker Compose 会自动读取项目根目录的 `.env` 文件
   - ✅ 如果 `.env` 中设置了 `POSTGRES_USER`，会使用您的值
   - ✅ 如果没有设置，会使用默认值（`trading_user`）
   - ✅ **数据库初始化时会使用您设置的账号密码**

3. **数据持久化**

   数据库数据存储在 Docker Volume 中：
   ```yaml
   volumes:
     - postgres_data:/var/lib/postgresql/data
   ```
   
   **数据位置**：
   - Docker 会自动管理 Volume
   - 数据存储在 Docker 的数据目录（通常在 `/var/lib/docker/volumes/`）
   - **即使删除容器，数据也不会丢失**（除非删除 Volume）

#### 部署步骤

```bash
# 1. 克隆项目
git clone <your-repo-url>
cd trading-system

# 2. 配置数据库环境变量（推荐，更安全）
# 在项目根目录创建 .env 文件
cat > .env << EOF
POSTGRES_USER=your_secure_username
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=trading_db
EOF

# 3. 配置 API 服务环境变量（长桥API密钥等）
cp api/env.example api/.env
# 编辑 api/.env，配置长桥API密钥等

# 4. 启动服务（数据库会自动使用 .env 中的账号密码创建和初始化）
docker-compose up -d

# 5. 查看日志
docker-compose logs -f

# 6. 创建管理员账户
docker-compose exec api node scripts/create-admin.js admin your_password
```

**重要说明**：
- ✅ 如果在 `.env` 中设置了 `POSTGRES_USER` 和 `POSTGRES_PASSWORD`，**数据库初始化时会使用这些账号密码**
- ✅ 如果没有设置 `.env`，会使用 `docker-compose.yml` 中的默认值（`trading_user`/`trading_password`）
- ✅ `.env` 文件不会被提交到 Git（已在 `.gitignore` 中）

---

### 方案二：使用外部数据库（高级）

如果您已经有 PostgreSQL 数据库，或者想使用 NAS 上的 PostgreSQL 服务：

#### 配置步骤

1. **修改 docker-compose.yml**

   注释掉 `postgres` 服务，修改 `api` 服务的数据库连接：
   ```yaml
   # postgres:
   #   image: postgres:16-alpine
   #   ...
   
   api:
     environment:
       # 使用外部数据库
       DATABASE_URL: postgresql://user:password@nas-ip:5432/trading_db
   ```

2. **手动创建数据库**

   ```bash
   # 连接到您的 PostgreSQL
   psql -U postgres
   
   # 创建数据库和用户
   CREATE DATABASE trading_db;
   CREATE USER trading_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE trading_db TO trading_user;
   \q
   
   # 执行初始化脚本
   psql -U trading_user -d trading_db -f api/migrations/000_init_schema.sql
   ```

3. **配置网络**

   确保 API 容器可以访问外部数据库：
   - 如果数据库在同一 NAS 上，使用 NAS 的 IP 地址
   - 如果数据库在其他服务器，确保网络可达

---

## 🔄 Git 更新与数据安全

### ✅ Git 更新不会影响数据库数据

**重要结论：Git 更新代码不会影响数据库中的数据。**

#### 原因分析

1. **数据存储在 Docker Volume 中**
   ```
   数据库数据 → Docker Volume (postgres_data)
                ↓
            物理存储（NAS 磁盘）
   ```
   
   - 数据库数据**不在项目目录中**
   - Git 更新只影响项目代码文件
   - Volume 中的数据完全独立

2. **容器重启不影响数据**
   ```bash
   # 更新代码
   git pull
   
   # 重新构建和启动（数据不会丢失）
   docker-compose down
   docker-compose up -d --build
   ```

3. **迁移脚本的安全性**
   - `000_init_schema.sql` 使用 `IF NOT EXISTS` 和 `ON CONFLICT`
   - **只在数据库首次创建时执行**
   - 已有数据库不会重复执行初始化脚本

#### 安全更新流程

```bash
# 1. 备份数据库（推荐，以防万一）
docker-compose exec postgres pg_dump -U trading_user trading_db > backup_$(date +%Y%m%d).sql

# 2. 更新代码
git pull

# 3. 重新构建镜像（如果需要）
docker-compose build

# 4. 重启服务
docker-compose up -d

# 5. 检查服务状态
docker-compose ps
docker-compose logs -f api
```

---

## 🏠 NAS 部署最佳实践

### 1. 数据持久化配置

#### 使用命名 Volume（默认，推荐）

```yaml
volumes:
  postgres_data:  # Docker 自动管理
```

**优点**：
- ✅ 简单，无需手动管理路径
- ✅ Docker 自动备份和恢复
- ✅ 跨平台兼容性好

#### 使用绑定挂载（可选）

如果需要将数据存储到 NAS 的特定目录：

```yaml
volumes:
  - /volume1/docker/trading-system/postgres:/var/lib/postgresql/data
```

**优点**：
- ✅ 可以直接访问数据文件
- ✅ 方便备份（直接复制目录）
- ✅ 可以挂载到 NAS 的共享文件夹

**注意事项**：
- ⚠️ 需要确保目录权限正确（PostgreSQL 需要 `postgres` 用户权限
- ⚠️ 路径必须是绝对路径

### 2. 环境变量管理

#### 推荐方式：使用 .env 文件

```bash
# 项目根目录创建 .env
POSTGRES_USER=trading_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=trading_db

# API 配置
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token
```

**安全建议**：
- ✅ 将 `.env` 添加到 `.gitignore`（已添加）
- ✅ 使用强密码
- ✅ 定期轮换密钥

### 3. 端口配置

#### 默认端口

```yaml
postgres: 5432
api: 3001
frontend: 3000
```

#### 修改端口（如果冲突）

```yaml
services:
  postgres:
    ports:
      - "15432:5432"  # 外部:内部
  api:
    ports:
      - "13001:3001"
  frontend:
    ports:
      - "13000:3000"
```

### 4. 网络配置

#### 内网访问

```yaml
# docker-compose.yml 中已配置
networks:
  trading-network:
    driver: bridge
```

服务间通过服务名通信：
- API → `postgres:5432`
- Frontend → `api:3001`

#### 外网访问（通过 Cloudflare Zero Trust）

参考：[NAS+Docker+ZeroTrust方案可行性分析报告](../technical/NAS_DOCKER_ZEROTRUST_ANALYSIS.md)

### 5. 备份策略

#### 自动备份脚本

创建 `backup-db.sh`：

```bash
#!/bin/bash
BACKUP_DIR="/volume1/backups/trading-system"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份数据库
docker-compose exec -T postgres pg_dump -U trading_user trading_db | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# 保留最近30天的备份
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +30 -delete

echo "备份完成: $BACKUP_DIR/db_$DATE.sql.gz"
```

添加到 NAS 的定时任务（Cron）。

---

## ❓ 常见问题

### Q1: 数据库是否需要单独建立？

**A: 不需要！**

- Docker Compose 会自动创建 PostgreSQL 容器
- 初始化脚本会自动执行，创建数据库和表结构
- 您只需要：
  1. （可选）创建 `.env` 文件设置数据库账号密码
  2. 运行 `docker-compose up -d`

**如果在 .env 中设置了账号密码，数据库初始化时会使用这些账号密码吗？**

**A: 是的！** ✅

- ✅ 如果在项目根目录的 `.env` 文件中设置了 `POSTGRES_USER` 和 `POSTGRES_PASSWORD`
- ✅ Docker Compose 会读取这些环境变量
- ✅ PostgreSQL 容器启动时会使用这些账号密码创建数据库和用户
- ✅ API 服务也会使用这些账号密码连接数据库

**示例**：
```bash
# 项目根目录创建 .env 文件
POSTGRES_USER=my_custom_user
POSTGRES_PASSWORD=my_secure_password_123
POSTGRES_DB=trading_db

# 运行后，数据库会使用 my_custom_user/my_secure_password_123 创建
docker-compose up -d
```

**工作原理**：
- Docker Compose 会自动读取项目根目录的 `.env` 文件
- `docker-compose.yml` 中已配置：`POSTGRES_USER: ${POSTGRES_USER:-trading_user}`
- 如果 `.env` 中有 `POSTGRES_USER`，使用您的值；否则使用默认值 `trading_user`
- **数据库初始化时会使用您设置的账号密码**

### Q2: Git 更新会影响数据库数据吗？

**A: 不会！**

- ✅ 数据库数据存储在 Docker Volume 中，独立于项目代码
- ✅ Git 更新只影响代码文件
- ✅ 即使删除容器，数据也不会丢失（除非删除 Volume）

**唯一需要注意的情况**：
- ⚠️ 如果有新的数据库迁移脚本，需要手动执行（当前项目使用统一初始化脚本，无需担心）

### Q3: 如何备份数据库？

```bash
# 方法1：使用 pg_dump
docker-compose exec postgres pg_dump -U trading_user trading_db > backup.sql

# 方法2：备份 Volume（需要停止容器）
docker-compose down
# 备份 Docker Volume 数据目录
docker-compose up -d
```

### Q4: 如何迁移到新 NAS？

```bash
# 1. 在新 NAS 上导出数据
docker-compose exec postgres pg_dump -U trading_user trading_db > migration.sql

# 2. 在新 NAS 上导入数据
docker-compose up -d  # 先启动服务
docker-compose exec -T postgres psql -U trading_user trading_db < migration.sql
```

### Q5: 如何查看数据库数据？

```bash
# 进入数据库容器
docker-compose exec postgres psql -U trading_user trading_db

# 或者使用外部工具连接
# 主机: NAS IP
# 端口: 5432（或您配置的端口）
# 用户: trading_user
# 密码: trading_password（或您配置的密码）
# 数据库: trading_db
```

### Q6: 数据库密码在哪里配置？

**方式1：.env 文件（推荐）** ⭐
```bash
# 项目根目录创建 .env 文件
POSTGRES_USER=your_username
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=trading_db
```

**说明**：
- ✅ `docker-compose.yml` 已配置支持从 `.env` 读取
- ✅ 数据库初始化时会使用这些账号密码
- ✅ `.env` 文件不会被提交到 Git（安全）

**方式2：docker-compose.yml（不推荐用于生产）**
```yaml
environment:
  POSTGRES_PASSWORD: trading_password
```
- ⚠️ 密码会暴露在配置文件中
- ⚠️ 会被提交到 Git（不安全）

**方式3：环境变量**
```bash
export POSTGRES_PASSWORD=your_secure_password
docker-compose up -d
```
- ✅ 适合临时测试
- ⚠️ 每次都需要设置

### Q7: 如何重置数据库？

```bash
# ⚠️ 警告：这会删除所有数据！

# 1. 停止服务
docker-compose down

# 2. 删除 Volume
docker volume rm trading-system_postgres_data

# 3. 重新启动（会自动初始化）
docker-compose up -d
```

---

## 📝 总结

### 数据库配置

1. **推荐使用 Docker Compose 中的数据库**
   - ✅ 自动创建和初始化
   - ✅ 数据自动持久化
   - ✅ 配置简单

2. **环境变量配置**
   - 使用 `.env` 文件（推荐）
   - 或使用 `docker-compose.yml` 中的默认值

### Git 更新安全

1. **数据安全**
   - ✅ Git 更新不会影响数据库数据
   - ✅ 数据存储在独立的 Docker Volume 中
   - ✅ 容器重启不会丢失数据

2. **更新流程**
   ```bash
   git pull
   docker-compose up -d --build
   ```

### NAS 部署建议

1. **数据持久化**：使用 Docker Volume（默认）或绑定挂载到 NAS 目录
2. **备份策略**：定期备份数据库（使用 pg_dump）
3. **安全配置**：使用强密码，保护 `.env` 文件
4. **监控**：使用健康检查监控服务状态
5. **本地构建测试**：在推送到NAS之前，先在本地测试构建（见Q9）

---

## 🧪 本地构建测试（推荐）

### Q9: 是否应该在本地先测试构建？

**A: 强烈推荐！** ✅

在推送到NAS之前，建议先在本地测试构建，原因：

1. **环境相似性**：本地环境与NAS Docker环境相似（Node.js、TypeScript）
2. **快速迭代**：本地构建更快，便于快速发现和修复问题
3. **成功率预测**：本地构建成功，NAS上大概率也能成功
4. **节省时间**：避免在NAS上反复构建失败

### 本地构建测试步骤

```bash
# 1. 测试API构建
cd api
npm install  # 如果需要
npm run build

# 2. 测试前端构建
cd ../frontend
npm install  # 如果需要
npm run build

# 3. 如果构建成功，再推送到NAS
git add .
git commit -m "修复构建错误"
git push
```

### 构建成功标准

- ✅ API构建：`npm run build` 成功，0错误
- ✅ 前端构建：`npm run build` 成功，TypeScript编译通过
- ⚠️ 注意：Next.js运行时警告（如`useSearchParams()`需要Suspense边界）不影响构建，但建议后续修复

### 常见构建错误

如果遇到构建错误，请参考：
- [构建错误修复总结](../features/251211-BUILD_ERROR_FIX_SUMMARY.md)
- [Docker优化文档](../../DOCKER_OPTIMIZATION.md)

---

**需要帮助？** 查看 [Docker 环境设置指南](251214-Docker环境设置指南.md) 或 [故障排除指南](../DOCKER_OPTIMIZATION.md#故障排除)





