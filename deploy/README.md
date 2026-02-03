# Trading System 部署指南

## 架构说明

本项目采用**单容器部署**架构：

```
浏览器
  ↓
Cloudflare Tunnel (lh.riowang.win)
  ↓
Docker Container (port 3001)
  ├─ Next.js Frontend (port 3000) - 内部运行
  └─ Express API (port 3001) - 对外暴露
```

**优点**：
- 只需一个 Cloudflare Tunnel 映射
- 前端通过相对路径 `/api` 调用后端，无 CORS 问题
- 部署简单，资源占用少
- 后端 API 不直接暴露给外部

## 部署步骤

### 1. 准备环境变量

```bash
# 复制环境变量示例文件
cp .env.example .env

# 编辑 .env 文件，填入实际配置
nano .env
```

必填项：
- `POSTGRES_PASSWORD` - 数据库密码
- `LONGPORT_APP_KEY` - 长桥 API Key
- `LONGPORT_APP_SECRET` - 长桥 API Secret
- `LONGPORT_ACCESS_TOKEN` - 长桥 Access Token

### 2. 构建镜像

```bash
# 构建统一镜像（包含前端和后端）
docker-compose build

# 或者使用 Docker 直接构建
docker build -t trading-system:latest .
```

### 3. 启动服务

```bash
# 启动所有服务（数据库 + 应用）
docker-compose up -d

# 查看日志
docker-compose logs -f app

# 查看服务状态
docker-compose ps
```

### 4. 验证服务

```bash
# 检查后端健康状态
curl http://localhost:3001/api/health

# 检查前端（容器内部）
docker exec trading-app curl http://localhost:3000

# 访问应用
open http://localhost:3001
```

### 5. 配置 Cloudflare Tunnel

#### 方式1: 使用配置文件

```bash
# 复制配置示例
cp deploy/cloudflared-config.example.yml ~/.cloudflared/config.yml

# 编辑配置文件，修改 tunnel ID 和域名
nano ~/.cloudflared/config.yml

# 启动 tunnel
cloudflared tunnel run
```

#### 方式2: 使用命令行

```bash
# 创建 tunnel（首次）
cloudflared tunnel create trading-system

# 添加 DNS 记录
cloudflared tunnel route dns trading-system lh.riowang.win

# 运行 tunnel
cloudflared tunnel --url http://localhost:3001 run trading-system
```

**重要**: 只需要映射一个端口 (3001)，前端会自动通过后端访问。

### 6. 验证线上部署

```bash
# 测试后端 API
curl https://lh.riowang.win/api/health

# 浏览器访问前端
open https://lh.riowang.win
```

## 故障排查

### 前端无法访问后端

**问题**: 浏览器 F12 显示 API 请求失败

**排查步骤**:
1. 检查前端环境变量: `docker exec trading-app env | grep NEXT_PUBLIC_API_URL`
   - 应该为空或 `/api`（相对路径）
2. 检查前端构建日志: `docker logs trading-app | grep "NEXT_PUBLIC"`
3. 重新构建镜像: `docker-compose build --no-cache app`

### 容器无法启动

**问题**: `docker-compose up` 失败

**排查步骤**:
1. 检查日志: `docker-compose logs app`
2. 检查数据库连接: `docker-compose logs postgres`
3. 验证环境变量: `docker-compose config`

### 长桥 SDK 错误

**问题**: API 日志显示长桥 SDK 初始化失败

**解决方案**:
- 确保 `SKIP_LONGPORT_INIT=true` 环境变量已设置
- 检查 `api/conditional-longport.js` 是否存在
- 查看详细日志: `docker logs trading-app | grep -i longport`

### 端口冲突

**问题**: 端口 3001 已被占用

**解决方案**:
```bash
# 查找占用进程
lsof -i:3001  # macOS/Linux
netstat -ano | findstr :3001  # Windows

# 修改 docker-compose.yml 端口映射
ports:
  - "3002:3001"  # 使用其他宿主机端口
```

## 开发环境

开发环境继续使用分离架构（前后端独立运行）：

```bash
# 后端 (终端1)
cd api
pnpm install
pnpm run dev

# 前端 (终端2)
cd frontend
pnpm install
pnpm run dev
```

前端会自动使用 `.env.local` 中的 `NEXT_PUBLIC_API_URL=http://localhost:3001/api`

## 更新部署

```bash
# 1. 拉取最新代码
git pull

# 2. 重新构建镜像
docker-compose build

# 3. 重启服务
docker-compose down
docker-compose up -d

# 4. 查看日志
docker-compose logs -f app
```

## 备份和恢复

### 备份数据库

```bash
# 备份
docker exec trading-postgres pg_dump -U trading_user trading_db > backup.sql

# 恢复
docker exec -i trading-postgres psql -U trading_user trading_db < backup.sql
```

### 备份日志

```bash
# 日志已挂载到宿主机 ./logs 目录
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/
```

## 性能优化

### 资源限制

编辑 `docker-compose.yml` 添加资源限制：

```yaml
services:
  app:
    # ... 其他配置
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### 日志轮转

```bash
# 配置 Docker 日志大小限制
# 编辑 /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}

# 重启 Docker
systemctl restart docker
```

## 监控

### 容器资源使用

```bash
# 实时监控
docker stats trading-app

# 查看容器详情
docker inspect trading-app
```

### 应用日志

```bash
# 查看最近日志
docker logs --tail 100 trading-app

# 实时跟踪
docker logs -f trading-app

# 按时间过滤
docker logs --since 2024-01-01T00:00:00 trading-app
```

## 安全建议

1. **修改默认密码**: 更改数据库和管理员密码
2. **使用 Secrets**: 敏感信息使用 Docker Secrets 或外部密钥管理
3. **定期更新**: 保持依赖和镜像最新
4. **限制端口暴露**: 生产环境不要暴露不必要的端口
5. **启用 HTTPS**: Cloudflare Tunnel 自动提供 HTTPS

## 联系支持

遇到问题？
1. 查看日志: `docker logs trading-app`
2. 检查配置: `docker-compose config`
3. 提交 Issue: [GitHub Issues](https://github.com/your-repo/trading-system/issues)
