-- 检查买入订单和信号（修正版）
-- 设置客户端编码为UTF-8
SET client_encoding = 'UTF8';

-- ============================================
-- 1. 检查订单表中的买入和卖出订单统计
-- ============================================
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

-- ============================================
-- 2. 查看所有订单详情（2025-12-17）
-- ============================================
SELECT 
    order_id,
    strategy_id,
    symbol,
    side,
    quantity,
    price,
    current_status,
    created_at,
    updated_at
FROM execution_orders
WHERE DATE(created_at) = '2025-12-17'
ORDER BY created_at DESC;

-- ============================================
-- 3. 检查买入订单（如果有）
-- ============================================
SELECT 
    order_id,
    strategy_id,
    symbol,
    side,
    quantity,
    price,
    current_status,
    created_at
FROM execution_orders
WHERE DATE(created_at) = '2025-12-17'
AND side = 'BUY'
ORDER BY created_at DESC;

-- ============================================
-- 4. 检查卖出订单详情
-- ============================================
SELECT 
    order_id,
    strategy_id,
    symbol,
    side,
    quantity,
    price,
    current_status,
    created_at
FROM execution_orders
WHERE DATE(created_at) = '2025-12-17'
AND side = 'SELL'
ORDER BY created_at DESC;

-- ============================================
-- 5. 检查信号表中的买入和卖出信号
-- ============================================
SELECT 
    signal_type,
    COUNT(*) as signal_count,
    COUNT(DISTINCT symbol) as symbol_count,
    MIN(created_at) as first_signal,
    MAX(created_at) as last_signal
FROM strategy_signals
WHERE DATE(created_at) = '2025-12-17'
GROUP BY signal_type
ORDER BY signal_type;

-- ============================================
-- 6. 查看所有信号详情（2025-12-17）
-- ============================================
SELECT 
    id,
    strategy_id,
    symbol,
    signal_type,
    price,
    status,
    reason,
    created_at
FROM strategy_signals
WHERE DATE(created_at) = '2025-12-17'
ORDER BY created_at DESC
LIMIT 50;

-- ============================================
-- 7. 检查买入信号（如果有）
-- ============================================
SELECT 
    id,
    strategy_id,
    symbol,
    signal_type,
    price,
    status,
    reason,
    created_at
FROM strategy_signals
WHERE DATE(created_at) = '2025-12-17'
AND signal_type = 'BUY'
ORDER BY created_at DESC;

-- ============================================
-- 8. 检查当前持仓（策略5）
-- ============================================
SELECT 
    id,
    strategy_id,
    symbol,
    side,
    quantity,
    avg_price,
    status,
    open_time,
    close_time,
    order_id
FROM auto_trades
WHERE strategy_id = 5
AND close_time IS NULL
ORDER BY open_time DESC;

-- ============================================
-- 9. 检查策略5的所有交易记录（2025-12-17）
-- ============================================
SELECT 
    id,
    strategy_id,
    symbol,
    side,
    quantity,
    avg_price,
    status,
    open_time,
    close_time
FROM auto_trades
WHERE strategy_id = 5
AND DATE(open_time) = '2025-12-17'
ORDER BY open_time DESC;

-- ============================================
-- 10. 检查订单和信号的关联情况
-- ============================================
SELECT 
    eo.order_id,
    eo.strategy_id,
    eo.symbol,
    eo.side as order_side,
    eo.current_status,
    eo.signal_id,
    ss.signal_type,
    ss.status as signal_status,
    eo.created_at as order_created_at,
    ss.created_at as signal_created_at
FROM execution_orders eo
LEFT JOIN strategy_signals ss ON eo.signal_id = ss.id
WHERE DATE(eo.created_at) = '2025-12-17'
ORDER BY eo.created_at DESC;

-- ============================================
-- 11. 检查未关联信号的订单
-- ============================================
SELECT 
    order_id,
    strategy_id,
    symbol,
    side,
    current_status,
    signal_id,
    created_at
FROM execution_orders
WHERE DATE(created_at) = '2025-12-17'
AND signal_id IS NULL
ORDER BY created_at DESC;

-- ============================================
-- 12. 检查策略实例状态（策略5）
-- ============================================
SELECT 
    id,
    strategy_id,
    symbol,
    current_state,
    context,
    last_updated
FROM strategy_instances
WHERE strategy_id = 5
ORDER BY last_updated DESC;




