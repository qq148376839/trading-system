# 配置管理功能设置指南

**创建日期**: 2025-01-27  
**版本**: 方案B（基础配置管理）

---

## 📋 功能概述

本功能实现了以下特性：
1. ✅ 配置存储在数据库中（支持加密）
2. ✅ Web界面配置管理（需要管理员认证）
3. ✅ Token自动刷新功能
4. ✅ 兼容Windows和Docker部署

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd trading-system/api
npm install
```

**注意**: 如果`bcrypt`安装失败（Windows常见问题），可以使用`bcryptjs`替代：

```bash
npm install bcryptjs @types/bcryptjs
```

然后修改 `api/src/routes/config.ts` 中的导入：
```typescript
import bcrypt from 'bcryptjs';
```

### 2. 运行数据库迁移

执行数据库迁移脚本创建必要的表：

```bash
# 使用psql或其他PostgreSQL客户端
psql -U your_user -d your_database -f api/migrations/003_config_management.sql
```

或者在Docker中：
```bash
docker exec -i your_postgres_container psql -U your_user -d your_database < api/migrations/003_config_management.sql
```

### 3. 创建管理员账户

管理员账户需要在数据库中手动创建。可以使用以下方法：

#### 方法1: 使用Node.js脚本（推荐）

创建文件 `api/scripts/create-admin.js`:

```javascript
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createAdmin() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin123';
  
  if (!password || password.length < 6) {
    console.error('密码长度至少6位');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  
  try {
    const result = await pool.query(
      'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = $2',
      [username, passwordHash]
    );
    console.log(`管理员账户创建成功: ${username}`);
  } catch (error) {
    console.error('创建失败:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createAdmin();
```

运行：
```bash
node api/scripts/create-admin.js admin your_password
```

#### 方法2: 使用SQL（需要先加密密码）

使用在线bcrypt工具（如 https://bcrypt-generator.com/）生成密码哈希，然后执行：

```sql
INSERT INTO admin_users (username, password_hash) VALUES 
    ('admin', '$2b$10$...');  -- 替换为实际的bcrypt哈希值
```

### 4. 配置加密密钥（可选但推荐）

在`.env`文件中添加：

```env
CONFIG_ENCRYPTION_KEY=your-32-character-encryption-key-here!!
```

**注意**: 
- 加密密钥必须至少32个字符
- 生产环境必须设置此密钥
- 如果未设置，系统会使用默认密钥（不安全，仅用于开发）

### 5. 启动服务

```bash
# 开发环境
npm run dev

# 生产环境
npm run build
npm start
```

---

## 🔧 配置说明

### 数据库配置

数据库连接信息**必须保留在.env文件中**，因为需要先连接数据库才能读取配置。

```env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```

### 配置项说明

系统支持以下配置项（存储在`system_config`表中）：

| 配置键 | 说明 | 是否加密 | 默认值 |
|--------|------|----------|--------|
| `longport_app_key` | 长桥API App Key | ✅ | 空 |
| `longport_app_secret` | 长桥API App Secret | ✅ | 空 |
| `longport_access_token` | 长桥API Access Token | ✅ | 空 |
| `longport_token_expired_at` | Token过期时间 | ❌ | 空 |
| `longport_token_issued_at` | Token颁发时间 | ❌ | 空 |
| `longport_enable_overnight` | 是否开启美股夜盘 | ❌ | false |
| `futunn_csrf_token` | 富途API CSRF Token | ✅ | 空 |
| `futunn_cookies` | 富途API Cookies | ✅ | 空 |
| `server_port` | API服务端口 | ❌ | 3001 |

---

## 🌐 使用Web界面

1. 访问 `http://localhost:3000/config`（前端地址）
2. 使用管理员账户登录
3. 查看和编辑配置项
4. 刷新Token（如果需要）

### Token刷新

- **自动刷新**: 系统每天凌晨2点自动检查Token状态，如果7天内过期则自动刷新
- **手动刷新**: 在配置管理页面点击"刷新Token"按钮

---

## 🐳 Docker部署

### Dockerfile示例

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 复制package文件
COPY api/package*.json ./
RUN npm install

# 复制源代码
COPY api/ ./

# 构建
RUN npm run build

# 暴露端口
EXPOSE 3001

# 启动
CMD ["npm", "start"]
```

### docker-compose.yml示例

```yaml
version: '3.8'

services:
  api:
    build: ./api
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://user:password@db:5432/dbname
      - CONFIG_ENCRYPTION_KEY=${CONFIG_ENCRYPTION_KEY}
      - PORT=3001
    depends_on:
      - db
    volumes:
      - ./api/.env:/app/.env  # 可选，如果需要.env文件
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=dbname
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  postgres_data:
```

### 初始化步骤（Docker）

1. 启动数据库：
```bash
docker-compose up -d db
```

2. 运行数据库迁移：
```bash
docker exec -i trading-system_db_1 psql -U user -d dbname < api/migrations/003_config_management.sql
```

3. 创建管理员账户：
```bash
docker exec -it trading-system_api_1 node scripts/create-admin.js admin your_password
```

4. 启动所有服务：
```bash
docker-compose up -d
```

---

## 🔒 安全注意事项

1. **加密密钥**: 生产环境必须设置`CONFIG_ENCRYPTION_KEY`环境变量
2. **管理员密码**: 使用强密码，建议至少12位，包含大小写字母、数字和特殊字符
3. **数据库访问**: 限制数据库访问权限，仅允许应用服务器访问
4. **HTTPS**: 生产环境建议使用HTTPS加密传输
5. **Token安全**: Token刷新后旧Token会失效，确保及时更新

---

## 🐛 故障排除

### 问题1: bcrypt安装失败（Windows）

**解决方案**: 使用`bcryptjs`替代`bcrypt`：

```bash
npm install bcryptjs @types/bcryptjs
```

修改 `api/src/routes/config.ts`:
```typescript
import bcrypt from 'bcryptjs';
```

### 问题2: 配置读取失败，fallback到环境变量

**可能原因**:
- 数据库未连接
- 配置表不存在
- 配置项未设置

**解决方案**:
1. 检查数据库连接
2. 确认已运行数据库迁移
3. 在配置管理页面设置配置项

### 问题3: Token刷新失败

**可能原因**:
- Token已过期
- App Key/Secret不匹配
- 网络问题

**解决方案**:
1. 检查Token是否已过期
2. 确认App Key和Secret正确
3. 检查网络连接
4. 手动在长桥开发者中心生成新Token

### 问题4: 定时任务不工作（Docker）

**可能原因**: Docker容器时区设置不正确

**解决方案**: 在docker-compose.yml中添加时区环境变量：

```yaml
environment:
  - TZ=Asia/Shanghai
```

---

## 📚 API文档

### 配置管理API

- `POST /api/config/auth` - 管理员登录
- `GET /api/config` - 获取所有配置（需要认证）
- `PUT /api/config/:key` - 更新配置（需要认证）
- `POST /api/config/batch` - 批量更新配置（需要认证）
- `DELETE /api/config/:key` - 删除配置（需要认证）

### Token刷新API

- `POST /api/token-refresh/refresh` - 手动刷新Token
- `GET /api/token-refresh/status` - 获取Token状态
- `POST /api/token-refresh/auto-refresh` - 触发自动刷新检查

---

## 📝 更新日志

### 2025-01-27
- ✅ 实现基础配置管理功能（方案B）
- ✅ 实现Token刷新功能
- ✅ 支持Windows和Docker部署
- ✅ 创建Web配置管理界面

---

**最后更新**: 2025-01-27

