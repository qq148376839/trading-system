-- Backtest Results Table
-- Created: 2025-12-03
-- Description: Store strategy backtest results

CREATE TABLE IF NOT EXISTS backtest_results (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    config JSONB,  -- Backtest configuration
    result JSONB,  -- Backtest result
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy ON backtest_results(strategy_id);
CREATE INDEX IF NOT EXISTS idx_backtest_results_dates ON backtest_results(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_backtest_results_created_at ON backtest_results(created_at DESC);

COMMENT ON TABLE backtest_results IS 'Strategy backtest results table';
COMMENT ON COLUMN backtest_results.strategy_id IS 'Strategy ID';
COMMENT ON COLUMN backtest_results.start_date IS 'Backtest start date';
COMMENT ON COLUMN backtest_results.end_date IS 'Backtest end date';
COMMENT ON COLUMN backtest_results.config IS 'Backtest configuration (JSONB)';
COMMENT ON COLUMN backtest_results.result IS 'Backtest result (JSONB)';
COMMENT ON COLUMN backtest_results.created_at IS 'Created timestamp';
