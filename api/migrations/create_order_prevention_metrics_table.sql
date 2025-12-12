-- Order Duplicate Prevention Mechanism - Metrics Table
-- Records historical data of key metrics

CREATE TABLE IF NOT EXISTS order_prevention_metrics (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Position validation metrics
    position_validation_total INTEGER DEFAULT 0,
    position_validation_passed INTEGER DEFAULT 0,
    position_validation_failed INTEGER DEFAULT 0,
    
    -- Order deduplication metrics
    duplicate_order_prevented INTEGER DEFAULT 0,
    duplicate_order_by_cache INTEGER DEFAULT 0,
    duplicate_order_by_pending INTEGER DEFAULT 0,
    
    -- Short position detection metrics
    short_position_detected INTEGER DEFAULT 0,
    short_position_closed INTEGER DEFAULT 0,
    short_position_close_failed INTEGER DEFAULT 0,
    
    -- Trade push metrics
    trade_push_received INTEGER DEFAULT 0,
    trade_push_error INTEGER DEFAULT 0,
    
    -- Order rejection metrics
    order_rejected_by_position INTEGER DEFAULT 0,
    order_rejected_by_duplicate INTEGER DEFAULT 0,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_order_prevention_metrics_timestamp ON order_prevention_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_order_prevention_metrics_created_at ON order_prevention_metrics(created_at);

-- Add comments
COMMENT ON TABLE order_prevention_metrics IS 'Order duplicate prevention mechanism metrics table';
COMMENT ON COLUMN order_prevention_metrics.position_validation_total IS 'Total position validation count';
COMMENT ON COLUMN order_prevention_metrics.position_validation_passed IS 'Position validation passed count';
COMMENT ON COLUMN order_prevention_metrics.position_validation_failed IS 'Position validation failed count';
COMMENT ON COLUMN order_prevention_metrics.duplicate_order_prevented IS 'Total duplicate order prevented count';
COMMENT ON COLUMN order_prevention_metrics.duplicate_order_by_cache IS 'Duplicate order prevented by cache count';
COMMENT ON COLUMN order_prevention_metrics.duplicate_order_by_pending IS 'Duplicate order prevented by pending order check count';
COMMENT ON COLUMN order_prevention_metrics.short_position_detected IS 'Short position detected count';
COMMENT ON COLUMN order_prevention_metrics.short_position_closed IS 'Short position auto-closed success count';
COMMENT ON COLUMN order_prevention_metrics.short_position_close_failed IS 'Short position auto-closed failed count';
COMMENT ON COLUMN order_prevention_metrics.trade_push_received IS 'Trade push received count';
COMMENT ON COLUMN order_prevention_metrics.trade_push_error IS 'Trade push error count';
COMMENT ON COLUMN order_prevention_metrics.order_rejected_by_position IS 'Order rejected due to insufficient position count';
COMMENT ON COLUMN order_prevention_metrics.order_rejected_by_duplicate IS 'Order rejected due to duplicate submission count';

