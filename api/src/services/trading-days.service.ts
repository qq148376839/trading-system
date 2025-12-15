/**
 * 交易日服务
 * 使用Longbridge SDK的tradingDays接口获取真实的交易日数据
 * 参考文档: https://open.longbridge.com/zh-CN/docs/quote/pull/trade-day
 */

import { getQuoteContext } from '../config/longport';
import { logger } from '../utils/logger';

interface TradingDaysCache {
  market: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  tradeDays: Set<string>; // YYYYMMDD格式的日期集合
  halfTradeDays: Set<string>; // 半日市
  expiresAt: number; // 缓存过期时间戳
}

/**
 * 交易日服务（单例）
 * 使用Longbridge API获取真实的交易日数据，并实现缓存机制
 */
class TradingDaysService {
  private cache: Map<string, TradingDaysCache> = new Map();
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时缓存

  /**
   * 将Date转换为YYYYMMDD格式字符串
   */
  private dateToYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * 将YYYYMMDD格式字符串转换为Date
   */
  private YYMMDDToDate(yymmdd: string): Date {
    const year = parseInt(yymmdd.substring(0, 4));
    const month = parseInt(yymmdd.substring(4, 6)) - 1; // JavaScript月份从0开始
    const day = parseInt(yymmdd.substring(6, 8));
    return new Date(year, month, day);
  }

  /**
   * 将市场类型转换为Longbridge Market枚举值
   */
  private marketToLongbridgeMarket(market: 'US' | 'HK' | 'SH' | 'SZ'): string {
    const mapping: Record<string, string> = {
      'US': 'US',
      'HK': 'HK',
      'SH': 'CN', // A股市场在Longbridge中为CN
      'SZ': 'CN', // A股市场在Longbridge中为CN
    };
    return mapping[market] || 'US';
  }

