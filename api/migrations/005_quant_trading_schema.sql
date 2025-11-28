-- Quantitative Trading System Database Schema
-- Created: 2025-01-28
-- Description: Phase 1 - Core engine and stock selection/capital framework

-- 1. Capital Allocations Table
CREATE TABLE IF NOT EXISTS capital_allocations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    parent_id INTEGER REFERENCES capital_allocations(id),
    allocation_type VARCHAR(20) NOT NULL CHECK (allocation_type IN ('PERCENTAGE', 'FIXED_AMOUNT')),
    allocation_value DECIMAL(15, 4) NOT NULL,
    current_usage DECIMAL(15, 4) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Strategies Configuration Table
CREATE TABLE IF NOT EXISTS strategies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    capital_allocation_id INTEGER REFERENCES capital_allocations(id),
    symbol_pool_config JSONB NOT NULL,
    config JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'STOPPED' CHECK (status IN ('RUNNING', 'STOPPED', 'PAUSED', 'ERROR')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. Strategy Instances State Table
CREATE TABLE IF NOT EXISTS strategy_instances (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    current_state VARCHAR(50) NOT NULL CHECK (current_state IN ('IDLE', 'OPENING', 'HOLDING', 'CLOSING', 'COOLDOWN')),
    context JSONB,
    last_updated TIMESTAMP DEFAULT NOW(),
    UNIQUE(strategy_id, symbol)
);

-- 4. Strategy Signals Log Table
CREATE TABLE IF NOT EXISTS strategy_signals (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    symbol VARCHAR(20),
    signal_type VARCHAR(10) CHECK (signal_type IN ('BUY', 'SELL')),
    price DECIMAL(15, 4),
    reason TEXT,
    metadata JSONB,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'EXECUTED', 'REJECTED', 'IGNORED')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Auto Trades Record Table
CREATE TABLE IF NOT EXISTS auto_trades (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    symbol VARCHAR(20),
    side VARCHAR(10) CHECK (side IN ('BUY', 'SELL')),
    quantity INTEGER,
    avg_price DECIMAL(15, 4),
    pnl DECIMAL(15, 4),
    fees DECIMAL(10, 4),
    estimated_fees DECIMAL(10, 4),
    status VARCHAR(20) CHECK (status IN ('FILLED', 'PARTIALLY_FILLED')),
    open_time TIMESTAMP,
    close_time TIMESTAMP,
    order_id VARCHAR(50),
    charge_detail JSONB
);

-- 6. Execution Orders State Table
CREATE TABLE IF NOT EXISTS execution_orders (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    symbol VARCHAR(20),
    order_id VARCHAR(50) UNIQUE,
    client_order_id VARCHAR(50),
    side VARCHAR(10),
    quantity INTEGER,
    price DECIMAL(15, 4),
    current_status VARCHAR(20),
    execution_stage INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 7. Stock Blacklist Table
CREATE TABLE IF NOT EXISTS stock_blacklist (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(100)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_capital_allocations_parent ON capital_allocations(parent_id);
CREATE INDEX IF NOT EXISTS idx_strategies_capital_allocation ON strategies(capital_allocation_id);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies(status);
CREATE INDEX IF NOT EXISTS idx_strategy_instances_strategy_symbol ON strategy_instances(strategy_id, symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_instances_state ON strategy_instances(current_state);
CREATE INDEX IF NOT EXISTS idx_signals_strategy_created ON strategy_signals(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status ON strategy_signals(status);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_symbol ON auto_trades(strategy_id, symbol);
CREATE INDEX IF NOT EXISTS idx_trades_open_time ON auto_trades(open_time DESC);
CREATE INDEX IF NOT EXISTS idx_execution_orders_status ON execution_orders(current_status);
CREATE INDEX IF NOT EXISTS idx_execution_orders_strategy ON execution_orders(strategy_id, symbol);
CREATE INDEX IF NOT EXISTS idx_execution_orders_order_id ON execution_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_symbol ON stock_blacklist(symbol);

-- Initialize root capital account
-- Note: Actual balance needs to be fetched from Longbridge SDK
INSERT INTO capital_allocations (name, parent_id, allocation_type, allocation_value)
VALUES ('GLOBAL', NULL, 'PERCENTAGE', 1.0)
ON CONFLICT DO NOTHING;
