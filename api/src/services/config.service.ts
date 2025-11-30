/**
 * 配置管理服务
 * 支持从数据库读取配置，敏感信息加密存储
 * 兼容Windows和Docker部署
 */

import pool from '../config/database';
import crypto from 'crypto';
import path from 'path';
import os from 'os';

// 加密密钥（从环境变量读取，如果没有则使用默认值）
// 注意：生产环境必须设置CONFIG_ENCRYPTION_KEY环境变量
const getEncryptionKey = (): string => {
  const envKey = process.env.CONFIG_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 32) {
    return envKey.substring(0, 32);
  }
  
  // 如果没有设置环境变量，使用默认值（仅用于开发环境）
  console.warn('警告: 未设置CONFIG_ENCRYPTION_KEY环境变量，使用默认密钥（不安全，仅用于开发）');
  return 'default-key-change-in-production-32chars!!';
};

const ENCRYPTION_KEY = getEncryptionKey();
const ALGORITHM = 'aes-256-cbc';

class ConfigService {
  /**
   * 加密配置值
   */
  private encrypt(text: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32));
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (error: any) {
      console.error('加密失败:', error.message);
      throw new Error('配置加密失败');
    }
  }

  /**
   * 解密配置值
   */
  private decrypt(encryptedText: string): string {
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        throw new Error('无效的加密格式');
      }
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32));
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error: any) {
      console.error('解密失败:', error.message);
      throw new Error('配置解密失败');
    }
  }

  /**
   * 获取配置值
   * 优先从数据库读取，如果数据库中没有则返回null（调用方可以使用环境变量fallback）
   */
  async getConfig(key: string): Promise<string | null> {
    try {
      const result = await pool.query(
        'SELECT config_value, encrypted FROM system_config WHERE config_key = $1',
        [key]
      );
      
      if (result.rows.length === 0) {
        return null;
      }

      const { config_value, encrypted } = result.rows[0];
      
      // 如果值为空字符串，也返回null（表示未配置）
      if (!config_value || config_value.trim() === '') {
        return null;
      }

      return encrypted ? this.decrypt(config_value) : config_value;
    } catch (error: any) {
      console.error(`获取配置失败 (${key}):`, error.message);
      return null; // 出错时返回null，让调用方使用环境变量fallback
    }
  }

  /**
   * 设置配置值
   */
  async setConfig(
    key: string, 
    value: string, 
    encrypted: boolean = false, 
    updatedBy?: string
  ): Promise<void> {
    try {
      const finalValue = encrypted ? this.encrypt(value) : value;
      await pool.query(
        `INSERT INTO system_config (config_key, config_value, encrypted, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (config_key) 
         DO UPDATE SET 
           config_value = $2, 
           encrypted = $3, 
           updated_by = $4, 
           updated_at = CURRENT_TIMESTAMP`,
        [key, finalValue, encrypted, updatedBy || 'system']
      );
    } catch (error: any) {
      console.error(`设置配置失败 (${key}):`, error.message);
      throw error;
    }
  }

  /**
   * 获取所有配置（用于配置管理页面）
   * 加密的配置值显示为"***已加密***"
   */
  async getAllConfigs(): Promise<Array<{
    key: string;
    value: string;
    encrypted: boolean;
    description: string;
    updatedAt: string;
    updatedBy: string | null;
  }>> {
    try {
      const result = await pool.query(
        `SELECT config_key, config_value, encrypted, description, updated_at, updated_by 
         FROM system_config 
         ORDER BY config_key`
      );
      
      return result.rows.map(row => ({
        key: row.config_key,
        value: row.encrypted ? '***已加密***' : (row.config_value || ''),
        encrypted: row.encrypted,
        description: row.description || '',
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
        updatedBy: row.updated_by || null,
      }));
    } catch (error: any) {
      console.error('获取所有配置失败:', error.message);
      throw error;
    }
  }

  /**
   * 删除配置
   */
  async deleteConfig(key: string): Promise<void> {
    try {
      await pool.query('DELETE FROM system_config WHERE config_key = $1', [key]);
    } catch (error: any) {
      console.error(`删除配置失败 (${key}):`, error.message);
      throw error;
    }
  }

  /**
   * 批量设置配置
   */
  async setConfigs(
    configs: Array<{ key: string; value: string; encrypted?: boolean }>,
    updatedBy?: string
  ): Promise<void> {
    try {
      await pool.query('BEGIN');
      
      for (const config of configs) {
        await this.setConfig(
          config.key,
          config.value,
          config.encrypted || false,
          updatedBy
        );
      }
      
      await pool.query('COMMIT');
    } catch (error: any) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

export default new ConfigService();

