-- 日志系统节流+摘要配置
-- 添加节流和摘要相关的系统配置项

INSERT INTO system_config (config_key, config_value, encrypted, description, updated_by)
VALUES
  ('log_throttle_enabled', 'true', false, '启用日志节流（同一消息模板在窗口内只写一条到库）', 'migration'),
  ('log_throttle_window_seconds', '30', false, '日志节流窗口时间（秒）', 'migration'),
  ('log_digest_enabled', 'true', false, '启用日志摘要（高频指标定期聚合写入）', 'migration'),
  ('log_digest_interval_minutes', '5', false, '日志摘要刷新间隔（分钟）', 'migration'),
  ('log_debug_to_db', 'false', false, '应急开关：启用 DEBUG 级别日志入库（默认关闭以减少DB压力）', 'migration')
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  description = EXCLUDED.description,
  updated_by = 'migration',
  updated_at = CURRENT_TIMESTAMP;
