# 安装问题修复说明

## 问题描述

在 Mac 和 Docker 环境中安装依赖时遇到以下问题：

1. **bcrypt 安装失败**：需要原生编译，但 Xcode Command Line Tools 检测失败
2. **网络超时**：无法下载预编译的二进制文件
3. **缺少 Docker 配置**：项目没有 Docker 支持

## 解决方案

### 1. 替换 bcrypt 为 bcryptjs

**更改的文件：**
- `api/package.json`：将 `bcrypt` 替换为 `bcryptjs`
- `api/src/routes/config.ts`：更新导入语句
- `api/scripts/create-admin.js`：更新 require 语句

**优势：**
- ✅ 纯 JavaScript 实现，无需原生编译
- ✅ 跨平台兼容（Mac、Linux、Windows、Docker）
- ✅ API 完全兼容，无需修改业务逻辑
- ✅ 安装速度快，无编译步骤

### 2. 添加 Docker 支持

**新增的文件：**
- `api/Dockerfile`：API 服务生产环境镜像
- `api/Dockerfile.dev`：API 服务开发环境镜像
- `frontend/Dockerfile`：前端服务生产环境镜像
- `frontend/Dockerfile.dev`：前端服务开发环境镜像
- `docker-compose.yml`：生产环境编排文件
- `docker-compose.dev.yml`：开发环境编排文件
- `.dockerignore` 文件：优化构建速度

**Docker 特性：**
- ✅ 包含 PostgreSQL 数据库服务
- ✅ 自动执行数据库迁移脚本
- ✅ 支持开发模式热重载
- ✅ 生产环境优化配置

### 3. 安装脚本

**新增文件：**
- `install.sh`：一键安装所有依赖的脚本

## 使用方法

### Mac/Linux 本地环境

```bash
# 方法 1：使用安装脚本
./install.sh

# 方法 2：手动安装
cd api && npm install
cd ../frontend && npm install
```

### Docker 环境

**生产环境：**
```bash
docker-compose up -d
```

**开发环境：**
```bash
docker-compose -f docker-compose.dev.yml up
```

详细说明请参考 `DOCKER_SETUP.md`。

## 验证安装

安装完成后，可以验证：

```bash
# 检查 API 依赖
cd api
npm list bcryptjs

# 检查 Frontend 依赖
cd ../frontend
npm list
```

## 注意事项

1. **bcryptjs vs bcrypt**：
   - `bcryptjs` 是纯 JavaScript 实现，性能略低于原生 `bcrypt`
   - 但对于大多数应用场景，性能差异可以忽略
   - API 完全兼容，生成的哈希值格式相同

2. **Docker 环境变量**：
   - 生产环境：通过 `docker-compose.yml` 中的环境变量配置
   - 开发环境：可以通过 `.env` 文件或环境变量覆盖

3. **数据库迁移**：
   - Docker 环境会自动执行迁移脚本
   - 本地环境需要手动执行 SQL 文件

## 回滚方案

如果需要回滚到 `bcrypt`：

1. 修改 `api/package.json`：
   ```json
   "bcrypt": "^5.1.1",
   "@types/bcrypt": "^5.0.2",
   ```

2. 修改代码中的导入：
   ```typescript
   import bcrypt from 'bcrypt';
   ```

3. 确保安装了 Xcode Command Line Tools：
   ```bash
   xcode-select --install
   ```

4. 重新安装依赖：
   ```bash
   cd api && npm install
   ```

