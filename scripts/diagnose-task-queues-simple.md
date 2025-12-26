# Task_queues 模块快速诊断指南

## 🚀 最简单的方法：直接查询数据库

### 方法1：使用数据库客户端（推荐）

连接到 PostgreSQL 数据库，执行以下 SQL：

```sql
-- 查看 Task_queues 模块的实际文件路径
SELECT DISTINCT 
  file_path,
  COUNT(*) as log_count,
  MIN(timestamp) as first_log,
  MAX(timestamp) as last_log
FROM system_logs
WHERE module = 'Task_queues'
GROUP BY file_path
ORDER BY log_count DESC;
```

**预期结果示例**：
```
file_path                                    | log_count | first_log              | last_log
---------------------------------------------|-----------|------------------------|------------------------
D:\Python脚本\trading-system\api\src\...    | 1234      | 2025-12-15 10:00:00   | 2025-12-16 16:40:00
```

### 方法2：使用 API 接口查询

如果 API 服务正在运行，可以直接查询：

```bash
# 查询 Task_queues 模块的日志
curl "http://localhost:3001/api/logs?module=Task_queues&limit=10" | jq '.data.logs[] | {file_path, module, message}'
```

或者在浏览器中访问：
```
http://localhost:3001/api/logs?module=Task_queues&limit=10
```

### 方法3：使用 psql 命令行

```bash
# 连接到数据库
psql -h localhost -U postgres -d trading_system

# 执行查询
SELECT DISTINCT file_path, COUNT(*) as count
FROM system_logs
WHERE module = 'Task_queues'
GROUP BY file_path
ORDER BY count DESC
LIMIT 10;
```

## 📊 根据查询结果处理

### 如果文件路径是 `strategy-scheduler.service.ts`

说明应该映射到 `Strategy.Scheduler`，在 `api/src/utils/log-module-mapper.ts` 中添加：

```typescript
{
  pattern: /strategy-scheduler\.service\.ts$/,
  module: 'Strategy.Scheduler',
  chineseName: '策略调度器',
  description: '策略调度器：定时触发策略运行，管理策略生命周期',
}
```

### 如果文件路径包含 `task-queues` 或 `task_queues`

添加对应的映射规则：

```typescript
{
  pattern: /task-queues|task_queues/i,
  module: 'Strategy.Scheduler',  // 根据实际功能决定
  chineseName: '策略调度器',
  description: '策略调度器：定时触发策略运行，管理策略生命周期',
}
```

### 如果文件路径是其他文件

根据文件的实际功能，决定映射到哪个模块。

## 🔍 查看示例日志

```sql
SELECT 
  timestamp,
  level,
  message,
  file_path,
  line_no
FROM system_logs
WHERE module = 'Task_queues'
ORDER BY timestamp DESC
LIMIT 5;
```

## ✅ 验证修复

添加映射规则后，新的日志应该使用正确的模块名称。可以：

1. 等待新日志生成
2. 或者手动触发一次策略执行
3. 查询新日志确认模块名称已更新

```sql
-- 查看最新的日志，确认模块名称
SELECT module, file_path, message
FROM system_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC
LIMIT 10;
```





