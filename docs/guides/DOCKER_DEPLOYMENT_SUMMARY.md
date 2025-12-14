# Docker 部署完成总结

## ✅ 部署状态

**完成时间**: 2025-12-12  
**状态**: ✅ 已完全修复并测试通过  
**测试环境**: Synology NAS (Linux)

## 📋 修复内容总结

### 1. 包管理器统一 ✅

**问题**: 项目使用 pnpm，但 Dockerfile 使用 npm  
**修复**:
- API Dockerfile: 安装 pnpm，使用 `pnpm install --frozen-lockfile`
- Frontend Dockerfile: 支持 pnpm，智能检测 lock 文件
- 生成并提交 `pnpm-lock.yaml` 文件

### 2. 原生模块编译支持 ✅

**问题**: bcrypt 需要编译原生模块，Alpine 缺少构建工具  
**修复**:
- 添加构建工具：python3, make, g++, build-essential
- 构建后清理工具以减小镜像大小
- 使用虚拟包组（.build-deps）便于管理

### 3. longport 原生模块支持 ✅

**问题**: longport 包缺少 `longport-linux-x64-musl` 模块  
**修复**:
- 从 `node:20-alpine` 切换到 `node:20` (Debian/glibc)
- longport 包需要 glibc，Alpine 使用 musl 不兼容
- 更新包管理器命令（apk → apt-get）

### 4. 前端 API URL 配置修复 ✅

**问题**: NEXT_PUBLIC_API_URL 在运行时设置，但 Next.js 需要在构建时注入  
**修复**:
- Dockerfile 添加 ARG 接收构建参数
- 设置 ENV 使构建时可用
- docker-compose.yml 使用 build.args 传递参数
- 确保前端使用 NAS IP 而不是 localhost

### 5. 依赖缺失修复 ✅

**问题**: @ant-design/icons 在代码中使用但未在 package.json 中声明  
**修复**:
- 添加 `@ant-design/icons@^6.0.0` 到 dependencies
- 更新 pnpm-lock.yaml

### 6. 目录结构修复 ✅

**问题**: Next.js standalone 模式需要 public 目录  
**修复**:
- 创建 `frontend/public/` 目录
- Dockerfile 确保目录存在

### 7. 端口冲突修复 ✅

**问题**: PostgreSQL 端口 5432 与系统服务冲突  
**修复**:
- 移除外部端口映射
- 容器间通过 Docker 网络通信（使用服务名 `postgres`）

### 8. NAS 系统兼容性 ✅

**问题**: Synology NAS 不支持 CPU CFS 调度器  
**修复**:
- 移除 `deploy.resources` 配置
- 添加注释说明原因

## 📁 相关文件

### Docker 配置文件
- `docker-compose.yml` - 生产环境配置
- `docker-compose.dev.yml` - 开发环境配置
- `api/Dockerfile` - API 服务 Dockerfile
- `api/Dockerfile.dev` - API 开发环境 Dockerfile
- `frontend/Dockerfile` - Frontend 服务 Dockerfile
- `frontend/Dockerfile.dev` - Frontend 开发环境 Dockerfile

### 故障排查文档
- `DOCKER_TROUBLESHOOTING.md` - 完整的故障排查指南
- `DOCKER_BUILD_FIX.md` - 构建问题修复说明
- `FRONTEND_API_URL_SETUP.md` - 前端 API URL 配置指南
- `DOCKER_MIRROR_FIX.md` - Docker 镜像源问题修复

### 依赖文件
- `api/pnpm-lock.yaml` - API 依赖锁定文件
- `api/pnpm-workspace.yaml` - pnpm 工作区配置
- `frontend/pnpm-lock.yaml` - Frontend 依赖锁定文件
- `frontend/public/.gitkeep` - public 目录占位文件

## 🚀 部署流程

### 首次部署

