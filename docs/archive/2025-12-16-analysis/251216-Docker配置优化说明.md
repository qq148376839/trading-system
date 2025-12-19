# Docker 配置优化说明

## 📋 优化内容

### 1. Dockerfile 优化

#### API Dockerfile (`api/Dockerfile`)
- ✅ 添加 `curl` 用于健康检查
- ✅ 添加健康检查指令 (`HEALTHCHECK`)
- ✅ 创建非 root 用户运行服务（安全）
- ✅ 设置文件权限

#### Frontend Dockerfile (`frontend/Dockerfile`)
- ✅ 添加 `curl` 用于健康检查
- ✅ 添加健康检查指令 (`HEALTHCHECK`)
- ✅ 优化多阶段构建

#### 开发环境 Dockerfile
- ✅ 添加健康检查支持
- ✅ 保持热重载功能

### 2. Docker Compose 优化

#### 生产环境 (`docker-compose.yml`)
- ✅ API 服务添加健康检查
- ✅ Frontend 服务添加健康检查
- ✅ 添加资源限制（CPU、内存）
- ✅ 优化迁移脚本挂载（只挂载初始化脚本）
- ✅ Frontend 依赖 API 健康状态

#### 开发环境 (`docker-compose.dev.yml`)
- ✅ API 服务添加健康检查
- ✅ Frontend 服务添加健康检查
- ✅ Frontend 依赖 API 健康状态

### 3. 迁移脚本优化

**问题**：之前挂载整个 `migrations` 目录会导致执行所有 SQL 文件，包括历史迁移脚本。

**解决方案**：只挂载 `000_init_schema.sql` 初始化脚本。

```yaml
volumes:
  - ./api/migrations/000_init_schema.sql:/docker-entrypoint-initdb.d/000_init_schema.sql:ro
```

### 4. 健康检查配置

#### PostgreSQL
```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U trading_user -d trading_db"]
  interval: 10s
  timeout: 5s
  retries: 5
```

#### API 服务
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

#### Frontend 服务
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

### 5. 资源限制

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'
      memory: 512M
    reservations:
      cpus: '0.5'
      memory: 256M
```

## 🔍 错误检测脚本

### Linux/Mac (`docker-check.sh`)

**功能**：
- ✅ 检查 Docker 环境
- ✅ 检查必要文件
- ✅ 检查端口占用
- ✅ 检查环境变量文件
- ✅ 构建镜像
- ✅ 启动服务
- ✅ 等待服务就绪
- ✅ 检查健康状态

**使用方法**：
```bash
# 生产环境
./docker-check.sh

# 开发环境
./docker-check.sh dev
```

### Windows (`docker-check.ps1`)

**功能**：与 Linux 版本相同

**使用方法**：
```powershell
# 生产环境
.\docker-check.ps1

# 开发环境
.\docker-check.ps1 dev
```

## 🚀 快速开始

### 1. 使用检查脚本（推荐）

```bash
# Linux/Mac
chmod +x docker-check.sh
./docker-check.sh

# Windows
.\docker-check.ps1
```

### 2. 手动启动

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 检查服务状态
docker-compose ps

# 检查健康状态
curl http://localhost:3001/api/health
```

## 📊 服务依赖关系

```
PostgreSQL (健康检查)
    ↓
API (健康检查)
    ↓
Frontend (健康检查)
```

## 🔧 故障排除

### 1. 端口被占用

```bash
# 检查端口占用
netstat -tulpn | grep 3000
netstat -tulpn | grep 3001
netstat -tulpn | grep 5432

# 修改 docker-compose.yml 中的端口映射
ports:
  - "3002:3001"  # 修改外部端口
```

### 2. 数据库初始化失败

```bash
# 查看数据库日志
docker-compose logs postgres

# 手动执行初始化脚本
docker-compose exec postgres psql -U trading_user -d trading_db -f /docker-entrypoint-initdb.d/000_init_schema.sql
```

### 3. API 服务启动失败

```bash
# 查看 API 日志
docker-compose logs api

# 检查环境变量
docker-compose exec api env | grep DATABASE_URL

# 检查健康状态
curl http://localhost:3001/api/health
```

### 4. Frontend 构建失败

```bash
# 查看构建日志
docker-compose logs frontend

# 检查 Next.js 配置
cat frontend/next.config.js

# 清理并重新构建
docker-compose down
docker-compose build --no-cache frontend
docker-compose up -d
```

### 5. 健康检查失败

```bash
# 检查容器健康状态
docker-compose ps

# 查看健康检查日志
docker inspect trading-api | grep -A 10 Health

# 手动测试健康检查
docker-compose exec api curl -f http://localhost:3001/api/health
```

## 📝 注意事项

1. **环境变量文件**：确保 `api/.env` 文件存在并配置正确
2. **迁移脚本**：只挂载 `000_init_schema.sql`，避免执行历史迁移脚本
3. **资源限制**：根据实际需求调整 CPU 和内存限制
4. **健康检查**：服务启动需要一定时间，健康检查有 `start_period` 延迟
5. **非 root 用户**：生产环境使用非 root 用户运行，提高安全性

## ✅ 验证清单

- [x] Dockerfile 添加健康检查
- [x] Docker Compose 添加健康检查
- [x] 添加资源限制
- [x] 优化迁移脚本挂载
- [x] 创建错误检测脚本
- [x] 添加服务依赖关系
- [x] 创建非 root 用户
- [x] 添加文档说明

## 🔄 更新记录

- **2025-12-11**: 初始优化
  - 添加健康检查
  - 优化迁移脚本挂载
  - 添加资源限制
  - 创建错误检测脚本

