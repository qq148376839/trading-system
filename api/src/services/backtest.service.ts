/**
 * 回测服务
 * Phase 2: 完整的回测服务实现
 */

import pool from '../config/database';
import { RecommendationStrategy } from './strategies/recommendation-strategy';
import { TradingIntent } from './strategies/strategy-base';
import tradingRecommendationService from './trading-recommendation.service';
import dynamicPositionManager from './dynamic-position-manager.service';
import { getQuoteContext } from '../config/longport';
import { logger } from '../utils/logger';

export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  entryReason: string;
  exitReason: string | null;
  stopLoss?: number;  // 买入时的止损价（初始值）
  takeProfit?: number;  // 买入时的止盈价（初始值）
  currentStopLoss?: number;  // 当前止损价（动态调整后）
  currentTakeProfit?: number;  // 当前止盈价（动态调整后）
  entryTime?: string;  // 买入时间（用于计算持仓时间，ISO格式）
}

export type BacktestStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface BacktestResult {
  id?: number;
  strategyId: number;
  startDate: string;
  endDate: string;
  status?: BacktestStatus;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  totalReturn?: number;
  totalTrades?: number;
  winningTrades?: number;
  losingTrades?: number;
  winRate?: number;
  avgReturn?: number;
  maxDrawdown?: number;
  sharpeRatio?: number;
  avgHoldingTime?: number; // 小时
  trades?: BacktestTrade[];
  dailyReturns?: Array<{ date: string; return: number; equity: number }>;
  diagnosticLog?: any; // 诊断日志
}

class BacktestService {
  private initialCapital: number = 10000;

  /**
   * 获取历史K线数据
   * 使用Longbridge API的historyCandlesticksByOffset方法获取历史K线数据
   * 如果失败，降级到Moomoo日K接口
   */
  private async getHistoricalCandlesticks(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number; turnover?: number }>> {
    try {
      const quoteCtx = await getQuoteContext();
      const longport = require('longport');
      const { Period, AdjustType, NaiveDate, NaiveDatetime, TradeSessions } = longport;
      const { formatLongbridgeCandlestickForBacktest, toDate } = require('../utils/candlestick-formatter');
      
      // ✅ 验证和调整日期范围，排除周末和未来日期
      const { getMarketFromSymbol, validateDateRange } = require('../utils/trading-days');
      const market = getMarketFromSymbol(symbol);
      const validation = validateDateRange(startDate, endDate, market);
      
      if (!validation.valid) {
        logger.warn(`日期范围验证失败 (${symbol}): ${validation.error}`);
        if (validation.adjustedRange) {
          logger.log(`使用调整后的日期范围: ${validation.adjustedRange.startDate.toISOString().split('T')[0]} 至 ${validation.adjustedRange.endDate.toISOString().split('T')[0]}`);
          startDate = validation.adjustedRange.startDate;
          endDate = validation.adjustedRange.endDate;
        } else {
          throw new Error(`日期范围无效 (${symbol}): ${validation.error}`);
        }
      } else if (validation.adjustedRange) {
        // 如果日期范围被调整了，使用调整后的范围
        const originalStart = startDate.toISOString().split('T')[0];
        const originalEnd = endDate.toISOString().split('T')[0];
        startDate = validation.adjustedRange.startDate;
        endDate = validation.adjustedRange.endDate;
        const adjustedStart = startDate.toISOString().split('T')[0];
        const adjustedEnd = endDate.toISOString().split('T')[0];
        
        if (originalStart !== adjustedStart || originalEnd !== adjustedEnd) {
          logger.log(`日期范围已调整 (${symbol}): ${originalStart} 至 ${originalEnd} -> ${adjustedStart} 至 ${adjustedEnd}`);
        }
      }

      // 计算需要获取的数据量
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      // 需要获取的数据量：日期差 + 缓冲，最多1000条（Longbridge API的限制）
      const count = Math.min(daysDiff + 100, 1000);

      logger.log(`获取历史数据 (${symbol}): 需要从 ${startDate.toISOString().split('T')[0]} 到 ${endDate.toISOString().split('T')[0]}, 计算count=${count}`);

      // ✅ API频次限制处理
      const { apiRateLimiter } = require('../utils/api-rate-limiter');
      await apiRateLimiter.waitIfNeeded();
      
      // ✅ 配额监控
      const { quotaMonitor } = require('../utils/quota-monitor');
      await quotaMonitor.recordQuery(symbol);
      const quotaStatus = await quotaMonitor.checkQuota(1000);
      if (quotaStatus.isOverQuota) {
        logger.warn(`[配额警告] 已达到配额上限 (${symbol}): 已使用 ${quotaStatus.currentUsage} 个标的`);
      } else if (quotaStatus.usageRate > 80) {
        logger.warn(`[配额警告] 配额使用率较高 (${symbol}): ${quotaStatus.usageRate.toFixed(1)}% (${quotaStatus.currentUsage}/1000)`);
      }

      // ✅ 使用historyCandlesticksByDate或historyCandlesticksByOffset获取历史K线数据
      let candlesticks: any[];
      try {
        // 计算日期范围
        const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        
        // ✅ 将JavaScript Date转换为NaiveDate（Longbridge SDK要求的格式）
        // NaiveDate构造函数：new NaiveDate(year, month, day)
        // 注意：month从1开始（1=1月，12=12月），不是从0开始
        const startNaiveDate = new NaiveDate(
          startDate.getFullYear(),
          startDate.getMonth() + 1, // JavaScript的month从0开始，需要+1
          startDate.getDate()
        );
        const endNaiveDate = new NaiveDate(
          endDate.getFullYear(),
          endDate.getMonth() + 1,
          endDate.getDate()
        );
        
        if (daysDiff <= 1000) {
          // 日期范围在1000天内，优先使用historyCandlesticksByDate（更精确）
          try {
            // ✅ historyCandlesticksByDate参数顺序：
            // symbol, period, adjustType, start, end, tradeSessions(可选)
            // 注意：tradeSessions参数是可选的，如果不传则使用默认值
            candlesticks = await quoteCtx.historyCandlesticksByDate(
              symbol,
              Period.Day,
              AdjustType.NoAdjust,
              startNaiveDate,
              endNaiveDate
            );
            logger.log(`✅ 使用historyCandlesticksByDate获取到 ${candlesticks?.length || 0} 条历史数据 (${symbol})`);
          } catch (byDateError: any) {
            // 如果historyCandlesticksByDate失败，尝试使用historyCandlesticksByOffset
            logger.warn(`historyCandlesticksByDate失败 (${symbol}): ${byDateError.message}，尝试使用historyCandlesticksByOffset`);
            throw byDateError; // 继续到historyCandlesticksByOffset的catch块
          }
        } else {
          // 日期范围超过1000天，使用historyCandlesticksByOffset从结束日期往前获取
          // ✅ 将JavaScript Date转换为NaiveDatetime（Longbridge SDK要求的格式）
          // NaiveDatetime构造函数：new NaiveDatetime(NaiveDate, Time)
          const endNaiveDate = new NaiveDate(
            endDate.getFullYear(),
            endDate.getMonth() + 1,
            endDate.getDate()
          );
          const endNaiveTime = new longport.Time(
            endDate.getHours(),
            endDate.getMinutes(),
            endDate.getSeconds()
          );
          const endNaiveDatetime = new NaiveDatetime(endNaiveDate, endNaiveTime);
          
          const count = Math.min(daysDiff + 100, 1000); // 最多1000条
          // ✅ 参数顺序：
          // symbol, period, adjustType, forward, datetime, count, tradeSessions(可选)
          const tradeSessions = TradeSessions?.All || 100;
          candlesticks = await quoteCtx.historyCandlesticksByOffset(
            symbol,
            Period.Day,
            AdjustType.NoAdjust,
            false,  // forward: false表示向历史数据方向查找
            endNaiveDatetime,
            count,
            tradeSessions
          );
          logger.log(`✅ 使用historyCandlesticksByOffset获取到 ${candlesticks?.length || 0} 条历史数据 (${symbol})`);
        }
      } catch (historyError: any) {
        // 如果historyCandlesticksByOffset或historyCandlesticksByDate失败，尝试使用candlesticks作为降级方案
        logger.warn(`Longbridge历史K线API失败 (${symbol}): ${historyError.message}，尝试使用candlesticks方法`);
        
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const daysFromStartToToday = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const fallbackCount = Math.min(daysFromStartToToday + 100, 1000);
        
        // SDK 3.0.18需要TradeSessions参数
        candlesticks = await quoteCtx.candlesticks(
          symbol,
          Period.Day,
          fallbackCount,
          AdjustType.NoAdjust,
          TradeSessions?.All || 100 // 使用All获取所有交易时段的数据
        );
        
        logger.log(`✅ 使用candlesticks降级方案获取到 ${candlesticks?.length || 0} 条历史数据 (${symbol})`);
      }

      if (!candlesticks || candlesticks.length === 0) {
        logger.warn(`未获取到任何历史数据 (${symbol})，尝试降级到Moomoo`);
        // ✅ 实现Moomoo降级方案
        try {
          const moomooData = await this.getHistoricalCandlesticksFromMoomoo(symbol, startDate, endDate);
          if (moomooData && moomooData.length > 0) {
            logger.log(`✅ Moomoo降级方案成功获取到 ${moomooData.length} 条数据 (${symbol})`);
            return moomooData;
          }
        } catch (moomooError: any) {
          logger.error(`Moomoo降级方案失败 (${symbol}):`, moomooError.message);
        }
        return [];
      }

      // ✅ 使用统一的数据转换工具函数
      // 注意：getMarketFromSymbol 和 market 已在函数开头声明（第72-73行），这里直接使用
      const tradingDaysService = require('../services/trading-days.service').default;
      
      // ✅ 获取真实的交易日数据（使用Longbridge API）
      let tradingDaysSet: Set<string>;
      try {
        tradingDaysSet = await tradingDaysService.getTradingDays(market, startDate, endDate);
        logger.log(`[交易日服务] ${symbol}: 获取到 ${tradingDaysSet.size} 个交易日`);
      } catch (error: any) {
        logger.warn(`[交易日服务] ${symbol}: 获取交易日数据失败，降级到周末判断: ${error.message}`);
        tradingDaysSet = new Set(); // 如果失败，使用空集合，后续会降级到周末判断
      }
      
      // ✅ 调试日志：查看API返回的原始数据
      logger.log(`[数据诊断] ${symbol}: API返回原始数据 ${candlesticks.length} 条`);
      
      const formattedCandlesticks = candlesticks.map((c: any) => formatLongbridgeCandlestickForBacktest(c));
      
      // ✅ 调试日志：查看日期范围
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      // ✅ 调试日志：查看格式化后的数据日期范围（只在数据量异常时输出）
      if (formattedCandlesticks.length > 0 && formattedCandlesticks.length < 50) {
        const firstDate = new Date(formattedCandlesticks[0].timestamp);
        const lastDate = new Date(formattedCandlesticks[formattedCandlesticks.length - 1].timestamp);
        logger.log(`[数据诊断] ${symbol}: 目标日期范围 ${start.toISOString().split('T')[0]} 至 ${end.toISOString().split('T')[0]}`);
        logger.log(`[数据诊断] ${symbol}: API返回数据日期范围 ${firstDate.toISOString().split('T')[0]} 至 ${lastDate.toISOString().split('T')[0]}`);
      }
      
      // ✅ 辅助函数：将Date转换为YYYYMMDD格式（用于交易日判断）
      const dateToYYMMDD = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      };
      
      // ✅ 辅助函数：判断是否为交易日
      const isTradingDay = (date: Date): boolean => {
        // 如果成功获取了交易日数据，使用真实数据判断
        if (tradingDaysSet && tradingDaysSet.size > 0) {
          const dateStr = dateToYYMMDD(date);
          return tradingDaysSet.has(dateStr);
        }
        
        // 降级方案：仅判断周末
        const dayOfWeek = date.getDay();
        return dayOfWeek !== 0 && dayOfWeek !== 6;
      };
      
      let result = formattedCandlesticks
        .filter((c: any) => {
          // 过滤出指定日期范围内的数据
          const cDate = new Date(c.timestamp);
          cDate.setHours(0, 0, 0, 0);
          
          // ✅ 交易日判断：只保留交易日的数据（使用Longbridge API的真实交易日数据）
          if (!isTradingDay(cDate)) {
            return false;
          }
          
          const inRange = cDate >= start && cDate <= end;
          return inRange;
        })
        .sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime());
      
