/**
 * 市场数据缓存服务
 * 避免重复调用市场数据API，提高性能
 * 实现智能缓存策略：根据交易时间动态调整缓存时长
 */

import marketDataService from './market-data.service';
import { getCacheDuration, isTradingHours } from '../utils/trading-hours';

interface CandlestickData {
  close: number;
  open: number;
  low: number;
  high: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

interface MarketDataCache {
  spx: CandlestickData[];
  usdIndex: CandlestickData[];
  btc: CandlestickData[];
  timestamp: number;
  // 分时数据（可选）
  usdIndexHourly?: CandlestickData[];
  btcHourly?: CandlestickData[];
  hourlyTimestamp?: number;
}

class MarketDataCacheService {
  private cache: MarketDataCache | null = null;
  private isFetching: boolean = false; // 防止并发请求
  private fetchPromise: Promise<MarketDataCache> | null = null;

  /**
   * 获取当前缓存时长（毫秒）
   * 根据交易时间动态调整
   */
  private getCacheDurationMs(): number {
    const durationSeconds = getCacheDuration();
    return durationSeconds * 1000;
  }

  /**
   * 获取分时数据缓存时长（毫秒）
   * 分时数据缓存时间更短，因为数据变化更快
   */
  private getIntradayCacheDurationMs(): number {
    const isTrading = isTradingHours();
    // 交易时间：5分钟缓存
    // 非交易时间：30分钟缓存
    return (isTrading ? 300 : 1800) * 1000;
  }

  /**
   * 获取市场数据（带缓存）
   */
  async getMarketData(count: number = 100, includeIntraday: boolean = false): Promise<MarketDataCache> {
    const now = Date.now();
    const cacheDuration = this.getCacheDurationMs();
    const intradayCacheDuration = this.getIntradayCacheDurationMs();

    // 检查日K数据缓存
    const dailyCacheValid = this.cache && (now - this.cache.timestamp) < cacheDuration;
    
    // 检查分时数据缓存（如果启用）
    const hourlyCacheValid = includeIntraday && 
      this.cache?.hourlyTimestamp && 
      (now - this.cache.hourlyTimestamp) < intradayCacheDuration;

    // 如果日K和分时数据都有效，直接返回（不输出日志，避免重复）
    if (dailyCacheValid && (!includeIntraday || hourlyCacheValid)) {
      return this.cache!;
    }

    // 如果正在获取数据，等待正在进行的请求完成
    if (this.isFetching && this.fetchPromise) {
      return this.fetchPromise;
    }

    // 缓存过期或不存在，重新获取
    this.isFetching = true;
    const duration = Math.floor(cacheDuration / 1000);
    const tradingStatus = isTradingHours() ? '交易时间' : '非交易时间';
    console.log(`获取新的市场数据（${tradingStatus}，缓存时长: ${duration}秒，包含分时: ${includeIntraday}）`);
    
    this.fetchPromise = marketDataService.getAllMarketData(count, includeIntraday).then((marketData) => {
      this.cache = {
        spx: marketData.spx,
        usdIndex: marketData.usdIndex,
        btc: marketData.btc,
        timestamp: Date.now(),
      };

      // 如果包含分时数据，更新分时数据缓存
      if (includeIntraday) {
        this.cache.usdIndexHourly = marketData.usdIndexHourly || [];
        this.cache.btcHourly = marketData.btcHourly || [];
        this.cache.hourlyTimestamp = Date.now();
      }

      this.isFetching = false;
      this.fetchPromise = null;
      return this.cache;
    }).catch((error) => {
      this.isFetching = false;
      this.fetchPromise = null;
      throw error;
    });

    return this.fetchPromise;
  }

  /**
   * 清除缓存（强制刷新）
   */
  clearCache() {
    console.log('清除市场数据缓存');
    this.cache = null;
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus() {
    if (!this.cache) {
      return {
        cached: false,
        age: 0,
        duration: this.getCacheDurationMs() / 1000,
      };
    }

    const age = Date.now() - this.cache.timestamp;
    const duration = this.getCacheDurationMs() / 1000;
    return {
      cached: true,
      age: Math.floor(age / 1000),
      duration: duration,
      expired: age >= this.getCacheDurationMs(),
    };
  }

  /**
   * 清除缓存（强制刷新）
   */
  clearCache() {
    console.log('清除市场数据缓存');
    this.cache = null;
    this.isFetching = false;
    this.fetchPromise = null;
  }

  /**
   * 判断是否在交易时间
   */
  isTradingHours(): boolean {
    return isTradingHours();
  }

  /**
   * 获取当前缓存时长（秒）
   */
  getCacheDuration(): number {
    return getCacheDuration();
  }
}

export default new MarketDataCacheService();
