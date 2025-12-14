-- 添加回测诊断日志字段
-- 创建时间: 2025-12-12
-- 描述: 为回测结果表添加诊断日志字段，用于记录为什么没有交易数据

-- 添加诊断日志字段
DO $$
BEGIN
    -- 添加诊断日志字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'diagnostic_log'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN diagnostic_log JSONB;
    END IF;
END $$;

-- 添加注释
COMMENT ON COLUMN backtest_results.diagnostic_log IS '回测诊断日志（记录信号生成、买入尝试、失败原因等）';

