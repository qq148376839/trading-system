-- ============================================================================
-- 016: 期权交易K线存储 + 交易分析摘要
-- ============================================================================
-- 用途：
--   保存期权交易的正向 + 反向K线数据，避免期权过期后无法获取历史K线
--   同时保存每笔交易的分析摘要（原始盈亏 vs 反向模拟盈亏）
-- ============================================================================

SET client_encoding = 'UTF8';

-- ============================================================================
-- 表1: option_trade_kline — 期权交易K线存储（正向 + 反向共用）
-- ============================================================================

CREATE TABLE IF NOT EXISTS option_trade_kline (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(100) NOT NULL,
    symbol VARCHAR(80) NOT NULL,
    kline_type VARCHAR(10) NOT NULL CHECK (kline_type IN ('ORIGINAL', 'REVERSE')),
    underlying VARCHAR(20) NOT NULL,
    trade_date DATE NOT NULL,
    period VARCHAR(10) DEFAULT '1m',
    timestamp BIGINT NOT NULL,
    open DECIMAL(20, 6) NOT NULL,
    high DECIMAL(20, 6) NOT NULL,
    low DECIMAL(20, 6) NOT NULL,
    close DECIMAL(20, 6) NOT NULL,
    volume DECIMAL(20, 4) DEFAULT 0,
    turnover DECIMAL(20, 4) DEFAULT 0,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_option_kline_symbol_type_period_ts UNIQUE (symbol, kline_type, period, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_option_kline_order_id ON option_trade_kline(order_id);
CREATE INDEX IF NOT EXISTS idx_option_kline_trade_date ON option_trade_kline(trade_date);
CREATE INDEX IF NOT EXISTS idx_option_kline_symbol_type_ts ON option_trade_kline(symbol, kline_type, timestamp);

COMMENT ON TABLE option_trade_kline IS '期权交易K线存储（正向+反向），避免期权过期后数据丢失';
COMMENT ON COLUMN option_trade_kline.order_id IS '关联的订单 ID';
COMMENT ON COLUMN option_trade_kline.symbol IS '期权代码（正向或反向）';
COMMENT ON COLUMN option_trade_kline.kline_type IS 'ORIGINAL=实际交易期权 / REVERSE=反向期权';
COMMENT ON COLUMN option_trade_kline.underlying IS '标的代码（如 QQQ）';
COMMENT ON COLUMN option_trade_kline.trade_date IS '交易日期';
COMMENT ON COLUMN option_trade_kline.period IS 'K线周期（默认1m）';
COMMENT ON COLUMN option_trade_kline.timestamp IS '毫秒时间戳';

-- ============================================================================
-- 表2: option_trade_analysis — 每笔交易的分析摘要
-- ============================================================================

CREATE TABLE IF NOT EXISTS option_trade_analysis (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(100) UNIQUE,
    original_symbol VARCHAR(80),
    reverse_symbol VARCHAR(80),
    underlying VARCHAR(20),
    trade_date DATE,
    strategy VARCHAR(30),
    direction VARCHAR(20),
    original_entry_price DECIMAL(20, 6),
    original_exit_price DECIMAL(20, 6),
    original_qty INTEGER,
    original_pnl DECIMAL(20, 6),
    original_pnl_pct DECIMAL(10, 4),
    reverse_price_at_entry DECIMAL(20, 6),
    reverse_price_at_exit DECIMAL(20, 6),
    reverse_pnl DECIMAL(20, 6),
    reverse_pnl_pct DECIMAL(10, 4),
    reverse_high DECIMAL(20, 6),
    reverse_low DECIMAL(20, 6),
    entry_time TIMESTAMPTZ,
    exit_time TIMESTAMPTZ,
    signal_score DECIMAL(10, 4),
    exit_type VARCHAR(30),
    original_candle_count INTEGER DEFAULT 0,
    reverse_candle_count INTEGER DEFAULT 0,
    collection_status VARCHAR(20) DEFAULT 'PENDING' CHECK (collection_status IN ('PENDING', 'SUCCESS', 'PARTIAL', 'FAILED', 'NO_DATA')),
    error_message TEXT,
    collected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_analysis_trade_date ON option_trade_analysis(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_option_analysis_underlying_date ON option_trade_analysis(underlying, trade_date);
CREATE INDEX IF NOT EXISTS idx_option_analysis_status ON option_trade_analysis(collection_status);

COMMENT ON TABLE option_trade_analysis IS '期权交易分析摘要（原始 vs 反向模拟盈亏对比）';
COMMENT ON COLUMN option_trade_analysis.order_id IS '订单 ID（唯一）';
COMMENT ON COLUMN option_trade_analysis.original_symbol IS '实际交易的期权代码';
COMMENT ON COLUMN option_trade_analysis.reverse_symbol IS '反向期权代码';
COMMENT ON COLUMN option_trade_analysis.strategy IS '策略类型 (BULL_SPREAD/BEAR_SPREAD/REVERSE_BEAR)';
COMMENT ON COLUMN option_trade_analysis.direction IS '方向 (BULL/BEAR/REV_BEAR)';
COMMENT ON COLUMN option_trade_analysis.reverse_price_at_entry IS '反向期权在买入时刻的价格';
COMMENT ON COLUMN option_trade_analysis.reverse_price_at_exit IS '反向期权在卖出时刻的价格';
COMMENT ON COLUMN option_trade_analysis.reverse_high IS '持仓期间反向期权最高价';
COMMENT ON COLUMN option_trade_analysis.reverse_low IS '持仓期间反向期权最低价';
COMMENT ON COLUMN option_trade_analysis.collection_status IS 'PENDING/SUCCESS/PARTIAL/FAILED/NO_DATA';

-- ============================================================================
-- 配置项
-- ============================================================================

INSERT INTO system_config (config_key, config_value, encrypted, description) VALUES
    ('option_kline_collection_enabled', 'true', false, '期权K线采集总开关'),
    ('option_kline_collection_delay_minutes', '5', false, '收盘后延迟采集分钟数（默认5分钟）')
ON CONFLICT (config_key) DO UPDATE SET
    description = EXCLUDED.description,
    config_value = CASE
        WHEN system_config.config_value = '' OR system_config.config_value IS NULL THEN EXCLUDED.config_value
        ELSE system_config.config_value
    END,
    updated_at = CURRENT_TIMESTAMP;