      logger.log(`[数据诊断] ${symbol}: 日期范围过滤后 ${result.length} 条`);

      // ✅ 数据完整性检查
      const requiredDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (result.length < requiredDays * 0.5) {
        logger.warn(`数据完整性警告 (${symbol}): 需要约${requiredDays}天数据，但只获取到${result.length}条，数据可能不完整`);
      }
      
      // ✅ 确保至少有50条数据（calculateRecommendation的最低要求）
      if (result.length < 50) {
        logger.warn(`数据量不足警告 (${symbol}): 只有${result.length}条数据，calculateRecommendation需要至少50条。尝试获取更多数据...`);
        // 如果数据不足，尝试获取更多数据（从更早的日期开始）
        try {
          // ✅ 计算需要补充的数据量：至少需要50条，当前有result.length条，需要补充50-result.length条
          // 但为了保险，多获取一些（考虑非交易日）
          const neededCount = Math.max(50 - result.length, 50);
          const additionalCount = Math.min(neededCount * 2, 1000 - result.length); // 多获取一些以应对非交易日
          
          logger.log(`[补充数据] ${symbol}: 尝试获取额外 ${additionalCount} 条数据`);
          
          await apiRateLimiter.waitIfNeeded();
          // SDK 3.0.18需要TradeSessions参数
          const additionalCandlesticks = await quoteCtx.candlesticks(
            symbol,
            Period.Day,
            additionalCount,
            AdjustType.NoAdjust,
            TradeSessions?.All || 100 // 使用All获取所有交易时段的数据
          );
          
          logger.log(`[补充数据] ${symbol}: API返回 ${additionalCandlesticks?.length || 0} 条额外数据`);
          
          if (additionalCandlesticks && additionalCandlesticks.length > 0) {
            const additionalFormatted = additionalCandlesticks.map((c: any) => formatLongbridgeCandlestickForBacktest(c));
            
            // ✅ 获取已有数据的最早日期，补充数据应该是这个日期之前的数据
            const earliestDate = result.length > 0 
              ? new Date(result[0].timestamp)
              : new Date(startDate);
            earliestDate.setHours(0, 0, 0, 0);
            
            // ✅ 去重：避免补充数据与已有数据重复
            const existingTimestamps = new Set(
              result.map(r => {
                const d = new Date(r.timestamp);
                d.setHours(0, 0, 0, 0);
                return d.getTime();
              })
            );
            
            // ✅ 获取补充数据日期范围的交易日数据
            const supplementStartDate = new Date(earliestDate);
            supplementStartDate.setDate(supplementStartDate.getDate() - 100); // 往前100天
            let supplementTradingDaysSet: Set<string>;
            try {
              supplementTradingDaysSet = await tradingDaysService.getTradingDays(market, supplementStartDate, earliestDate);
            } catch (error: any) {
              logger.warn(`[补充数据] ${symbol}: 获取交易日数据失败，降级到周末判断`);
              supplementTradingDaysSet = new Set();
            }
            
            const supplementDateToYYMMDD = (date: Date): string => {
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              return `${year}${month}${day}`;
            };
            
            const supplementIsTradingDay = (date: Date): boolean => {
              if (supplementTradingDaysSet && supplementTradingDaysSet.size > 0) {
                const dateStr = supplementDateToYYMMDD(date);
                return supplementTradingDaysSet.has(dateStr);
              }
              const dayOfWeek = date.getDay();
              return dayOfWeek !== 0 && dayOfWeek !== 6;
            };
            
            const additionalResult = additionalFormatted
              .filter((c: any) => {
                const cDate = new Date(c.timestamp);
                cDate.setHours(0, 0, 0, 0);
                const cTimestamp = cDate.getTime();
                
                // ✅ 去重：排除已存在的数据
                if (existingTimestamps.has(cTimestamp)) {
                  return false;
                }
                
                // ✅ 只保留在最早日期之前的数据，且是交易日
                return cDate < earliestDate && supplementIsTradingDay(cDate);
              })
              .sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime());
            
            logger.log(`[补充数据] ${symbol}: 过滤后补充数据 ${additionalResult.length} 条`);
            
            // 合并数据，确保时间顺序
            result = [...additionalResult, ...result].sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime());
            logger.log(`✅ 补充数据后，共有 ${result.length} 条数据 (${symbol})`);
          }
        } catch (additionalError: any) {
          logger.warn(`补充数据失败 (${symbol}): ${additionalError.message}`);
          logger.error(`补充数据错误详情:`, additionalError);
        }
      }

      if (result.length === 0) {
        logger.warn(`过滤后没有数据 (${symbol}): 开始日期=${startDate.toISOString().split('T')[0]}, 结束日期=${endDate.toISOString().split('T')[0]}`);
      } else {
        logger.log(`过滤后得到 ${result.length} 条数据 (${symbol})`);
      }

      return result;
    } catch (error: any) {
      logger.error(`获取历史数据失败 (${symbol}):`, error.message);
      // ✅ 实现Moomoo降级方案
      try {
        const moomooData = await this.getHistoricalCandlesticksFromMoomoo(symbol, startDate, endDate);
        if (moomooData && moomooData.length > 0) {
          logger.log(`✅ Moomoo降级方案成功获取到 ${moomooData.length} 条数据 (${symbol})`);
          return moomooData;
        }
      } catch (moomooError: any) {
        logger.error(`Moomoo降级方案失败 (${symbol}):`, moomooError.message);
      }
      throw error;
    }
  }

  /**
   * 从Moomoo获取历史K线数据（降级方案）
   * @param symbol 股票代码（Longbridge格式，如"700.HK", "AAPL.US"）
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @returns 历史K线数据（回测格式）
   */
  private async getHistoricalCandlesticksFromMoomoo(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number; turnover?: number }>> {
    const { symbolToMoomooParams } = require('../utils/symbol-to-moomoo');
    const marketDataService = require('./market-data.service').default;
    
    // 转换symbol为Moomoo参数
    const moomooParams = symbolToMoomooParams(symbol);
    if (!moomooParams) {
      logger.warn(`无法将symbol转换为Moomoo参数 (${symbol})，跳过Moomoo降级方案`);
      return [];
    }

    try {
      // 获取所有日K数据（Moomoo一次性返回所有数据）
      const allCandlesticks = await marketDataService.getCandlesticks(
        moomooParams.stockId,
        moomooParams.marketId,
        moomooParams.marketCode,
        moomooParams.instrumentType,
        moomooParams.subInstrumentType,
        1000  // 获取最多1000条
      );

      if (!allCandlesticks || allCandlesticks.length === 0) {
        logger.warn(`Moomoo未返回任何数据 (${symbol})`);
        return [];
      }

      // 转换为回测格式并过滤日期范围
      const { formatMoomooCandlestickForBacktest } = require('../utils/candlestick-formatter');
      const result = allCandlesticks
        .map((c: any) => formatMoomooCandlestickForBacktest(c))
        .filter((c: any) => {
          const cDate = new Date(c.timestamp);
          cDate.setHours(0, 0, 0, 0);
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          return cDate >= start && cDate <= end;
        })
        .sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime());

      logger.log(`Moomoo降级方案：过滤后得到 ${result.length} 条数据 (${symbol})`);
      return result;
    } catch (error: any) {
      logger.error(`从Moomoo获取历史数据失败 (${symbol}):`, error.message);
      throw error;
    }
  }

  /**
   * 执行回测
   * @param id 回测任务ID（可选，用于保存诊断日志）
   */
  async runBacktest(
    strategyId: number,
    symbols: string[],
    startDate: Date,
    endDate: Date,
    config?: any,
    id?: number
  ): Promise<BacktestResult> {
    logger.log(`开始回测: 策略ID=${strategyId}, 标的=${symbols.join(',')}`);
    logger.log(`时间范围: ${startDate.toISOString().split('T')[0]} 至 ${endDate.toISOString().split('T')[0]}`);

    // ✅ 添加诊断日志收集
    const diagnosticLog: {
      dataFetch: Array<{ symbol: string; success: boolean; count: number; error?: string }>;
      signalGeneration: Array<{ date: string; symbol: string; signal: string | null; error?: string; marketEnvironment?: string; stockTrend?: string; reason?: string }>;
      buyAttempts: Array<{ date: string; symbol: string; success: boolean; reason: string; details?: any }>;
      summary: {
        totalDates: number;
        totalSignals: number;
        totalBuyAttempts: number;
        totalBuySuccess: number;
        buyRejectReasons: Record<string, number>;
      };
    } = {
      dataFetch: [],
      signalGeneration: [],
      buyAttempts: [],
      summary: {
        totalDates: 0,
        totalSignals: 0,
        totalBuyAttempts: 0,
        totalBuySuccess: 0,
        buyRejectReasons: {},
      },
    };

    let currentCapital = this.initialCapital;
    const positions: Map<string, BacktestTrade> = new Map();
    const trades: BacktestTrade[] = [];
    const dailyEquity: Array<{ date: string; equity: number }> = [];

    // ✅ 计算扩展的开始日期：策略需要至少50条历史数据才能计算推荐
    // 为了确保回测开始时就有足够的数据，需要提前获取50个交易日的数据
    // 考虑到非交易日，多获取一些（约75天，确保有足够的交易日数据）
    const { getMarketFromSymbol } = require('../utils/trading-days');
    const tradingDaysService = require('../services/trading-days.service').default;
    const markets = new Set(symbols.map((s: string) => getMarketFromSymbol(s)));
    
    // 计算需要往前推多少天（考虑非交易日）
    // 策略需要至少50条数据，多获取一些以应对非交易日
    const daysToGoBack = 75; // 约75天，确保有足够的交易日数据（美股一周5个交易日，约15周）
    const extendedStartDate = new Date(startDate);
    extendedStartDate.setDate(extendedStartDate.getDate() - daysToGoBack);
    
    logger.log(`[回测] 扩展开始日期: ${startDate.toISOString().split('T')[0]} -> ${extendedStartDate.toISOString().split('T')[0]} (提前${daysToGoBack}天，确保有足够的历史数据)`);

    // 获取所有标的的历史数据
    const allCandlesticks: Map<string, Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number; turnover?: number }>> = new Map();
    
    // ✅ 在数据获取时记录日志
    for (const symbol of symbols) {
      try {
        // ✅ 使用扩展的开始日期获取数据，确保有足够的历史数据
        const candlesticks = await this.getHistoricalCandlesticks(symbol, extendedStartDate, endDate);
        diagnosticLog.dataFetch.push({
          symbol,
          success: true,
          count: candlesticks.length,
        });
        
        if (candlesticks.length > 0) {
          allCandlesticks.set(symbol, candlesticks);
          logger.log(`[回测] ${symbol}: 获取了 ${candlesticks.length} 条历史数据（从 ${extendedStartDate.toISOString().split('T')[0]} 到 ${endDate.toISOString().split('T')[0]}）`);
        } else {
          logger.warn(`回测 ${symbol}: 未获取到任何K线数据`);
        }
      } catch (error: any) {
        diagnosticLog.dataFetch.push({
          symbol,
          success: false,
          count: 0,
          error: error.message,
        });
        logger.error(`回测 ${symbol}: 数据获取失败`, error);
      }
    }

    if (allCandlesticks.size === 0) {
      // ✅ 保存诊断日志后再抛出错误
      if (id) {
        await this.saveDiagnosticLog(id, diagnosticLog);
      }
      throw new Error('无法获取任何历史数据');
    }

    // ✅ 获取所有日期（合并所有标的的日期），并过滤掉非交易日和未来日期
    const { isFutureDate } = require('../utils/trading-days');
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    // ✅ 获取日期范围内所有标的的交易日数据（合并所有市场）
    // 注意：markets 已在上面定义
    const tradingDaysByMarket = new Map<string, Set<string>>();
    
    // 为每个市场获取交易日数据
    for (const market of markets) {
      try {
        const tradingDays = await tradingDaysService.getTradingDays(market, startDate, endDate);
        tradingDaysByMarket.set(market, tradingDays);
        logger.log(`[回测] ${market}市场交易日数量: ${tradingDays.size}`);
      } catch (error: any) {
        logger.warn(`[回测] ${market}市场交易日数据获取失败，降级到周末判断: ${error.message}`);
        tradingDaysByMarket.set(market, new Set());
      }
    }
    
    // ✅ 辅助函数：将Date转换为YYYYMMDD格式
    const dateToYYMMDD = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    };
    
    const allDates = new Set<string>();
    allCandlesticks.forEach((candles, symbol) => {
      const market = getMarketFromSymbol(symbol);
      const marketTradingDays = tradingDaysByMarket.get(market) || new Set();
      
      candles.forEach((c) => {
        const dateStr = c.timestamp.toISOString().split('T')[0];
        const date = new Date(dateStr);
        date.setHours(0, 0, 0, 0);
        
        // ✅ 排除未来日期
        if (isFutureDate(date)) {
          return;
        }
        
        // ✅ 交易日判断：如果成功获取了交易日数据，使用真实数据；否则降级到周末判断
        let isTrading = false;
        if (marketTradingDays.size > 0) {
          const dateStrYYMMDD = dateToYYMMDD(date);
          isTrading = marketTradingDays.has(dateStrYYMMDD);
        } else {
          // 降级方案：仅判断周末
          const dayOfWeek = date.getDay();
          isTrading = dayOfWeek !== 0 && dayOfWeek !== 6;
        }
        
        if (isTrading) {
          allDates.add(dateStr);
        }
      });
    });
    const sortedDates = Array.from(allDates).sort();
    
    // ✅ 记录总日期数
    diagnosticLog.summary.totalDates = sortedDates.length;
    
    if (sortedDates.length === 0) {
      throw new Error('日期范围内没有有效的交易日数据');
    }
    
    logger.log(`[回测] 有效交易日数量: ${sortedDates.length} 天`);

    // ✅ 在回测开始前，一次性获取所有市场数据（避免在循环中多次调用）
    // Moomoo的get-kline接口（type=2）一次性返回所有日K数据，不需要多次调用
    logger.log(`[回测] 开始一次性获取市场数据（日期范围: ${startDate.toISOString().split('T')[0]} 至 ${endDate.toISOString().split('T')[0]}）`);
    const marketDataService = require('./market-data.service').default;
    
    // 计算需要获取的数据量（从开始日期到今天，确保覆盖回测日期范围）
    // Moomoo的get-kline接口一次性返回所有数据，所以只需要请求一次，传入足够大的count
    // 注意：today 已在函数开头声明（第562行），这里直接使用
    const daysFromStartToToday = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const marketDataCount = Math.min(daysFromStartToToday + 200, 1000); // 多获取200条作为缓冲，确保覆盖回测日期范围
    
    // 一次性获取所有市场数据（SPX、USD Index、BTC）
    // 注意：Moomoo的get-kline接口（type=2）一次性返回所有日K数据，不需要多次调用
    let allMarketData: Map<string, any[]> = new Map();
    try {
      const [spxData, usdIndexData, btcData] = await Promise.all([
        marketDataService.getSPXCandlesticks(marketDataCount),
        marketDataService.getUSDIndexCandlesticks(marketDataCount),
        marketDataService.getBTCCandlesticks(marketDataCount),
      ]);
      
      allMarketData.set('SPX', spxData);
      allMarketData.set('USD Index', usdIndexData);
      allMarketData.set('BTC', btcData);
      
      logger.log(`[回测] 市场数据获取完成: SPX=${spxData.length}条, USD Index=${usdIndexData.length}条, BTC=${btcData.length}条`);
    } catch (error: any) {
      logger.error(`[回测] 市场数据获取失败:`, error.message);
      // 如果市场数据获取失败，回测仍然可以继续，但会在循环中每次调用时失败
    }

    // 创建策略实例
    const strategy = new RecommendationStrategy(strategyId, {});

      // 按日期遍历
      for (const dateStr of sortedDates) {
        // ✅ 使用日期的结束时间，确保包含当天的数据
        const currentDate = new Date(dateStr);
        currentDate.setHours(23, 59, 59, 999);
        
        // ✅ 再次验证：确保是交易日且不是未来日期（双重检查）
        const dateForCheck = new Date(dateStr);
        dateForCheck.setHours(0, 0, 0, 0);
        const market = symbols.length > 0 ? getMarketFromSymbol(symbols[0]) : 'US';
        
        // ✅ 使用交易日服务判断（如果可用）
        const marketTradingDays = tradingDaysByMarket.get(market) || new Set();
        let isTrading = false;
        if (marketTradingDays.size > 0) {
          const dateStrYYMMDD = dateToYYMMDD(dateForCheck);
          isTrading = marketTradingDays.has(dateStrYYMMDD);
        } else {
          // 降级方案：仅判断周末
          const dayOfWeek = dateForCheck.getDay();
          isTrading = dayOfWeek !== 0 && dayOfWeek !== 6;
        }
        
        if (!isTrading || isFutureDate(dateForCheck)) {
          logger.warn(`[回测] 跳过非交易日或未来日期: ${dateStr}`);
          continue;
        }

      // 检查每个标的的持仓
      for (const symbol of symbols) {
        const candlesticks = allCandlesticks.get(symbol);
        if (!candlesticks) continue;

        const candle = candlesticks.find(c => c.timestamp.toISOString().split('T')[0] === dateStr);
        if (!candle) continue;

        const currentPrice = candle.close;

        // 检查持仓的止损止盈
        if (positions.has(symbol)) {
          const trade = positions.get(symbol)!;
          
          // ✅ 动态调整止损止盈（如果启用）
          // 使用当前止损止盈，如果没有则使用初始值
          let currentStopLoss = trade.currentStopLoss ?? trade.stopLoss;
          let currentTakeProfit = trade.currentTakeProfit ?? trade.takeProfit;
          
          // 如果配置中启用了动态调整，则调用动态调整管理器
          // 注意：回测中需要模拟市场环境数据
          if (config?.enableDynamicAdjustment !== false) {
            try {
              // 获取当前市场环境（回测中需要从推荐服务获取）
              // 这里简化实现：如果entryReason中包含市场环境信息，则解析使用
              const marketEnvMatch = trade.entryReason.match(/市场环境([^；]+)/);
              const marketEnv = marketEnvMatch ? marketEnvMatch[1].trim() : '中性利好';
              
              const strengthMatch = trade.entryReason.match(/综合市场强度\s*(\d+\.?\d*)/);
              const marketStrength = strengthMatch ? parseFloat(strengthMatch[1]) : 21.0;
              
              // 计算持仓时间（小时）
              const entryTime = trade.entryTime ? new Date(trade.entryTime) : new Date(trade.entryDate);
              const currentTime = new Date(dateStr);
              const holdingHours = (currentTime.getTime() - entryTime.getTime()) / (1000 * 60 * 60);
              
              // 调用动态调整
              const adjustmentResult = await dynamicPositionManager.adjustStopLossTakeProfit(
                {
                  entryPrice: trade.entryPrice,
                  entryTime: trade.entryTime || trade.entryDate,
                  currentStopLoss: currentStopLoss,
                  currentTakeProfit: currentTakeProfit,
                } as any,
                currentPrice,
                marketEnv,
                marketStrength,
                symbol
              );
              
              // 更新止损止盈
              if (adjustmentResult.context.currentStopLoss !== undefined) {
                currentStopLoss = adjustmentResult.context.currentStopLoss;
                trade.currentStopLoss = currentStopLoss;
              }
              if (adjustmentResult.context.currentTakeProfit !== undefined) {
                currentTakeProfit = adjustmentResult.context.currentTakeProfit;
                trade.currentTakeProfit = currentTakeProfit;
              }
              
              // 如果动态调整建议卖出，则执行卖出
              if (adjustmentResult.shouldSell) {
                const sellPrice = currentPrice; // 动态调整卖出使用当前价格
                this.simulateSell(symbol, dateStr, sellPrice, adjustmentResult.exitReason || 'DYNAMIC_ADJUSTMENT', trade, positions, trades, (amount) => {
                  currentCapital += amount;
                }, config);
                continue; // 已卖出，继续下一个标的
              }
            } catch (error: any) {
              // 动态调整失败，使用原始止损止盈
              logger.warn(`[回测] ${symbol} ${dateStr}: 动态调整失败，使用原始止损止盈: ${error.message}`);
            }
          }

          // 检查止损止盈触发
          // ✅ 修复：优先检查原始止损止盈，确保即使动态调整移除了止损止盈，也能正确触发
          const originalStopLoss = trade.stopLoss;
          const originalTakeProfit = trade.takeProfit;
          
          // 先检查动态调整后的止损止盈
          if (currentStopLoss && currentPrice <= currentStopLoss) {
            // ✅ 修复：使用止损价格作为卖出价格，而不是收盘价
            // 实际交易中，止损触发时应该以止损价格或更差的价格卖出（限价单）
            // 这里使用止损价格，更符合实际交易逻辑
            const sellPrice = currentStopLoss;
            this.simulateSell(symbol, dateStr, sellPrice, 'STOP_LOSS', trade, positions, trades, (amount) => {
              currentCapital += amount; // amount 是卖出收回的资金（price * quantity）
            }, config);
          } else if (currentTakeProfit && currentPrice >= currentTakeProfit) {
            // ✅ 修复：使用止盈价格作为卖出价格，而不是收盘价
            // 实际交易中，止盈触发时应该以止盈价格或更好的价格卖出（限价单）
            // 这里使用止盈价格，更符合实际交易逻辑
            const sellPrice = currentTakeProfit;
            this.simulateSell(symbol, dateStr, sellPrice, 'TAKE_PROFIT', trade, positions, trades, (amount) => {
              currentCapital += amount; // amount 是卖出收回的资金（price * quantity）
            }, config);
          } else if (originalStopLoss && currentPrice <= originalStopLoss) {
            // ✅ 修复：如果动态调整移除了止损，但价格已经低于原始止损价，仍然触发止损
            // 这可以防止动态调整错误地移除止损导致大额亏损
            const sellPrice = originalStopLoss;
            this.simulateSell(symbol, dateStr, sellPrice, 'STOP_LOSS_ORIGINAL', trade, positions, trades, (amount) => {
              currentCapital += amount;
            }, config);
          } else if (originalTakeProfit && currentPrice >= originalTakeProfit) {
            // ✅ 修复：如果动态调整移除了止盈，但价格已经超过原始止盈价，仍然触发止盈
            // 这可以防止动态调整错误地移除止盈导致错过盈利机会
            const sellPrice = originalTakeProfit;
            this.simulateSell(symbol, dateStr, sellPrice, 'TAKE_PROFIT_ORIGINAL', trade, positions, trades, (amount) => {
              currentCapital += amount;
            }, config);
          }
        }

        // 如果没有持仓，尝试生成买入信号
        if (!positions.has(symbol)) {
          try {
            // ✅ 传入历史日期和历史K线数据，确保策略基于历史市场条件生成信号
            // 获取当前日期之前的历史K线数据（用于推荐服务）
            // 注意：需要至少50条数据才能计算推荐
            const historicalCandles = candlesticks.filter(c => 
              c.timestamp.toISOString().split('T')[0] <= dateStr
            );
            
            // ✅ 调试日志：记录数据使用情况（仅在数据不足时输出）
            if (historicalCandles.length < 50) {
              const totalDataCount = candlesticks.length;
              const firstDataDate = candlesticks.length > 0 
                ? candlesticks[0].timestamp.toISOString().split('T')[0]
                : 'N/A';
              logger.warn(`[回测] ${symbol} 历史K线数据不足: 日期 ${dateStr}，可用历史数据 ${historicalCandles.length} 条（总数据量 ${totalDataCount} 条，最早数据日期 ${firstDataDate}），需要至少50条。跳过该日期`);
              continue; // 跳过该日期，继续下一个日期
            }
            
            // ✅ 调试日志：记录数据使用情况（仅在回测开始的前几天输出，帮助验证修复效果）
            if (historicalCandles.length >= 50 && historicalCandles.length <= 55) {
              logger.log(`[回测] ${symbol} 日期 ${dateStr}: 使用 ${historicalCandles.length} 条历史数据生成信号`);
            }
            
            // 转换为推荐服务需要的格式（包含timestamp和turnover字段）
            const historicalStockCandlesticks = historicalCandles.map(c => ({
              close: c.close,
              open: c.open,
              high: c.high,
              low: c.low,
              volume: c.volume,
              turnover: c.turnover || 0, // 添加turnover字段
              timestamp: c.timestamp.getTime() / 1000, // 转换为秒级时间戳
            }));
            
            // ✅ 从预获取的市场数据中提取当前日期的数据
            const preFetchedMarketData = {
              spx: allMarketData.get('SPX') || [],
              usdIndex: allMarketData.get('USD Index') || [],
              btc: allMarketData.get('BTC') || [],
            };
            
            // ✅ 直接调用推荐服务获取原始结果，以便诊断为什么没有BUY信号
            const recommendation = await tradingRecommendationService.calculateRecommendation(
              symbol,
              currentDate,
              historicalStockCandlesticks,
              preFetchedMarketData
            );
            
            // ✅ 记录推荐服务的原始结果（包括HOLD）
            diagnosticLog.summary.totalSignals++;
            diagnosticLog.signalGeneration.push({
              date: dateStr,
              symbol,
              signal: recommendation.action, // 记录原始action（BUY/HOLD/SELL）
              marketEnvironment: recommendation.market_environment, // 市场环境
              stockTrend: recommendation.analysis_summary?.includes('上升趋势') ? '上升趋势' : 
                        recommendation.analysis_summary?.includes('盘整') ? '盘整' : 
                        recommendation.analysis_summary?.includes('下降趋势') ? '下降趋势' : '未知',
              reason: recommendation.action === 'HOLD' ? '策略判断为HOLD' : recommendation.analysis_summary,
            });
            
            // 如果推荐是HOLD，不生成信号（与recommendation-strategy.ts的逻辑一致）
            if (recommendation.action === 'HOLD') {
              continue; // 跳过，不生成买入信号
            }
            
            // 转换为TradingIntent（与recommendation-strategy.ts的逻辑一致）
            const intent: TradingIntent = {
              action: recommendation.action,
              symbol: recommendation.symbol,
              entryPriceRange: recommendation.entry_price_range,
              entryPrice: (recommendation.entry_price_range.min + recommendation.entry_price_range.max) / 2,
              stopLoss: recommendation.stop_loss,
              takeProfit: recommendation.take_profit,
              reason: recommendation.analysis_summary,
              metadata: {
                marketEnvironment: recommendation.market_environment,
              },
            };
            
            if (intent && intent.action === 'BUY') {
              // 基于历史K线数据计算止损止盈（不使用实时推荐服务的止损止盈）
              const candlesticks = allCandlesticks.get(symbol);
              let stopLoss: number;
              let takeProfit: number;
              
              if (candlesticks) {
                // 找到当前日期之前的K线数据
                const historicalCandles = candlesticks.filter(c => 
                  c.timestamp.toISOString().split('T')[0] <= dateStr
                );
                
                if (historicalCandles.length >= 14) {
                  const atr = this.calculateATR(historicalCandles, 14);
                  const atrMultiplier = 2.0; // 默认ATR倍数
                  
                  // 止损：买入价 - ATR * 倍数，但至少5%止损
                  stopLoss = Math.max(
                    currentPrice - atr * atrMultiplier,
                    currentPrice * 0.95  // 至少5%止损
                  );
                  
                  // 止盈：买入价 + ATR * 倍数 * 1.5，但至少10%止盈
                  takeProfit = Math.min(
                    currentPrice + atr * atrMultiplier * 1.5,
                    currentPrice * 1.10  // 至少10%止盈
                  );
                  
                  // 确保止损 < 买入价 < 止盈
                  if (stopLoss >= currentPrice) {
                    stopLoss = currentPrice * 0.95;
                  }
                  if (takeProfit <= currentPrice) {
                    takeProfit = currentPrice * 1.10;
                  }
                } else {
                  // 数据不足，使用固定百分比
                  stopLoss = currentPrice * 0.95;
                  takeProfit = currentPrice * 1.10;
                }
              } else {
                // 没有历史数据，使用固定百分比
                stopLoss = currentPrice * 0.95;
                takeProfit = currentPrice * 1.10;
              }
              
              // 验证止损止盈的合理性
              if (stopLoss >= currentPrice) {
                logger.warn(`回测 ${symbol} ${dateStr}: 止损价(${stopLoss.toFixed(2)}) >= 买入价(${currentPrice.toFixed(2)})，调整为95%`);
                stopLoss = currentPrice * 0.95;
              }
              if (takeProfit <= currentPrice) {
                logger.warn(`回测 ${symbol} ${dateStr}: 止盈价(${takeProfit.toFixed(2)}) <= 买入价(${currentPrice.toFixed(2)})，调整为110%`);
                takeProfit = currentPrice * 1.10;
              }
              
              // ✅ 记录买入尝试
              diagnosticLog.summary.totalBuyAttempts++;
              const buyResult = this.simulateBuy(
                symbol, 
                dateStr, 
                currentPrice, 
                intent.reason || 'BUY_SIGNAL', 
                currentCapital, 
                positions, 
                stopLoss,
                takeProfit,
                (amount) => {
                  // amount 是负数（实际买入成本），所以用 += 来扣除
                  currentCapital += amount;
                },
                config
              );
              
              // ✅ 记录买入结果
              if (buyResult.success) {
                diagnosticLog.summary.totalBuySuccess++;
                diagnosticLog.buyAttempts.push({
                  date: dateStr,
                  symbol,
                  success: true,
                  reason: '买入成功',
                  details: buyResult.details,
                });
              } else {
                const rejectReason = buyResult.reason || '未知原因';
                diagnosticLog.buyAttempts.push({
                  date: dateStr,
                  symbol,
                  success: false,
                  reason: rejectReason,
                  details: buyResult.details,
                });
                diagnosticLog.summary.buyRejectReasons[rejectReason] = 
                  (diagnosticLog.summary.buyRejectReasons[rejectReason] || 0) + 1;
              }
            }
          } catch (error: any) {
            // ✅ 记录信号生成失败
            diagnosticLog.signalGeneration.push({
              date: dateStr,
              symbol,
              signal: null,
              error: error.message,
            });
            logger.warn(`回测生成信号失败 (${symbol}, ${dateStr}):`, error.message);
          }
        }
      }

      // 记录每日权益
      // 权益 = 现金 + 持仓市值
      let dailyEquityValue = currentCapital;
      positions.forEach((trade) => {
        const symbolCandles = allCandlesticks.get(trade.symbol);
        if (symbolCandles) {
          const candle = symbolCandles.find(c => c.timestamp.toISOString().split('T')[0] === dateStr);
          if (candle) {
            // 持仓市值 = 当前价格 * 数量
            const positionValue = candle.close * trade.quantity;
            dailyEquityValue += positionValue;
          }
        }
      });
      dailyEquity.push({
        date: dateStr,
        equity: dailyEquityValue,
      });
    }

    // 平仓所有剩余持仓
    const lastDate = sortedDates[sortedDates.length - 1];
    for (const symbol of symbols) {
      if (positions.has(symbol)) {
        const trade = positions.get(symbol)!;
        const candlesticks = allCandlesticks.get(symbol);
        if (candlesticks && candlesticks.length > 0) {
          const lastCandle = candlesticks[candlesticks.length - 1];
          this.simulateSell(symbol, lastDate, lastCandle.close, 'BACKTEST_END', trade, positions, trades, (amount) => {
            currentCapital += amount; // amount 是卖出收回的资金（price * quantity）
          }, config);
        }
      }
    }

    // 平仓后，更新最后一天的权益（使用平仓后的现金）
    if (dailyEquity.length > 0) {
      dailyEquity[dailyEquity.length - 1].equity = currentCapital;
    } else {
      // 如果没有记录，添加一条最终权益记录
      dailyEquity.push({
        date: lastDate,
        equity: currentCapital,
      });
    }

    // 计算性能指标
    const result = this.calculateMetrics(trades, dailyEquity, this.initialCapital);

    // ✅ 保存诊断日志
    if (id) {
      await this.saveDiagnosticLog(id, diagnosticLog);
    }

    return {
      strategyId,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      ...result,
    };
  }

  /**
   * 计算ATR（平均真实波幅）
   */
  private calculateATR(
    candlesticks: Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>,
    period: number = 14
  ): number {
    if (candlesticks.length < period + 1) {
      if (candlesticks.length > 0) {
        const recent = candlesticks.slice(-Math.min(period, candlesticks.length));
        const ranges = recent.map(c => c.high - c.low);
        return ranges.reduce((a, b) => a + b, 0) / ranges.length;
      }
      return 0;
    }

    const trueRanges: number[] = [];
    for (let i = 1; i < candlesticks.length; i++) {
      const prevClose = candlesticks[i - 1].close;
      const currentHigh = candlesticks[i].high;
      const currentLow = candlesticks[i].low;
      
      const tr1 = currentHigh - currentLow;
      const tr2 = Math.abs(currentHigh - prevClose);
      const tr3 = Math.abs(currentLow - prevClose);
      
      const tr = Math.max(tr1, tr2, tr3);
      trueRanges.push(tr);
    }

    const recentTRs = trueRanges.slice(-period);
    return recentTRs.reduce((a, b) => a + b, 0) / recentTRs.length;
  }

  /**
   * 计算交易成本（参考长桥证券美国市场交易费用）
   * 简化版本，用于回测
   */
  private calculateTradingCosts(
    price: number,
    quantity: number,
    isSell: boolean = false
  ): number {
    if (quantity <= 0 || price <= 0) return 0;

    const tradeAmount = price * quantity;
    let totalFees = 0;

    // 1. 佣金（Commission）：0.0049 USD / 股，最低 0.99 USD / 订单
    const commissionPerShare = 0.0049;
    const commission = Math.max(commissionPerShare * quantity, 0.99);
    totalFees += commission;

    // 2. 平台费（Platform Fee）：0.0050 USD / 股，最低 1 USD / 订单（简化，使用固定费率）
    const platformFeePerShare = 0.0050;
    const platformFee = Math.max(platformFeePerShare * quantity, 1.0);
    totalFees += platformFee;

    // 3. 交收费（Clearing Fee）：0.003 美元 × 成交股数，最高 7% × 交易金额
    const clearingFee = Math.min(0.003 * quantity, tradeAmount * 0.07);
    totalFees += clearingFee;

    // 4. 交易活动费（Trading Activity Fee）- 仅卖出
    if (isSell) {
      const tradingActivityFee = Math.min(Math.max(0.000166 * quantity, 0.01), 8.30);
      totalFees += tradingActivityFee;
    }

    // 5. 综合审计跟踪监管费（CAT Fee）：0.000046/股，每笔订单最低 0.01 美元
    const catFee = Math.max(0.000046 * quantity, 0.01);
    totalFees += catFee;

    return totalFees;
  }

  /**
   * 模拟买入
   * 返回结果和失败原因，用于诊断日志
   */
  private simulateBuy(
    symbol: string,
    date: string,
    price: number,
    reason: string,
    currentCapital: number,
    positions: Map<string, BacktestTrade>,
    stopLoss: number,
    takeProfit: number,
    onCapitalChange: (amount: number) => void,
    config?: any
  ): { success: boolean; reason?: string; details?: any } {
    if (positions.has(symbol)) {
      return { success: false, reason: '已有持仓' };
    }

    const tradeAmount = currentCapital * 0.1;
    const quantity = Math.floor(tradeAmount / price);

    if (quantity <= 0) {
      return { 
        success: false, 
        reason: `资金不足: 可用资金=${currentCapital.toFixed(2)}, 价格=${price.toFixed(2)}, 计算数量=${quantity}`,
        details: {
          currentCapital,
          price,
          tradeAmount,
          quantity,
        }
      };
    }

    // ✅ 计算交易成本（如果启用）
    let tradingCost = 0;
    if (config?.includeTradingCosts !== false) {
      // 计算交易成本（参考长桥证券美国市场交易费用）
      tradingCost = this.calculateTradingCosts(price, quantity, false);
    }
    
    // 实际买入成本 = 价格 * 数量 + 交易成本
    const actualCost = price * quantity + tradingCost;

    const trade: BacktestTrade = {
      symbol,
      entryDate: date,
      exitDate: null,
      entryPrice: price,
      exitPrice: null,
      quantity,
      pnl: 0,
      pnlPercent: 0,
      entryReason: reason,
      exitReason: null,
      stopLoss,
      takeProfit,
      currentStopLoss: stopLoss,  // 初始值等于买入时的止损价
      currentTakeProfit: takeProfit,  // 初始值等于买入时的止盈价
      entryTime: new Date(date).toISOString(),  // 记录买入时间
    };

    positions.set(symbol, trade);
    // 扣除实际买入成本，而不是计划投入金额
    // 这样可以确保买入扣除和卖出收回的金额匹配
    onCapitalChange(-actualCost);
    return { 
      success: true, 
      details: {
        quantity,
        actualCost,
        entryPrice: price,
      }
    };
  }

  /**
   * 模拟卖出
   */
  private simulateSell(
    symbol: string,
    date: string,
    price: number,
    reason: string,
    trade: BacktestTrade,
    positions: Map<string, BacktestTrade>,
    trades: BacktestTrade[],
    onCapitalChange: (amount: number) => void,
    config?: any
  ): void {
    // ✅ 计算交易成本（如果启用）
    let tradingCost = 0;
    if (config?.includeTradingCosts !== false) {
      // 计算交易成本（参考长桥证券美国市场交易费用）
      tradingCost = this.calculateTradingCosts(price, trade.quantity, true);
    }
    
    // 计算盈亏（扣除交易成本）
    const grossPnL = (price - trade.entryPrice) * trade.quantity;
    const netPnL = grossPnL - tradingCost;  // 扣除卖出时的交易成本
    const pnlPercent = ((price - trade.entryPrice) / trade.entryPrice) * 100;

    trade.exitDate = date;
    trade.exitPrice = price;
    trade.pnl = netPnL;  // 使用净盈亏
    trade.pnlPercent = pnlPercent;
    trade.exitReason = reason;

    // 卖出时：收回卖出资金 = 卖出价格 * 数量 - 交易成本
    // 买入时扣除了 entryPrice * quantity + 买入交易成本
    // 卖出时加上 price * quantity - 卖出交易成本
    // 净盈亏 = (price - entryPrice) * quantity - 总交易成本
    const sellAmount = price * trade.quantity - tradingCost;
    onCapitalChange(sellAmount);
    trades.push({ ...trade });
    positions.delete(symbol);
  }

  /**
   * 计算性能指标
   */
  private calculateMetrics(
    trades: BacktestTrade[],
    dailyEquity: Array<{ date: string; equity: number }>,
    initialCapital: number
  ): Omit<BacktestResult, 'strategyId' | 'startDate' | 'endDate'> {
    const totalReturn = ((dailyEquity[dailyEquity.length - 1]?.equity || initialCapital) - initialCapital) / initialCapital * 100;
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.pnl > 0).length;
    const losingTrades = trades.filter(t => t.pnl < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgReturn = totalTrades > 0
      ? trades.reduce((sum, t) => sum + t.pnlPercent, 0) / totalTrades
      : 0;

    // 计算最大回撤
    let maxDrawdown = 0;
    let peak = initialCapital;
    for (const day of dailyEquity) {
      if (day.equity > peak) {
        peak = day.equity;
      }
      const drawdown = ((day.equity - peak) / peak) * 100;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // 计算夏普比率
    const returns = dailyEquity.slice(1).map((day, i) => {
      const prevEquity = dailyEquity[i].equity;
      return prevEquity > 0 ? ((day.equity - prevEquity) / prevEquity) * 100 : 0;
    });
    const avgReturn2 = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const variance = returns.length > 0
      ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn2, 2), 0) / returns.length
      : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn2 / stdDev : 0;

    // 计算平均持仓时间
    const holdingTimes = trades.map(t => {
      if (!t.exitDate) return 0;
      const entry = new Date(t.entryDate);
      const exit = new Date(t.exitDate);
      return (exit.getTime() - entry.getTime()) / (1000 * 60 * 60);
    });
    const avgHoldingTime = holdingTimes.length > 0
      ? holdingTimes.reduce((sum, t) => sum + t, 0) / holdingTimes.length
      : 0;

    // 计算每日收益率
    const dailyReturns = dailyEquity.slice(1).map((day, i) => {
      const prevEquity = dailyEquity[i].equity;
      const returnPercent = prevEquity > 0 ? ((day.equity - prevEquity) / prevEquity) * 100 : 0;
      return {
        date: day.date,
        return: returnPercent,
        equity: day.equity,
      };
    });

    return {
      totalReturn,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      avgReturn,
      maxDrawdown,
      sharpeRatio,
      avgHoldingTime,
      trades,
      dailyReturns,
    };
  }

  /**
   * 创建回测任务（异步）
   */
  async createBacktestTask(
    strategyId: number,
    symbols: string[],
    startDate: Date,
    endDate: Date,
    config?: any
  ): Promise<number> {
    const query = `
      INSERT INTO backtest_results (
        strategy_id, start_date, end_date, config, 
        status, started_at, created_at
      )
      VALUES ($1, $2, $3, $4, 'PENDING', NOW(), NOW())
      RETURNING id
    `;
    
    const values = [
      strategyId,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
      JSON.stringify(config || {}),
    ];

    const res = await pool.query(query, values);
    return res.rows[0].id;
  }

  /**
   * 更新回测状态
   */
  async updateBacktestStatus(
    id: number,
    status: BacktestStatus,
    errorMessage?: string
  ): Promise<void> {
    const query = `
      UPDATE backtest_results
      SET status = $1,
          error_message = $2,
          ${status === 'RUNNING' ? 'started_at = NOW(),' : ''}
          ${status === 'COMPLETED' || status === 'FAILED' ? 'completed_at = NOW(),' : ''}
          updated_at = NOW()
      WHERE id = $3
    `;

    await pool.query(query, [status, errorMessage || null, id]);
  }

  /**
   * 保存回测结果到数据库
   */
  async saveBacktestResult(result: BacktestResult, config?: any): Promise<number> {
    const query = `
      INSERT INTO backtest_results (
        strategy_id, start_date, end_date, config, result, 
        status, completed_at, created_at
      )
      VALUES ($1, $2, $3, $4, $5, 'COMPLETED', NOW(), NOW())
      RETURNING id
    `;
    
    const values = [
      result.strategyId,
      result.startDate,
      result.endDate,
      JSON.stringify(config || {}),
      JSON.stringify(result),
    ];

    const res = await pool.query(query, values);
    return res.rows[0].id;
  }

  /**
   * 更新回测结果（用于异步执行完成后）
   */
  async updateBacktestResult(id: number, result: BacktestResult): Promise<void> {
    const query = `
      UPDATE backtest_results
      SET result = $1,
          status = 'COMPLETED',
          completed_at = NOW()
      WHERE id = $2
    `;

    await pool.query(query, [JSON.stringify(result), id]);
  }

  /**
   * 保存诊断日志
   */
  async saveDiagnosticLog(id: number, diagnosticLog: any): Promise<void> {
    const query = `
      UPDATE backtest_results
      SET diagnostic_log = $1,
          updated_at = NOW()
      WHERE id = $2
    `;

    await pool.query(query, [JSON.stringify(diagnosticLog), id]);
  }

  /**
   * 异步执行回测
   */
  async executeBacktestAsync(
    id: number,
    strategyId: number,
    symbols: string[],
    startDate: Date,
    endDate: Date,
    config?: any
  ): Promise<void> {
    try {
      // 更新状态为运行中
      await this.updateBacktestStatus(id, 'RUNNING');

      // ✅ 执行回测，传递id参数用于保存诊断日志
      const result = await this.runBacktest(strategyId, symbols, startDate, endDate, config, id);

      // 保存结果
      await this.updateBacktestResult(id, {
        ...result,
        id,
        strategyId,
        startDate: result.startDate,
        endDate: result.endDate,
      });

      logger.log(`回测任务 ${id} 完成`);
    } catch (error: any) {
      logger.error(`回测任务 ${id} 失败:`, error);
      await this.updateBacktestStatus(id, 'FAILED', error.message || '回测执行失败');
    }
  }

  /**
   * 获取回测状态
   */
  async getBacktestStatus(id: number): Promise<{
    id: number;
    status: BacktestStatus;
    errorMessage?: string;
    startedAt?: string;
    completedAt?: string;
  } | null> {
    const query = `
      SELECT id, status, error_message, started_at, completed_at
      FROM backtest_results
      WHERE id = $1
    `;

    const res = await pool.query(query, [id]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      id: row.id,
      status: row.status || 'COMPLETED',
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  /**
   * 获取回测结果
   */
  async getBacktestResult(id: number, includeDetails: boolean = true): Promise<BacktestResult | null> {
    const query = `
      SELECT id, strategy_id, start_date, end_date, config, result, status, error_message, started_at, completed_at, created_at, diagnostic_log
      FROM backtest_results
      WHERE id = $1
    `;

    const res = await pool.query(query, [id]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    
    // 如果状态不是 COMPLETED，返回基本信息
    if (row.status !== 'COMPLETED') {
      return {
        id: row.id,
        strategyId: row.strategy_id,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status || 'COMPLETED',
        errorMessage: row.error_message,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      } as BacktestResult;
    }

    // PostgreSQL JSONB 字段可能已经是对象，也可能需要解析
    let resultData: any = {};
    if (row.result) {
      if (typeof row.result === 'string') {
        try {
          resultData = JSON.parse(row.result);
        } catch (e) {
          logger.error('解析回测结果失败:', e);
          // 如果解析失败，返回空对象而不是抛出错误
          resultData = {};
        }
      } else if (typeof row.result === 'object') {
        resultData = row.result;
      }
    }
    // 如果 result 为 null 或 undefined，resultData 保持为空对象

    // 如果不需要详细信息，限制数据量
    if (!includeDetails) {
      if (resultData.trades && Array.isArray(resultData.trades)) {
        resultData.trades = resultData.trades.slice(0, 100); // 只返回前100条交易
      }
      if (resultData.dailyReturns && Array.isArray(resultData.dailyReturns)) {
        // 对于每日收益，可以采样返回
        const dailyReturns = resultData.dailyReturns;
        if (dailyReturns.length > 500) {
          const step = Math.ceil(dailyReturns.length / 500);
          resultData.dailyReturns = dailyReturns.filter((_: any, i: number) => i % step === 0);
        }
      }
    }

    // ✅ 解析诊断日志
    let diagnosticLog: any = null;
    if (row.diagnostic_log) {
      if (typeof row.diagnostic_log === 'string') {
        try {
          diagnosticLog = JSON.parse(row.diagnostic_log);
        } catch (e) {
          logger.error('解析诊断日志失败:', e);
        }
      } else if (typeof row.diagnostic_log === 'object') {
        diagnosticLog = row.diagnostic_log;
      }
    }

    const result: BacktestResult = {
      id: row.id,
      strategyId: row.strategy_id,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status || 'COMPLETED',
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      diagnosticLog, // ✅ 添加诊断日志
      ...resultData,
    };

    return result;
  }

  /**
   * 获取策略的所有回测结果（列表视图，不包含详细交易数据）
   */
  async getBacktestResultsByStrategy(strategyId: number): Promise<BacktestResult[]> {
    const query = `
      SELECT id, strategy_id, start_date, end_date, config, result, status, error_message, started_at, completed_at, created_at
      FROM backtest_results
      WHERE strategy_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const res = await pool.query(query, [strategyId]);
    return res.rows.map((row) => {
      // PostgreSQL JSONB 字段可能已经是对象，也可能需要解析
      let resultData: any = {};
      if (row.result) {
        if (typeof row.result === 'string') {
          try {
            resultData = JSON.parse(row.result);
          } catch (e) {
            logger.error(`解析回测结果失败 (ID: ${row.id}):`, e);
            resultData = {};
          }
        } else if (typeof row.result === 'object') {
          resultData = row.result;
        }
      }
      // 如果 result 为 null 或 undefined，resultData 保持为空对象

      // 列表视图不需要详细的交易数据和每日收益数据
      const summary: BacktestResult = {
        id: row.id,
        strategyId: row.strategy_id,
        startDate: row.start_date,
        endDate: row.end_date,
        totalReturn: resultData.totalReturn || 0,
        totalTrades: resultData.totalTrades || 0,
        winningTrades: resultData.winningTrades || 0,
        losingTrades: resultData.losingTrades || 0,
        winRate: resultData.winRate || 0,
        avgReturn: resultData.avgReturn || 0,
        maxDrawdown: resultData.maxDrawdown || 0,
        sharpeRatio: resultData.sharpeRatio || 0,
        avgHoldingTime: resultData.avgHoldingTime || 0,
        trades: [], // 列表视图不包含交易详情
        dailyReturns: [], // 列表视图不包含每日收益
      };

      return summary;
    });
  }
}

export default new BacktestService();

