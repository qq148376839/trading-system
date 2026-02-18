-- ============================================================================
-- 013: 市场K线历史数据表
-- ============================================================================
-- 用途：存储 SPX、USD Index、BTC 的分钟级K线数据，供回测使用
-- 使用方法：
--   docker exec -i trading-postgres psql -U trading_user -d trading_db < api/migrations/013_add_market_kline_history.sql
-- 注意：所有语句使用 IF NOT EXISTS，可安全重复执行
-- ============================================================================

SET client_encoding = 'UTF8';

-- ============================================================================
-- 表 1：market_kline_history — K线数据主表
-- ============================================================================

CREATE TABLE IF NOT EXISTS market_kline_history (
    id BIGSERIAL PRIMARY KEY,
    source VARCHAR(20) NOT NULL,              -- 'SPX', 'USD_INDEX', 'BTC'
    period VARCHAR(10) NOT NULL DEFAULT '1m',
    timestamp BIGINT NOT NULL,                -- 毫秒时间戳（与 CandlestickData.timestamp 一致）
    open DECIMAL(20, 6) NOT NULL,
    high DECIMAL(20, 6) NOT NULL,
    low DECIMAL(20, 6) NOT NULL,
    close DECIMAL(20, 6) NOT NULL,
    volume DECIMAL(20, 4) NOT NULL DEFAULT 0,
    turnover DECIMAL(20, 4) NOT NULL DEFAULT 0,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_kline_source_period_ts UNIQUE (source, period, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_kline_source_period_ts ON market_kline_history (source, period, timestamp);
CREATE INDEX IF NOT EXISTS idx_kline_timestamp_brin ON market_kline_history USING BRIN (timestamp);

COMMENT ON TABLE market_kline_history IS '市场K线历史数据（SPX/USD_INDEX/BTC 分钟级）';
COMMENT ON COLUMN market_kline_history.source IS '数据源: SPX, USD_INDEX, BTC';
COMMENT ON COLUMN market_kline_history.period IS 'K线周期: 1m';
COMMENT ON COLUMN market_kline_history.timestamp IS '毫秒时间戳';

-- ============================================================================
-- 表 2：kline_collection_status — 采集监控表
-- ============================================================================

CREATE TABLE IF NOT EXISTS kline_collection_status (
    id SERIAL PRIMARY KEY,
    source VARCHAR(20) NOT NULL,
    period VARCHAR(10) NOT NULL DEFAULT '1m',
    collection_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_points_fetched INTEGER NOT NULL DEFAULT 0,
    data_points_inserted INTEGER NOT NULL DEFAULT 0,
    data_points_skipped INTEGER NOT NULL DEFAULT 0,
    earliest_timestamp BIGINT,
    latest_timestamp BIGINT,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_collection_status_source_time ON kline_collection_status (source, collection_time DESC);

COMMENT ON TABLE kline_collection_status IS 'K线数据采集状态监控表';

-- ============================================================================
-- 系统配置项
-- ============================================================================

INSERT INTO system_config (config_key, config_value, encrypted, description) VALUES
    ('kline_collection_enabled', 'true', false, 'K线历史数据采集总开关'),
    ('kline_collection_trading_interval_min', '60', false, 'K线采集间隔：交易时段（分钟）'),
    ('kline_collection_off_hours_interval_min', '240', false, 'K线采集间隔：非交易时段（分钟）'),
    ('kline_data_retention_days', '365', false, 'K线1m数据保留天数')
ON CONFLICT (config_key) DO UPDATE SET
    description = EXCLUDED.description,
    config_value = CASE
        WHEN system_config.config_value = '' OR system_config.config_value IS NULL THEN EXCLUDED.config_value
        ELSE system_config.config_value
    END,
    updated_at = CURRENT_TIMESTAMP;
