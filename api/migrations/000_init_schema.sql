-- ============================================================================
-- 统一数据库初始化脚本
-- ============================================================================
-- 用途：
--   1. 新项目初始化：直接运行此脚本创建所有表结构
--   2. 已有项目更新：脚本使用 IF NOT EXISTS 和 ON CONFLICT，可安全重复运行
-- 
-- 使用方法：
--   psql -U postgres -d trading_db -f api\migrations\000_init_schema.sql
--   或者设置环境变量：set PGCLIENTENCODING=UTF8
-- 
-- 注意：
--   运行此脚本后，需要创建管理员账户：
--   node scripts/create-admin.js admin your_password
-- ============================================================================

-- 设置客户端编码为UTF-8，避免中文注释编码错误
SET client_encoding = 'UTF8';

-- ============================================================================
-- 第一部分：基础表结构（001_initial_schema.sql）
-- ============================================================================

-- 更新updated_at的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 关注股票列表
CREATE TABLE IF NOT EXISTS watchlist (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist(symbol);
CREATE INDEX IF NOT EXISTS idx_watchlist_enabled ON watchlist(enabled);

-- 为watchlist表创建触发器
DROP TRIGGER IF EXISTS update_watchlist_updated_at ON watchlist;
CREATE TRIGGER update_watchlist_updated_at BEFORE UPDATE ON watchlist
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 行情数据历史
CREATE TABLE IF NOT EXISTS quotes (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    last_done DECIMAL(20, 4),
    prev_close DECIMAL(20, 4),
    open DECIMAL(20, 4),
    high DECIMAL(20, 4),
    low DECIMAL(20, 4),
    volume BIGINT,
    turnover DECIMAL(20, 4),
    timestamp BIGINT NOT NULL,
    trade_status INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quotes_symbol ON quotes(symbol);
CREATE INDEX IF NOT EXISTS idx_quotes_timestamp ON quotes(timestamp);
CREATE INDEX IF NOT EXISTS idx_quotes_symbol_timestamp ON quotes(symbol, timestamp);

-- 交易记录
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL, -- BUY, SELL
    quantity INTEGER NOT NULL,
    price DECIMAL(20, 4) NOT NULL,
    status VARCHAR(20) NOT NULL, -- PENDING, SUCCESS, FAILED, CANCELLED
    order_id VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);

-- 为trades表创建触发器
DROP TRIGGER IF EXISTS update_trades_updated_at ON trades;
CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON trades
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 用户配置
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL UNIQUE,
    value TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- 为settings表创建触发器
DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 第二部分：持仓和交易规则表（002_add_positions_and_trading_rules.sql）
-- ============================================================================

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

-- 为positions表创建触发器
DROP TRIGGER IF EXISTS update_positions_updated_at ON positions;
CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

-- 为trading_rules表创建触发器
DROP TRIGGER IF EXISTS update_trading_rules_updated_at ON trading_rules;
CREATE TRIGGER update_trading_rules_updated_at BEFORE UPDATE ON trading_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 第三部分：配置管理表（003_config_management.sql）
-- ============================================================================

-- System configuration table
CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT NOT NULL,
    encrypted BOOLEAN DEFAULT false,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_config_key ON system_config(config_key);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_admin_username ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_active ON admin_users(is_active);

-- Insert default configuration items
-- Auto-detection and update: Missing config items will be added, descriptions will be updated
-- User-set values will NOT be overwritten (only empty/default values are set)
INSERT INTO system_config (config_key, config_value, encrypted, description) VALUES
    ('longport_app_key', '', true, 'LongPort API App Key'),
    ('longport_app_secret', '', true, 'LongPort API App Secret'),
    ('longport_access_token', '', true, 'LongPort API Access Token'),
    ('longport_token_expired_at', '', false, 'Token expiration time (ISO8601 format)'),
    ('longport_token_issued_at', '', false, 'Token issued time (ISO8601 format)'),
    ('longport_enable_overnight', 'false', false, 'Enable US stock overnight trading'),
    ('longport_token_auto_refresh', 'true', false, 'Enable automatic token refresh (refresh when less than 10 days remaining)'),
    ('only_regular_hours', 'true', false, 'Only allow regular trading hours (true=regular hours only, false=include pre-market and after-hours)'),
    ('futunn_csrf_token', '', true, 'Futunn API CSRF Token'),
    ('futunn_cookies', '', true, 'Futunn API Cookies'),
    ('futunn_search_cookies', '', true, 'Futunn API Cookies for search endpoint (headfoot-search), separate from main API cookies'),
    ('longport_enable_option_quote', 'false', false, 'Enable LongPort API for option quotes (default: false, use Futunn API instead)'),
    ('server_port', '3001', false, 'API server port'),
    ('log_retention_days', '-1', false, '日志保留天数（-1表示不清理，默认不清理）'),
    ('log_auto_cleanup_enabled', 'false', false, '是否启用日志自动清理（true启用，false禁用）'),
    ('log_cleanup_schedule', '0 2 * * *', false, '日志清理执行时间（Cron表达式，默认每天凌晨2点）'),
    ('log_queue_size', '10000', false, '日志队列初始大小'),
    ('log_queue_min_size', '5000', false, '日志队列最小大小（动态调整下限）'),
    ('log_queue_max_size', '50000', false, '日志队列最大大小（动态调整上限）'),
    ('log_batch_size', '100', false, '日志批量写入大小（每次写入数据库的日志条数）'),
    ('log_batch_interval', '1000', false, '日志批量写入间隔（毫秒）'),
    ('log_throttle_enabled', 'true', false, '启用日志节流（同一消息模板在窗口内只写一条到库）'),
    ('log_throttle_window_seconds', '30', false, '日志节流窗口时间（秒）'),
    ('log_digest_enabled', 'true', false, '启用日志摘要（高频指标定期聚合写入）'),
    ('log_digest_interval_minutes', '5', false, '日志摘要刷新间隔（分钟）'),
    ('log_debug_to_db', 'false', false, '应急开关：启用 DEBUG 级别日志入库（默认关闭以减少DB压力）'),
    ('moomoo_guest_cookies', '[]', true, 'Moomoo多组游客Cookies（JSON数组）'),
    ('moomoo_edge_function_url', 'https://moomoo-api.riowang.win', false, 'Moomoo边缘函数代理URL'),
    ('use_moomoo_edge_function', 'true', false, '是否启用Moomoo边缘函数代理（true启用，false直连moomoo.com）')
ON CONFLICT (config_key) DO UPDATE SET 
    -- Update description if it changed (always update for clarity)
    description = EXCLUDED.description,
    -- Update encrypted flag if it changed (e.g., if a config item changed from plain to encrypted)
    encrypted = EXCLUDED.encrypted,
    -- Only update config_value if current value is empty or matches old default
    -- This preserves user-set values while allowing default value updates
    config_value = CASE 
        WHEN system_config.config_value = '' OR system_config.config_value IS NULL THEN EXCLUDED.config_value
        ELSE system_config.config_value  -- Keep existing user-set value
    END,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================================
-- 第四部分：量化交易系统表（005_quant_trading_schema.sql）
-- ============================================================================

-- 1. Capital Allocations Table
CREATE TABLE IF NOT EXISTS capital_allocations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    parent_id INTEGER REFERENCES capital_allocations(id),
    allocation_type VARCHAR(20) NOT NULL CHECK (allocation_type IN ('PERCENTAGE', 'FIXED_AMOUNT')),
    allocation_value DECIMAL(15, 4) NOT NULL,
    current_usage DECIMAL(15, 4) DEFAULT 0,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capital_allocations_parent ON capital_allocations(parent_id);
CREATE INDEX IF NOT EXISTS idx_capital_allocations_is_system ON capital_allocations(is_system);

-- Add is_system column if it doesn't exist (for existing tables)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'capital_allocations' AND column_name = 'is_system'
    ) THEN
        ALTER TABLE capital_allocations ADD COLUMN is_system BOOLEAN DEFAULT FALSE;
        -- Set GLOBAL account as system account
        UPDATE capital_allocations SET is_system = TRUE WHERE name = 'GLOBAL';
    END IF;
