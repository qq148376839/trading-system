-- 诊断 Task_queues 模块的来源
-- 查询数据库中 Task_queues 模块的日志，查看实际的文件路径

-- 1. 查看 Task_queues 模块的日志数量和文件路径分布
SELECT 
  file_path,
  COUNT(*) as log_count,
  MIN(timestamp) as first_log,
  MAX(timestamp) as last_log
FROM system_logs
WHERE module = 'Task_queues'
GROUP BY file_path
ORDER BY log_count DESC
LIMIT 20;

-- 2. 查看 Task_queues 模块的示例日志
SELECT 
  id,
  timestamp,
  level,
  module,
  message,
  file_path,
  line_no
FROM system_logs
WHERE module = 'Task_queues'
ORDER BY timestamp DESC
LIMIT 10;

-- 3. 查看所有使用下划线命名的模块（可能还有其他类似问题）
SELECT DISTINCT module
FROM system_logs
WHERE module LIKE '%\_%' ESCAPE '\'
ORDER BY module;

-- 4. 统计各模块的日志数量（帮助了解模块使用情况）
SELECT 
  module,
  COUNT(*) as log_count,
  COUNT(DISTINCT DATE(timestamp)) as days_active
FROM system_logs
GROUP BY module
ORDER BY log_count DESC
LIMIT 30;





