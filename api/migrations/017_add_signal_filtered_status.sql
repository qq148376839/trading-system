-- 新增 FILTERED 状态：竞价淘汰的信号标记为 FILTERED，区分于 PENDING
ALTER TABLE strategy_signals DROP CONSTRAINT IF EXISTS strategy_signals_status_check;
ALTER TABLE strategy_signals ADD CONSTRAINT strategy_signals_status_check
  CHECK (status IN ('PENDING', 'EXECUTED', 'REJECTED', 'IGNORED', 'FILTERED'));
