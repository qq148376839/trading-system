-- ============================================================================
-- 015: IV 历史表
-- ============================================================================
-- 用途：存储标的的 ATM 隐含波动率历史数据
-- 供 Schwartz 策略计算 IV Rank，判断当前 IV 在历史中的相对位置
-- ============================================================================

CREATE TABLE IF NOT EXISTS iv_history (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,         -- 标的代码 (QQQ.US)
    atm_iv DECIMAL(10, 6),               -- ATM 期权隐含波动率
    vix_value DECIMAL(10, 4),            -- 当时 VIX 值
    recorded_date DATE NOT NULL,         -- 记录日期
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(symbol, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_iv_history_symbol_date ON iv_history(symbol, recorded_date DESC);
