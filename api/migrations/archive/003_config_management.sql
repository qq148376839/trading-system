-- Configuration Management Database Migration Script
-- Created: 2025-01-27
-- Description: Support Windows and Docker deployment

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

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_config_key ON system_config(config_key);
CREATE INDEX IF NOT EXISTS idx_admin_username ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_active ON admin_users(is_active);

-- Insert default configuration items
INSERT INTO system_config (config_key, config_value, encrypted, description) VALUES
    ('longport_app_key', '', true, 'LongPort API App Key'),
    ('longport_app_secret', '', true, 'LongPort API App Secret'),
    ('longport_access_token', '', true, 'LongPort API Access Token'),
    ('longport_token_expired_at', '', false, 'Token expiration time (ISO8601 format)'),
    ('longport_token_issued_at', '', false, 'Token issued time (ISO8601 format)'),
    ('longport_enable_overnight', 'false', false, 'Enable US stock overnight trading'),
    ('longport_token_auto_refresh', 'true', false, 'Enable automatic token refresh (refresh when less than 10 days remaining)'),
    ('futunn_csrf_token', '', true, 'Futunn API CSRF Token'),
    ('futunn_cookies', '', true, 'Futunn API Cookies'),
    ('server_port', '3001', false, 'API server port')
ON CONFLICT (config_key) DO NOTHING;

-- Note: Admin account needs to be created manually
-- Use the create-admin.js script to create admin account
