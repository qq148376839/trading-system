/**
 * 交易推荐计算服务
 * 根据SPX、USD Index、BTC的市场数据，为目标股票生成交易推荐
 */

import marketDataCacheService from './market-data-cache.service';
import { getQuoteContext } from '../config/longport';
import { isPreMarketHours, isAfterHours } from '../utils/trading-hours';
import intradayDataFilterService from './intraday-data-filter.service';

interface CandlestickData {
  close: number;
  open: number;
  low: number;
  high: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

interface TradingRecommendation {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  entry_price_range: {
    min: number;
    max: number;
  };
  stop_loss: number;
  take_profit: number;
  risk_reward_ratio: number;
  market_environment: '良好' | '较差' | '中性' | '中性利好' | '中性利空';
  comprehensive_market_strength: number;
  trend_consistency: string;
  analysis_summary: string;
  risk_note: string;
  spx_usd_relationship_analysis?: string; // SPX与USD关系的详细分析（可选）
  atr?: number; // ATR（平均真实波幅），用于动态止损止盈
  market_regime?: {
    market_temperature: number;
    vix: number;
    score: number;
    status: string;
    veto_reason?: string;
  };
}

interface MarketAnalysis {
  current_price: number;
  avg_20: number;
  avg_10: number;
  high_50: number;
  low_50: number;
  trend: string;
  short_term_trend: string;
  market_position: string;
  position_percentage: number;
  trend_strength: number;
  deviation_from_20day: number;
}

interface SPXBTCCorrelation {
  correlation: number;
  consistency_rate: number;
  relationship: string;
  is_resonant: boolean;
}

class TradingRecommendationService {
  /**
   * 计算单个股票的交易推荐
   * @param symbol 股票代码
   * @param targetDate 目标日期（可选），如果提供则使用历史数据
   * @param historicalStockCandlesticks 历史股票K线数据（可选），如果提供则使用此数据而不是实时数据
   */
  async calculateRecommendation(
    symbol: string,
    targetDate?: Date,
    historicalStockCandlesticks?: any[],
    preFetchedMarketData?: { spx?: any[]; usdIndex?: any[]; btc?: any[]; vix?: any[]; marketTemperature?: any } // ✅ 新增：预获取的市场数据（用于回测优化）
  ): Promise<TradingRecommendation> {
    try {
      // 1. 获取市场数据
      let marketData: any;
      if (preFetchedMarketData && targetDate) {
        // ✅ 回测优化：使用预获取的市场数据，避免多次调用API
        // 从预获取的数据中过滤出目标日期之前的数据
        const marketDataService = require('./market-data.service').default;
        const spxFiltered = marketDataService.filterDataBeforeDate(preFetchedMarketData.spx || [], targetDate, 100);
        const usdIndexFiltered = marketDataService.filterDataBeforeDate(preFetchedMarketData.usdIndex || [], targetDate, 100);
        const btcFiltered = marketDataService.filterDataBeforeDate(preFetchedMarketData.btc || [], targetDate, 100);
        const vixFiltered = marketDataService.filterDataBeforeDate(preFetchedMarketData.vix || [], targetDate, 100);
        
        marketData = {
          spx: spxFiltered,
          usdIndex: usdIndexFiltered,
          btc: btcFiltered,
          vix: vixFiltered,
          marketTemperature: preFetchedMarketData.marketTemperature,
          timestamp: targetDate.getTime(),
        };
      } else if (targetDate) {
        // 使用历史数据（如果没有预获取的数据）
        marketData = await marketDataCacheService.getHistoricalMarketData(targetDate, 100, true);
      } else {
        // 使用实时数据
        marketData = await marketDataCacheService.getMarketData(100, true);
      }
      
      // ✅ 调试日志：确认使用的是历史数据还是实时数据
      if (targetDate) {
        console.log(`[回测] ${symbol} 使用历史市场数据（目标日期: ${targetDate.toISOString().split('T')[0]}）`);
        console.log(`[回测] SPX: ${marketData.spx?.length || 0}, USD: ${marketData.usdIndex?.length || 0}, BTC: ${marketData.btc?.length || 0}, VIX: ${marketData.vix?.length || 0}`);
      }

      // 2. 获取股票K线数据（如果提供了历史数据则使用，否则获取实时数据）
      let stockCandlesticks: any[];
      if (historicalStockCandlesticks && historicalStockCandlesticks.length > 0) {
        // 使用提供的历史数据
        stockCandlesticks = historicalStockCandlesticks;
      } else {
        // 获取实时数据
        stockCandlesticks = await this.getStockCandlesticks(symbol);
      }

      // 如果股票数据不足，抛出错误（无法计算）
      if (!stockCandlesticks || stockCandlesticks.length < 50) {
        throw new Error(`${symbol} 数据不足，无法计算推荐`);
      }

      // 2.5. 如果在盘前/盘后时间且不是历史数据，获取实时价格并更新最后一条K线
      let currentPrice = stockCandlesticks[stockCandlesticks.length - 1].close;
      let isRealtimePrice = false;
      
      // 只有在非历史数据模式下才获取实时价格
      if (!targetDate && (isPreMarketHours() || isAfterHours())) {
        const realtimePrice = await this.getRealtimePrice(symbol);
        if (realtimePrice && realtimePrice > 0) {
          // 更新最后一条K线的收盘价为实时价格（用于计算）
          stockCandlesticks[stockCandlesticks.length - 1].close = realtimePrice;
          currentPrice = realtimePrice;
          isRealtimePrice = true;
          console.log(`${symbol} 使用实时价格: ${realtimePrice.toFixed(2)} (${isPreMarketHours() ? '盘前' : '盘后'})`);
        }
      }

      // 3. 检查市场数据是否充足（历史数据模式下不重新获取）
      let finalMarketData = marketData;
      if (!targetDate) {
        // 只有在实时数据模式下才检查并重新获取
        if (!marketData.spx || marketData.spx.length < 50 || 
            !marketData.usdIndex || marketData.usdIndex.length < 50 ||
            !marketData.btc || marketData.btc.length < 50) {
          console.warn('市场数据不足，强制刷新缓存并重新获取...');
          // 清除缓存，强制重新获取
          marketDataCacheService.clearCache();
          finalMarketData = await marketDataCacheService.getMarketData(100, true);
          
          // 如果重新获取后仍然不足，抛出错误
          if (!finalMarketData.spx || finalMarketData.spx.length < 50 || 
              !finalMarketData.usdIndex || finalMarketData.usdIndex.length < 50 ||
              !finalMarketData.btc || finalMarketData.btc.length < 50) {
            throw new Error('市场数据获取失败，无法计算推荐。请检查富途API连接。');
          }
        }
      }

      // 3. 计算各市场分析
      const spxAnalysis = this.calculateMarketAnalysis(finalMarketData.spx, 'SPX');
      const usdAnalysis = this.calculateMarketAnalysis(finalMarketData.usdIndex, 'USD Index');
      const btcAnalysis = this.calculateBTCAnalysis(finalMarketData.btc);
      const spxBtcCorrelation = this.calculateSPXBTCCorrelation(
        finalMarketData.spx,
        finalMarketData.btc
      );

      // Extract VIX and Market Temperature
      const vixData = finalMarketData.vix || [];
      const marketTemperature = finalMarketData.marketTemperature;
      
      // 3.5. 提取VIX和市场温度数据
      let currentVix: number | undefined;
      let marketTemp: any;
      
      if (finalMarketData.vix && finalMarketData.vix.length > 0) {
        // 取最近一天的VIX收盘价
        const lastVix = finalMarketData.vix[finalMarketData.vix.length - 1];
        currentVix = typeof lastVix.close === 'number' ? lastVix.close : parseFloat(String(lastVix.close));
      }
      
      marketTemp = finalMarketData.marketTemperature;

      // 3.6. 计算分时数据情绪（如果可用）
      let intradaySentiment = null;
      if (finalMarketData.btcHourly && finalMarketData.btcHourly.length > 0 && 
          finalMarketData.usdIndexHourly && finalMarketData.usdIndexHourly.length > 0) {
        // 过滤分时数据噪音
        const filteredBTCHourly = intradayDataFilterService.filterData(finalMarketData.btcHourly);
        const filteredUSDHourly = intradayDataFilterService.filterData(finalMarketData.usdIndexHourly);
        
        // 计算分时情绪
        intradaySentiment = this.calculateIntradaySentiment(
          finalMarketData.btc,
          filteredBTCHourly,
          finalMarketData.usdIndex,
          filteredUSDHourly
        );
      }

      // 4. 计算股票分析（使用更新后的价格）
      const stockAnalysis = this.calculateMarketAnalysis(stockCandlesticks, symbol);

      // 5. 综合计算交易推荐（集成分时数据、VIX和市场温度）
      const recommendation = this.calculateTradingDecision(
        spxAnalysis,
        usdAnalysis,
        btcAnalysis,
        spxBtcCorrelation,
        stockAnalysis,
        stockCandlesticks,
        intradaySentiment,
        currentVix, // VIX恐慌指数
        marketTemp  // 市场温度
      );

      // 6. 如果使用了实时价格，调整推荐以适应当前价格
      if (isRealtimePrice) {
        const adjustedRecommendation = this.adjustRecommendationForCurrentPrice(
          recommendation,
          currentPrice
        );
        return {
          symbol,
          ...adjustedRecommendation,
        };
      }

      return {
        symbol,
        ...recommendation,
      };
    } catch (error: any) {
      console.error(`计算 ${symbol} 交易推荐失败:`, error.message);
      throw error;
    }
  }

