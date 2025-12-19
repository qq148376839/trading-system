# Docker 部署故障排查指南

## API 容器启动失败（unhealthy）

### 1. 查看 API 容器日志

```bash
docker-compose logs api
```

或者查看最近的日志：
```bash
docker-compose logs --tail=100 api
```

### 2. 常见问题

#### 问题 1: 数据库连接失败

**症状**：日志中显示 "数据库连接失败" 或 "Database connection error"

**原因**：
- `DATABASE_URL` 配置不正确
- `api/.env` 文件中的 `DATABASE_URL` 覆盖了 docker-compose.yml 中的配置
- 数据库服务还未完全启动

**解决方案**：

1. **检查 `api/.env` 文件**：
   ```bash
   cat api/.env | grep DATABASE_URL
   ```
   
   如果存在 `DATABASE_URL`，确保它使用 Docker 服务名 `postgres`：
   ```bash
   DATABASE_URL=postgresql://trading_user:trading_password@postgres:5432/trading_db
   ```
   
   注意：不要使用 `localhost`，应该使用服务名 `postgres`

2. **如果 `api/.env` 文件不存在或没有 DATABASE_URL**：
   docker-compose.yml 中的环境变量会自动设置正确的 DATABASE_URL

3. **临时删除 `api/.env` 文件**（如果它包含错误的配置）：
   ```bash
   mv api/.env api/.env.backup
   docker-compose up -d --force-recreate api
   ```

#### 问题 2: 环境变量缺失

**症状**：日志中显示 "LongPort credentials not configured"

**解决方案**：
确保在项目根目录的 `.env` 文件或 `api/.env` 文件中设置了：
```bash
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token
```

#### 问题 3: 数据库未初始化

**症状**：数据库连接成功但表不存在

**解决方案**：
检查数据库是否已初始化：
```bash
docker-compose exec postgres psql -U trading_user -d trading_db -c "\dt"
```

如果没有表，检查初始化脚本：
```bash
docker-compose exec postgres psql -U trading_user -d trading_db -f /docker-entrypoint-initdb.d/000_init_schema.sql
```

### 3. 手动测试数据库连接

```bash
# 进入 API 容器
docker-compose exec api sh

# 在容器内测试数据库连接
node -e "const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL }); pool.query('SELECT 1').then(() => console.log('OK')).catch(e => console.error(e)).finally(() => process.exit());"
```

### 4. 检查健康检查端点

```bash
# 从宿主机测试
curl http://localhost:3001/api/health

# 从容器内测试
docker-compose exec api curl http://localhost:3001/api/health
```

### 5. 重新启动服务

```bash
# 停止所有服务
docker-compose down

# 清理卷（注意：这会删除数据库数据）
# docker-compose down -v

# 重新启动
docker-compose up -d

# 查看日志
docker-compose logs -f api
```

## Frontend 容器启动失败

### 查看日志

```bash
docker-compose logs frontend
```

### 常见问题

#### 问题：无法连接到 API

**解决方案**：
确保 `NEXT_PUBLIC_API_URL` 配置正确。如果前端需要从浏览器访问 API，应该使用宿主机的地址或域名，而不是容器内部地址。

## 数据库容器问题

### 查看日志

```bash
docker-compose logs postgres
```

### 检查数据库状态

```bash
docker-compose exec postgres pg_isready -U trading_user -d trading_db
```

## 网络问题

### 检查容器网络

```bash
docker network inspect trading-system_trading-network
```

### 测试容器间通信

```bash
# 从 API 容器 ping 数据库容器
docker-compose exec api ping postgres

# 从 API 容器测试数据库端口
docker-compose exec api nc -zv postgres 5432
```

## 完整重启流程

如果所有方法都失败，尝试完整重启：

```bash
# 1. 停止所有服务
docker-compose down

# 2. 清理未使用的资源（可选）
docker system prune -f

# 3. 重新构建镜像（如果需要）
docker-compose build --no-cache

# 4. 启动服务
docker-compose up -d

# 5. 查看所有服务日志
docker-compose logs -f
```

