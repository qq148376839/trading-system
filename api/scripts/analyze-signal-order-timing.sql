-- 分析信号和订单的时间差分布
-- 用于确定回填脚本的最佳时间窗口

-- 1. 检查订单和信号的时间差分布
SELECT 
  CASE 
    WHEN time_diff <= 5 THEN '0-5分钟'
    WHEN time_diff <= 15 THEN '5-15分钟'
    WHEN time_diff <= 30 THEN '15-30分钟'
    WHEN time_diff <= 60 THEN '30-60分钟'
    WHEN time_diff <= 120 THEN '60-120分钟'
    ELSE '120分钟以上'
  END as time_range,
  COUNT(*) as potential_matches
FROM (
  SELECT 
    eo.order_id,
    ss.id as signal_id,
    ABS(EXTRACT(EPOCH FROM (eo.created_at - ss.created_at))) / 60 as time_diff
  FROM execution_orders eo
  CROSS JOIN strategy_signals ss
  WHERE eo.strategy_id = ss.strategy_id
    AND eo.symbol = ss.symbol
    AND (
      (eo.side = 'BUY' AND ss.signal_type = 'BUY')
      OR (eo.side = 'SELL' AND ss.signal_type = 'SELL')
    )
    AND eo.signal_id IS NULL  -- 只检查未关联的订单
    AND ss.status = 'PENDING'  -- 只检查PENDING状态的信号
) t
GROUP BY time_range
ORDER BY 
  CASE time_range
    WHEN '0-5分钟' THEN 1
    WHEN '5-15分钟' THEN 2
    WHEN '15-30分钟' THEN 3
    WHEN '30-60分钟' THEN 4
    WHEN '60-120分钟' THEN 5
    ELSE 6
  END;

-- 2. 检查PENDING信号的创建时间分布
SELECT 
  DATE(created_at) as date,
  COUNT(*) as signal_count,
  MIN(created_at) as earliest,
  MAX(created_at) as latest
FROM strategy_signals
WHERE status = 'PENDING'
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;

-- 3. 检查未关联订单的创建时间分布
SELECT 
  DATE(created_at) as date,
  COUNT(*) as order_count,
  MIN(created_at) as earliest,
  MAX(created_at) as latest
FROM execution_orders
WHERE signal_id IS NULL
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;

-- 4. 检查订单和信号的时间差（详细）
SELECT 
  eo.order_id,
  eo.symbol,
  eo.side,
  eo.created_at as order_time,
  ss.id as signal_id,
  ss.created_at as signal_time,
  ABS(EXTRACT(EPOCH FROM (eo.created_at - ss.created_at))) / 60 as time_diff_minutes
FROM execution_orders eo
CROSS JOIN strategy_signals ss
WHERE eo.strategy_id = ss.strategy_id
  AND eo.symbol = ss.symbol
  AND (
    (eo.side = 'BUY' AND ss.signal_type = 'BUY')
    OR (eo.side = 'SELL' AND ss.signal_type = 'SELL')
  )
  AND eo.signal_id IS NULL
  AND ss.status = 'PENDING'
ORDER BY time_diff_minutes
LIMIT 50;

