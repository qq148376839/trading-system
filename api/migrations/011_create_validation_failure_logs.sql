-- ============================================================================
-- Database Migration Script: Create Validation Failure Logs Table
-- ============================================================================
-- Purpose: Create table to store short position validation failure logs
--
-- Usage:
--   psql -U postgres -d trading_db -f api\migrations\011_create_validation_failure_logs.sql
--
-- Related Issue: Log error "relation validation_failure_logs does not exist"
-- Error Code: 42P01
-- Occurrences: 780 times (from 2026-01-27 log analysis)
-- ============================================================================

-- Set client encoding to UTF-8
SET client_encoding = 'UTF8';

BEGIN;

-- Create validation_failure_logs table
CREATE TABLE IF NOT EXISTS validation_failure_logs (
  id SERIAL PRIMARY KEY,
  strategy_id INTEGER NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  failure_type VARCHAR(50) NOT NULL,
  reason TEXT,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Foreign key constraint
  CONSTRAINT fk_validation_logs_strategy
    FOREIGN KEY (strategy_id)
    REFERENCES strategies(id)
    ON DELETE CASCADE
);

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS idx_validation_logs_strategy_id
  ON validation_failure_logs(strategy_id);

CREATE INDEX IF NOT EXISTS idx_validation_logs_symbol
  ON validation_failure_logs(symbol);

CREATE INDEX IF NOT EXISTS idx_validation_logs_timestamp
  ON validation_failure_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_validation_logs_failure_type
  ON validation_failure_logs(failure_type);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_validation_logs_strategy_symbol
  ON validation_failure_logs(strategy_id, symbol, timestamp DESC);

-- Add table and column comments
COMMENT ON TABLE validation_failure_logs IS '卖空验证失败日志记录表 - 记录策略执行过程中卖空验证失败的情况';
COMMENT ON COLUMN validation_failure_logs.id IS '主键ID，自增';
COMMENT ON COLUMN validation_failure_logs.strategy_id IS '策略ID，关联 strategies 表';
COMMENT ON COLUMN validation_failure_logs.symbol IS '标的代码（如 TSLA.US, AAPL.US）';
COMMENT ON COLUMN validation_failure_logs.failure_type IS '失败类型（如 SHORT_VALIDATION_FAILED, MARGIN_CHECK_FAILED）';
COMMENT ON COLUMN validation_failure_logs.reason IS '失败原因详情';
COMMENT ON COLUMN validation_failure_logs.timestamp IS '失败时间';
COMMENT ON COLUMN validation_failure_logs.created_at IS '记录创建时间';

COMMIT;

-- Verification
DO $$
DECLARE
    table_exists BOOLEAN;
    index_count INTEGER;
BEGIN
    -- Check if table was created
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'validation_failure_logs'
    ) INTO table_exists;

    -- Count indexes
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes
    WHERE tablename = 'validation_failure_logs';

    IF table_exists THEN
        RAISE NOTICE '✓ Migration successful: validation_failure_logs table created';
        RAISE NOTICE '✓ Created % indexes for performance optimization', index_count;
    ELSE
        RAISE WARNING '✗ Migration may have failed: table not found';
    END IF;
END $$;

-- ============================================================================
-- Migration completed
--
-- Next steps:
--   1. Verify table creation: \d validation_failure_logs
--   2. Check indexes: \di validation_failure_logs*
--   3. Test insert: INSERT INTO validation_failure_logs (strategy_id, symbol, failure_type, reason, timestamp)
--                   VALUES (1, 'TEST.US', 'TEST', 'Test record', NOW());
--   4. Clean test data: DELETE FROM validation_failure_logs WHERE failure_type = 'TEST';
-- ============================================================================
