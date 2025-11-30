-- Add option quote configuration
-- Created: 2025-11-28
-- Description: Add configuration to control whether to use LongPort API for option quotes

-- Add configuration item for LongPort option quote
INSERT INTO system_config (config_key, config_value, encrypted, description) VALUES
    ('longport_enable_option_quote', 'false', false, 'Enable LongPort API for option quotes (default: false, use Futunn API instead)')
ON CONFLICT (config_key) DO NOTHING;

