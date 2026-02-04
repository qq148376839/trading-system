/**
 * 交易时段服务
 * 使用Longbridge SDK的tradingSession接口获取当日交易时段
 * 参考文档: https://open.longbridge.com/zh-CN/docs/quote/pull/trade-session
 */

import { getQuoteContext } from '../config/longport';
import { logger } from '../utils/logger';
import { getMarketFromSymbol } from '../utils/trading-days';
import configService from './config.service';

// 导入Longbridge SDK的Market枚举（延迟加载）
let longport: any = null;
let Market: any = null;

try {
  longport = require('longport');
  Market = longport.Market;
} catch (error: any) {
  console.warn('交易时段服务: LongPort SDK 不可用，交易时段查询功能将被禁用');
}

/**
 * 交易时段类型枚举
 * 0: 盘中交易（Regular Trading Hours）
 * 1: 盘前交易（Pre-Market）
 * 2: 盘后交易（After-Hours）
 * 3: 夜盘交易（Night Session）
 */
export enum TradeSessionType {
  REGULAR = 0,      // 盘中交易
  PRE_MARKET = 1,   // 盘前交易
  AFTER_HOURS = 2,  // 盘后交易
  NIGHT = 3,        // 夜盘交易
}

interface TradePeriod {
  begTime: number; // 交易开始时间，格式：hhmm 例如：930
  endTime: number; // 交易结束时间，格式：hhmm 例如：1600
  tradeSession?: number; // 交易时段类型（可选）：0=盘中交易, 1=盘前交易, 2=盘后交易, 3=夜盘交易
}

interface MarketTradingSession {
  market: string; // 市场类型：US, HK, CN, SG
  tradeSession: TradePeriod[]; // 交易时段列表
}

/**
 * 交易时段服务（单例）
 * 使用Longbridge API获取当日交易时段数据，并实现缓存机制
 */
class TradingSessionService {
  private cache: MarketTradingSession[] | null = null;
  private cacheDate: string | null = null; // 缓存日期（YYYY-MM-DD格式）
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1小时缓存（交易时段可能变化）

