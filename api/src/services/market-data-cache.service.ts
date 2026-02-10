/**
 * 市场数据缓存服务
 * 避免重复调用市场数据API，提高性能
 * 实现智能缓存策略：根据交易时间动态调整缓存时长
 */

import marketDataService from './market-data.service';
import { getCacheDuration, isTradingHours } from '../utils/trading-hours';
import { logger } from '../utils/logger';

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
  vix?: CandlestickData[]; // VIX恐慌指数
  marketTemperature?: any; // 市场温度
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
  private consecutiveFailures: number = 0;

  /**
   * 获取缓存数据（即使已过期）用于止盈止损等关键操作
   * 当新鲜数据不可用时，旧数据总比没有好
   * @returns 缓存数据或 null
   */
  getStaleCache(): MarketDataCache | null {
    return this.cache;
  }

  /**
   * 获取连续失败次数
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

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
   *
   * 2024-02 API频率限制测试结果:
   * - Futunn API无严格频率限制，可以更频繁获取数据
   */
  private getIntradayCacheDurationMs(): number {
    const isTrading = isTradingHours();
    // 交易时间：15秒缓存（期权交易需要更实时的分时数据）
    // 非交易时间：5分钟缓存
    return (isTrading ? 15 : 300) * 1000;
  }

  /**
   * 获取历史市场数据（截止到指定日期，不缓存）
   * @param targetDate 目标日期，获取该日期之前的数据
   * @param count 需要的数据条数
   * @param includeIntraday 是否包含分时数据
   */
  async getHistoricalMarketData(targetDate: Date, count: number = 100, includeIntraday: boolean = false): Promise<MarketDataCache> {
    logger.debug(`获取历史市场数据（目标日期: ${targetDate.toISOString().split('T')[0]}，包含分时: ${includeIntraday}）`);
    
    const marketData = await marketDataService.getHistoricalMarketData(targetDate, count, includeIntraday);
    
    // 验证数据完整性
    if (!marketData.spx || marketData.spx.length < 50) {
      throw new Error(`SPX历史数据不足（${marketData.spx?.length || 0} < 50），无法提供交易建议`);
    }
    if (!marketData.usdIndex || marketData.usdIndex.length < 50) {
      throw new Error(`USD Index历史数据不足（${marketData.usdIndex?.length || 0} < 50），无法提供交易建议`);
    }
    if (!marketData.btc || marketData.btc.length < 50) {
      throw new Error(`BTC历史数据不足（${marketData.btc?.length || 0} < 50），无法提供交易建议`);
    }

    const result: MarketDataCache = {
      spx: marketData.spx,
      usdIndex: marketData.usdIndex,
      btc: marketData.btc,
      vix: marketData.vix || [], // VIX数据
      marketTemperature: marketData.marketTemperature, // 市场温度
      timestamp: targetDate.getTime(), // 使用目标日期作为时间戳
    };

    // 如果包含分时数据，添加分时数据
    if (includeIntraday) {
      result.usdIndexHourly = marketData.usdIndexHourly || [];
      result.btcHourly = marketData.btcHourly || [];
      result.hourlyTimestamp = targetDate.getTime();
    }

    return result;
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
    logger.info(`获取新的市场数据（${tradingStatus}，缓存时长: ${duration}秒，包含分时: ${includeIntraday}）`);
    
    this.fetchPromise = marketDataService.getAllMarketData(count, includeIntraday).then((marketData) => {
      // 再次验证数据完整性（双重检查）
      if (!marketData.spx || marketData.spx.length < 50) {
        throw new Error(`SPX数据不足（${marketData.spx?.length || 0} < 50），无法提供交易建议`);
      }
      if (!marketData.usdIndex || marketData.usdIndex.length < 50) {
        throw new Error(`USD Index数据不足（${marketData.usdIndex?.length || 0} < 50），无法提供交易建议`);
      }
      if (!marketData.btc || marketData.btc.length < 50) {
        throw new Error(`BTC数据不足（${marketData.btc?.length || 0} < 50），无法提供交易建议`);
      }

      this.cache = {
        spx: marketData.spx,
        usdIndex: marketData.usdIndex,
        btc: marketData.btc,
        vix: marketData.vix || [],
        marketTemperature: marketData.marketTemperature,
        timestamp: Date.now(),
      };

      // 如果包含分时数据，更新分时数据缓存
      if (includeIntraday) {
        this.cache.usdIndexHourly = marketData.usdIndexHourly || [];
        this.cache.btcHourly = marketData.btcHourly || [];
        this.cache.hourlyTimestamp = Date.now();
      }

      this.consecutiveFailures = 0;
      this.isFetching = false;
      this.fetchPromise = null;
      return this.cache;
    }).catch((error) => {
      this.consecutiveFailures++;
      this.isFetching = false;
      this.fetchPromise = null;

      // 保留旧缓存数据（用于止盈止损等关键操作），但仍向新信号生成抛出错误
      if (this.cache) {
        const staleAge = Math.floor((Date.now() - this.cache.timestamp) / 1000);
        logger.warn(
          `市场数据获取失败（连续${this.consecutiveFailures}次），保留旧缓存数据（${staleAge}秒前）: ${error.message}`
        );
        // 不更新 timestamp，下次调用仍会尝试刷新
      } else {
        logger.error(`市场数据获取失败且无缓存可用: ${error.message}`);
      }

      throw error;
    });

    return this.fetchPromise;
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
    logger.info('清除市场数据缓存');
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