  /**
   * 生成缓存key
   */
  private getCacheKey(market: string, startDate: Date, endDate: Date): string {
    return `${market}_${this.dateToYYMMDD(startDate)}_${this.dateToYYMMDD(endDate)}`;
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(cache: TradingDaysCache): boolean {
    return cache.expiresAt > Date.now();
  }

  /**
   * 从Longbridge API获取交易日数据
   * API限制：开始时间和结束时间间隔不能大于一个月
   */
  private async fetchTradingDaysFromAPI(
    market: 'US' | 'HK' | 'SH' | 'SZ',
    startDate: Date,
    endDate: Date
  ): Promise<{ tradeDays: Set<string>; halfTradeDays: Set<string> }> {
    try {
      const quoteCtx = await getQuoteContext();
      const longport = require('longport');
      const { Market, NaiveDate } = longport;

      // 转换市场类型
      const lbMarket = this.marketToLongbridgeMarket(market);
      // ✅ 使用Market枚举值（Market.US, Market.HK, Market.CN等）
      let marketEnum: any;
      if (lbMarket === 'US') {
        marketEnum = Market.US;
      } else if (lbMarket === 'HK') {
        marketEnum = Market.HK;
      } else if (lbMarket === 'CN') {
        marketEnum = Market.CN;
      } else {
        throw new Error(`不支持的市场类型: ${market} (${lbMarket})`);
      }

      // 转换为NaiveDate（注意：month从1开始）
      const beginNaiveDate = new NaiveDate(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        startDate.getDate()
      );
      const endNaiveDate = new NaiveDate(
        endDate.getFullYear(),
        endDate.getMonth() + 1,
        endDate.getDate()
      );

      logger.log(`[交易日服务] 从Longbridge API获取交易日数据: ${market}, ${this.dateToYYMMDD(startDate)} 至 ${this.dateToYYMMDD(endDate)}`);

      // 调用Longbridge API
      const response = await quoteCtx.tradingDays(marketEnum, beginNaiveDate, endNaiveDate);

      // 解析响应数据
      const tradeDays = new Set<string>();
      const halfTradeDays = new Set<string>();

      // response.tradeDay 是字符串数组，格式为 YYMMDD
      if (response.tradeDay && Array.isArray(response.tradeDay)) {
        response.tradeDay.forEach((day: string) => {
          tradeDays.add(day);
        });
      }

      // response.halfTradeDay 是半日市数组
      if (response.halfTradeDay && Array.isArray(response.halfTradeDay)) {
        response.halfTradeDay.forEach((day: string) => {
          halfTradeDays.add(day);
          tradeDays.add(day); // 半日市也是交易日
        });
      }

      logger.log(`[交易日服务] 获取到 ${tradeDays.size} 个交易日，其中 ${halfTradeDays.size} 个半日市`);

      return { tradeDays, halfTradeDays };
    } catch (error: any) {
      logger.error(`[交易日服务] 获取交易日数据失败:`, error.message);
      throw error;
    }
  }

  /**
   * 获取交易日数据（带缓存）
   * 如果日期范围超过一个月，会自动分批获取
   */
  async getTradingDays(
    market: 'US' | 'HK' | 'SH' | 'SZ',
    startDate: Date,
    endDate: Date
  ): Promise<Set<string>> {
    // 检查缓存
    const cacheKey = this.getCacheKey(market, startDate, endDate);
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      logger.log(`[交易日服务] 使用缓存数据: ${cacheKey}`);
      return cached.tradeDays;
    }

    // 计算日期范围（天）
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // 如果日期范围超过一个月（30天），需要分批获取
    if (daysDiff > 30) {
      logger.log(`[交易日服务] 日期范围超过30天，分批获取: ${daysDiff}天`);
      
      const allTradeDays = new Set<string>();
      let currentStart = new Date(startDate);
      
      while (currentStart <= endDate) {
        // 计算当前批次的结束日期（最多30天）
        const currentEnd = new Date(currentStart);
        currentEnd.setDate(currentEnd.getDate() + 30);
        if (currentEnd > endDate) {
          currentEnd.setTime(endDate.getTime());
        }

        // 获取当前批次的交易日数据
        const batchData = await this.fetchTradingDaysFromAPI(market, currentStart, currentEnd);
        batchData.tradeDays.forEach(day => allTradeDays.add(day));

        // 移动到下一批次
        currentStart = new Date(currentEnd);
        currentStart.setDate(currentStart.getDate() + 1);

        // 避免频繁调用API
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 缓存结果
      this.cache.set(cacheKey, {
        market,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        tradeDays: allTradeDays,
        halfTradeDays: new Set(),
        expiresAt: Date.now() + this.CACHE_TTL,
      });

      return allTradeDays;
    } else {
      // 日期范围在30天内，直接获取
      const { tradeDays, halfTradeDays } = await this.fetchTradingDaysFromAPI(market, startDate, endDate);

      // 缓存结果
      this.cache.set(cacheKey, {
        market,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        tradeDays,
        halfTradeDays,
        expiresAt: Date.now() + this.CACHE_TTL,
      });

      return tradeDays;
    }
  }

  /**
   * 判断指定日期是否为交易日
   * @param date 日期
   * @param market 市场类型
   * @returns 是否为交易日
   */
  async isTradingDay(date: Date, market: 'US' | 'HK' | 'SH' | 'SZ' = 'US'): Promise<boolean> {
    // 先快速检查：周末肯定不是交易日
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }

    // 检查未来日期
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (date > today) {
      return false;
    }

    // 获取该日期所在月份的交易日数据
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    
    try {
      const tradingDays = await this.getTradingDays(market, monthStart, monthEnd);
      const dateStr = this.dateToYYMMDD(date);
      return tradingDays.has(dateStr);
    } catch (error: any) {
      logger.warn(`[交易日服务] 获取交易日数据失败，使用周末判断: ${error.message}`);
      // 如果API调用失败，降级到周末判断
      return dayOfWeek !== 0 && dayOfWeek !== 6;
    }
  }

  /**
   * 获取指定日期范围内的交易日列表
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param market 市场类型
   * @returns 交易日列表
   */
  async getTradingDaysList(
    startDate: Date,
    endDate: Date,
    market: 'US' | 'HK' | 'SH' | 'SZ' = 'US'
  ): Promise<Date[]> {
    const tradingDaysSet = await this.getTradingDays(market, startDate, endDate);
    const tradingDays: Date[] = [];
    
    tradingDaysSet.forEach(dayStr => {
      const day = this.YYMMDDToDate(dayStr);
      if (day >= startDate && day <= endDate) {
        tradingDays.push(day);
      }
    });
    
    return tradingDays.sort((a, b) => a.getTime() - b.getTime());
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    logger.log('[交易日服务] 缓存已清除');
  }
}

export default new TradingDaysService();

