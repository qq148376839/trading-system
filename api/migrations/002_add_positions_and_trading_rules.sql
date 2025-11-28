-- Database migration script: Add positions and trading_rules tables
-- Version: 002
-- Date: 2024-12

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL UNIQUE,
    symbol_name VARCHAR(200),
    quantity INTEGER NOT NULL DEFAULT 0,
    available_quantity INTEGER NOT NULL DEFAULT 0,
    cost_price DECIMAL(20, 4) NOT NULL DEFAULT 0,
    current_price DECIMAL(20, 4) NOT NULL DEFAULT 0,
    market_value DECIMAL(20, 4) NOT NULL DEFAULT 0,
    unrealized_pl DECIMAL(20, 4) NOT NULL DEFAULT 0,
    unrealized_pl_ratio DECIMAL(10, 4) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    position_side VARCHAR(10) NOT NULL DEFAULT 'Long',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_positions_quantity ON positions(quantity) WHERE quantity > 0;

-- Trading rules table
CREATE TABLE IF NOT EXISTS trading_rules (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    rule_name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, rule_name)
);

CREATE INDEX IF NOT EXISTS idx_trading_rules_symbol ON trading_rules(symbol);
CREATE INDEX IF NOT EXISTS idx_trading_rules_enabled ON trading_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_trading_rules_type ON trading_rules(rule_type);

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trading_rules_updated_at BEFORE UPDATE ON trading_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
