-- Migration: 012_backfill_signal_id_and_status.sql
-- Backfill signal_id for historical orders and update signal statuses
-- Feature: Historical data repair for signal-order association
--
-- ⚠️ IMPORTANT: This script is for DATA BACKFILL only, NOT for initialization
--    - Do NOT run this script during database initialization
--    - Run this script only if you need to repair historical data
--    - New orders will automatically have signal_id set (via application code)
--    - This script uses time-window matching (±5 minutes) to associate historical orders with signals

-- Step 1: Backfill signal_id for historical orders using time window matching
-- Match signals to orders by: strategy_id, symbol, side, and created_at (within ±5 minutes)
-- Priority: Prefer signals created before order creation time (most recent), then closest time
UPDATE execution_orders eo
SET signal_id = (
  SELECT ss.id
  FROM strategy_signals ss
  WHERE ss.strategy_id = eo.strategy_id
    AND ss.symbol = eo.symbol
    AND ss.signal_type = CASE 
      WHEN eo.side = 'BUY' OR eo.side = '1' THEN 'BUY'
      WHEN eo.side = 'SELL' OR eo.side = '2' THEN 'SELL'
      ELSE NULL
    END
    AND ss.created_at >= eo.created_at - INTERVAL '5 minutes'
    AND ss.created_at <= eo.created_at + INTERVAL '5 minutes'
    AND ss.status = 'PENDING'
  ORDER BY 
    CASE 
      WHEN ss.created_at <= eo.created_at THEN 0  -- Prefer signals before order creation
      ELSE 1  -- Then signals after order creation
    END,
    ABS(EXTRACT(EPOCH FROM (ss.created_at - eo.created_at)))  -- Among same priority, choose closest
  LIMIT 1
)
WHERE eo.signal_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM strategy_signals ss
    WHERE ss.strategy_id = eo.strategy_id
      AND ss.symbol = eo.symbol
      AND ss.signal_type = CASE 
        WHEN eo.side = 'BUY' OR eo.side = '1' THEN 'BUY'
        WHEN eo.side = 'SELL' OR eo.side = '2' THEN 'SELL'
        ELSE NULL
      END
      AND ss.created_at >= eo.created_at - INTERVAL '5 minutes'
      AND ss.created_at <= eo.created_at + INTERVAL '5 minutes'
      AND ss.status = 'PENDING'
  );

-- Step 2: Update signal statuses based on order statuses
-- For filled orders (FilledStatus, PartialFilledStatus) -> EXECUTED
UPDATE strategy_signals ss
SET status = 'EXECUTED'
WHERE ss.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM execution_orders eo
    WHERE eo.signal_id = ss.id
      AND eo.current_status IN ('FILLED', 'PARTIALLY_FILLED', 'FilledStatus', 'PartialFilledStatus')
  );

-- For cancelled orders (CanceledStatus, PendingCancelStatus, WaitToCancel) -> IGNORED
UPDATE strategy_signals ss
SET status = 'IGNORED'
WHERE ss.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM execution_orders eo
    WHERE eo.signal_id = ss.id
      AND eo.current_status IN ('CANCELLED', 'CanceledStatus', 'PendingCancelStatus', 'WaitToCancel')
  );

-- For rejected orders (RejectedStatus) -> REJECTED
UPDATE strategy_signals ss
SET status = 'REJECTED'
WHERE ss.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM execution_orders eo
    WHERE eo.signal_id = ss.id
      AND eo.current_status IN ('FAILED', 'REJECTED', 'RejectedStatus')
  );

-- Step 3: Also update signals for orders that were matched but don't have signal_id set yet
-- (Fallback: update signals directly using time window matching)
UPDATE strategy_signals ss
SET status = 'EXECUTED'
WHERE ss.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM execution_orders eo
    WHERE eo.strategy_id = ss.strategy_id
      AND eo.symbol = ss.symbol
      AND eo.side = CASE 
        WHEN ss.signal_type = 'BUY' THEN 'BUY'
        WHEN ss.signal_type = 'SELL' THEN 'SELL'
        ELSE NULL
      END
      AND eo.created_at >= ss.created_at - INTERVAL '5 minutes'
      AND eo.created_at <= ss.created_at + INTERVAL '5 minutes'
      AND eo.current_status IN ('FILLED', 'PARTIALLY_FILLED', 'FilledStatus', 'PartialFilledStatus')
      AND eo.signal_id IS NULL
  );

UPDATE strategy_signals ss
SET status = 'IGNORED'
WHERE ss.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM execution_orders eo
    WHERE eo.strategy_id = ss.strategy_id
      AND eo.symbol = ss.symbol
      AND eo.side = CASE 
        WHEN ss.signal_type = 'BUY' THEN 'BUY'
        WHEN ss.signal_type = 'SELL' THEN 'SELL'
        ELSE NULL
      END
      AND eo.created_at >= ss.created_at - INTERVAL '5 minutes'
      AND eo.created_at <= ss.created_at + INTERVAL '5 minutes'
      AND eo.current_status IN ('CANCELLED', 'CanceledStatus', 'PendingCancelStatus', 'WaitToCancel')
      AND eo.signal_id IS NULL
  );

UPDATE strategy_signals ss
SET status = 'REJECTED'
WHERE ss.status = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM execution_orders eo
    WHERE eo.strategy_id = ss.strategy_id
      AND eo.symbol = ss.symbol
      AND eo.side = CASE 
        WHEN ss.signal_type = 'BUY' THEN 'BUY'
        WHEN ss.signal_type = 'SELL' THEN 'SELL'
        ELSE NULL
      END
      AND eo.created_at >= ss.created_at - INTERVAL '5 minutes'
      AND eo.created_at <= ss.created_at + INTERVAL '5 minutes'
      AND eo.current_status IN ('FAILED', 'REJECTED', 'RejectedStatus')
      AND eo.signal_id IS NULL
  );

-- Add comment
COMMENT ON COLUMN execution_orders.signal_id IS 'Reference to strategy_signals table. Backfilled for historical orders using time window matching (±5 minutes).';

