-- Add Futunn search API cookies configuration
-- Created: 2025-01-28
-- Description: Add separate cookies configuration for search API (headfoot-search)

-- Add configuration item for Futunn search API cookies
INSERT INTO system_config (config_key, config_value, encrypted, description) VALUES
    ('futunn_search_cookies', '', true, 'Futunn API Cookies for search endpoint (headfoot-search), separate from main API cookies')
ON CONFLICT (config_key) DO NOTHING;

