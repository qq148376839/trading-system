# Docker 环境设置指南

本文档说明如何在 Mac 和 Docker 环境中运行交易系统。

## ✅ Docker 部署状态

**当前状态**: Docker 部署已完全修复并测试通过 ✅

**支持的平台**:
- ✅ Linux (包括 Synology NAS)
- ✅ macOS
- ✅ Windows (通过 WSL2)

**关键修复**:
- ✅ pnpm 包管理器支持
- ✅ longport 原生模块支持（Debian 基础镜像）
- ✅ bcrypt 编译支持（构建工具）
- ✅ 前端 API URL 构建时注入
- ✅ PostgreSQL 端口冲突修复
- ✅ NAS 系统兼容性

## 问题解决

### 1. bcrypt 编译问题

**已修复**: Dockerfile 中添加了构建工具（python3, make, g++, build-essential），支持编译 bcrypt 原生模块。

### 2. longport 原生模块问题

**已修复**: 从 `node:20-alpine` 切换到 `node:20` (Debian)，因为 longport 包需要 glibc 支持。

### 3. pnpm 支持

**已修复**: API 和 Frontend Dockerfile 都支持 pnpm 包管理器，使用 `pnpm install --frozen-lockfile`。

## Docker 环境使用

### 前置要求

- Docker Desktop（Mac）或 Docker Engine
- Docker Compose

### 生产环境（快速开始）

1. **配置环境变量**

   在项目根目录创建 `.env` 文件：

   ```bash
   # 数据库配置（Docker Compose 会读取）
   POSTGRES_USER=trading_user
   POSTGRES_PASSWORD=your_secure_password
   POSTGRES_DB=trading_db

   # 长桥API配置
   LONGPORT_APP_KEY=your_app_key
   LONGPORT_APP_SECRET=your_app_secret
   LONGPORT_ACCESS_TOKEN=your_access_token
   LONGPORT_ENABLE_OVERNIGHT=false

   # 前端 API URL（重要：使用 NAS 的实际 IP 地址）
   # 如果从浏览器访问，必须使用宿主机的 IP，而不是 localhost
   NEXT_PUBLIC_API_URL=http://192.168.31.18:3001
   ```

   **重要提示**:
   - `NEXT_PUBLIC_API_URL` 必须在构建时设置，修改后需要重新构建前端镜像
   - 如果 NAS IP 会变化，建议使用固定 IP 或域名

2. **构建并启动所有服务**

   ```bash
   # 构建镜像（首次部署或修改配置后）
   docker-compose build

   # 启动所有服务
   docker-compose up -d
   ```

   这将启动：
   - PostgreSQL 数据库（容器内部端口 5432，不映射到宿主机）
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

数据库容器启动时会自动执行 `api/migrations/000_init_schema.sql` 初始化脚本。

**注意**: 只执行初始化脚本，历史迁移脚本已归档。

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

### 常见问题

详细的故障排查指南请参考：
- **[Docker 故障排查指南](../DOCKER_TROUBLESHOOTING.md)** - 完整的故障排查步骤
- **[前端 API URL 配置指南](../FRONTEND_API_URL_SETUP.md)** - 前端连接问题修复
- **[Docker 构建修复说明](../DOCKER_BUILD_FIX.md)** - 构建问题修复

### 快速问题排查

#### API 服务无法连接数据库
- 检查 `api/.env` 文件中的 `DATABASE_URL` 是否使用服务名 `postgres` 而不是 `localhost`
- 查看日志：`docker-compose logs api`

#### Frontend 无法连接 API
- 检查 `NEXT_PUBLIC_API_URL` 是否设置为 NAS 的实际 IP 地址
- **重要**: 修改后必须重新构建前端镜像：`docker-compose build --no-cache frontend`
- 查看浏览器控制台（F12）的网络请求，确认请求的 URL

#### 端口冲突
- PostgreSQL 端口冲突：已修复，不再映射外部端口
- API/Frontend 端口冲突：可以在 `docker-compose.yml` 中修改端口映射

#### 构建失败
- longport 模块错误：已修复，使用 Debian 基础镜像
- bcrypt 编译错误：已修复，添加了构建工具
- pnpm lockfile 错误：已修复，使用 pnpm 并同步 lockfile

## 生产环境部署

### 部署检查清单

- [ ] 配置环境变量（`.env` 文件）
- [ ] 设置 `NEXT_PUBLIC_API_URL` 为实际 IP 或域名
- [ ] 创建管理员账户：`docker-compose exec api node scripts/create-admin.js admin your_password`
- [ ] 配置长桥 API 凭证（通过配置管理页面或环境变量）
- [ ] 验证所有服务健康状态：`docker-compose ps`

### 生产环境建议

1. **安全配置**
   - 使用强密码（数据库、管理员账户）
   - 配置 `CONFIG_ENCRYPTION_KEY` 环境变量（32字符以上）
   - 使用环境变量文件或密钥管理服务

2. **网络配置**
   - 配置 HTTPS 和反向代理（如 Nginx）
   - 使用域名而不是 IP 地址
   - 配置防火墙规则

3. **数据管理**
   - 设置数据库备份策略
   - 定期备份 `postgres_data` 卷
   - 监控磁盘空间使用

4. **监控和日志**
   - 配置日志收集和监控
   - 设置健康检查告警
   - 定期查看服务日志

5. **版本管理**
   - 使用 Docker 镜像标签版本管理
   - 保留历史版本以便回滚
   - 使用 Git 标签标记发布版本

## 相关文档

- [Docker 故障排查指南](../DOCKER_TROUBLESHOOTING.md) - 详细的问题排查步骤
- [前端 API URL 配置指南](../FRONTEND_API_URL_SETUP.md) - 前端连接配置
- [Docker 构建修复说明](../DOCKER_BUILD_FIX.md) - 构建问题修复历史
- [环境变量配置指南](../ENV_SETUP_GUIDE.md) - 环境变量详细说明

