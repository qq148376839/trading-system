-- ============================================================================
-- Migration 012: Create option strategy decision logs table
-- ============================================================================
-- Purpose: 记录期权策略的完整决策链路，用于分析未下单原因
-- Created: 2026-02-05
--
-- Background:
-- 期权策略有9个关键检查点，之前只输出到console，无法事后分析。
-- 此表用于记录所有检查点的决策数据，仅在美股交易时间写入。
--
-- ============================================================================

-- 创建期权策略决策日志表
CREATE TABLE IF NOT EXISTS option_strategy_decision_logs (
    id BIGSERIAL PRIMARY KEY,

    -- 基本信息
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    underlying_symbol VARCHAR(20) NOT NULL,
    execution_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 检查点1: 市场数据充足性
    data_check_spx_count INTEGER,
    data_check_usd_count INTEGER,
    data_check_btc_count INTEGER,
    data_check_vix_available BOOLEAN,
    data_check_temperature_available BOOLEAN,
    data_check_passed BOOLEAN DEFAULT false,
    data_check_error TEXT,

    -- 检查点2: 信号方向判定
    signal_direction VARCHAR(10) CHECK (signal_direction IN ('CALL', 'PUT', 'HOLD')),
    signal_confidence INTEGER,
    signal_market_score DECIMAL(10, 2),
    signal_intraday_score DECIMAL(10, 2),
    signal_time_adjustment DECIMAL(10, 2),
    signal_final_score DECIMAL(10, 2),

    -- 检查点3: 风险等级评估
    risk_level VARCHAR(20) CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'EXTREME')),
    risk_vix_value DECIMAL(10, 2),
    risk_temperature_value DECIMAL(10, 2),
    risk_score INTEGER,
    risk_blocked BOOLEAN DEFAULT false,

    -- 检查点4: 0DTE期权可用性
    dte_check_mode VARCHAR(10),
    dte_check_available BOOLEAN,
    dte_check_expiry_date VARCHAR(20),
    dte_check_left_days INTEGER,

    -- 检查点5: 期权链数据
    chain_contracts_count INTEGER,
    chain_strike_range_min DECIMAL(15, 4),
    chain_strike_range_max DECIMAL(15, 4),
    chain_data_available BOOLEAN DEFAULT false,

    -- 检查点6+7: 流动性和Greeks筛选
    filter_candidates_before INTEGER,
    filter_liquidity_passed INTEGER,
    filter_greeks_passed INTEGER,
    filter_final_selected BOOLEAN DEFAULT false,
    filter_reason TEXT,

    -- 检查点8: 入场价格有效性
    price_mode VARCHAR(10),
    price_ask DECIMAL(15, 4),
    price_bid DECIMAL(15, 4),
    price_mid DECIMAL(15, 4),
    price_selected DECIMAL(15, 4),
    price_valid BOOLEAN DEFAULT false,

    -- 检查点9: 信号生成结果
    signal_generated BOOLEAN DEFAULT false,
    signal_id INTEGER REFERENCES strategy_signals(id) ON DELETE SET NULL,
    option_symbol VARCHAR(50),
    option_contracts INTEGER,
    option_premium DECIMAL(15, 4),
    option_delta DECIMAL(10, 4),
    option_theta DECIMAL(10, 4),
    estimated_cost DECIMAL(15, 4),

    -- 最终结果和原因
    final_result VARCHAR(20) CHECK (final_result IN ('SIGNAL_GENERATED', 'NO_SIGNAL', 'ERROR')) NOT NULL,
    rejection_reason TEXT,
    rejection_checkpoint VARCHAR(50), -- 在哪个检查点被拒绝

    -- 额外数据（JSON格式，用于存储更多诊断信息）
    extra_data JSONB,

    -- 索引时间戳
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_option_decision_logs_strategy_time
    ON option_strategy_decision_logs(strategy_id, execution_time DESC);

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_symbol
    ON option_strategy_decision_logs(underlying_symbol);

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_result
    ON option_strategy_decision_logs(final_result);

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_rejection_checkpoint
    ON option_strategy_decision_logs(rejection_checkpoint) WHERE rejection_checkpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_execution_time
    ON option_strategy_decision_logs(execution_time DESC);

-- GIN索引用于JSONB查询
CREATE INDEX IF NOT EXISTS idx_option_decision_logs_extra_data
    ON option_strategy_decision_logs USING GIN(extra_data);

-- 添加表注释
COMMENT ON TABLE option_strategy_decision_logs IS '期权策略决策链路日志表，记录9个关键检查点的详细数据';
COMMENT ON COLUMN option_strategy_decision_logs.id IS '主键，自增';
COMMENT ON COLUMN option_strategy_decision_logs.strategy_id IS '策略ID，外键关联strategies表';
COMMENT ON COLUMN option_strategy_decision_logs.underlying_symbol IS '底层标的代码（如QQQ.US）';
COMMENT ON COLUMN option_strategy_decision_logs.execution_time IS '执行时间（美东时间）';
COMMENT ON COLUMN option_strategy_decision_logs.data_check_passed IS '数据检查是否通过';
COMMENT ON COLUMN option_strategy_decision_logs.signal_direction IS '推荐信号方向（CALL/PUT/HOLD）';
COMMENT ON COLUMN option_strategy_decision_logs.signal_confidence IS '信号置信度（0-100）';
COMMENT ON COLUMN option_strategy_decision_logs.risk_level IS '风险等级评估结果';
COMMENT ON COLUMN option_strategy_decision_logs.risk_blocked IS '是否因风险过高被阻止';
COMMENT ON COLUMN option_strategy_decision_logs.dte_check_mode IS '到期模式（0DTE/NEAREST）';
COMMENT ON COLUMN option_strategy_decision_logs.filter_final_selected IS '是否最终筛选出合约';
COMMENT ON COLUMN option_strategy_decision_logs.price_valid IS '入场价格是否有效';
COMMENT ON COLUMN option_strategy_decision_logs.signal_generated IS '是否成功生成交易信号';
COMMENT ON COLUMN option_strategy_decision_logs.final_result IS '最终结果（SIGNAL_GENERATED/NO_SIGNAL/ERROR）';
COMMENT ON COLUMN option_strategy_decision_logs.rejection_reason IS '被拒绝的原因描述';
COMMENT ON COLUMN option_strategy_decision_logs.rejection_checkpoint IS '在哪个检查点被拒绝（1-9）';

-- 查询示例（添加到注释中供参考）
-- 1. 查询最近24小时未生成信号的原因统计
-- SELECT rejection_checkpoint, rejection_reason, COUNT(*) as count
-- FROM option_strategy_decision_logs
-- WHERE execution_time > NOW() - INTERVAL '24 hours'
--   AND final_result = 'NO_SIGNAL'
-- GROUP BY rejection_checkpoint, rejection_reason
-- ORDER BY count DESC;

-- 2. 查询特定标的的决策历史
-- SELECT execution_time, signal_direction, signal_confidence, risk_level, final_result, rejection_reason
-- FROM option_strategy_decision_logs
-- WHERE underlying_symbol = 'QQQ.US'
-- ORDER BY execution_time DESC
-- LIMIT 100;

-- 3. 查询因风险过高被阻止的记录
-- SELECT underlying_symbol, execution_time, risk_level, risk_vix_value, risk_temperature_value
-- FROM option_strategy_decision_logs
-- WHERE risk_blocked = true
-- ORDER BY execution_time DESC;
