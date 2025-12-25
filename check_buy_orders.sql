-- 检查买入订单和信号
-- 设置客户端编码为UTF-8
SET client_encoding = 'UTF8';

-- 方法1: 只查询BUY（不包含中文）
SELECT 
    id,
    created_at,
    module,
    level,
    message,
    trace_id
FROM strategy_execution_logs
WHERE DATE(created_at) = '2025-12-17'
AND (message LIKE '%BUY%' OR message ILIKE '%buy%')
ORDER BY created_at DESC
LIMIT 50;

-- 方法2: 检查订单表中的买入订单
SELECT 
    order_id,
    strategy_id,
    symbol,
    side,
    quantity,
    price,
    status,
    created_at
FROM execution_orders
WHERE DATE(created_at) = '2025-12-17'
AND side = 'BUY'
ORDER BY created_at DESC;

-- 方法3: 检查信号表中的买入信号
SELECT 
    id,
    strategy_id,
    symbol,
    side,
    action,
    status,
    created_at
FROM strategy_signals
WHERE DATE(created_at) = '2025-12-17'
AND (side = 'BUY' OR action = 'BUY')
ORDER BY created_at DESC;

-- 方法4: 检查策略执行日志（使用ASCII字符）
SELECT 
    id,
    created_at,
    module,
    level,
    CASE 
        WHEN message LIKE '%BUY%' THEN 'BUY found'
        WHEN message LIKE '%SELL%' THEN 'SELL found'
        ELSE 'Other'
    END as order_type,
    LEFT(message, 100) as message_preview
FROM strategy_execution_logs
WHERE DATE(created_at) = '2025-12-17'
AND (message LIKE '%BUY%' OR message LIKE '%SELL%')
ORDER BY created_at DESC
LIMIT 100;

-- 方法5: 统计买入和卖出订单数量
SELECT 
    side,
    COUNT(*) as order_count,
    COUNT(DISTINCT symbol) as symbol_count,
    MIN(created_at) as first_order,
    MAX(created_at) as last_order
FROM execution_orders
WHERE DATE(created_at) = '2025-12-17'
GROUP BY side
ORDER BY side;

-- 方法6: 检查资金状态
SELECT 
    strategy_id,
    total_capital,
    allocated_capital,
    available_capital,
    updated_at
FROM strategy_capital
WHERE DATE(updated_at) = '2025-12-17'
ORDER BY strategy_id;

-- 方法7: 检查当前持仓
SELECT 
    strategy_id,
    symbol,
    side,
    quantity,
    open_price,
    open_time,
    close_time
FROM auto_trades
WHERE strategy_id = 5
AND close_time IS NULL
ORDER BY open_time DESC;




