-- 清理已废弃的 exitRules.maxHoldMinutes 字段（已被 theta_bleed PnL 轨迹检测替代）
UPDATE strategies
SET config = jsonb_set(
  config,
  '{exitRules}',
  (config->'exitRules') - 'maxHoldMinutes'
)
WHERE config->'exitRules' ? 'maxHoldMinutes';
