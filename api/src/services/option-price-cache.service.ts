/**
 * 期权价格缓存服务
 *
 * 功能：
 * - 减少API调用频率，提高性能
 * - 按数据来源区分 TTL：LongPort 5秒，其他 10秒
 * - 自动清理过期缓存
 *
 * 使用场景：
 * - 持仓监控循环中获取期权价格
 * - 避免频繁调用期权行情API
 *
 * TTL 策略：
 * - LongPort: 5秒（10次/秒限额，与5秒监控周期对齐）
 * - Futunn:  10秒（无严格频率限制，但响应较慢400-800ms）
 */

import { logger } from '../utils/logger';

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
  private ttlMs = 10 * 1000; // 默认 TTL（Futunn 等来源）
  private longportTtlMs = 5 * 1000; // LongPort 来源 TTL（与5秒监控周期对齐）
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
   * LongPort 来源使用更短的 TTL（5秒），其他来源使用默认 TTL（10秒）
   */
  get(symbol: string): OptionPriceCacheEntry | null {
    const entry = this.cache.get(symbol.toUpperCase());
    if (!entry) return null;

    // 根据数据来源选择 TTL
    const ttl = entry.source === 'longport' ? this.longportTtlMs : this.ttlMs;
    if (Date.now() - entry.timestamp > ttl) {
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
      const ttl = entry.source === 'longport' ? this.longportTtlMs : this.ttlMs;
      if (now - entry.timestamp > ttl) {
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
        const ttl = entry.source === 'longport' ? this.longportTtlMs : this.ttlMs;
        if (now - entry.timestamp > ttl) {
          toDelete.push(symbol);
        }
      }

      toDelete.forEach((symbol) => this.cache.delete(symbol));

      if (toDelete.length > 0) {
        logger.debug(`[OptionPriceCache] 清理了 ${toDelete.length} 个过期缓存`);
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