  /**
   * 批量计算多个股票的交易推荐
   */
  async calculateBatchRecommendations(
    symbols: string[]
  ): Promise<Map<string, TradingRecommendation>> {
    const recommendations = new Map<string, TradingRecommendation>();

    // 并行计算所有股票的推荐
    const promises = symbols.map(async (symbol) => {
      try {
        const recommendation = await this.calculateRecommendation(symbol);
        recommendations.set(symbol, recommendation);
      } catch (error: any) {
        console.error(`计算 ${symbol} 推荐失败:`, error.message);
      }
    });

    await Promise.all(promises);

    return recommendations;
  }

  /**
   * 获取市场状态矩阵（全局市场环境指标）
   * 不依赖具体股票，返回当前市场的整体状态
   * 如果VIX或市场温度获取失败，抛出错误（不使用默认值）
   */
  async getMarketRegime(): Promise<{
    market_temperature: number;
    vix: number;
    score: number;
    status: string;
    veto_reason?: string;
  }> {
    try {
      // 获取市场数据（不计算具体股票推荐）
      const marketData = await marketDataCacheService.getMarketData(100, false);

      // 提取VIX（必须成功，否则抛出错误）
      if (!marketData.vix || marketData.vix.length === 0) {
        throw new Error('VIX数据获取失败，无法计算市场状态矩阵');
      }
      const lastVix = marketData.vix[marketData.vix.length - 1];
      const currentVix = typeof lastVix.close === 'number' ? lastVix.close : parseFloat(String(lastVix.close));
      if (isNaN(currentVix) || currentVix <= 0) {
        throw new Error(`VIX数据无效: ${currentVix}`);
      }

      // 提取市场温度（必须成功，否则抛出错误）
      if (!marketData.marketTemperature) {
        throw new Error('市场温度数据获取失败，无法计算市场状态矩阵');
      }
      let currentTemp: number;
      if (typeof marketData.marketTemperature === 'number') {
        currentTemp = marketData.marketTemperature;
      } else if (marketData.marketTemperature && typeof marketData.marketTemperature === 'object') {
        if ('value' in marketData.marketTemperature && typeof (marketData.marketTemperature as any).value === 'number') {
          currentTemp = (marketData.marketTemperature as any).value;
        } else if ('temperature' in marketData.marketTemperature && typeof (marketData.marketTemperature as any).temperature === 'number') {
          currentTemp = (marketData.marketTemperature as any).temperature;
        } else {
          throw new Error(`市场温度数据结构未知: ${JSON.stringify(marketData.marketTemperature)}`);
        }
      } else {
        throw new Error(`市场温度数据类型错误: ${typeof marketData.marketTemperature}`);
      }
      
      if (isNaN(currentTemp) || currentTemp < 0 || currentTemp > 100) {
        throw new Error(`市场温度数据无效: ${currentTemp}`);
      }

      // 计算市场分析（用于计算基础强度）
      const spxAnalysis = this.calculateMarketAnalysis(marketData.spx, 'SPX');
      const usdAnalysis = this.calculateMarketAnalysis(marketData.usdIndex, 'USD Index');
      const btcAnalysis = this.calculateBTCAnalysis(marketData.btc);
      const spxBtcCorrelation = this.calculateSPXBTCCorrelation(marketData.spx, marketData.btc);

      // 计算基础市场强度
      const usd_impact_strength = -usdAnalysis.trend_strength * 0.3;
      let btc_support = 0;
      if (spxBtcCorrelation.is_resonant) {
        if (btcAnalysis.is_stable || btcAnalysis.trend === '上升趋势') {
          btc_support = btcAnalysis.spx_impact_strength;
        }
      }
      const basic_market_strength = spxAnalysis.trend_strength + usd_impact_strength + btc_support;

      // 数据归一化
      const market_temp_normalized = (currentTemp - 50) * 2;
      let vix_score = 0;
      if (currentVix > 15) {
        vix_score = (15 - currentVix) * 5;
      } else {
        vix_score = (15 - currentVix) * 2;
      }
      const vix_normalized = Math.max(-100, Math.min(50, vix_score));

      // 环境分计算
      const env_score = basic_market_strength * 0.4 + market_temp_normalized * 0.4 + vix_normalized * 0.2;

      // 市场状态矩阵判定
      let market_regime_status = 'Neutral';
      let veto_reason: string | undefined;

      if (currentTemp > 50) {
        if (currentVix < 20) {
          market_regime_status = 'Goldilocks (黄金做多)';
        } else {
          market_regime_status = 'Volatile Bull (疯狂博弈)';
        }
      } else {
        if (currentVix > 20) {
          market_regime_status = 'Fear (恐慌下跌)';
        } else {
          market_regime_status = 'Stagnant (阴跌/盘整)';
        }
      }

      // 一票否决权
      if (currentVix > 35) {
        veto_reason = `VIX恐慌指数过高(${currentVix.toFixed(2)})，强制风控`;
      } else if (currentTemp < 10) {
        veto_reason = `市场温度冰点(${currentTemp.toFixed(1)})，缺乏广度支持`;
      }

      return {
        market_temperature: parseFloat(currentTemp.toFixed(2)),
        vix: parseFloat(currentVix.toFixed(2)),
        score: parseFloat(env_score.toFixed(2)),
        status: market_regime_status,
        veto_reason,
      };
    } catch (error: any) {
      console.error('获取市场状态矩阵失败:', error.message);
      // 不返回默认值，直接抛出错误
      throw new Error(`市场状态矩阵计算失败: ${error.message}`);
    }
  }

