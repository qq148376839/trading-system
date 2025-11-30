-- Add missing longport_token_auto_refresh configuration
-- Created: 2025-01-27

-- Insert the token auto refresh configuration if it doesn't exist
INSERT INTO system_config (config_key, config_value, encrypted, description) 
VALUES ('longport_token_auto_refresh', 'true', false, 'Enable automatic token refresh (refresh when less than 10 days remaining)') 
ON CONFLICT (config_key) DO UPDATE SET 
  config_value = COALESCE(NULLIF(system_config.config_value, ''), 'true'),
  description = 'Enable automatic token refresh (refresh when less than 10 days remaining)';

