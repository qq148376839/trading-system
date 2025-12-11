-- Migration: 010_add_is_system_to_capital_allocations.sql
-- Add is_system column to capital_allocations table
-- Feature: Fix capital management account type identification (Feature 6)
-- Related PRD: docs/features/QUANT_TRADING_BUGFIX_PRD.md

-- Add is_system column
ALTER TABLE capital_allocations ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE;

-- Set GLOBAL account as system account
UPDATE capital_allocations SET is_system = TRUE WHERE name = 'GLOBAL';

-- Create index for query optimization
CREATE INDEX IF NOT EXISTS idx_capital_allocations_is_system ON capital_allocations(is_system);

-- Add column comment (using English to avoid encoding issues)
COMMENT ON COLUMN capital_allocations.is_system IS 'Whether this is a system account. System accounts cannot be deleted or have their names edited';