  /**
   * 获取股票实时价格（用于盘前/盘后时间）
   */
  private async getRealtimePrice(symbol: string): Promise<number | null> {
    try {
      const quoteCtx = await getQuoteContext();
      // quote() 方法需要传递数组，即使只有一个标的
      const quotes = await quoteCtx.quote([symbol]);
      
      if (!quotes || quotes.length === 0) {
        return null;
      }
      
      const quote = quotes[0];
      if (quote && quote.last_done) {
        const price = typeof quote.last_done === 'number' 
          ? quote.last_done 
          : parseFloat(String(quote.last_done || 0));
        
        if (price > 0) {
          return price;
        }
      }
      
      // 尝试从盘前/盘后价格获取
      if (quote?.pre_market_quote?.last_done) {
        const price = typeof quote.pre_market_quote.last_done === 'number'
          ? quote.pre_market_quote.last_done
          : parseFloat(String(quote.pre_market_quote.last_done || 0));
        if (price > 0) return price;
      }
      
      if (quote?.post_market_quote?.last_done) {
        const price = typeof quote.post_market_quote.last_done === 'number'
          ? quote.post_market_quote.last_done
          : parseFloat(String(quote.post_market_quote.last_done || 0));
        if (price > 0) return price;
      }
      
      return null;
    } catch (error: any) {
      console.warn(`获取${symbol}实时价格失败:`, error.message);
      return null;
    }
  }

  /**
   * 获取股票K线数据
   */
  private async getStockCandlesticks(
    symbol: string
  ): Promise<CandlestickData[]> {
    const quoteCtx = await getQuoteContext();
    const longport = require('longport');
    const { Period, AdjustType, TradeSessions } = longport;
    const { formatLongbridgeCandlestick } = require('../utils/candlestick-formatter');

    // SDK 3.0.18需要TradeSessions参数
    const candlesticks = await quoteCtx.candlesticks(
      symbol,
      Period.Day,
      100, // 获取最近100天
      AdjustType.NoAdjust,
      TradeSessions?.All || 100 // 使用All获取所有交易时段的数据
    );

    // ✅ 使用统一的数据转换工具函数，修复timestamp转换错误
    return candlesticks.map((c: any) => formatLongbridgeCandlestick(c));
  }

  /**
   * 计算市场分析（通用）
   * 注意：此方法假设数据已经充足，如果数据不足应该在调用前检查
   */
  private calculateMarketAnalysis(
    data: CandlestickData[],
    name: string
  ): MarketAnalysis {
    if (!data || data.length < 50) {
      // 数据不足时抛出错误，而不是返回默认值
      const dataLength = data?.length || 0;
      throw new Error(`${name} 数据不足（${dataLength} < 50），无法计算分析`);
    }

    // 确保所有价格都是数字类型
    const current_price = typeof data[data.length - 1].close === 'number' 
      ? data[data.length - 1].close 
      : parseFloat(String(data[data.length - 1].close || 0));
    const prices_20 = data.slice(-20).map(d => typeof d.close === 'number' ? d.close : parseFloat(String(d.close || 0)));
    const highs_50 = data.slice(-50).map(d => typeof d.high === 'number' ? d.high : parseFloat(String(d.high || 0)));
    const lows_50 = data.slice(-50).map(d => typeof d.low === 'number' ? d.low : parseFloat(String(d.low || 0)));

    const avg_20 = this.calculateAverage(prices_20);
    const avg_10 = this.calculateAverage(prices_20.slice(-10));
    const high_50 = Math.max(...highs_50);
    const low_50 = Math.min(...lows_50);

    const trend = this.judgeTrend(current_price, avg_20);
    const short_term_trend = this.judgeTrend(current_price, avg_10, 0.005);

    const position_percentage = ((current_price - low_50) / (high_50 - low_50)) * 100;
    const market_position = this.judgePosition(position_percentage);

    let trend_strength = ((current_price - avg_20) / avg_20) * 100;
    if (trend === '上升趋势' && current_price > high_50 * 0.95) {
      trend_strength += 20;
    } else if (trend === '下降趋势' && current_price < low_50 * 1.05) {
      trend_strength -= 20;
    }

    const deviation_from_20day = ((current_price - avg_20) / avg_20) * 100;

    return {
      current_price,
      avg_20,
      avg_10,
      high_50,
      low_50,
      trend,
      short_term_trend,
      market_position,
      position_percentage,
      trend_strength,
      deviation_from_20day,
    };
  }

  /**
   * 计算BTC分析（包含对SPX的影响）
   */
  private calculateBTCAnalysis(data: CandlestickData[]): MarketAnalysis & { spx_impact_strength: number; is_stable: boolean } {
    const analysis = this.calculateMarketAnalysis(data, 'BTC');

    // BTC对SPX的影响强度
    let spx_impact_strength = 0;
    const is_stable = analysis.trend === '盘整' &&
                      analysis.position_percentage > 30 &&
                      analysis.position_percentage < 70;

    if (is_stable) {
      spx_impact_strength = Math.abs(analysis.trend_strength) * 0.5;
    } else if (analysis.trend === '上升趋势') {
      spx_impact_strength = Math.abs(analysis.trend_strength) * 0.5;
    } else if (analysis.trend === '下降趋势' && analysis.position_percentage < 30) {
      spx_impact_strength = -Math.abs(analysis.trend_strength) * 0.3;
    }

    return {
      ...analysis,
      spx_impact_strength,
      is_stable,
    };
  }

  /**
   * 计算SPX与BTC的关联关系
   */
  private calculateSPXBTCCorrelation(
    spxData: CandlestickData[],
    btcData: CandlestickData[]
  ): SPXBTCCorrelation {
    // 如果任一数据为空，返回默认值
    if (!spxData || !btcData || spxData.length < 2 || btcData.length < 2) {
      return {
        correlation: 0,
        consistency_rate: 0.5,
        relationship: '弱相关',
        is_resonant: false,
      };
    }

    const minLen = Math.min(spxData.length, btcData.length, 50);
    const spxPrices = spxData.slice(-minLen).map(d => d.close);
    const btcPrices = btcData.slice(-minLen).map(d => d.close);

    // 计算价格变化率
    const spxChanges = [];
    const btcChanges = [];
    for (let i = 1; i < spxPrices.length; i++) {
      spxChanges.push((spxPrices[i] - spxPrices[i - 1]) / spxPrices[i - 1] * 100);
      btcChanges.push((btcPrices[i] - btcPrices[i - 1]) / btcPrices[i - 1] * 100);
    }

    // 计算Pearson相关系数
    const correlation = this.calculatePearsonCorrelation(spxChanges, btcChanges);

    // 计算趋势一致性
    let sameDirection = 0;
    for (let i = 0; i < spxChanges.length; i++) {
      if ((spxChanges[i] > 0) === (btcChanges[i] > 0)) {
        sameDirection++;
      }
    }
    const consistency_rate = sameDirection / spxChanges.length;

    let relationship = '弱相关';
    if (correlation > 0.7) {
      relationship = '强正相关';
    } else if (correlation > 0.3) {
      relationship = '中等正相关';
    } else if (correlation < -0.3) {
      relationship = '负相关';
    }

    const is_resonant = correlation > 0.5;

    return {
      correlation,
      consistency_rate,
      relationship,
      is_resonant,
    };
  }

