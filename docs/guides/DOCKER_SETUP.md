# Docker 环境设置指南

本文档说明如何在 Mac 和 Docker 环境中运行交易系统。

## 问题解决

### 1. bcrypt 安装问题

已将所有 `bcrypt` 依赖替换为 `bcryptjs`（纯 JavaScript 实现），无需原生编译，解决了以下问题：
- Mac 上 Xcode Command Line Tools 检测失败
- Docker 环境中缺少构建工具
- 网络超时导致预编译二进制文件下载失败

### 2. 依赖安装

现在可以直接运行 `npm install`，无需额外的构建工具。

## Docker 环境使用

### 前置要求

- Docker Desktop（Mac）或 Docker Engine
- Docker Compose

### 生产环境（快速开始）

1. **配置环境变量**

   在项目根目录创建 `.env` 文件（可选，用于覆盖默认配置）：

   ```bash
   # 长桥API配置
   LONGPORT_APP_KEY=your_app_key
   LONGPORT_APP_SECRET=your_app_secret
   LONGPORT_ACCESS_TOKEN=your_access_token
   LONGPORT_ENABLE_OVERNIGHT=false
   ```

2. **启动所有服务**

   ```bash
   docker-compose up -d
   ```

   这将启动：
   - PostgreSQL 数据库（端口 5432）
   - API 服务（端口 3001）
   - Frontend 服务（端口 3000）

3. **查看日志**

   ```bash
   # 查看所有服务日志
   docker-compose logs -f

   # 查看特定服务日志
   docker-compose logs -f api
   docker-compose logs -f frontend
   docker-compose logs -f postgres
   ```

4. **停止服务**

   ```bash
   docker-compose down
   ```

5. **清理数据（包括数据库）**

   ```bash
   docker-compose down -v
   ```

### 开发环境

使用开发环境配置，支持热重载：

```bash
docker-compose -f docker-compose.dev.yml up
```

开发环境特点：
- 源代码挂载，修改代码自动重载
- 包含开发依赖和工具
- 适合本地开发和调试

### 数据库初始化

数据库容器启动时会自动执行 `api/migrations/` 目录下的 SQL 迁移脚本。

### 创建管理员账户

在 Docker 容器中创建管理员账户：

```bash
# 进入 API 容器
docker-compose exec api sh

# 在容器内运行创建管理员脚本
node scripts/create-admin.js admin your_password
```

或者从宿主机直接执行：

```bash
docker-compose exec api node scripts/create-admin.js admin your_password
```

## 本地开发环境（不使用 Docker）

### Mac 环境

1. **安装依赖**

   ```bash
   cd api
   npm install

   cd ../frontend
   npm install
   ```

   现在 `bcryptjs` 不需要编译，安装应该会成功。

2. **配置数据库**

   确保 PostgreSQL 正在运行，并创建数据库：

   ```bash
   createdb trading_db
   ```

   运行迁移脚本：

   ```bash
   psql trading_db < api/migrations/001_initial_schema.sql
   psql trading_db < api/migrations/002_add_positions_and_trading_rules.sql
   psql trading_db < api/migrations/003_config_management.sql
   psql trading_db < api/migrations/004_add_token_auto_refresh_config.sql
   psql trading_db < api/migrations/005_quant_trading_schema.sql
   ```

3. **配置环境变量**

   在 `api` 目录创建 `.env` 文件：

   ```bash
   DATABASE_URL=postgresql://user:password@localhost:5432/trading_db
   PORT=3001
   NODE_ENV=development
   LONGPORT_APP_KEY=your_app_key
   LONGPORT_APP_SECRET=your_app_secret
   LONGPORT_ACCESS_TOKEN=your_access_token
   ```

   在 `frontend` 目录创建 `.env.local` 文件：

   ```bash
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

4. **启动服务**

   ```bash
   # 启动 API（终端 1）
   cd api
   npm run dev

   # 启动 Frontend（终端 2）
   cd frontend
   npm run dev
   ```

## 故障排除

### API 服务无法连接数据库

- 检查 `DATABASE_URL` 环境变量是否正确
- 确保数据库服务正在运行
- 检查网络连接（Docker 网络或本地连接）

### Frontend 无法连接 API

- 检查 `NEXT_PUBLIC_API_URL` 环境变量
- 确保 API 服务正在运行
- 检查端口是否被占用

### 端口冲突

如果端口被占用，可以在 `docker-compose.yml` 中修改端口映射：

```yaml
ports:
  - "3002:3001"  # 将 API 映射到 3002
```

## 生产环境部署

生产环境建议：

1. 使用环境变量文件或密钥管理服务
2. 配置 HTTPS 和反向代理（如 Nginx）
3. 设置数据库备份策略
4. 配置日志收集和监控
5. 使用 Docker 镜像标签版本管理

