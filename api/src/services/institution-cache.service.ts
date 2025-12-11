/**
 * 机构数据缓存服务
 * 使用内存缓存机构列表和持仓数据，减少API调用
 */

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

class InstitutionCacheService {
  private cache: Map<string, CacheItem<any>> = new Map();
  private defaultTTL: number = 5 * 60 * 1000; // 5分钟（毫秒）
  private maxCacheSize: number = 1000; // 最大缓存条目数

  /**
   * 获取缓存数据
   * @param key 缓存键
   * @returns 缓存数据，如果不存在或已过期返回null
   */
  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    const now = Date.now();
    if (now - item.timestamp > this.defaultTTL) {
      // 缓存已过期，删除
      this.cache.delete(key);
      return null;
    }

    return item.data as T;
  }

  /**
   * 设置缓存数据
   * @param key 缓存键
   * @param data 缓存数据
   * @param ttl 过期时间（毫秒），默认使用defaultTTL
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // 如果缓存已满，删除最旧的条目（简单策略：删除第一个）
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * 删除缓存
   * @param key 缓存键
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.defaultTTL) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));

    if (keysToDelete.length > 0) {
      console.log(`[机构缓存] 清理了 ${keysToDelete.length} 个过期缓存`);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hitRate: 0, // TODO: 实现命中率统计
    };
  }

  /**
   * 设置默认TTL
   * @param ttl 过期时间（毫秒）
   */
  setDefaultTTL(ttl: number): void {
    this.defaultTTL = ttl;
  }
}

// 单例模式
const institutionCache = new InstitutionCacheService();

// 定期清理过期缓存（每10分钟）
setInterval(() => {
  institutionCache.cleanup();
}, 10 * 60 * 1000);

export default institutionCache;