  /**
   * 计算分时数据情绪指标
   */
  private calculateIntradaySentiment(
    btcDaily: CandlestickData[],
    btcHourly: CandlestickData[],
    usdDaily: CandlestickData[],
    usdHourly: CandlestickData[]
  ): {
    short_term_momentum: number;      // 短期动量（基于小时K）
    volatility_adjustment: number;     // 波动性调整系数
    trend_confirmation: boolean;      // 趋势确认（日K和小时K是否一致）
    btc_hourly_strength: number;      // BTC小时K强度
    usd_hourly_strength: number;      // USD小时K强度
  } | null {
    if (!btcHourly || btcHourly.length < 10 || !usdHourly || usdHourly.length < 10) {
      return null;
    }

    // 计算BTC小时K分析
    const btcHourlyAnalysis = this.calculateMarketAnalysis(btcHourly, 'BTC Hourly');
    const btcDailyAnalysis = this.calculateMarketAnalysis(btcDaily, 'BTC Daily');
    
    // 计算USD小时K分析
    const usdHourlyAnalysis = this.calculateMarketAnalysis(usdHourly, 'USD Hourly');
    const usdDailyAnalysis = this.calculateMarketAnalysis(usdDaily, 'USD Daily');

    // 短期动量：基于小时K的趋势强度
    const btcHourlyStrength = btcHourlyAnalysis.trend_strength;
    const usdHourlyStrength = -usdHourlyAnalysis.trend_strength * 0.3; // USD上升对股市是负面
    const short_term_momentum = btcHourlyStrength + usdHourlyStrength;

    // 趋势确认：日K和小时K趋势是否一致
    const btcTrendMatch = btcDailyAnalysis.trend === btcHourlyAnalysis.trend;
    const usdTrendMatch = usdDailyAnalysis.trend === usdHourlyAnalysis.trend;
    const trend_confirmation = btcTrendMatch && usdTrendMatch;

    // 波动性调整：基于小时K的波动性
    // 计算最近24小时的价格变化率标准差
    const btcRecentPrices = btcHourly.slice(-24).map(d => d.close);
    const usdRecentPrices = usdHourly.slice(-24).map(d => d.close);
    
    const btcVolatility = this.calculateVolatility(btcRecentPrices);
    const usdVolatility = this.calculateVolatility(usdRecentPrices);
    
    // 波动性调整系数：波动性越高，调整系数越大（但不超过1.5）
    const avgVolatility = (btcVolatility + usdVolatility) / 2;
    const volatility_adjustment = Math.min(1.0 + avgVolatility * 2, 1.5);

    return {
      short_term_momentum,
      volatility_adjustment,
      trend_confirmation,
      btc_hourly_strength: btcHourlyStrength,
      usd_hourly_strength: usdHourlyStrength,
    };
  }

  /**
   * 计算价格序列的波动性（标准差）
   */
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    // 计算价格变化率
    const changes: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) {
        changes.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
    }

    if (changes.length === 0) return 0;

