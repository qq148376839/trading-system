-- Add status and error_message columns to backtest_results table
-- Created: 2025-12-03
-- Description: Support async backtest execution

ALTER TABLE backtest_results 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'COMPLETED',
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Update existing records to COMPLETED status
UPDATE backtest_results SET status = 'COMPLETED' WHERE status IS NULL;

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_backtest_results_status ON backtest_results(status);

COMMENT ON COLUMN backtest_results.status IS 'Backtest status: PENDING, RUNNING, COMPLETED, FAILED';
COMMENT ON COLUMN backtest_results.error_message IS 'Error message if backtest failed';
COMMENT ON COLUMN backtest_results.started_at IS 'Backtest start timestamp';
COMMENT ON COLUMN backtest_results.completed_at IS 'Backtest completion timestamp';
COMMENT ON COLUMN backtest_results.updated_at IS 'Last update timestamp';