END $$;

-- Add column comment (using English to avoid encoding issues)
COMMENT ON COLUMN capital_allocations.is_system IS 'Whether this is a system account. System accounts cannot be deleted or have their names edited';

-- 为capital_allocations表创建触发器
DROP TRIGGER IF EXISTS update_capital_allocations_updated_at ON capital_allocations;
CREATE TRIGGER update_capital_allocations_updated_at BEFORE UPDATE ON capital_allocations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

CREATE INDEX IF NOT EXISTS idx_strategies_capital_allocation ON strategies(capital_allocation_id);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies(status);

-- 为strategies表创建触发器
DROP TRIGGER IF EXISTS update_strategies_updated_at ON strategies;
CREATE TRIGGER update_strategies_updated_at BEFORE UPDATE ON strategies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Strategy Instances State Table
CREATE TABLE IF NOT EXISTS strategy_instances (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    current_state VARCHAR(50) NOT NULL CHECK (current_state IN ('IDLE', 'OPENING', 'HOLDING', 'CLOSING', 'SHORTING', 'SHORT', 'COVERING', 'COOLDOWN')),
    context JSONB,
    last_updated TIMESTAMP DEFAULT NOW(),
    UNIQUE(strategy_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_strategy_instances_strategy_symbol ON strategy_instances(strategy_id, symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_instances_state ON strategy_instances(current_state);

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

CREATE INDEX IF NOT EXISTS idx_signals_strategy_created ON strategy_signals(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status ON strategy_signals(status);

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

CREATE INDEX IF NOT EXISTS idx_trades_strategy_symbol ON auto_trades(strategy_id, symbol);
CREATE INDEX IF NOT EXISTS idx_trades_open_time ON auto_trades(open_time DESC);

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
    signal_id INTEGER REFERENCES strategy_signals(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_orders_status ON execution_orders(current_status);
CREATE INDEX IF NOT EXISTS idx_execution_orders_strategy ON execution_orders(strategy_id, symbol);
CREATE INDEX IF NOT EXISTS idx_execution_orders_order_id ON execution_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_execution_orders_signal_id ON execution_orders(signal_id);

-- Add signal_id column if it doesn't exist (for existing tables)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'execution_orders' AND column_name = 'signal_id'
    ) THEN
        ALTER TABLE execution_orders 
        ADD COLUMN signal_id INTEGER REFERENCES strategy_signals(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_execution_orders_signal_id ON execution_orders(signal_id);
    END IF;
END $$;

-- Add column comment (using English to avoid encoding issues)
COMMENT ON COLUMN execution_orders.signal_id IS 'Reference to strategy_signals table. Used to track signal execution status based on order status';

-- 为execution_orders表创建触发器
DROP TRIGGER IF EXISTS update_execution_orders_updated_at ON execution_orders;
CREATE TRIGGER update_execution_orders_updated_at BEFORE UPDATE ON execution_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Stock Blacklist Table
CREATE TABLE IF NOT EXISTS stock_blacklist (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_blacklist_symbol ON stock_blacklist(symbol);

-- ============================================================================
-- 第六部分：回测结果表（008_add_backtest_results.sql + 009_add_backtest_status.sql）
-- ============================================================================

-- Backtest Results Table
CREATE TABLE IF NOT EXISTS backtest_results (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    config JSONB,  -- Backtest configuration
    result JSONB,  -- Backtest result
    status VARCHAR(20) DEFAULT 'COMPLETED',
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy ON backtest_results(strategy_id);
CREATE INDEX IF NOT EXISTS idx_backtest_results_dates ON backtest_results(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_backtest_results_created_at ON backtest_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_results_status ON backtest_results(status);

-- Add columns if they don't exist (for existing tables)
DO $$
BEGIN
    -- Add status column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'status'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN status VARCHAR(20) DEFAULT 'COMPLETED';
    END IF;
    
    -- Add error_message column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'error_message'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN error_message TEXT;
    END IF;
    
    -- Add started_at column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'started_at'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN started_at TIMESTAMP;
    END IF;
    
    -- Add completed_at column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'completed_at'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN completed_at TIMESTAMP;
    END IF;
    
    -- Add updated_at column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
    END IF;
    
    -- Add diagnostic_log column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'diagnostic_log'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN diagnostic_log JSONB;
    END IF;
END $$;

-- Update existing records to COMPLETED status if status is NULL
UPDATE backtest_results SET status = 'COMPLETED' WHERE status IS NULL;

-- Create index for status if not exists (handled by CREATE INDEX IF NOT EXISTS above)

-- Add comments
COMMENT ON TABLE backtest_results IS 'Strategy backtest results table';
COMMENT ON COLUMN backtest_results.strategy_id IS 'Strategy ID';
COMMENT ON COLUMN backtest_results.start_date IS 'Backtest start date';
COMMENT ON COLUMN backtest_results.end_date IS 'Backtest end date';
COMMENT ON COLUMN backtest_results.config IS 'Backtest configuration (JSONB)';
COMMENT ON COLUMN backtest_results.result IS 'Backtest result (JSONB)';
COMMENT ON COLUMN backtest_results.status IS 'Backtest status: PENDING, RUNNING, COMPLETED, FAILED';
COMMENT ON COLUMN backtest_results.error_message IS 'Error message if backtest failed';
COMMENT ON COLUMN backtest_results.started_at IS 'Backtest start timestamp';
COMMENT ON COLUMN backtest_results.completed_at IS 'Backtest completion timestamp';
COMMENT ON COLUMN backtest_results.created_at IS 'Created timestamp';
COMMENT ON COLUMN backtest_results.updated_at IS 'Last update timestamp';
COMMENT ON COLUMN backtest_results.diagnostic_log IS '回测诊断日志（记录信号生成、买入尝试、失败原因等）';

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_backtest_results_updated_at ON backtest_results;
CREATE TRIGGER update_backtest_results_updated_at BEFORE UPDATE ON backtest_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 第七部分：日志系统表（012_add_system_logs_table.sql）
-- ============================================================================

-- System Logs Table
-- Purpose: Store structured logs for the trading system
-- Features: Non-blocking write, structured data, trace ID support
CREATE TABLE IF NOT EXISTS system_logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    level VARCHAR(10) NOT NULL CHECK (level IN ('INFO', 'WARNING', 'ERROR', 'DEBUG')),
    module VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    trace_id UUID,
    extra_data JSONB,
    file_path VARCHAR(500),
    line_no INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for system_logs table
-- BRIN index for timestamp (efficient for time-range queries on large tables)
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs USING BRIN(timestamp);

-- B-tree indexes for common filter columns
CREATE INDEX IF NOT EXISTS idx_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_module ON system_logs(module);
CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON system_logs(trace_id);

-- GIN index for JSONB extra_data (enables efficient JSON queries)
CREATE INDEX IF NOT EXISTS idx_logs_extra_data ON system_logs USING GIN(extra_data);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_logs_module_time ON system_logs(module, timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_level_time ON system_logs(level, timestamp);

-- Add comments
COMMENT ON TABLE system_logs IS 'System logs table for structured logging';
COMMENT ON COLUMN system_logs.id IS 'Primary key, auto-increment';
COMMENT ON COLUMN system_logs.timestamp IS 'Log timestamp (with timezone, microsecond precision)';
COMMENT ON COLUMN system_logs.level IS 'Log level: INFO, WARNING, ERROR, DEBUG';
COMMENT ON COLUMN system_logs.module IS 'Source module (e.g., Strategy.MA, Execution, DataFeed). Max length: 200 characters';
COMMENT ON COLUMN system_logs.message IS 'Log message text';
COMMENT ON COLUMN system_logs.trace_id IS 'Trace ID for linking related logs (UUID)';
COMMENT ON COLUMN system_logs.extra_data IS 'Structured data (JSONB, e.g., current price, position, order params)';
COMMENT ON COLUMN system_logs.file_path IS 'Source file path. Max length: 500 characters';
COMMENT ON COLUMN system_logs.line_no IS 'Source line number';
COMMENT ON COLUMN system_logs.created_at IS 'Record creation timestamp';

-- Auto-update field lengths if table already exists with old field sizes
-- This ensures compatibility with existing databases without requiring separate migration scripts
DO $$
DECLARE
    module_type VARCHAR;
    file_path_type VARCHAR;
BEGIN
    -- Check if table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'system_logs'
    ) THEN
        -- Check current module column type
        SELECT data_type INTO module_type
        FROM information_schema.columns
        WHERE table_name = 'system_logs' AND column_name = 'module';
        
        -- Update module column if it's VARCHAR(50) or smaller
        IF module_type = 'character varying' THEN
            SELECT character_maximum_length INTO module_type
            FROM information_schema.columns
            WHERE table_name = 'system_logs' AND column_name = 'module';
            
            IF module_type IS NOT NULL AND module_type::INTEGER < 200 THEN
                ALTER TABLE system_logs ALTER COLUMN module TYPE VARCHAR(200);
                RAISE NOTICE 'Updated system_logs.module: VARCHAR(%) -> VARCHAR(200)', module_type;
            END IF;
        END IF;
        
        -- Check current file_path column type
        SELECT data_type INTO file_path_type
        FROM information_schema.columns
        WHERE table_name = 'system_logs' AND column_name = 'file_path';
        
        -- Update file_path column if it's VARCHAR(255) or smaller
        IF file_path_type = 'character varying' THEN
            SELECT character_maximum_length INTO file_path_type
            FROM information_schema.columns
            WHERE table_name = 'system_logs' AND column_name = 'file_path';
            
            IF file_path_type IS NOT NULL AND file_path_type::INTEGER < 500 THEN
                ALTER TABLE system_logs ALTER COLUMN file_path TYPE VARCHAR(500);
                RAISE NOTICE 'Updated system_logs.file_path: VARCHAR(%) -> VARCHAR(500)', file_path_type;
            END IF;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 第八部分：验证失败日志表（011_create_validation_failure_logs.sql）
-- ============================================================================

-- Validation Failure Logs Table
-- Purpose: Store short position validation failure logs
CREATE TABLE IF NOT EXISTS validation_failure_logs (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    failure_type VARCHAR(50) NOT NULL,
    reason TEXT,
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT fk_validation_logs_strategy
        FOREIGN KEY (strategy_id)
        REFERENCES strategies(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_validation_logs_strategy_id
    ON validation_failure_logs(strategy_id);

CREATE INDEX IF NOT EXISTS idx_validation_logs_symbol
    ON validation_failure_logs(symbol);

CREATE INDEX IF NOT EXISTS idx_validation_logs_timestamp
    ON validation_failure_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_validation_logs_failure_type
    ON validation_failure_logs(failure_type);

CREATE INDEX IF NOT EXISTS idx_validation_logs_strategy_symbol
    ON validation_failure_logs(strategy_id, symbol, timestamp DESC);

COMMENT ON TABLE validation_failure_logs IS '卖空验证失败日志记录表 - 记录策略执行过程中卖空验证失败的情况';
COMMENT ON COLUMN validation_failure_logs.id IS '主键ID，自增';
COMMENT ON COLUMN validation_failure_logs.strategy_id IS '策略ID，关联 strategies 表';
COMMENT ON COLUMN validation_failure_logs.symbol IS '标的代码（如 TSLA.US, AAPL.US）';
COMMENT ON COLUMN validation_failure_logs.failure_type IS '失败类型（如 SHORT_VALIDATION_FAILED, MARGIN_CHECK_FAILED）';
COMMENT ON COLUMN validation_failure_logs.reason IS '失败原因详情';
COMMENT ON COLUMN validation_failure_logs.timestamp IS '失败时间';
COMMENT ON COLUMN validation_failure_logs.created_at IS '记录创建时间';

-- ============================================================================
-- 第九部分：期权策略决策日志表（012_create_option_decision_logs.sql）
-- ============================================================================

-- Option Strategy Decision Logs Table
-- Purpose: 记录期权策略的完整决策链路，用于分析未下单原因
CREATE TABLE IF NOT EXISTS option_strategy_decision_logs (
    id BIGSERIAL PRIMARY KEY,

    -- 基本信息
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    underlying_symbol VARCHAR(20) NOT NULL,
    execution_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 检查点1: 市场数据充足性
    data_check_spx_count INTEGER,
    data_check_usd_count INTEGER,
    data_check_btc_count INTEGER,
    data_check_vix_available BOOLEAN,
    data_check_temperature_available BOOLEAN,
    data_check_passed BOOLEAN DEFAULT false,
    data_check_error TEXT,

    -- 检查点2: 信号方向判定
    signal_direction VARCHAR(10) CHECK (signal_direction IN ('CALL', 'PUT', 'HOLD')),
    signal_confidence INTEGER,
    signal_market_score DECIMAL(10, 2),
    signal_intraday_score DECIMAL(10, 2),
    signal_time_adjustment DECIMAL(10, 2),
    signal_final_score DECIMAL(10, 2),

    -- 检查点3: 风险等级评估
    risk_level VARCHAR(20) CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'EXTREME')),
    risk_vix_value DECIMAL(10, 2),
    risk_temperature_value DECIMAL(10, 2),
    risk_score INTEGER,
    risk_blocked BOOLEAN DEFAULT false,

    -- 检查点4: 0DTE期权可用性
    dte_check_mode VARCHAR(10),
    dte_check_available BOOLEAN,
    dte_check_expiry_date VARCHAR(20),
    dte_check_left_days INTEGER,

    -- 检查点5: 期权链数据
    chain_contracts_count INTEGER,
    chain_strike_range_min DECIMAL(15, 4),
    chain_strike_range_max DECIMAL(15, 4),
    chain_data_available BOOLEAN DEFAULT false,

    -- 检查点6+7: 流动性和Greeks筛选
    filter_candidates_before INTEGER,
    filter_liquidity_passed INTEGER,
    filter_greeks_passed INTEGER,
    filter_final_selected BOOLEAN DEFAULT false,
    filter_reason TEXT,

    -- 检查点8: 入场价格有效性
    price_mode VARCHAR(10),
    price_ask DECIMAL(15, 4),
    price_bid DECIMAL(15, 4),
    price_mid DECIMAL(15, 4),
    price_selected DECIMAL(15, 4),
    price_valid BOOLEAN DEFAULT false,

    -- 检查点9: 信号生成结果
    signal_generated BOOLEAN DEFAULT false,
    signal_id INTEGER REFERENCES strategy_signals(id) ON DELETE SET NULL,
    option_symbol VARCHAR(50),
    option_contracts INTEGER,
    option_premium DECIMAL(15, 4),
    option_delta DECIMAL(10, 4),
    option_theta DECIMAL(10, 4),
    estimated_cost DECIMAL(15, 4),

    -- 最终结果和原因
    final_result VARCHAR(20) CHECK (final_result IN ('SIGNAL_GENERATED', 'NO_SIGNAL', 'ERROR')) NOT NULL,
    rejection_reason TEXT,
    rejection_checkpoint VARCHAR(50),

    -- 额外数据
    extra_data JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_strategy_time
    ON option_strategy_decision_logs(strategy_id, execution_time DESC);

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_symbol
    ON option_strategy_decision_logs(underlying_symbol);

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_result
    ON option_strategy_decision_logs(final_result);

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_rejection_checkpoint
    ON option_strategy_decision_logs(rejection_checkpoint) WHERE rejection_checkpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_execution_time
    ON option_strategy_decision_logs(execution_time DESC);

CREATE INDEX IF NOT EXISTS idx_option_decision_logs_extra_data
    ON option_strategy_decision_logs USING GIN(extra_data);

COMMENT ON TABLE option_strategy_decision_logs IS '期权策略决策链路日志表，记录9个关键检查点的详细数据';
COMMENT ON COLUMN option_strategy_decision_logs.id IS '主键，自增';
COMMENT ON COLUMN option_strategy_decision_logs.strategy_id IS '策略ID，外键关联strategies表';
COMMENT ON COLUMN option_strategy_decision_logs.underlying_symbol IS '底层标的代码（如QQQ.US）';
COMMENT ON COLUMN option_strategy_decision_logs.execution_time IS '执行时间（美东时间）';
COMMENT ON COLUMN option_strategy_decision_logs.data_check_passed IS '数据检查是否通过';
COMMENT ON COLUMN option_strategy_decision_logs.signal_direction IS '推荐信号方向（CALL/PUT/HOLD）';
COMMENT ON COLUMN option_strategy_decision_logs.signal_confidence IS '信号置信度（0-100）';
COMMENT ON COLUMN option_strategy_decision_logs.risk_level IS '风险等级评估结果';
COMMENT ON COLUMN option_strategy_decision_logs.risk_blocked IS '是否因风险过高被阻止';
COMMENT ON COLUMN option_strategy_decision_logs.dte_check_mode IS '到期模式（0DTE/NEAREST）';
COMMENT ON COLUMN option_strategy_decision_logs.filter_final_selected IS '是否最终筛选出合约';
COMMENT ON COLUMN option_strategy_decision_logs.price_valid IS '入场价格是否有效';
COMMENT ON COLUMN option_strategy_decision_logs.signal_generated IS '是否成功生成交易信号';
COMMENT ON COLUMN option_strategy_decision_logs.final_result IS '最终结果（SIGNAL_GENERATED/NO_SIGNAL/ERROR）';
COMMENT ON COLUMN option_strategy_decision_logs.rejection_reason IS '被拒绝的原因描述';
COMMENT ON COLUMN option_strategy_decision_logs.rejection_checkpoint IS '在哪个检查点被拒绝（1-9）';

-- ============================================================================
-- 第十部分：订单防重指标表（create_order_prevention_metrics_table.sql）
-- ============================================================================

-- Order Prevention Metrics Table
-- Purpose: Records historical data of order duplicate prevention metrics
CREATE TABLE IF NOT EXISTS order_prevention_metrics (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Position validation metrics
    position_validation_total INTEGER DEFAULT 0,
    position_validation_passed INTEGER DEFAULT 0,
    position_validation_failed INTEGER DEFAULT 0,

    -- Order deduplication metrics
    duplicate_order_prevented INTEGER DEFAULT 0,
    duplicate_order_by_cache INTEGER DEFAULT 0,
    duplicate_order_by_pending INTEGER DEFAULT 0,

    -- Short position detection metrics
    short_position_detected INTEGER DEFAULT 0,
    short_position_closed INTEGER DEFAULT 0,
    short_position_close_failed INTEGER DEFAULT 0,

    -- Trade push metrics
    trade_push_received INTEGER DEFAULT 0,
    trade_push_error INTEGER DEFAULT 0,

    -- Order rejection metrics
    order_rejected_by_position INTEGER DEFAULT 0,
    order_rejected_by_duplicate INTEGER DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_prevention_metrics_timestamp ON order_prevention_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_order_prevention_metrics_created_at ON order_prevention_metrics(created_at);

COMMENT ON TABLE order_prevention_metrics IS 'Order duplicate prevention mechanism metrics table';
COMMENT ON COLUMN order_prevention_metrics.position_validation_total IS 'Total position validation count';
COMMENT ON COLUMN order_prevention_metrics.position_validation_passed IS 'Position validation passed count';
COMMENT ON COLUMN order_prevention_metrics.position_validation_failed IS 'Position validation failed count';
COMMENT ON COLUMN order_prevention_metrics.duplicate_order_prevented IS 'Total duplicate order prevented count';
COMMENT ON COLUMN order_prevention_metrics.duplicate_order_by_cache IS 'Duplicate order prevented by cache count';
COMMENT ON COLUMN order_prevention_metrics.duplicate_order_by_pending IS 'Duplicate order prevented by pending order check count';
COMMENT ON COLUMN order_prevention_metrics.short_position_detected IS 'Short position detected count';
COMMENT ON COLUMN order_prevention_metrics.short_position_closed IS 'Short position auto-closed success count';
COMMENT ON COLUMN order_prevention_metrics.short_position_close_failed IS 'Short position auto-closed failed count';
COMMENT ON COLUMN order_prevention_metrics.trade_push_received IS 'Trade push received count';
COMMENT ON COLUMN order_prevention_metrics.trade_push_error IS 'Trade push error count';
COMMENT ON COLUMN order_prevention_metrics.order_rejected_by_position IS 'Order rejected due to insufficient position count';
COMMENT ON COLUMN order_prevention_metrics.order_rejected_by_duplicate IS 'Order rejected due to duplicate submission count';

-- ============================================================================
-- 第五部分：初始化数据
-- ============================================================================

-- Initialize root capital account
-- Note: Actual balance needs to be fetched from Longbridge SDK
-- 使用 NOT EXISTS 检查，避免重复插入
INSERT INTO capital_allocations (name, parent_id, allocation_type, allocation_value, is_system)
SELECT 'GLOBAL', NULL, 'PERCENTAGE', 1.0, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM capital_allocations WHERE name = 'GLOBAL' AND parent_id IS NULL
)
ON CONFLICT DO NOTHING;

-- Ensure GLOBAL account is marked as system account (for existing databases)
UPDATE capital_allocations SET is_system = TRUE WHERE name = 'GLOBAL' AND (is_system IS NULL OR is_system = FALSE);

-- ============================================================================
-- 完成
-- ============================================================================
-- 脚本执行完成！
-- 
-- 下一步：
--   1. 创建管理员账户：
--      node scripts/create-admin.js admin your_password
--   
--   2. 配置API密钥（通过前端配置管理界面或直接更新数据库）：
--      - longport_app_key
--      - longport_app_secret
--      - longport_access_token
--      - futunn_csrf_token
--      - futunn_cookies
-- ============================================================================