    // 计算标准差
    const mean = changes.reduce((sum, c) => sum + c, 0) / changes.length;
    const variance = changes.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / changes.length;
    return Math.sqrt(variance);
  }

  /**
   * 计算交易决策
   */
  private calculateTradingDecision(
    spxAnalysis: MarketAnalysis,
    usdAnalysis: MarketAnalysis,
    btcAnalysis: MarketAnalysis & { spx_impact_strength: number; is_stable: boolean },
    spxBtcCorrelation: SPXBTCCorrelation,
    stockAnalysis: MarketAnalysis,
    stockCandlesticks: CandlestickData[],
    intradaySentiment?: {
      short_term_momentum: number;
      volatility_adjustment: number;
      trend_confirmation: boolean;
      btc_hourly_strength: number;
      usd_hourly_strength: number;
    } | null,
    vix?: number,
    marketTemperature?: any
  ): Omit<TradingRecommendation, 'symbol'> {
    // 计算USD Index对股票市场的影响（USD上升利空股市）
    const usd_impact_strength = -usdAnalysis.trend_strength * 0.3;

    // BTC企稳且与SPX共振时的影响
    let btc_support = 0;
    if (spxBtcCorrelation.is_resonant) {
      if (btcAnalysis.is_stable || btcAnalysis.trend === '上升趋势') {
        btc_support = btcAnalysis.spx_impact_strength;
      }
    }

    // 分时数据影响（如果可用）
    let intraday_adjustment = 0;
    if (intradaySentiment) {
      // 短期动量影响（权重30%）
      intraday_adjustment = intradaySentiment.short_term_momentum * 0.3;
      
      // 如果趋势不一致，降低市场强度（权重-10%）
      if (!intradaySentiment.trend_confirmation) {
        intraday_adjustment -= Math.abs(intradaySentiment.short_term_momentum) * 0.1;
      }
    }

    // 基础综合市场强度（Basic Comprehensive Market Strength）
    const basic_market_strength =
      spxAnalysis.trend_strength +
      usd_impact_strength +
      btc_support +
      intraday_adjustment;

    // ===== 新增：市场温度与恐慌指数分析 =====
    
    // 1. 验证数据有效性（如果数据缺失，跳过这些指标的计算）
    let useMarketRegime = false;
    let market_temp_normalized = 0;
    let vix_normalized = 0;
    let currentVixValue: number | null = null;
    let currentTempValue: number | null = null;
    
    // 验证VIX数据
    if (vix !== undefined && vix !== null && !isNaN(vix) && vix > 0) {
      currentVixValue = vix;
      
      // 验证市场温度数据
      if (marketTemperature !== undefined && marketTemperature !== null) {
        // 解析市场温度
        if (typeof marketTemperature === 'number') {
          currentTempValue = marketTemperature;
        } else if (marketTemperature && typeof marketTemperature === 'object') {
          if ('value' in marketTemperature && typeof (marketTemperature as any).value === 'number') {
            currentTempValue = (marketTemperature as any).value;
          } else if ('temperature' in marketTemperature && typeof (marketTemperature as any).temperature === 'number') {
            currentTempValue = (marketTemperature as any).temperature;
          }
        }
        
        // 验证温度值有效性
        if (currentTempValue !== null && !isNaN(currentTempValue) && currentTempValue >= 0 && currentTempValue <= 100) {
          // 数据有效，可以使用市场状态矩阵
          useMarketRegime = true;
          
          // 数据归一化
          market_temp_normalized = (currentTempValue - 50) * 2;
          
          // VIX反向归一化
          let vix_score = 0;
          if (currentVixValue > 15) {
            vix_score = (15 - currentVixValue) * 5;
          } else {
            vix_score = (15 - currentVixValue) * 2;
          }
          vix_normalized = Math.max(-100, Math.min(50, vix_score));
        } else {
          console.warn('市场温度数据无效，跳过市场状态矩阵计算');
        }
      } else {
        console.warn('市场温度数据缺失，跳过市场状态矩阵计算');
      }
    } else {
      console.warn('VIX数据缺失或无效，跳过市场状态矩阵计算');
    }

    // 2. 环境分计算 (Environment Score)
    // 如果市场状态矩阵数据有效，使用完整公式；否则只使用基础强度
    let env_score: number;
    if (useMarketRegime) {
      // 权重：基础强度 40%, 市场温度 40%, VIX 20%
      env_score = basic_market_strength * 0.4 + market_temp_normalized * 0.4 + vix_normalized * 0.2;
    } else {
      // 数据缺失时，只使用基础强度（不包含温度和VIX）
      env_score = basic_market_strength;
      console.warn('市场状态矩阵数据缺失，环境分仅基于基础市场强度计算');
    }

    // 3. 市场环境评估 (升级版)
    let market_environment: '良好' | '较差' | '中性' | '中性利好' | '中性利空' = '中性';
    
    if (env_score > 50) {
      market_environment = '良好';
    } else if (env_score > 20) {
      market_environment = '中性利好';
    } else if (env_score < -50) {
      market_environment = '较差';
    } else if (env_score < -20) {
      market_environment = '中性利空';
    } else {
      market_environment = '中性';
    }

    // 4. 一票否决权 (Veto Power) - 仅在数据有效时应用
    let veto_reason = '';
    
    if (useMarketRegime) {
      // 解析当前VIX和温度值（用于一票否决判断）
      let currentVixValue: number | null = null;
      let currentTempValue: number | null = null;
      
      if (vix !== undefined && vix !== null && !isNaN(vix) && vix > 0) {
        currentVixValue = vix;
      }
      
      if (marketTemperature !== undefined && marketTemperature !== null) {
        if (typeof marketTemperature === 'number') {
          currentTempValue = marketTemperature;
        } else if (marketTemperature && typeof marketTemperature === 'object') {
          if ('value' in marketTemperature && typeof (marketTemperature as any).value === 'number') {
            currentTempValue = (marketTemperature as any).value;
          } else if ('temperature' in marketTemperature && typeof (marketTemperature as any).temperature === 'number') {
            currentTempValue = (marketTemperature as any).temperature;
          }
        }
      }
      
      // 极度恐慌，强制不做多
      if (currentVixValue !== null && currentVixValue > 35) {
        market_environment = '较差';
        veto_reason = `VIX恐慌指数过高(${currentVixValue.toFixed(2)})，强制风控`;
      }
      // 冰点时刻，虽有反弹但不可持续，强制观望
      else if (currentTempValue !== null && currentTempValue < 10) {
        if (market_environment !== '较差') {
          market_environment = '中性';
          veto_reason = `市场温度冰点(${currentTempValue.toFixed(1)})，缺乏广度支持`;
        }
      }
    }

    // 趋势一致性分析 (保留用于显示)
    let trend_consistency: '一致利好' | '一致利空' | '趋势冲突';
    if (spxAnalysis.trend === '上升趋势' && usdAnalysis.trend === '下降趋势') {
      trend_consistency = '一致利好';
    } else if (spxAnalysis.trend === '下降趋势' && usdAnalysis.trend === '上升趋势') {
      trend_consistency = '一致利空';
    } else {
      trend_consistency = '趋势冲突';
    }
    
    // 5. 市场状态矩阵判定 (用于 Regim Status) - 仅在数据有效时计算
    let market_regime_status = 'Neutral';
    if (useMarketRegime && currentTempValue !== null && currentVixValue !== null) {
      if (currentTempValue > 50) {
        if (currentVixValue < 20) market_regime_status = 'Goldilocks (黄金做多)';
        else market_regime_status = 'Volatile Bull (疯狂博弈)';
      } else {
        if (currentVixValue > 20) market_regime_status = 'Fear (恐慌下跌)';
        else market_regime_status = 'Stagnant (阴跌/盘整)';
      }
    } else {
      market_regime_status = 'Data Unavailable (数据缺失)';
    }

    // 计算ATR（平均真实波幅）用于动态止损止盈
    const atr = this.calculateATR(stockCandlesticks, 14);
    const atrMultiplier = atr > 0 ? atr / stockAnalysis.current_price : 0.02; // ATR百分比，默认2%
    
    // 根据波动性调整倍数
    let stopLossMultiplier = 2.0;
    let takeProfitMultiplier = 3.0;
    if (atrMultiplier < 0.015) {
      stopLossMultiplier = 1.5;
      takeProfitMultiplier = 2.5;
    } else if (atrMultiplier > 0.03) {
      stopLossMultiplier = 2.5;
      takeProfitMultiplier = 3.5;
    }
    
    // VIX 调整：如果 VIX 较高，进一步放宽止损以避免被洗盘，或者收紧止损以防崩盘？
    // 策略：VIX高意味着波动率大，ATR已经反映了波动率。
    // 这里我们额外根据 VIX 调整倍数。
    // 如果 VIX > 25 (恐慌)，稍微收紧止盈，放宽止损(给波动空间)或者收紧止损(防崩盘)？
    // PRD建议：疯狂博弈期(VIX高)需收紧止损。
    if (useMarketRegime && currentVixValue !== null && currentVixValue > 25) {
      stopLossMultiplier *= 0.8; // 收紧止损
      takeProfitMultiplier *= 0.8; // 快速止盈
    }

    // 决定操作建议
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let entry_min = stockAnalysis.current_price;
    let entry_max = stockAnalysis.current_price;
    let stop_loss = stockAnalysis.current_price * 0.95;
    let take_profit = stockAnalysis.current_price * 1.05;

    if ((market_environment === '良好' || market_environment === '中性利好') && (stockAnalysis.trend === '上升趋势' || stockAnalysis.trend === '盘整')) {
      action = 'BUY';
      // 买入逻辑
      const entryRange = Math.max(atr * 0.5, stockAnalysis.current_price * 0.01); 
      entry_min = Math.min(
        stockAnalysis.current_price - entryRange * 0.5,
        Math.max(stockAnalysis.current_price * 0.98, stockAnalysis.low_50 * 1.01)
      );
      entry_max = Math.max(
        stockAnalysis.current_price + entryRange * 0.5,
        Math.min(stockAnalysis.current_price * 1.02, stockAnalysis.high_50 * 0.99)
      );
      if (entry_min >= entry_max) {
        entry_min = stockAnalysis.current_price * 0.99;
        entry_max = stockAnalysis.current_price * 1.01;
      }
      
      const avgEntry = (entry_min + entry_max) / 2;
      stop_loss = Math.max(
        avgEntry - atr * stopLossMultiplier,
        Math.min(entry_min * 0.95, stockAnalysis.low_50 * 1.02)
      );

      const estimatedQuantity = this.estimateTradeQuantity(avgEntry);
      const buyFees = this.calculateTradingFees(avgEntry, estimatedQuantity, false);
      const sellFees = this.calculateTradingFees(avgEntry, estimatedQuantity, true);
      const totalFees = buyFees + sellFees;
      const feesPerShare = totalFees / estimatedQuantity;

      const potential_loss = avgEntry - stop_loss;
      const min_profit = potential_loss * 1.5;
      const minTakeProfit = avgEntry + min_profit + feesPerShare * 2;
      
      const maxTakeProfit = Math.max(
        entry_max * 1.08,
        stockAnalysis.high_50 * 0.98,
        avgEntry * 1.05
      );
      
      take_profit = Math.max(
        avgEntry + atr * takeProfitMultiplier + feesPerShare,
        minTakeProfit,
        entry_max * 1.02
      );
      
      take_profit = Math.min(take_profit, maxTakeProfit);
      
      if (take_profit <= entry_max) {
        take_profit = entry_max * 1.02 + feesPerShare;
      }
      
      const netProfit = take_profit - avgEntry - feesPerShare;
      if (netProfit <= 0) {
        take_profit = avgEntry + feesPerShare * 2 + atr * 1.0;
        if (take_profit <= entry_max) {
          take_profit = entry_max * 1.02 + feesPerShare * 2;
        }
      }
      
      if (take_profit <= entry_min) {
        console.warn(`止盈价调整警告（BUY）：止盈(${take_profit.toFixed(2)}) <= 入场下限(${entry_min.toFixed(2)})，强制调整`);
        take_profit = entry_min * 1.03 + feesPerShare;
      }
    } else if (market_environment === '较差' || market_environment === '中性利空' || (stockAnalysis.trend === '下降趋势' && market_environment !== '良好' && market_environment !== '中性利好')) {
      action = 'SELL';
      // 做空逻辑
      const entryRange = Math.max(atr * 0.5, stockAnalysis.current_price * 0.01);
      entry_max = Math.max(
        stockAnalysis.current_price + entryRange * 0.5,
        Math.min(stockAnalysis.current_price * 1.02, stockAnalysis.high_50 * 0.99)
      );
      entry_min = Math.min(
        stockAnalysis.current_price - entryRange * 0.5,
        Math.max(stockAnalysis.current_price * 0.98, stockAnalysis.low_50 * 1.01)
      );
      if (entry_min >= entry_max) {
        entry_min = stockAnalysis.current_price * 0.99;
        entry_max = stockAnalysis.current_price * 1.01;
      }
      
      const avgEntry = (entry_min + entry_max) / 2;
      stop_loss = Math.min(
        avgEntry + atr * stopLossMultiplier,
        Math.max(entry_max * 1.05, stockAnalysis.high_50 * 0.98)
      );

      const estimatedQuantity = this.estimateTradeQuantity(avgEntry);
      const sellFees = this.calculateTradingFees(avgEntry, estimatedQuantity, true);
      const buyBackFees = this.calculateTradingFees(avgEntry, estimatedQuantity, false);
      const totalFees = sellFees + buyBackFees;
      const feesPerShare = totalFees / estimatedQuantity;

      const potential_loss = stop_loss - avgEntry;
      const min_profit = potential_loss * 1.5;
      
      const minTakeProfit = avgEntry - min_profit - feesPerShare * 2;
      take_profit = Math.min(
        avgEntry - atr * takeProfitMultiplier - feesPerShare,
        minTakeProfit,
        Math.max(entry_min * 0.92, stockAnalysis.low_50 * 1.02)
      );
      
      if (take_profit >= entry_min) {
        take_profit = entry_min - atr * 1.5 - feesPerShare;
      }
      
      const netProfit = avgEntry - take_profit - feesPerShare;
      if (netProfit <= 0) {
        take_profit = avgEntry - feesPerShare * 2 - atr * 1.0;
      }
    } else {
      // HOLD逻辑
      const entryRange = Math.max(atr * 0.3, stockAnalysis.current_price * 0.005);
      entry_min = Math.max(
        stockAnalysis.current_price - entryRange,
        stockAnalysis.current_price * 0.995
      );
      entry_max = Math.min(
        stockAnalysis.current_price + entryRange,
        stockAnalysis.current_price * 1.005
      );
      if (entry_min >= entry_max) {
        entry_min = stockAnalysis.current_price * 0.998;
        entry_max = stockAnalysis.current_price * 1.002;
      }
      
      const avgEntry = (entry_min + entry_max) / 2;
      stop_loss = Math.max(
        avgEntry - atr * stopLossMultiplier * 0.8,
        stockAnalysis.low_50 * 1.01
      );
      
      const minTakeProfit = entry_max * 1.01;
      const atrTakeProfit = avgEntry + atr * takeProfitMultiplier * 0.8;
      const maxTakeProfit = Math.max(
        stockAnalysis.high_50 * 0.99,
        entry_max * 1.05
      );
      
      take_profit = Math.max(
        atrTakeProfit,
        minTakeProfit
      );
      
      take_profit = Math.min(take_profit, maxTakeProfit);
      
      if (take_profit <= entry_max) {
        console.warn(`HOLD止盈价调整：止盈(${take_profit.toFixed(2)}) <= 入场上限(${entry_max.toFixed(2)})，强制调整`);
        take_profit = entry_max * 1.02;
      }
      
      if (stop_loss >= entry_min) {
        console.warn(`HOLD止损价调整：止损(${stop_loss.toFixed(2)}) >= 入场下限(${entry_min.toFixed(2)})，强制调整`);
        stop_loss = entry_min * 0.98;
      }
    }

    // 计算风险收益比
    const risk_reward_ratio = this.calculateRiskRewardRatio(
      action,
      entry_min,
      entry_max,
      stop_loss,
      take_profit
    );

    // 生成SPX与USD关系的详细分析
    const spx_usd_relationship_analysis = this.generateSPXUSDRelationshipAnalysis(
      spxAnalysis,
      usdAnalysis,
      trend_consistency,
      basic_market_strength
    );
    
    // 生成分析摘要
    const analysis_summary = this.generateAnalysisSummary(
      spxAnalysis,
      usdAnalysis,
      btcAnalysis,
      stockAnalysis,
      market_environment,
      env_score, // 使用新的环境分
      trend_consistency
    );

    // 生成风险提示
    const risk_note = this.generateRiskNote(
      market_environment,
      risk_reward_ratio,
      stockAnalysis
    );
    
    // 添加 VIX 和 温度 风险提示（仅在数据有效时）
    let final_risk_note = risk_note;
    if (veto_reason) {
      final_risk_note = `${veto_reason}；${final_risk_note}`;
    }
    
    // 解析当前VIX和温度值（用于风险提示）
    if (useMarketRegime && vix !== undefined && vix !== null && !isNaN(vix) && vix > 0) {
      if (vix > 25) {
        final_risk_note = `恐慌指数偏高(${vix.toFixed(2)})，波动加剧；${final_risk_note}`;
      }
    }
    
    if (useMarketRegime && marketTemperature !== undefined && marketTemperature !== null) {
      let currentTempValue: number | null = null;
      if (typeof marketTemperature === 'number') {
        currentTempValue = marketTemperature;
      } else if (marketTemperature && typeof marketTemperature === 'object') {
        if ('value' in marketTemperature && typeof (marketTemperature as any).value === 'number') {
          currentTempValue = (marketTemperature as any).value;
        } else if ('temperature' in marketTemperature && typeof (marketTemperature as any).temperature === 'number') {
          currentTempValue = (marketTemperature as any).temperature;
        }
      }
      
      if (currentTempValue !== null && currentTempValue < 20) {
        final_risk_note = `市场温度低(${currentTempValue.toFixed(1)})，广度不足；${final_risk_note}`;
      }
    }

    return {
      action,
      entry_price_range: {
        min: parseFloat(entry_min.toFixed(2)),
        max: parseFloat(entry_max.toFixed(2)),
      },
      stop_loss: parseFloat(stop_loss.toFixed(2)),
      take_profit: parseFloat(take_profit.toFixed(2)),
      risk_reward_ratio: parseFloat(risk_reward_ratio.toFixed(2)),
      market_environment,
      comprehensive_market_strength: parseFloat(env_score.toFixed(2)), // 返回环境分
      trend_consistency,
      analysis_summary,
      risk_note: final_risk_note,
      spx_usd_relationship_analysis: spx_usd_relationship_analysis,
      atr: parseFloat(atr.toFixed(4)),
      // 返回市场状态矩阵信息（仅在数据有效时）
      market_regime: useMarketRegime && currentTempValue !== null && currentVixValue !== null ? {
        market_temperature: parseFloat(currentTempValue.toFixed(2)),
        vix: parseFloat(currentVixValue.toFixed(2)),
        score: parseFloat(env_score.toFixed(2)),
        status: market_regime_status,
        veto_reason: veto_reason || undefined
      } : undefined
    };
  }

  // ===== 辅助方法 =====

  private calculateAverage(numbers: number[]): number {
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  /**
   * 计算长桥证券美国市场交易费用
   * 参考：https://longbridge.com/hk/zh-CN/rate?channel=WHAB0001
   * 
   * @param price 交易价格（USD）
   * @param quantity 交易股数
   * @param isSell 是否为卖出（卖出有额外的交易活动费）
   * @param monthlyVolume 本月累计交易股数（用于计算阶梯平台费）
   * @returns 总交易费用（USD）
   */
  private calculateTradingFees(
    price: number,
    quantity: number,
    isSell: boolean = false,
    monthlyVolume: number = 0
  ): number {
    if (quantity <= 0 || price <= 0) return 0;

    const tradeAmount = price * quantity; // 交易金额
    let totalFees = 0;

    // 1. 佣金（Commission）
    // 0 USD* 或 0.0049 USD / 股，最低 0.99 USD / 订单
    const commissionPerShare = 0.0049;
    const commission = Math.max(commissionPerShare * quantity, 0.99);
    totalFees += commission;

    // 2. 平台费（Platform Fee）
    // 阶梯平台费（根据每月交易股数）
    let platformFeePerShare = 0.0070; // 默认最高费率
    if (monthlyVolume + quantity <= 5000) {
      platformFeePerShare = 0.0070;
    } else if (monthlyVolume + quantity <= 10000) {
      platformFeePerShare = 0.0060;
    } else if (monthlyVolume + quantity <= 100000) {
      platformFeePerShare = 0.0050;
    } else if (monthlyVolume + quantity <= 1000000) {
      platformFeePerShare = 0.0040;
    } else {
      platformFeePerShare = 0.0030;
    }
    // 固定平台费：0.0050 USD / 股，最低 1 USD / 订单
    // 使用阶梯平台费（通常更优惠）
    const platformFee = Math.max(platformFeePerShare * quantity, 1.0);
    totalFees += platformFee;

    // 3. 交收费（Clearing Fee）
    // 0.003 美元 × 成交股数，最高 7% × 交易金额
    const clearingFee = Math.min(0.003 * quantity, tradeAmount * 0.07);
    totalFees += clearingFee;

    // 4. 交易活动费（Trading Activity Fee）- 仅卖出
    // 0.000166 美元 x 卖出数量，最低 0.01 美元，最高 8.30 美元
    if (isSell) {
      const tradingActivityFee = Math.min(Math.max(0.000166 * quantity, 0.01), 8.30);
      totalFees += tradingActivityFee;
    }

    // 5. 综合审计跟踪监管费（CAT Fee）
    // 0.000046/股，每笔订单最低 0.01 美元
    const catFee = Math.max(0.000046 * quantity, 0.01);
    totalFees += catFee;

    return totalFees;
  }

  /**
   * 估算交易股数（用于费用计算）
   * 假设使用固定金额（如1000 USD）或固定股数（如100股）
   */
  private estimateTradeQuantity(price: number, tradeAmount: number = 1000): number {
    if (price <= 0) return 100; // 默认100股
    return Math.max(Math.floor(tradeAmount / price), 1); // 至少1股
  }

  /**
   * 计算ATR（平均真实波幅）
   * ATR用于衡量市场波动性，用于动态设置止损止盈
   */
  private calculateATR(candlesticks: CandlestickData[], period: number = 14): number {
    if (!candlesticks || candlesticks.length < period + 1) {
      // 如果数据不足，使用简单的波动率估算
      if (candlesticks && candlesticks.length > 0) {
        const recent = candlesticks.slice(-Math.min(period, candlesticks.length));
        const ranges = recent.map(c => c.high - c.low);
        return this.calculateAverage(ranges);
      }
      return 0;
    }

    // 计算True Range (TR)
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

    // 计算ATR（最近period个TR的平均值）
    const recentTRs = trueRanges.slice(-period);
    return this.calculateAverage(recentTRs);
  }


  private judgeTrend(current: number, avg: number, threshold: number = 0.01): string {
    if (current > avg * (1 + threshold)) {
      return '上升趋势';
    } else if (current < avg * (1 - threshold)) {
      return '下降趋势';
    } else {
      return '盘整';
    }
  }

  private judgePosition(positionPct: number): string {
    if (positionPct > 70) {
      return '高位区间';
    } else if (positionPct < 30) {
      return '低位区间';
    } else {
      return '中位区间';
    }
  }

  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) {
      return 0;
    }

    const n = x.length;
    const sum_x = x.reduce((a, b) => a + b, 0);
    const sum_y = y.reduce((a, b) => a + b, 0);
    const sum_xy = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sum_x2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sum_y2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sum_xy - sum_x * sum_y;
    const denominator = Math.sqrt((n * sum_x2 - sum_x * sum_x) * (n * sum_y2 - sum_y * sum_y));

    return denominator !== 0 ? numerator / denominator : 0;
  }

  private calculateRiskRewardRatio(
    action: 'BUY' | 'SELL' | 'HOLD',
    entry_min: number,
    entry_max: number,
    stop_loss: number,
    take_profit: number
  ): number {
    // 使用入场价范围的中点来计算R/R（更准确）
    const avgEntry = (entry_min + entry_max) / 2;
    
    if (action === 'BUY') {
      // 买入：风险 = 入场价 - 止损价，收益 = 止盈价 - 入场价
      const potential_loss = avgEntry - stop_loss;
      const potential_profit = take_profit - avgEntry;
      
      // 验证数据有效性
      if (potential_loss <= 0) {
        console.warn(`R/R计算警告（BUY）：潜在损失 <= 0 (entry=${avgEntry.toFixed(2)}, stop_loss=${stop_loss.toFixed(2)}, entry_range=[${entry_min.toFixed(2)}, ${entry_max.toFixed(2)}])`);
        // 如果止损价 >= 入场价，说明止损设置不合理，返回0
        return 0;
      }
      
      if (potential_profit <= 0) {
        console.warn(`R/R计算警告（BUY）：潜在收益 <= 0 (entry=${avgEntry.toFixed(2)}, take_profit=${take_profit.toFixed(2)}, entry_range=[${entry_min.toFixed(2)}, ${entry_max.toFixed(2)}])`);
        // 如果止盈价 <= 入场价，说明止盈设置不合理，返回0
        // 尝试使用entry_max重新计算
        const altProfit = take_profit - entry_max;
        if (altProfit > 0) {
          const altRatio = altProfit / potential_loss;
          console.warn(`R/R计算（BUY）：使用entry_max重新计算，R/R=${altRatio.toFixed(2)}`);
          return altRatio;
        }
        return 0;
      }
      
      const ratio = potential_profit / potential_loss;
      return ratio > 0 ? ratio : 0;
    } else if (action === 'SELL') {
      // 做空：风险 = 止损价 - 入场价，收益 = 入场价 - 止盈价
      const potential_loss = stop_loss - avgEntry;
      const potential_profit = avgEntry - take_profit;
      
      // 验证数据有效性
      if (potential_loss <= 0) {
        console.warn(`R/R计算警告（SELL）：潜在损失 <= 0 (entry=${avgEntry.toFixed(2)}, stop_loss=${stop_loss.toFixed(2)}, entry_range=[${entry_min.toFixed(2)}, ${entry_max.toFixed(2)}])`);
        // 如果止损价 <= 入场价，说明止损设置不合理，返回0
        return 0;
      }
      
      if (potential_profit <= 0) {
        console.warn(`R/R计算警告（SELL）：潜在收益 <= 0 (entry=${avgEntry.toFixed(2)}, take_profit=${take_profit.toFixed(2)}, entry_range=[${entry_min.toFixed(2)}, ${entry_max.toFixed(2)}])`);
        // 如果止盈价 >= 入场价，说明止盈设置不合理，返回0
        // 尝试使用entry_min重新计算
        const altProfit = entry_min - take_profit;
        if (altProfit > 0) {
          const altLoss = stop_loss - entry_min;
          if (altLoss > 0) {
            const altRatio = altProfit / altLoss;
            console.warn(`R/R计算（SELL）：使用entry_min重新计算，R/R=${altRatio.toFixed(2)}`);
            return altRatio;
          }
        }
        return 0;
      }
      
      const ratio = potential_profit / potential_loss;
      return ratio > 0 ? ratio : 0;
    } else if (action === 'HOLD') {
      // HOLD操作：也可以计算R/R，用于评估持有策略的风险收益比
      // 对于HOLD，我们假设在入场价范围买入，然后设置止损止盈
      // 风险 = 入场价 - 止损价，收益 = 止盈价 - 入场价
      const potential_loss = avgEntry - stop_loss;
      const potential_profit = take_profit - avgEntry;
      
      // 验证数据有效性
      if (potential_loss <= 0) {
        console.warn(`R/R计算警告（HOLD）：潜在损失 <= 0 (entry=${avgEntry.toFixed(2)}, stop_loss=${stop_loss.toFixed(2)}, entry_range=[${entry_min.toFixed(2)}, ${entry_max.toFixed(2)}])`);
        return 0;
      }
      
      if (potential_profit <= 0) {
        console.warn(`R/R计算警告（HOLD）：潜在收益 <= 0 (entry=${avgEntry.toFixed(2)}, take_profit=${take_profit.toFixed(2)}, entry_range=[${entry_min.toFixed(2)}, ${entry_max.toFixed(2)}])`);
        // 尝试使用entry_max重新计算
        const altProfit = take_profit - entry_max;
        if (altProfit > 0) {
          const altRatio = altProfit / potential_loss;
          console.warn(`R/R计算（HOLD）：使用entry_max重新计算，R/R=${altRatio.toFixed(2)}`);
          return altRatio;
        }
        return 0;
      }
      
      const ratio = potential_profit / potential_loss;
      return ratio > 0 ? ratio : 0;
    }
    
    // 未知操作类型
    return 0;
  }

  private generateSPXUSDRelationshipAnalysis(
    spxAnalysis: MarketAnalysis,
    usdAnalysis: MarketAnalysis,
    trend_consistency: string,
    comprehensive_market_strength: number
  ): string {
    const usdImpact = usdAnalysis.trend === '上升趋势' ? '负面' : 
                     usdAnalysis.trend === '下降趋势' ? '正面' : '中性';
    
    return `SPX当前${spxAnalysis.current_price.toFixed(2)}，${spxAnalysis.trend}（强度${spxAnalysis.trend_strength.toFixed(1)}）；` +
           `USD指数当前${usdAnalysis.current_price.toFixed(2)}，${usdAnalysis.trend}，对股市影响${usdImpact}；` +
           `趋势一致性：${trend_consistency}；` +
           `综合市场强度：${comprehensive_market_strength.toFixed(1)}。`;
  }

  private generateAnalysisSummary(
    spxAnalysis: MarketAnalysis,
    usdAnalysis: MarketAnalysis,
    btcAnalysis: MarketAnalysis & { is_stable: boolean },
    stockAnalysis: MarketAnalysis,
    market_environment: string,
    comprehensive_market_strength: number,
    trend_consistency: string
  ): string {
    const usdImpact = usdAnalysis.trend === '上升趋势' ? '负面' : 
                     usdAnalysis.trend === '下降趋势' ? '正面' : '中性';
    
    return `SPX ${spxAnalysis.current_price.toFixed(2)}，${spxAnalysis.trend}（强度${spxAnalysis.trend_strength.toFixed(1)}）；` +
           `USD指数 ${usdAnalysis.current_price.toFixed(2)}，${usdAnalysis.trend}，对股市影响${usdImpact}；` +
           `BTC ${btcAnalysis.current_price.toFixed(2)}，${btcAnalysis.is_stable ? '企稳' : btcAnalysis.trend}；` +
           `SPX-USD趋势一致性：${trend_consistency}；` +
           `综合市场强度 ${comprehensive_market_strength.toFixed(1)}，市场环境${market_environment}；` +
           `目标股票 ${stockAnalysis.current_price.toFixed(2)}，${stockAnalysis.trend}。`;
  }

  private generateRiskNote(
    market_environment: string,
    risk_reward_ratio: number,
    stockAnalysis: MarketAnalysis
  ): string {
    const notes: string[] = [];

    if (market_environment === '较差') {
      notes.push('市场环境较差，谨慎操作');
    } else if (market_environment === '中性利空') {
      notes.push('市场环境中性偏利空，建议谨慎操作');
    } else if (market_environment === '中性利好') {
      notes.push('市场环境中性偏利好，可适当关注机会');
    } else if (market_environment === '中性') {
      notes.push('市场环境中性，方向不明确，建议观望');
    }

    if (risk_reward_ratio < 1.5) {
      notes.push('风险收益比不足1.5，建议等待更好的入场时机');
    }

    if (stockAnalysis.position_percentage > 80) {
      notes.push('股票处于高位，注意回调风险');
    } else if (stockAnalysis.position_percentage < 20) {
      notes.push('股票处于低位，关注反弹机会');
    }

    return notes.length > 0 ? notes.join('；') : '无特别风险提示';
  }

  /**
   * 调整推荐以适应当前价格（盘前/盘后时间）
   * 如果当前价格已经超出入场价范围，给出提示或调整
   */
  private adjustRecommendationForCurrentPrice(
    recommendation: Omit<TradingRecommendation, 'symbol'>,
    currentPrice: number
  ): Omit<TradingRecommendation, 'symbol'> {
    const { entry_price_range, action, risk_note } = recommendation;
    let adjustedRecommendation = { ...recommendation };
    const notes: string[] = [];

    // 如果当前价格已经超过入场价范围
    if (currentPrice > entry_price_range.max) {
      if (action === 'BUY') {
        // BUY: 价格已上涨，可能需要调整入场价或给出提示
        const priceDiff = currentPrice - entry_price_range.max;
        const priceDiffPercent = ((priceDiff / entry_price_range.max) * 100).toFixed(2);
        
        if (priceDiffPercent > '5') {
          // 价格超过5%，给出警告
          notes.push(`当前价格(${currentPrice.toFixed(2)})已超过推荐入场价上限(${entry_price_range.max.toFixed(2)})${priceDiffPercent}%，建议等待回调或调整策略`);
        } else {
          // 价格超过但不超过5%，可以小幅调整入场价
          adjustedRecommendation.entry_price_range = {
            min: Math.max(entry_price_range.min, currentPrice * 0.99),
            max: currentPrice * 1.01,
          };
          notes.push(`当前价格已略高于推荐入场价，已调整入场价范围`);
        }
      } else if (action === 'SELL') {
        // SELL: 价格已上涨，可能是更好的做空机会
        notes.push(`当前价格(${currentPrice.toFixed(2)})已超过推荐做空入场价上限(${entry_price_range.max.toFixed(2)})，可能是更好的做空机会`);
      }
    } else if (currentPrice < entry_price_range.min) {
      if (action === 'BUY') {
        // BUY: 价格已下跌，可能是更好的入场机会
        const priceDiff = entry_price_range.min - currentPrice;
        const priceDiffPercent = ((priceDiff / entry_price_range.min) * 100).toFixed(2);
        notes.push(`当前价格(${currentPrice.toFixed(2)})低于推荐入场价下限(${entry_price_range.min.toFixed(2)})${priceDiffPercent}%，可能是更好的入场机会`);
      } else if (action === 'SELL') {
        // SELL: 价格已下跌，不适合做空
        notes.push(`当前价格(${currentPrice.toFixed(2)})已低于推荐做空入场价下限(${entry_price_range.min.toFixed(2)})，当前不适合做空`);
      }
    }

    // 重新计算R/R（基于当前价格）
    if (notes.length > 0) {
      const updatedRR = this.calculateRiskRewardRatioWithCurrentPrice(
        adjustedRecommendation,
        currentPrice
      );
      adjustedRecommendation.risk_reward_ratio = updatedRR;
    }

    // 合并风险提示
    if (notes.length > 0) {
      adjustedRecommendation.risk_note = risk_note && risk_note !== '无特别风险提示'
        ? `${notes.join('；')}；${risk_note}`
        : notes.join('；');
    }

    return adjustedRecommendation;
  }

  /**
   * 基于当前价格重新计算R/R
   */
  private calculateRiskRewardRatioWithCurrentPrice(
    recommendation: Omit<TradingRecommendation, 'symbol'>,
    currentPrice: number
  ): number {
    const { action, entry_price_range, stop_loss, take_profit } = recommendation;

    // 使用当前价格或入场价范围的中点
    const entryPrice = Math.max(
      entry_price_range.min,
      Math.min(currentPrice, entry_price_range.max)
    );

    if (action === 'BUY') {
      const potential_loss = entryPrice - stop_loss;
      const potential_profit = take_profit - entryPrice;

      if (potential_loss <= 0) return 0;
      return potential_profit > 0 ? potential_profit / potential_loss : 0;
    } else if (action === 'SELL') {
      const potential_loss = stop_loss - entryPrice;
      const potential_profit = entryPrice - take_profit;

      if (potential_loss <= 0) return 0;
      return potential_profit > 0 ? potential_profit / potential_loss : 0;
    } else if (action === 'HOLD') {
      const potential_loss = entryPrice - stop_loss;
      const potential_profit = take_profit - entryPrice;

      if (potential_loss <= 0) return 0;
      return potential_profit > 0 ? potential_profit / potential_loss : 0;
    }

    return 0;
  }
}

export default new TradingRecommendationService();
