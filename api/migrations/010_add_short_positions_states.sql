-- ============================================================================
-- Database Migration Script: Add Short Position States
-- ============================================================================
-- Purpose: Extend strategy_instances.current_state field to support short position states
-- 
-- New States:
--   - SHORTING: Shorting (submitted short order, waiting for fill)
--   - SHORT: Short position (holding short position)
--   - COVERING: Covering (submitted buy-to-cover order, waiting for fill)
-- 
-- Usage:
--   psql -U postgres -d trading_db -f api\migrations\010_add_short_positions_states.sql
-- ============================================================================

-- Set client encoding to UTF-8
SET client_encoding = 'UTF8';

-- Note: PostgreSQL CHECK constraints cannot be modified directly
-- Need to drop the old CHECK constraint first, then add a new one

-- 1. Drop the old CHECK constraint
DO $$
BEGIN
    -- Check if old CHECK constraint exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'strategy_instances' 
        AND constraint_name LIKE '%current_state%'
        AND constraint_type = 'CHECK'
    ) THEN
        -- Drop the old CHECK constraint (find the actual constraint name)
        ALTER TABLE strategy_instances DROP CONSTRAINT IF EXISTS strategy_instances_current_state_check;
    END IF;
END $$;

-- 2. Add new CHECK constraint (including short position states)
ALTER TABLE strategy_instances 
    ADD CONSTRAINT strategy_instances_current_state_check 
    CHECK (current_state IN (
        'IDLE',           -- Idle state
        'OPENING',        -- Opening (long position)
        'HOLDING',        -- Holding (long position)
        'CLOSING',        -- Closing (closing long position)
        'SHORTING',       -- Shorting (opening short position) NEW
        'SHORT',          -- Short position (holding short position) NEW
        'COVERING',       -- Covering (closing short position) NEW
        'COOLDOWN'        -- Cooldown period
    ));

-- 3. Add column comment
COMMENT ON COLUMN strategy_instances.current_state IS 'Strategy instance state:
    IDLE - Idle state
    OPENING - Opening (long position)
    HOLDING - Holding (long position)
    CLOSING - Closing (closing long position)
    SHORTING - Shorting (opening short position)
    SHORT - Short position (holding short position)
    COVERING - Covering (closing short position)
    COOLDOWN - Cooldown period';

-- 4. Verify migration result
DO $$
DECLARE
    constraint_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'strategy_instances' 
        AND constraint_name = 'strategy_instances_current_state_check'
        AND constraint_type = 'CHECK'
    ) INTO constraint_exists;
    
    IF constraint_exists THEN
        RAISE NOTICE 'Migration successful: strategy_instances.current_state now supports short position states';
    ELSE
        RAISE WARNING 'Migration may have failed: new CHECK constraint not found';
    END IF;
END $$;

