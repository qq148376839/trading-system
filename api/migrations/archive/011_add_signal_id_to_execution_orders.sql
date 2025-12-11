-- Migration: 011_add_signal_id_to_execution_orders.sql
-- Add signal_id column to execution_orders table
-- Feature: Link signals with orders for status tracking (QUANT_ORDER_MANAGEMENT_REFACTOR_PRD.md - Solution B)

-- Add signal_id column
ALTER TABLE execution_orders 
ADD COLUMN IF NOT EXISTS signal_id INTEGER REFERENCES strategy_signals(id) ON DELETE SET NULL;

-- Create index for query optimization
CREATE INDEX IF NOT EXISTS idx_execution_orders_signal_id ON execution_orders(signal_id);

-- Add column comment (using English to avoid encoding issues)
COMMENT ON COLUMN execution_orders.signal_id IS 'Reference to strategy_signals table. Used to track signal execution status based on order status';

