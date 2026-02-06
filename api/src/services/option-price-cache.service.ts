/**
 * 期权价格缓存服务
 *
 * 功能：
 * - 减少API调用频率，提高性能
 * - 10秒TTL，适合高频期权交易
 * - 自动清理过期缓存
 *
 * 使用场景：
 * - 持仓监控循环中获取期权价格
 * - 避免频繁调用富途期权详情API
 *
 * 2024-02 API频率限制测试结果:
 * - Futunn API无严格频率限制，可支持更短的缓存时间
 * - 平均响应时间约400-800ms
 * - TTL从5分钟缩短到10秒，提供更实时的价格数据
 */

export interface OptionPriceCacheEntry {
  price: number;
  bid: number;
  ask: number;
  mid: number;
  timestamp: number;
  underlyingPrice: number;
  source: 'longport' | 'futunn' | 'position_cache';
}

class OptionPriceCacheService {
  private cache: Map<string, OptionPriceCacheEntry> = new Map();
  private ttlMs = 10 * 1000; // 10秒TTL（API无频率限制，支持更频繁更新）
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * 设置缓存条目
   */
  set(symbol: string, entry: OptionPriceCacheEntry): void {
    this.cache.set(symbol.toUpperCase(), {
      ...entry,
      timestamp: Date.now(), // 更新时间戳
    });
  }

  /**
   * 获取缓存条目（如果未过期）
   */
  get(symbol: string): OptionPriceCacheEntry | null {
    const entry = this.cache.get(symbol.toUpperCase());
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(symbol.toUpperCase());
      return null;
    }

    return entry;
  }

  /**
   * 检查缓存是否存在且有效
   */
  has(symbol: string): boolean {
    return this.get(symbol) !== null;
  }

  /**
   * 删除指定缓存条目
   */
  delete(symbol: string): void {
    this.cache.delete(symbol.toUpperCase());
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    totalEntries: number;
    validEntries: number;
    expiredEntries: number;
  } {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const entry of this.cache.values()) {
      if (now - entry.timestamp > this.ttlMs) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
    };
  }

  /**
   * 启动定期清理任务（每10分钟清理一次过期缓存）
   */
  startCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const toDelete: string[] = [];

      for (const [symbol, entry] of this.cache.entries()) {
        if (now - entry.timestamp > this.ttlMs) {
          toDelete.push(symbol);
        }
      }

      toDelete.forEach((symbol) => this.cache.delete(symbol));

      if (toDelete.length > 0) {
        console.log(`[OptionPriceCache] 清理了 ${toDelete.length} 个过期缓存`);
      }
    }, 10 * 60 * 1000); // 每10分钟
  }

  /**
   * 停止定期清理任务
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 设置TTL（毫秒）
   */
  setTTL(ttlMs: number): void {
    this.ttlMs = Math.max(1000, ttlMs); // 最小1秒
  }

  /**
   * 获取当前TTL（毫秒）
   */
  getTTL(): number {
    return this.ttlMs;
  }
}

// 导出单例实例
const optionPriceCacheService = new OptionPriceCacheService();

// 自动启动清理任务
optionPriceCacheService.startCleanup();

export default optionPriceCacheService;
