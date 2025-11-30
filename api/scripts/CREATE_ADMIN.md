# 创建管理员账户脚本使用说明

## 概述

`create-admin.js` 脚本用于创建或更新后台管理员账户。该脚本会自动：
- 使用 bcryptjs 加密密码
- 检查账户是否已存在（如果存在则更新密码）
- 验证密码长度（至少6位）

## 前置条件

1. **数据库迁移已完成**
   - 确保已运行 `003_config_management.sql` 迁移脚本
   - `admin_users` 表必须存在

2. **环境变量配置**
   - 在 `api/.env` 文件中配置 `DATABASE_URL`
   - 格式：`postgresql://用户名:密码@主机:端口/数据库名`

3. **依赖已安装**
   - 确保已运行 `npm install` 安装所有依赖

## 使用方法

### 本地环境（Mac/Linux/Windows）

```bash
# 进入 api 目录
cd api

# 运行脚本（必须提供密码）
node scripts/create-admin.js [用户名] [密码]

# 示例：创建用户名为 admin，密码为 mypassword123 的管理员
node scripts/create-admin.js admin mypassword123

# 如果只提供密码，默认用户名为 admin
node scripts/create-admin.js mypassword123
```

**注意：** 如果用户名已存在，脚本会更新该账户的密码。

### Docker 环境

#### 方法 1：在运行中的容器内执行

```bash
# 进入 API 容器
docker-compose exec api sh

# 在容器内运行脚本
node scripts/create-admin.js admin mypassword123

# 退出容器
exit
```

#### 方法 2：直接执行（推荐）

```bash
# 从宿主机直接执行容器内的脚本
docker-compose exec api node scripts/create-admin.js admin mypassword123
```

#### 方法 3：开发环境

```bash
# 使用开发环境配置
docker-compose -f docker-compose.dev.yml exec api node scripts/create-admin.js admin mypassword123
```

## 参数说明

- **用户名**（可选）：管理员账户的用户名，默认为 `admin`
- **密码**（必需）：管理员账户的密码，至少6位字符

## 示例输出

### 成功创建新账户

```
正在创建管理员账户: admin...
✅ 管理员账户创建成功！
   用户名: admin
   密码: ************

现在可以使用此账户登录配置管理页面。
```

### 更新已存在的账户

```
正在创建管理员账户: admin...
账户 admin 已存在，将更新密码...
✅ 管理员账户创建成功！
   用户名: admin
   密码: ************

现在可以使用此账户登录配置管理页面。
```

### 错误情况

#### 缺少密码参数

```
错误: 请提供密码
使用方法: node scripts/create-admin.js [username] [password]
示例: node scripts/create-admin.js admin mypassword123
```

#### 密码太短

```
错误: 密码长度至少6位
```

#### 数据库表不存在

```
❌ 创建失败: relation "admin_users" does not exist

提示: 请先运行数据库迁移脚本:
   psql -U your_user -d your_database -f api/migrations/003_config_management.sql
```

#### 数据库连接失败

```
❌ 创建失败: connect ECONNREFUSED 127.0.0.1:5432

提示: 无法连接到数据库，请检查:
   1. DATABASE_URL环境变量是否正确设置
   2. 数据库服务是否正在运行
```

## 完整流程示例

### 本地环境完整流程

```bash
# 1. 确保数据库已创建并运行迁移
psql -U postgres -d trading_db -f api/migrations/003_config_management.sql

# 2. 配置环境变量（api/.env）
echo "DATABASE_URL=postgresql://postgres:password@localhost:5432/trading_db" > api/.env

# 3. 安装依赖
cd api
npm install

# 4. 创建管理员账户
node scripts/create-admin.js admin mypassword123
```

### Docker 环境完整流程

```bash
# 1. 启动所有服务（会自动运行迁移脚本）
docker-compose up -d

# 2. 等待数据库初始化完成（约10-30秒）
docker-compose logs -f postgres

# 3. 创建管理员账户
docker-compose exec api node scripts/create-admin.js admin mypassword123
```

## 验证账户创建

### 方法 1：通过数据库查询

```bash
# 本地环境
psql -U postgres -d trading_db -c "SELECT username, is_active, created_at FROM admin_users;"

# Docker 环境
docker-compose exec postgres psql -U trading_user -d trading_db -c "SELECT username, is_active, created_at FROM admin_users;"
```

### 方法 2：通过 API 登录测试

```bash
curl -X POST http://localhost:3001/api/config/auth \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mypassword123"}'
```

成功响应：
```json
{
  "success": true,
  "data": {
    "message": "登录成功"
  }
}
```

## 安全建议

1. **使用强密码**：建议使用至少12位字符，包含大小写字母、数字和特殊字符
2. **定期更换密码**：通过配置管理页面或重新运行脚本更新密码
3. **限制账户数量**：只创建必要的管理员账户
4. **禁用不活跃账户**：通过配置管理页面将不活跃账户的 `is_active` 设置为 `false`

## 故障排除

### 问题 1：脚本找不到 .env 文件

**解决方案：**
- 确保在 `api` 目录下运行脚本
- 或手动创建 `.env` 文件并配置 `DATABASE_URL`

### 问题 2：Docker 容器内找不到脚本

**解决方案：**
- 确保源代码已正确挂载到容器
- 检查 `docker-compose.yml` 中的 volumes 配置
- 开发环境应使用 `docker-compose.dev.yml`

### 问题 3：权限错误

**解决方案：**
```bash
# 确保脚本有执行权限（通常不需要，因为使用 node 运行）
chmod +x api/scripts/create-admin.js
```

### 问题 4：bcryptjs 模块未找到

**解决方案：**
```bash
# 重新安装依赖
cd api
npm install
```

## 相关文件

- `api/scripts/create-admin.js` - 创建管理员脚本
- `api/migrations/003_config_management.sql` - 数据库迁移脚本（创建 admin_users 表）
- `api/src/routes/config.ts` - 配置管理 API（包含管理员认证逻辑）

