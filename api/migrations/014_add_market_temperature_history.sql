-- 市场温度历史表：存储实盘 Longport API 返回的真实温度
-- 用途：回测时读取真实温度替代估算值，对齐回测与实盘信号
-- 数据量：每5分钟一条，约每天80行

CREATE TABLE IF NOT EXISTS market_temperature_history (
    id BIGSERIAL PRIMARY KEY,
    timestamp BIGINT NOT NULL,          -- 毫秒时间戳（5分钟窗口对齐）
    value DECIMAL(5, 2) NOT NULL,       -- 温度值 0-100
    source VARCHAR(20) NOT NULL DEFAULT 'longport',  -- 数据来源
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_temp_hist_ts
  ON market_temperature_history (timestamp);
CREATE INDEX IF NOT EXISTS idx_temp_hist_ts_brin
  ON market_temperature_history USING BRIN (timestamp);
