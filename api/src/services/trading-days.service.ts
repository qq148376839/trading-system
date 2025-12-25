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
      // 参考文档：
      // - Node.js SDK: https://longportapp.github.io/openapi/nodejs/classes/QuoteContext.html#tradingdays
      // - API文档: https://open.longbridge.com/zh-CN/docs/quote/pull/trade-day
      // 返回类型：Promise<MarketTradingDays>
      const response = await quoteCtx.tradingDays(marketEnum, beginNaiveDate, endNaiveDate);

      // 解析响应数据
      // 根据实际日志，Node.js SDK返回的格式为：
      // { tradingDays: string[], halfTradingDays: string[] }
      // 日期格式为 ISO 格式：YYYY-MM-DD (如 "2025-12-01")
      // 需要转换为 YYMMDD 格式 (如 "20251201")
      const tradeDays = new Set<string>();
      const halfTradeDays = new Set<string>();

      // ✅ 访问属性（注意：Node.js SDK使用复数形式 tradingDays）
      const tradingDaysArray = (response as any).tradingDays || (response as any).tradeDay || (response as any).trade_day;
      const halfTradingDaysArray = (response as any).halfTradingDays || (response as any).halfTradeDay || (response as any).half_trade_day;

      // 辅助函数：将日期转换为 YYMMDD 格式
      // 支持多种输入格式：ISO字符串、YYMMDD字符串、Date对象、NaiveDate对象等
      const isoToYYMMDD = (dateInput: any): string => {
        // 如果输入是 null 或 undefined，返回空字符串
        if (dateInput == null) {
          logger.warn(`[交易日服务] isoToYYMMDD收到null/undefined值: ${dateInput}`);
          return '';
        }

        // 如果输入不是字符串，尝试转换
        if (typeof dateInput !== 'string') {
          // 如果是Date对象
          if (dateInput instanceof Date) {
            const year = dateInput.getFullYear();
            const month = String(dateInput.getMonth() + 1).padStart(2, '0');
            const day = String(dateInput.getDate()).padStart(2, '0');
            return `${year}${month}${day}`;
          }
          // 如果是NaiveDate对象（Longbridge SDK）
          if (dateInput && typeof dateInput === 'object' && 'year' in dateInput && 'month' in dateInput && 'day' in dateInput) {
            const year = dateInput.year;
            const month = String(dateInput.month).padStart(2, '0');
            const day = String(dateInput.day).padStart(2, '0');
            return `${year}${month}${day}`;
          }
          // 尝试转换为字符串
          dateInput = String(dateInput);
        }

        // 如果已经是 YYMMDD 格式，直接返回
        if (/^\d{8}$/.test(dateInput)) {
          return dateInput;
        }
        // 如果是 ISO 格式 (YYYY-MM-DD)，转换为 YYMMDD
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
          return dateInput.replace(/-/g, '');
        }
        // 尝试解析其他格式
        const date = new Date(dateInput);
        if (!isNaN(date.getTime())) {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}${month}${day}`;
        }
        // 无法解析，返回原值（转换为字符串）
        return String(dateInput);
      };

      // tradingDays 是字符串数组，可能是 ISO 格式 (YYYY-MM-DD) 或 YYMMDD 格式
      if (tradingDaysArray && Array.isArray(tradingDaysArray)) {
        tradingDaysArray.forEach((day: any, index: number) => {
          try {
            const yymmdd = isoToYYMMDD(day);
            if (yymmdd && yymmdd.length === 8) {
              tradeDays.add(yymmdd);
            } else {
              logger.warn(`[交易日服务] 日期转换失败 (索引${index}): ${day} -> ${yymmdd}`);
            }
          } catch (error: any) {
            logger.error(`[交易日服务] 日期转换异常 (索引${index}): ${day}, 类型: ${typeof day}, 错误: ${error.message}`);
          }
        });
      }

      // halfTradingDays 是半日市数组
      if (halfTradingDaysArray && Array.isArray(halfTradingDaysArray)) {
        halfTradingDaysArray.forEach((day: any, index: number) => {
          try {
            const yymmdd = isoToYYMMDD(day);
            if (yymmdd && yymmdd.length === 8) {
              halfTradeDays.add(yymmdd);
              tradeDays.add(yymmdd); // 半日市也是交易日
            } else {
              logger.warn(`[交易日服务] 半日市日期转换失败 (索引${index}): ${day} -> ${yymmdd}`);
            }
          } catch (error: any) {
            logger.error(`[交易日服务] 半日市日期转换异常 (索引${index}): ${day}, 类型: ${typeof day}, 错误: ${error.message}`);
          }
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
   * 
   * ⚠️ 注意：根据Longbridge API限制，仅支持查询最近一年的数据
   * 如果查询未来日期，会自动限制到当前日期
   */
  async getTradingDays(
    market: 'US' | 'HK' | 'SH' | 'SZ',
    startDate: Date,
    endDate: Date
  ): Promise<Set<string>> {
    // ✅ 限制查询范围：不能查询未来日期（API仅支持最近一年）
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    // 如果开始日期是未来日期，返回空集合
    if (startDate > today) {
      logger.warn(`[交易日服务] 开始日期是未来日期，返回空集合: ${this.dateToYYMMDD(startDate)}`);
      return new Set<string>();
    }
    
    // 如果结束日期是未来日期，限制到当前日期
    // ⚠️ 注意：此日志仅在调试模式下输出，避免在生产环境产生过多日志
    let actualEndDate = endDate;
    if (endDate > today) {
      actualEndDate = new Date(today);
      // 仅在调试模式下输出日志，避免在生产环境产生过多日志
      // 这是正常行为（API限制仅支持最近一年数据），不需要每次都记录
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG_TRADING_DAYS === 'true') {
        logger.debug(`[交易日服务] 结束日期是未来日期，限制到当前日期: ${this.dateToYYMMDD(endDate)} -> ${this.dateToYYMMDD(actualEndDate)}`);
      }
    }
    
    // 确保开始日期不晚于结束日期
    if (startDate > actualEndDate) {
      logger.warn(`[交易日服务] 开始日期晚于结束日期，返回空集合`);
      return new Set<string>();
    }

    // 检查缓存（使用实际日期范围）
    const cacheKey = this.getCacheKey(market, startDate, actualEndDate);
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      logger.debug(`[交易日服务] 使用缓存数据: ${cacheKey}`);
      return cached.tradeDays;
    }

    // 计算日期范围（天）
    const daysDiff = Math.ceil((actualEndDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // 如果日期范围超过一个月（30天），需要分批获取
    if (daysDiff > 30) {
      logger.log(`[交易日服务] 日期范围超过30天，分批获取: ${daysDiff}天`);
      
      const allTradeDays = new Set<string>();
      let currentStart = new Date(startDate);
      
      while (currentStart <= actualEndDate) {
        // 计算当前批次的结束日期（最多30天）
        const currentEnd = new Date(currentStart);
        currentEnd.setDate(currentEnd.getDate() + 30);
        if (currentEnd > actualEndDate) {
          currentEnd.setTime(actualEndDate.getTime());
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
        endDate: actualEndDate.toISOString().split('T')[0],
        tradeDays: allTradeDays,
        halfTradeDays: new Set(),
        expiresAt: Date.now() + this.CACHE_TTL,
      });

      return allTradeDays;
    } else {
      // 日期范围在30天内，直接获取
      const { tradeDays, halfTradeDays } = await this.fetchTradingDaysFromAPI(market, startDate, actualEndDate);

      // 缓存结果
      this.cache.set(cacheKey, {
        market,
        startDate: startDate.toISOString().split('T')[0],
        endDate: actualEndDate.toISOString().split('T')[0],
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
   * 
   * ⚠️ 注意：此方法目前未被实际使用，项目中主要使用 getTradingDays() 方法
   * 
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param market 市场类型
   * @returns 交易日列表（Date[]格式）
   * 
   * 实现说明：
   * - 通过 getTradingDays() 获取交易日数据（使用Longbridge SDK）
   * - 将 YYYYMMDD 格式的字符串转换为 Date 对象
   * - 过滤并排序返回日期列表
   */
  async getTradingDaysList(
    startDate: Date,
    endDate: Date,
    market: 'US' | 'HK' | 'SH' | 'SZ' = 'US'
  ): Promise<Date[]> {
    // ✅ 使用 getTradingDays() 获取交易日数据（内部调用 Longbridge SDK）
    const tradingDaysSet = await this.getTradingDays(market, startDate, endDate);
    const tradingDays: Date[] = [];
    
    // 将 YYYYMMDD 格式的字符串转换为 Date 对象
    // 注意：由于 getTradingDays() 已经根据 startDate 和 endDate 过滤了数据，
    // 理论上不需要再次过滤，但为了确保日期边界正确（考虑时区问题），保留过滤逻辑
    tradingDaysSet.forEach(dayStr => {
      const day = this.YYMMDDToDate(dayStr);
      // 标准化日期比较（只比较日期部分，忽略时间）
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const startDateNormalized = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const endDateNormalized = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      
      if (dayStart >= startDateNormalized && dayStart <= endDateNormalized) {
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

