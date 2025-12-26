/**
 * 今日订单缓存服务
 * 统一管理今日订单的缓存，避免多个服务重复调用API导致频率限制
 */

import { getTradeContext } from '../config/longport';
import { mapOrderData } from '../routes/orders';
import { logger } from '../utils/logger';

class TodayOrdersCacheService {
  private cache: { orders: any[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 60 * 1000; // 60秒缓存
  private refreshPromise: Promise<any[]> | null = null; // 防止并发刷新

  /**
   * 获取今日订单（带缓存）
   * @param forceRefresh 是否强制刷新缓存
   */
  async getTodayOrders(forceRefresh: boolean = false): Promise<any[]> {
    const now = Date.now();
    
    // 如果缓存有效且不强制刷新，直接返回缓存
    if (!forceRefresh && this.cache && (now - this.cache.timestamp) < this.CACHE_TTL) {
      return this.cache.orders;
    }

    // 如果正在刷新，等待刷新完成（防止并发刷新）
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // 开始刷新
    this.refreshPromise = this.refreshCache();
    
    try {
      const orders = await this.refreshPromise;
      return orders;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * 刷新缓存
   */
  private async refreshCache(): Promise<any[]> {
    try {
      const tradeCtx = await getTradeContext();
      const rawOrders = await tradeCtx.todayOrders({});
      
      const mappedOrders = Array.isArray(rawOrders) 
        ? rawOrders.map((order: any) => mapOrderData(order))
        : [];
      
      // 更新缓存
      this.cache = {
        orders: mappedOrders,
        timestamp: Date.now(),
      };
      
      return this.cache.orders;
    } catch (error: any) {
      // 如果刷新失败，尝试使用过期缓存
      if (this.cache) {
        logger.warn(`获取今日订单失败，使用过期缓存: ${error.message}`);
        return this.cache.orders;
      }
      console.error('获取今日订单失败且无缓存:', error);
      return [];
    }
  }

  /**
   * 清除缓存（用于测试或手动刷新）
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * 获取缓存状态（用于调试）
   */
  getCacheStatus(): { hasCache: boolean; age: number | null } {
    if (!this.cache) {
      return { hasCache: false, age: null };
    }
    return {
      hasCache: true,
      age: Date.now() - this.cache.timestamp,
    };
  }
}

export default new TodayOrdersCacheService();