  /**
   * 获取当日交易时段数据（带缓存）
   */
  async getTradingSessions(): Promise<MarketTradingSession[]> {
    // 检查SDK是否可用
    if (!Market) {
      logger.warn('[交易时段服务] LongPort SDK 不可用，返回空数据');
      return [];
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // 检查缓存是否有效
    if (this.cache && this.cacheDate === today) {
      return this.cache;
    }

    try {
      const quoteCtx = await getQuoteContext();
      logger.log(`[交易时段服务] 开始调用Longbridge API获取交易时段...`);
      
      // 调用Longbridge API获取交易时段
      // 参考文档：https://longportapp.github.io/openapi/nodejs/classes/QuoteContext.html#tradingsession
      const response = await quoteCtx.tradingSession();

      // 简化日志：只在首次获取或出错时记录

      // 解析响应数据
      // 根据API文档，响应格式可能为：
      // 1. MarketTradingSession[] (数组)
      // 2. { market_trade_session: MarketTradingSession[] } (对象)
      // 3. market可能是枚举值（数字）或字符串
      const sessions: MarketTradingSession[] = [];

      // 处理不同的响应格式
      let responseArray: any[] = [];
      
      if (Array.isArray(response)) {
        responseArray = response;
      } else if (response && typeof response === 'object') {
        // 可能是对象格式，尝试提取数组
        responseArray = response.market_trade_session || response.marketTradeSession || response.sessions || [];
        if (!Array.isArray(responseArray)) {
          // 如果不是数组，尝试将对象转换为数组
          responseArray = Object.values(response);
        }
      } else {
        logger.warn(`[交易时段服务] 响应格式无法识别: ${typeof response}`);
      }

      // Market枚举值到字符串的映射
      const marketEnumMap: Record<number, string> = {
        [Market.US]: 'US',
        [Market.HK]: 'HK',
        [Market.CN]: 'CN',
        [Market.SG]: 'SG',
      };

      // 解析每个市场的交易时段
      responseArray.forEach((item: any) => {
        // 处理market字段：可能是枚举值（数字）或字符串
        let market: string | undefined;
        
        if (typeof item.market === 'number') {
          // 如果是数字，尝试从枚举映射中获取
          market = marketEnumMap[item.market];
          if (!market) {
            logger.warn(`[交易时段服务] 未知的Market枚举值: ${item.market}`);
            return; // 跳过未知市场
          }
        } else if (typeof item.market === 'string') {
          market = item.market;
        } else {
          logger.warn(`[交易时段服务] 无法解析market字段: ${typeof item.market}`);
          return; // 跳过无效数据
        }

        // 处理tradeSession字段：可能是数组或对象
        // 注意：Longbridge SDK返回的字段名可能是 tradeSessions（复数）或 tradeSession（单数）
        let tradeSessionArray: any[] = [];
        
        if (Array.isArray(item.tradeSessions)) {
          // ✅ 优先检查 tradeSessions（复数）- Longbridge SDK的实际字段名
          tradeSessionArray = item.tradeSessions;
        } else if (Array.isArray(item.tradeSession)) {
          tradeSessionArray = item.tradeSession;
        } else if (Array.isArray(item.trade_session)) {
          tradeSessionArray = item.trade_session;
        } else if (item.tradeSessions && typeof item.tradeSessions === 'object') {
          // 如果是对象，尝试转换为数组
          tradeSessionArray = Object.values(item.tradeSessions);
        } else if (item.tradeSession && typeof item.tradeSession === 'object') {
          tradeSessionArray = Object.values(item.tradeSession);
        }

        /**
         * 将时间转换为hhmm格式的数字
         * 支持格式:
         * - 数字: 400 -> 400
         * - 字符串: "04:00:00" -> 400, "09:30:00" -> 930
         * - Date对象: 转换为hhmm
         * - Longbridge Time对象: 转换为hhmm
         */
        const timeStringToHHMM = (timeInput: any): number | undefined => {
          // 已经是数字，直接返回
          if (typeof timeInput === 'number') {
            return timeInput;
          }
          
          // Date对象
          if (timeInput instanceof Date) {
            return timeInput.getHours() * 100 + timeInput.getMinutes();
          }
          
          // 字符串格式: "HH:MM:SS" 或 "HH:MM"
          if (typeof timeInput === 'string') {
            const parts = timeInput.split(':');
            if (parts.length >= 2) {
              const hour = parseInt(parts[0], 10);
              const minute = parseInt(parts[1], 10);
              if (!isNaN(hour) && !isNaN(minute)) {
                return hour * 100 + minute;
              }
            }
            return undefined;
          }
          
          // Longbridge Time对象处理
          if (timeInput && typeof timeInput === 'object') {
            // 方法1: 检查是否有hour和minute属性
            if ('hour' in timeInput && 'minute' in timeInput) {
              try {
                const hour = typeof timeInput.hour === 'number' ? timeInput.hour : parseInt(String(timeInput.hour), 10);
                const minute = typeof timeInput.minute === 'number' ? timeInput.minute : parseInt(String(timeInput.minute), 10);
                if (!isNaN(hour) && !isNaN(minute)) {
                  return hour * 100 + minute;
                }
              } catch (e) {
                // 忽略错误，继续尝试其他方法
              }
            }
            
            // 方法2: 尝试toString方法解析 "Time(4:00:00.0)" 格式
            try {
              const str = String(timeInput);
              // 匹配 "Time(4:00:00.0)" 或类似格式
              const match = str.match(/Time\((\d+):(\d+):/);
              if (match) {
                const hour = parseInt(match[1], 10);
                const minute = parseInt(match[2], 10);
                if (!isNaN(hour) && !isNaN(minute)) {
                  return hour * 100 + minute;
                }
              }
            } catch (e) {
              // toString失败，继续尝试其他方法
            }
            
            // 方法3: 尝试调用可能的方法（如果Time对象有toHours/toMinutes等方法）
            try {
              if (typeof timeInput.toHours === 'function') {
                const hour = timeInput.toHours();
                const minute = typeof timeInput.toMinutes === 'function' ? timeInput.toMinutes() % 60 : 0;
                if (!isNaN(hour) && !isNaN(minute)) {
                  return hour * 100 + minute;
                }
              }
            } catch (e) {
              // 忽略错误
            }
            
            // 方法4: 尝试访问可能的属性名变体
            const possibleHourProps = ['hour', 'hours', 'h', 'hourOfDay'];
            const possibleMinuteProps = ['minute', 'minutes', 'm', 'minuteOfHour'];
            
            for (const hourProp of possibleHourProps) {
              for (const minuteProp of possibleMinuteProps) {
                if (hourProp in timeInput && minuteProp in timeInput) {
                  try {
                    const hour = parseInt(String(timeInput[hourProp]), 10);
                    const minute = parseInt(String(timeInput[minuteProp]), 10);
                    if (!isNaN(hour) && !isNaN(minute)) {
                      return hour * 100 + minute;
                    }
                  } catch (e) {
                    // 继续尝试下一个组合
                  }
                }
              }
            }
          }
          
          return undefined;
        };
        
        const periods: TradePeriod[] = tradeSessionArray.map((ts: any) => {
          // 处理begTime和endTime：可能是数字、字符串或对象
          let begTime: number | undefined;
          let endTime: number | undefined;
          let tradeSessionType: number | undefined;

          if (typeof ts === 'object' && ts !== null) {
            // ✅ 优先检查 beginTime/endTime（Longbridge SDK的实际字段名）
            // 也支持 begTime/beg_time 等变体
            const rawBegTime = ts.beginTime || ts.begin_time || ts.begTime || ts.beg_time;
            const rawEndTime = ts.endTime || ts.end_time || ts.endTime || ts.end_time;
            tradeSessionType = ts.tradeSession || ts.trade_session || ts.sessionType || ts.session_type;
            
            // 转换时间格式（安全处理，避免类型转换错误）
            try {
              begTime = timeStringToHHMM(rawBegTime);
              endTime = timeStringToHHMM(rawEndTime);
              
              if (begTime === undefined || endTime === undefined) {
                // 如果转换失败，尝试从JSON序列化结果中提取（因为JSON.stringify会将Time对象转为字符串）
                const tsJson = JSON.stringify(ts);
                const begMatch = tsJson.match(/"beginTime"\s*:\s*"(\d{2}):(\d{2}):(\d{2})"/);
                const endMatch = tsJson.match(/"endTime"\s*:\s*"(\d{2}):(\d{2}):(\d{2})"/);
                
                if (begMatch && endMatch) {
                  begTime = parseInt(begMatch[1], 10) * 100 + parseInt(begMatch[2], 10);
                  endTime = parseInt(endMatch[1], 10) * 100 + parseInt(endMatch[2], 10);
                }
              }
            } catch (e: any) {
              logger.error(`[交易时段服务] ${market}市场时间转换失败: ${e.message}`);
              return null;
            }
          } else if (typeof ts === 'number') {
            // 如果直接是数字，可能是begTime
            begTime = ts;
          }

          // 验证数据有效性
          if (typeof begTime !== 'number' || typeof endTime !== 'number') {
            return null;
          }

          return {
            begTime,
            endTime,
            tradeSession: tradeSessionType,
          };
        }).filter((p: TradePeriod | null): p is TradePeriod => p !== null);

        if (periods.length > 0) {
          sessions.push({
            market,
            tradeSession: periods,
          });
        } else {
          logger.warn(`[交易时段服务] ${market}市场无有效交易时段数据`);
        }
      });

      // 更新缓存
      this.cache = sessions;
      this.cacheDate = today;

      logger.log(`[交易时段服务] 获取到 ${sessions.length} 个市场的交易时段数据`);
      return sessions;
    } catch (error: any) {
      logger.error(`[交易时段服务] ========== 错误详情 ==========`);
      logger.error(`[交易时段服务] 错误消息: ${error.message}`);
      logger.error(`[交易时段服务] 错误堆栈:`, error.stack);
      logger.error(`[交易时段服务] 错误类型: ${error.constructor?.name || typeof error}`);
      if (error.response) {
        logger.error(`[交易时段服务] 错误响应:`, JSON.stringify(error.response, null, 2));
      }
      logger.error(`[交易时段服务] ============================`);
      // 如果API调用失败，返回空数组（降级处理）
      return [];
    }
  }

  /**
   * 获取指定市场的交易时段
   * @param market 市场类型（US, HK, SH, SZ）
   * @returns 交易时段列表
   */
  async getMarketTradingSessions(market: 'US' | 'HK' | 'SH' | 'SZ'): Promise<TradePeriod[]> {
    const sessions = await this.getTradingSessions();
    
    // 转换市场类型（SH/SZ -> CN）
    const lbMarket = market === 'SH' || market === 'SZ' ? 'CN' : market;
    
    const marketSession = sessions.find(s => s.market === lbMarket);
    return marketSession?.tradeSession || [];
  }

  /**
   * 获取市场所在时区
   * 
   * ⚠️ 重要：Longbridge API返回的交易时段时间（begTime/endTime）是市场本地时间
   * 因此需要将当前UTC时间转换为市场本地时间进行比较
   */
  private getMarketTimeZone(market: 'US' | 'HK' | 'SH' | 'SZ'): string {
    const timeZoneMap: Record<string, string> = {
      'US': 'America/New_York', // 美东时间（EST/EDT，自动处理夏令时）
      'HK': 'Asia/Hong_Kong',    // 香港时间（HKT，UTC+8）
      'CN': 'Asia/Shanghai',     // 北京时间（CST，UTC+8）
      'SH': 'Asia/Shanghai',     // 上海时间（同北京时间）
      'SZ': 'Asia/Shanghai',     // 深圳时间（同北京时间）
    };
    return timeZoneMap[market] || 'UTC';
  }

  /**
   * 获取指定时区的当前时间（小时和分钟）
   * 
   * ⚠️ 时区转换说明：
   * - 输入：UTC时间（Date对象）
   * - 输出：指定时区的本地时间（小时和分钟）
   * - 用途：与API返回的市场本地时间进行比较
   * 
   * 示例：
   * - 当前UTC时间：2025-12-24 14:00:00 UTC
   * - 美股市场（America/New_York）：转换为美东时间 09:00:00 EST
   * - 港股市场（Asia/Hong_Kong）：转换为香港时间 22:00:00 HKT
   */
  private getLocalTime(date: Date, timeZone: string): { hour: number; minute: number } {
    // 使用 toLocaleString 将UTC时间转换为指定时区的本地时间
    const localHour = parseInt(date.toLocaleString('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }));
    
    const localMinute = parseInt(date.toLocaleString('en-US', {
      timeZone,
      minute: 'numeric',
    }));
    
    return { hour: localHour, minute: localMinute };
  }

  /**
   * 从配置中读取是否仅允许盘中交易时段
   * 配置键：only_regular_hours
   * 默认值：true（仅盘中交易时段）
   */
  private async getOnlyRegularHoursConfig(): Promise<boolean> {
    try {
      const configValue = await configService.getConfig('only_regular_hours');
      if (configValue === null) {
        // 配置不存在，使用默认值 true
        return true;
      }
      // 支持 'true'/'false' 字符串或 '1'/'0' 数字字符串
      const normalizedValue = configValue.toLowerCase().trim();
      return normalizedValue === 'true' || normalizedValue === '1';
    } catch (error: any) {
      // 如果读取配置失败，使用默认值 true
      logger.debug(`[交易时段服务] 读取only_regular_hours配置失败，使用默认值true: ${error.message}`);
      return true;
    }
  }

  /**
   * 判断当前时间是否在交易时段内
   * @param market 市场类型
   * @param currentTime 当前时间（可选，默认当前时间）
   * @param onlyRegularHours 是否仅检查盘中交易时段（可选，如果不提供则从配置读取）
   * @returns 是否在交易时段内
   */
  async isInTradingSession(
    market: 'US' | 'HK' | 'SH' | 'SZ',
    currentTime?: Date,
    onlyRegularHours?: boolean
  ): Promise<boolean> {
    // ✅ 如果未提供 onlyRegularHours 参数，从配置中读取
    let shouldOnlyRegularHours: boolean;
    if (onlyRegularHours !== undefined) {
      // 如果明确提供了参数，使用参数值（允许调用方覆盖配置）
      shouldOnlyRegularHours = onlyRegularHours;
    } else {
      // 从配置中读取
      shouldOnlyRegularHours = await this.getOnlyRegularHoursConfig();
    }
    try {
      const now = currentTime || new Date();
      const sessions = await this.getMarketTradingSessions(market);

      if (sessions.length === 0) {
        // 如果没有交易时段数据，降级到交易日判断
        logger.warn(`[交易时段服务] ${market}市场无交易时段数据，降级到交易日判断`);
        return true; // 假设是交易日，允许执行
      }

      // ✅ 时区转换：获取市场所在时区的当前时间
      // 
      // 重要说明：
      // 1. Longbridge API返回的交易时段时间（begTime/endTime）是市场本地时间
      //    例如：美股返回的是美东时间（EST/EDT），港股返回的是香港时间（HKT）
      // 2. 当前时间（now）是UTC时间，需要转换为市场本地时间进行比较
      // 3. 使用 getLocalTime 方法将UTC时间转换为市场本地时间
      //
      // 示例：
      // - API返回：begTime=930, endTime=1600（美东时间）
      // - 当前UTC时间：2025-12-24 14:00:00 UTC
      // - 转换为美东时间：2025-12-24 09:00:00 EST
      // - 比较：09:00 >= 09:30? 否，不在交易时段内
      const timeZone = this.getMarketTimeZone(market);
      const { hour: currentHour, minute: currentMinute } = this.getLocalTime(now, timeZone);
      const currentTimeMinutes = currentHour * 60 + currentMinute;

      // 检查是否在任何交易时段内
      for (const session of sessions) {
        // ✅ 如果只检查盘中交易时段，过滤掉盘前（1）和盘后（2）时段
        if (shouldOnlyRegularHours && session.tradeSession !== undefined) {
          // tradeSession = 0 表示盘中交易，undefined 也表示盘中交易（兼容旧数据）
          if (session.tradeSession !== TradeSessionType.REGULAR) {
            continue; // 跳过非盘中交易时段
          }
        }

        const begTime = session.begTime;
        const endTime = session.endTime;

        // 将hhmm格式转换为分钟数
        const begHour = Math.floor(begTime / 100);
        const begMin = begTime % 100;
        const begTimeMinutes = begHour * 60 + begMin;

        const endHour = Math.floor(endTime / 100);
        const endMin = endTime % 100;
        const endTimeMinutes = endHour * 60 + endMin;

        // 检查是否在交易时段内
        // 注意：如果结束时间小于开始时间（跨日），需要特殊处理
        if (endTimeMinutes > begTimeMinutes) {
          // 正常情况：同一天内
          if (currentTimeMinutes >= begTimeMinutes && currentTimeMinutes < endTimeMinutes) {
            return true;
          }
        } else {
          // 跨日情况：例如美股盘后 16:00 - 20:00（次日）
          // 如果当前时间 >= 开始时间 或 < 结束时间，则在交易时段内
          if (currentTimeMinutes >= begTimeMinutes || currentTimeMinutes < endTimeMinutes) {
            return true;
          }
        }
      }

      return false;
    } catch (error: any) {
      logger.error(`[交易时段服务] 判断交易时段失败:`, error.message);
      // 如果判断失败，降级到允许执行（避免阻塞策略）
      return true;
    }
  }

  /**
   * 判断指定标的当前是否在交易时段内
   * @param symbol 标的代码（如 "AAPL.US"）
   * @param currentTime 当前时间（可选）
   * @param onlyRegularHours 是否仅检查盘中交易时段（可选，如果不提供则从配置读取）
   * @returns 是否在交易时段内
   */
  async isSymbolInTradingSession(
    symbol: string, 
    currentTime?: Date,
    onlyRegularHours?: boolean
  ): Promise<boolean> {
    const market = getMarketFromSymbol(symbol);
    return this.isInTradingSession(market, currentTime, onlyRegularHours);
  }

  /**
   * 获取交易时段类型的中文描述
   * @param tradeSessionType 交易时段类型
   * @returns 中文描述
   */
  getTradeSessionTypeName(tradeSessionType?: number): string {
    if (tradeSessionType === undefined) {
      return '盘中交易';
    }
    switch (tradeSessionType) {
      case TradeSessionType.REGULAR:
        return '盘中交易';
      case TradeSessionType.PRE_MARKET:
        return '盘前交易';
      case TradeSessionType.AFTER_HOURS:
        return '盘后交易';
      case TradeSessionType.NIGHT:
        return '夜盘交易';
      default:
        return `未知时段(${tradeSessionType})`;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache = null;
    this.cacheDate = null;
    logger.log('[交易时段服务] 缓存已清除');
  }
}

export default new TradingSessionService();

