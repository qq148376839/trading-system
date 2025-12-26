# 脚本使用说明

## diagnose-task-queues-module.js

诊断 `Task_queues` 模块的来源。

### 安装依赖

```bash
cd api
npm install pg
# 或
pnpm add pg
```

### 使用方法

```bash
# 设置环境变量（可选）
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=trading_system
export DB_USER=postgres
export DB_PASSWORD=your_password

# 运行脚本
node scripts/diagnose-task-queues-module.js
```

### 或者直接使用 SQL

如果不想安装依赖，可以直接使用 SQL 文件：

```bash
# 使用 psql
psql -h localhost -U postgres -d trading_system -f scripts/diagnose-task-queues-module.sql

# 或使用数据库客户端工具执行 SQL 文件
```

## diagnose-task-queues-module.sql

纯 SQL 查询文件，可以直接在任何 PostgreSQL 客户端中执行。

### 使用方法

1. 使用 psql：
```bash
psql -h localhost -U postgres -d trading_system -f scripts/diagnose-task-queues-module.sql
```

2. 使用数据库客户端工具（如 pgAdmin、DBeaver、DataGrip）：
   - 打开 SQL 文件
   - 连接到数据库
   - 执行查询

3. 使用 API 接口（如果已实现）：
```bash
curl "http://localhost:3001/api/logs?module=Task_queues&limit=10"
```

## 快速诊断指南

查看 `diagnose-task-queues-simple.md` 获取最简单的诊断方法。