```bash
# 1. 克隆项目
git clone <repository-url>
cd trading-system

# 2. 配置环境变量
cat > .env << EOF
POSTGRES_USER=trading_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=trading_db
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token
NEXT_PUBLIC_API_URL=http://192.168.31.18:3001
EOF

# 3. 构建镜像
docker-compose build

# 4. 启动服务
docker-compose up -d

# 5. 等待服务启动（约1-2分钟）
docker-compose ps

# 6. 创建管理员账户
docker-compose exec api node scripts/create-admin.js admin your_password

# 7. 查看日志确认
docker-compose logs -f
```

### 更新部署

```bash
# 1. 拉取最新代码
git pull

# 2. 重新构建（如果代码或配置有变化）
docker-compose build

# 3. 重启服务
docker-compose up -d --force-recreate

# 4. 查看日志
docker-compose logs -f
```

## 🔍 验证步骤

### 1. 检查服务状态

```bash
docker-compose ps
```

所有服务应该显示为 `healthy` 状态。

### 2. 检查 API 服务

```bash
# 查看日志
docker-compose logs api

# 测试健康检查
curl http://localhost:3001/api/health
```

### 3. 检查前端服务

```bash
# 查看日志
docker-compose logs frontend

# 访问前端页面
# 浏览器访问: http://你的NAS地址:3000
```

### 4. 检查数据库

```bash
# 测试数据库连接
docker-compose exec postgres psql -U trading_user -d trading_db -c "SELECT 1"
```

## 📝 配置说明

### 环境变量配置

**项目根目录 `.env` 文件**:
```bash
# 数据库配置（Docker Compose 使用）
POSTGRES_USER=trading_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=trading_db

# 长桥 API 配置
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token

# 前端 API URL（重要：使用 NAS IP）
NEXT_PUBLIC_API_URL=http://192.168.31.18:3001
```

**API 服务 `.env` 文件** (`api/.env`):
```bash
# 数据库连接（使用 Docker 服务名）
DATABASE_URL=postgresql://trading_user:trading_password@postgres:5432/trading_db

# 长桥 API 配置（可选，优先使用数据库配置）
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token

# 服务器配置
PORT=3001
NODE_ENV=production
```

## 🎯 关键配置要点

1. **NEXT_PUBLIC_API_URL**: 
   - 必须在构建时设置（通过 build args）
   - 使用 NAS 的实际 IP 地址，不是 localhost
   - 修改后必须重新构建前端镜像

2. **DATABASE_URL**:
   - 在 Docker 环境中使用服务名 `postgres`，不是 `localhost`
   - 容器间通过 Docker 网络通信

3. **端口映射**:
   - PostgreSQL 不映射外部端口（避免冲突）
   - API: 3001
   - Frontend: 3000

4. **管理员账户**:
   - 首次部署后必须创建管理员账户
   - 使用脚本：`docker-compose exec api node scripts/create-admin.js admin your_password`

## 📚 相关文档

- [Docker 环境设置指南](DOCKER_SETUP.md) - 详细的部署指南
- [Docker 故障排查指南](../../DOCKER_TROUBLESHOOTING.md) - 问题排查
- [前端 API URL 配置指南](../../FRONTEND_API_URL_SETUP.md) - 前端配置
- [环境变量配置指南](../../ENV_SETUP_GUIDE.md) - 环境变量说明
- [配置管理设置指南](CONFIG_MANAGEMENT_SETUP.md) - 系统配置管理

## ✅ 测试清单

- [x] Docker 构建成功
- [x] 所有服务正常启动
- [x] 健康检查通过
- [x] 数据库连接正常
- [x] API 服务正常响应
- [x] 前端可以访问
- [x] 前端可以连接 API
- [x] 管理员账户创建成功
- [x] 配置管理页面可以访问
- [x] 长桥 API 配置可以更新

## 🎉 部署成功

Docker 部署已完全修复并测试通过，可以在生产环境中使用。

**下一步**:
1. 创建管理员账户
2. 配置长桥 API 凭证
3. 开始使用系统

