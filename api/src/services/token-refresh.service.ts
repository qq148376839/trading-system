/**
 * Token刷新服务
 * 使用长桥SDK的refreshAccessToken方法实现Token自动刷新
 * 参考: https://longportapp.github.io/openapi/nodejs/classes/Config.html#refreshaccesstoken
 */

import configService from './config.service';
import { clearQuoteContext, clearTradeContext } from '../config/longport';

// 动态导入长桥SDK（延迟加载，避免在模块不可用时崩溃）
let longport: any = null;
let Config: any = null;

// 尝试加载长桥SDK
try {
  longport = require('longport');
  Config = longport.Config;
} catch (error: any) {
  console.warn('Token刷新服务: LongPort SDK 不可用，Token刷新功能将被禁用');
}

class TokenRefreshService {
  /**
   * 刷新Access Token
   * 使用SDK的refreshAccessToken方法
   * 参考: https://longportapp.github.io/openapi/nodejs/classes/Config.html#refreshaccesstoken
   */
  async refreshToken(): Promise<{
    token: string;
    expiredAt: string;
    issuedAt: string;
  }> {
    // 检查SDK是否可用
    if (!Config) {
      throw new Error('LongPort SDK 不可用，无法刷新Token（系统运行在降级模式）');
    }

    // 优先从数据库读取配置，fallback到环境变量
    const appKey = await configService.getConfig('longport_app_key') || process.env.LONGPORT_APP_KEY;
    const appSecret = await configService.getConfig('longport_app_secret') || process.env.LONGPORT_APP_SECRET;
    const currentToken = await configService.getConfig('longport_access_token') || process.env.LONGPORT_ACCESS_TOKEN;

    if (!appKey || !appSecret || !currentToken) {
      throw new Error('长桥API配置不完整，无法刷新Token');
    }

    try {
      // 创建Config实例
      const config = new Config({
        appKey: appKey.trim(),
        appSecret: appSecret.trim(),
        accessToken: currentToken.trim(),
        enablePrintQuotePackages: false,
      });

      // 计算过期时间（默认90天，根据SDK文档）
      const expiredAt = new Date();
      expiredAt.setDate(expiredAt.getDate() + 90); // SDK默认90天
      const issuedAt = new Date();

      // 使用SDK的refreshAccessToken方法
      const newToken = await config.refreshAccessToken(expiredAt);
      
      // 更新数据库中的token和过期时间
      await configService.setConfig('longport_access_token', newToken, true, 'token-refresh');
      await configService.setConfig('longport_token_expired_at', expiredAt.toISOString(), false, 'token-refresh');
      await configService.setConfig('longport_token_issued_at', issuedAt.toISOString(), false, 'token-refresh');
      
      // 清除长桥Context缓存，强制重新初始化
      clearQuoteContext();
      clearTradeContext();
      
      console.log('Token刷新成功（使用SDK方法）');
      console.log(`  新Token后20位: ...${newToken.substring(newToken.length - 20)}`);
      console.log(`  过期时间: ${expiredAt.toISOString()}`);
      
      return {
        token: newToken,
        expiredAt: expiredAt.toISOString(),
        issuedAt: issuedAt.toISOString(),
      };
    } catch (error: any) {
      const errorMsg = error.message || '未知错误';
      throw new Error(`刷新Token失败: ${errorMsg}`);
    }
  }

  /**
   * 检查Token是否需要刷新
   * 在过期前10天自动刷新（如果启用了自动刷新）
   */
  async shouldRefreshToken(): Promise<boolean> {
    try {
      // 检查是否启用了自动刷新
      const autoRefreshEnabled = await configService.getConfig('longport_token_auto_refresh');
      if (autoRefreshEnabled !== 'true') {
        return false; // 如果未启用自动刷新，返回false
      }

      const expiredAtStr = await configService.getConfig('longport_token_expired_at');
      if (!expiredAtStr) {
        return false; // 如果没有过期时间记录，不自动刷新
      }

      const expiredAt = new Date(expiredAtStr);
      const now = new Date();
      const daysUntilExpiry = (expiredAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      // 如果10天内过期，返回true
      return daysUntilExpiry <= 10;
    } catch (error: any) {
      console.error('检查Token状态失败:', error.message);
      return false;
    }
  }

  /**
   * 获取Token状态信息
   */
  async getTokenStatus(): Promise<{
    expiredAt: string | null;
    issuedAt: string | null;
    daysUntilExpiry: number | null;
    shouldRefresh: boolean;
  }> {
    try {
      const expiredAtStr = await configService.getConfig('longport_token_expired_at');
      const issuedAtStr = await configService.getConfig('longport_token_issued_at');
      
      if (!expiredAtStr) {
        return {
          expiredAt: null,
          issuedAt: issuedAtStr || null,
          daysUntilExpiry: null,
          shouldRefresh: false,
        };
      }

      const expiredAt = new Date(expiredAtStr);
      const now = new Date();
      const daysUntilExpiry = (expiredAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      
      // 检查是否启用了自动刷新
      const autoRefreshEnabled = await configService.getConfig('longport_token_auto_refresh');
      const shouldRefresh = autoRefreshEnabled === 'true' && daysUntilExpiry <= 10;

      return {
        expiredAt: expiredAtStr,
        issuedAt: issuedAtStr || null,
        daysUntilExpiry: Math.floor(daysUntilExpiry),
        shouldRefresh,
      };
    } catch (error: any) {
      console.error('获取Token状态失败:', error.message);
      return {
        expiredAt: null,
        issuedAt: null,
        daysUntilExpiry: null,
        shouldRefresh: false,
      };
    }
  }

  /**
   * 自动刷新Token（如果需要）
   */
  async autoRefreshIfNeeded(): Promise<boolean> {
    try {
      if (await this.shouldRefreshToken()) {
        console.log('检测到Token即将过期，开始自动刷新...');
        await this.refreshToken();
        console.log('Token已自动刷新');
        return true;
      }
      return false;
    } catch (error: any) {
      console.error('自动刷新Token失败:', error.message);
      return false;
    }
  }
}

export default new TokenRefreshService();

