/**
 * 期权专用推荐服务 (Option-Specific Recommendation Service)
 *
 * 设计理念：
 * 1. 针对0DTE日内期权交易，不依赖底层股票的日K线趋势
 * 2. 核心决策因子：大盘方向预测 + 分时动量 + 期权特性
 * 3. 降低入场门槛，提高交易频率
 *
 * 决策流程：
 * - 大盘环境评分 (40%): SPX趋势 + 市场温度 + VIX
 * - 分时动量评分 (40%): BTC/USD小时K + 底层股票分时
 * - 期权特性调整 (20%): 时间窗口 + 波动率
 */

import marketDataCacheService from './market-data-cache.service';
import intradayDataFilterService from './intraday-data-filter.service';
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

interface OptionRecommendation {
  direction: 'CALL' | 'PUT' | 'HOLD';
  confidence: number; // 0-100
  reasoning: string;
  marketScore: number; // 大盘得分 -100 to 100
  intradayScore: number; // 分时得分 -100 to 100
  finalScore: number; // 综合得分 -100 to 100
  suggestedDelta: {
    min: number;
    max: number;
  };
  entryWindow: {
    immediate: boolean; // 是否立即入场
    waitForPullback: boolean; // 是否等待回调
  };
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  timeDecayFactor: number; // 时间价值衰减因子
  // 检查点1数据
  dataCheck?: {
    spxCount: number;
    usdCount: number;
    btcCount: number;
    vixAvailable: boolean;
    temperatureAvailable: boolean;
  };
  // 检查点3数据（用于日志记录）
  riskMetrics?: {
    vixValue?: number;
    temperatureValue?: number;
    riskScore?: number;
  };
  rsi?: number;
}

class OptionRecommendationService {
  /**
   * 计算期权交易推荐 (0DTE专用)
   * @param underlyingSymbol 底层股票代码 (如 QQQ.US)
   * @returns 期权方向推荐
   */
  async calculateOptionRecommendation(
    underlyingSymbol: string
  ): Promise<OptionRecommendation> {
    try {
      // 1. 获取市场数据（包含分时数据）
      const marketData = await marketDataCacheService.getMarketData(100, true);

      // [检查点1] 市场数据充足性
      logger.debug(
        `[${underlyingSymbol}数据检查] SPX=${marketData.spx?.length || 0}, USD=${marketData.usdIndex?.length || 0}, BTC=${marketData.btc?.length || 0}, VIX=${marketData.vix ? 'Y' : 'N'}, 温度=${marketData.marketTemperature !== undefined ? 'Y' : 'N'}`
      );

      // 验证数据充足性
      if (!marketData.spx || marketData.spx.length < 50) {
        throw new Error(
          `❌ 市场数据不足: SPX=${marketData.spx?.length || 0} (需要≥50)`
        );
      }
      if (!marketData.usdIndex || marketData.usdIndex.length < 50) {
        throw new Error(
          `❌ 市场数据不足: USD=${marketData.usdIndex?.length || 0} (需要≥50)`
        );
      }
      if (!marketData.btc || marketData.btc.length < 50) {
        throw new Error(
          `❌ 市场数据不足: BTC=${marketData.btc?.length || 0} (需要≥50)`
        );
      }

      // 2. 计算大盘环境得分 (40%权重)
      const marketScore = await this.calculateMarketScore(marketData);

      // 3. 计算分时动量得分 (40%权重)
      const intradayScore = await this.calculateIntradayScore(
        marketData,
        underlyingSymbol
      );

      // 4. 计算期权时间窗口调整 (20%权重)
      const timeWindowAdjustment = this.calculateTimeWindowAdjustment();

      // 5. 综合得分计算
      const finalScore =
        marketScore * 0.4 +
        intradayScore * 0.4 +
        timeWindowAdjustment * 0.2;

      // 6. 决策逻辑（降低门槛）
      let direction: 'CALL' | 'PUT' | 'HOLD' = 'HOLD';
      let confidence = 0;

      if (finalScore > 15) {
        // 从30降低到15，增加交易频率
        direction = 'CALL';
        confidence = Math.min(Math.round((finalScore / 100) * 100), 100);
        // [检查点2] 方向判定 - CALL
        logger.info(
          `[${underlyingSymbol}信号] BUY_CALL | 得分=${finalScore.toFixed(1)} (市场${marketScore.toFixed(1)} + 日内${intradayScore.toFixed(1)} + 时间${timeWindowAdjustment.toFixed(1)}) | 置信度=${confidence}%`
        );
      } else if (finalScore < -15) {
        direction = 'PUT';
        confidence = Math.min(Math.round((Math.abs(finalScore) / 100) * 100), 100);
        // [检查点2] 方向判定 - PUT
        logger.info(
          `[${underlyingSymbol}信号] BUY_PUT | 得分=${finalScore.toFixed(1)} (市场${marketScore.toFixed(1)} + 日内${intradayScore.toFixed(1)} + 时间${timeWindowAdjustment.toFixed(1)}) | 置信度=${confidence}%`
        );
      } else {
        direction = 'HOLD';
        confidence = Math.round(100 - Math.abs(finalScore) * 2);
        // [检查点2] 方向判定 - HOLD
        logger.debug(
          `[${underlyingSymbol}信号] HOLD | 得分=${finalScore.toFixed(1)} 处于中性区间[-15, 15] | 置信度=${confidence}%`
        );
      }

      // 7. Delta建议（根据得分强度）
      const suggestedDelta = this.calculateSuggestedDelta(finalScore, direction);

      // 8. 入场时机建议
      const entryWindow = this.calculateEntryWindow(
        finalScore,
        intradayScore,
        direction
      );

      // 9. 风险等级评估
      const { riskLevel, riskMetrics } = this.assessRiskLevel(marketData, finalScore);

      // 10. 时间价值衰减因子
      const timeDecayFactor = this.calculateTimeDecayFactor();

      // 11. 生成推理说明
      const reasoning = this.generateReasoning(
        marketScore,
        intradayScore,
        timeWindowAdjustment,
        finalScore,
        direction,
        marketData
      );

      // 12. 构建检查点1数据
      const dataCheck = {
        spxCount: marketData.spx?.length || 0,
        usdCount: marketData.usdIndex?.length || 0,
        btcCount: marketData.btc?.length || 0,
        vixAvailable: !!(marketData.vix && marketData.vix.length > 0),
        temperatureAvailable: marketData.marketTemperature !== undefined,
      };

      return {
        direction,
        confidence,
        reasoning,
        marketScore,
        intradayScore,
        finalScore,
        suggestedDelta,
        entryWindow,
        riskLevel,
        timeDecayFactor,
        dataCheck,
        riskMetrics,
      };
    } catch (error: any) {
      logger.error(`计算期权推荐失败 (${underlyingSymbol}):`, error.message);
      throw error;
    }
  }

  /**
   * 计算大盘环境得分
   * 考虑因素：SPX趋势、USD Index、BTC、VIX、市场温度
   */
  private async calculateMarketScore(marketData: any): Promise<number> {
    let score = 0;
    const components: string[] = [];

    // 1. SPX趋势分析 (权重40%)
    const spxAnalysis = this.analyzeMarketTrend(marketData.spx, 'SPX');
    score += spxAnalysis.trendStrength * 0.4;
    components.push(`SPX趋势${spxAnalysis.trendStrength.toFixed(1)}→${(spxAnalysis.trendStrength * 0.4).toFixed(1)}`);

    // 2. USD Index影响 (权重20%, 反向)
    const usdAnalysis = this.analyzeMarketTrend(marketData.usdIndex, 'USD');
    score += -usdAnalysis.trendStrength * 0.2; // USD上升对股市不利
    components.push(`USD${usdAnalysis.trendStrength.toFixed(1)}→${(-usdAnalysis.trendStrength * 0.2).toFixed(1)}`);

    // 3. BTC支持/阻力 (权重20%)
    const btcAnalysis = this.analyzeMarketTrend(marketData.btc, 'BTC');
    const btcCorrelation = this.checkBTCSPXCorrelation(marketData.spx, marketData.btc);
    if (btcCorrelation > 0.5) {
      // 共振时BTC影响更大
      score += btcAnalysis.trendStrength * 0.2;
      components.push(`BTC${btcAnalysis.trendStrength.toFixed(1)}*0.2→${(btcAnalysis.trendStrength * 0.2).toFixed(1)}`);
    } else {
      // 不共振时降低影响
      score += btcAnalysis.trendStrength * 0.1;
      components.push(`BTC${btcAnalysis.trendStrength.toFixed(1)}*0.1→${(btcAnalysis.trendStrength * 0.1).toFixed(1)}`);
    }

    // 4. VIX恐慌指数 (权重10%)
    if (marketData.vix && marketData.vix.length > 0) {
      const currentVix = marketData.vix[marketData.vix.length - 1].close;
      if (currentVix > 35) {
        // 极度恐慌，强制-50分
        score -= 50;
        components.push(`VIX=${currentVix.toFixed(1)}→-50`);
      } else if (currentVix > 25) {
        // 高恐慌，减20分
        score -= 20;
        components.push(`VIX=${currentVix.toFixed(1)}→-20`);
      } else if (currentVix < 15) {
        // 低恐慌，加10分
        score += 10;
        components.push(`VIX=${currentVix.toFixed(1)}→+10`);
      }
    }

    // 5. 市场温度 (权重10%)
    if (marketData.marketTemperature) {
      let temp = 0;
      if (typeof marketData.marketTemperature === 'number') {
        temp = marketData.marketTemperature;
      } else if (marketData.marketTemperature.value) {
        temp = marketData.marketTemperature.value;
      } else if (marketData.marketTemperature.temperature) {
        temp = marketData.marketTemperature.temperature;
      }

      if (temp > 50) {
        const tempScore = (temp - 50) * 0.3; // 高温加分
        score += tempScore;
        components.push(`温度=${temp.toFixed(0)}→+${tempScore.toFixed(1)}`);
      } else if (temp < 20) {
        const tempScore = (20 - temp) * 0.5; // 低温减分
        score -= tempScore;
        components.push(`温度=${temp.toFixed(0)}→-${tempScore.toFixed(1)}`);
      }
    }

    const finalMarketScore = Math.max(-100, Math.min(100, score));
    logger.info(`[大盘评分明细] 总分=${finalMarketScore.toFixed(1)} | ${components.join(' | ')}`);

    return finalMarketScore;
  }

  /**
   * 计算分时动量得分
   * 使用小时K线数据，捕捉日内动量
   */
  private async calculateIntradayScore(
    marketData: any,
    underlyingSymbol: string
  ): Promise<number> {
    let score = 0;
    const components: string[] = [];

    // 1. BTC小时K动量 (权重40%)
    if (marketData.btcHourly && marketData.btcHourly.length >= 10) {
      const filteredBTCHourly = intradayDataFilterService.filterData(
        marketData.btcHourly
      );
      const btcHourlyMomentum = this.calculateMomentum(filteredBTCHourly);
      score += btcHourlyMomentum * 0.4;
      components.push(`BTC时K=${btcHourlyMomentum.toFixed(1)}→${(btcHourlyMomentum * 0.4).toFixed(1)}`);
    }

    // 2. USD小时K动量 (权重20%, 反向)
    if (marketData.usdIndexHourly && marketData.usdIndexHourly.length >= 10) {
      const filteredUSDHourly = intradayDataFilterService.filterData(
        marketData.usdIndexHourly
      );
      const usdHourlyMomentum = this.calculateMomentum(filteredUSDHourly);
      score += -usdHourlyMomentum * 0.2;
      components.push(`USD时K=${usdHourlyMomentum.toFixed(1)}→${(-usdHourlyMomentum * 0.2).toFixed(1)}`);
    }

    // 3. 底层股票分时动量 (权重40%)
    // 使用SPX日K最后几根的强度作为替代
    if (marketData.spx && marketData.spx.length > 0) {
      const recentCandles = marketData.spx.slice(-5);
      const shortTermMomentum = this.calculateMomentum(recentCandles);
      score += shortTermMomentum * 0.4;
      components.push(`SPX近5日动量=${shortTermMomentum.toFixed(1)}→${(shortTermMomentum * 0.4).toFixed(1)}`);
    }

    const finalIntradayScore = Math.max(-100, Math.min(100, score));
    logger.info(`[分时评分明细] 总分=${finalIntradayScore.toFixed(1)} | ${components.join(' | ')}`);

    return finalIntradayScore;
  }

  /**
   * 分析市场趋势（通用）
   */
  private analyzeMarketTrend(
    data: CandlestickData[],
    name: string
  ): { trendStrength: number; trend: string } {
    if (!data || data.length < 20) {
      return { trendStrength: 0, trend: '数据不足' };
    }

    const currentPrice = data[data.length - 1].close;
    const prices = data.slice(-20).map((d) => d.close);
    const avg20 = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const avg10 = prices
      .slice(-10)
      .reduce((sum, p) => sum + p, 0) / 10;

    // 计算趋势强度 (-100 to 100)
    let trendStrength = ((currentPrice - avg20) / avg20) * 100 * 10; // 放大10倍

    // 短期趋势加成
    if (currentPrice > avg10 && avg10 > avg20) {
      trendStrength += 20; // 强势上涨
    } else if (currentPrice < avg10 && avg10 < avg20) {
      trendStrength -= 20; // 强势下跌
    }

    // 归一化到-100到100
    trendStrength = Math.max(-100, Math.min(100, trendStrength));

    let trend = '盘整';
    if (trendStrength > 20) trend = '强势上涨';
    else if (trendStrength > 5) trend = '上涨';
    else if (trendStrength < -20) trend = '强势下跌';
    else if (trendStrength < -5) trend = '下跌';

    return { trendStrength, trend };
  }

  /**
   * 计算动量 (基于价格变化率)
   */
  private calculateMomentum(data: CandlestickData[]): number {
    if (!data || data.length < 5) return 0;

    // 计算最近几根K线的价格变化率
    const changes: number[] = [];
    for (let i = 1; i < Math.min(data.length, 10); i++) {
      const change = (data[i].close - data[i - 1].close) / data[i - 1].close;
      changes.push(change);
    }

    // 平均变化率
    const avgChange = changes.reduce((sum, c) => sum + c, 0) / changes.length;

    // 转换为-100到100的分数
    const momentum = avgChange * 1000; // 放大1000倍
    return Math.max(-100, Math.min(100, momentum));
  }

  /**
   * 检查BTC与SPX的相关性
   */
  private checkBTCSPXCorrelation(
    spxData: CandlestickData[],
    btcData: CandlestickData[]
  ): number {
    if (!spxData || !btcData || spxData.length < 10 || btcData.length < 10) {
      return 0;
    }

    const minLen = Math.min(spxData.length, btcData.length, 20);
    const spxPrices = spxData.slice(-minLen).map((d) => d.close);
    const btcPrices = btcData.slice(-minLen).map((d) => d.close);

    // 计算价格变化率
    const spxChanges: number[] = [];
    const btcChanges: number[] = [];
    for (let i = 1; i < spxPrices.length; i++) {
      spxChanges.push((spxPrices[i] - spxPrices[i - 1]) / spxPrices[i - 1]);
      btcChanges.push((btcPrices[i] - btcPrices[i - 1]) / btcPrices[i - 1]);
    }

    // 计算Pearson相关系数
    return this.calculatePearsonCorrelation(spxChanges, btcChanges);
  }

  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;

    const n = x.length;
    const sum_x = x.reduce((a, b) => a + b, 0);
    const sum_y = y.reduce((a, b) => a + b, 0);
    const sum_xy = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sum_x2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sum_y2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sum_xy - sum_x * sum_y;
    const denominator = Math.sqrt(
      (n * sum_x2 - sum_x * sum_x) * (n * sum_y2 - sum_y * sum_y)
    );

    return denominator !== 0 ? numerator / denominator : 0;
  }

  /**
   * 计算时间窗口调整
   * 美股交易时间: 9:30 - 16:00 ET (14个交易小时，每小时约7.14%时间价值)
   */
  private calculateTimeWindowAdjustment(): number {
    const now = new Date();
    const hour = now.getUTCHours(); // UTC时间
    const minute = now.getUTCMinutes();

    // 美东时间 = UTC - 5小时 (EST) 或 UTC - 4小时 (EDT)
    // 简化：使用EST
    const etHour = (hour - 5 + 24) % 24;
    const etMinutes = etHour * 60 + minute;

    // 9:30 = 570分钟，16:00 = 960分钟
    const marketOpen = 570;
    const marketClose = 960;
    const forceCloseTime = marketClose - 30; // 15:30

    let adjustment = 0;

    if (etMinutes < marketOpen + 60) {
      // 开盘后1小时：最佳交易时段，+20分
      adjustment = 20;
    } else if (etMinutes > forceCloseTime) {
      // 收盘前30分钟：时间价值急速衰减，-50分
      adjustment = -50;
    } else if (etMinutes > forceCloseTime - 60) {
      // 收盘前90-30分钟：时间价值衰减加速，-30分
      adjustment = -30;
    } else if (etMinutes > marketOpen + 120) {
      // 开盘后2小时以上：时间价值正常衰减，-10分
      adjustment = -10;
    }

    return adjustment;
  }

  /**
   * 计算建议的Delta范围
   */
  private calculateSuggestedDelta(
    finalScore: number,
    direction: 'CALL' | 'PUT' | 'HOLD'
  ): { min: number; max: number } {
    if (direction === 'HOLD') {
      return { min: 0.45, max: 0.55 };
    }

    const absScore = Math.abs(finalScore);

    if (absScore > 50) {
      // 强信号：深度实值期权 (delta 0.6-0.8)
      return { min: 0.6, max: 0.8 };
    } else if (absScore > 30) {
      // 中等信号：浅度实值期权 (delta 0.45-0.65)
      return { min: 0.45, max: 0.65 };
    } else {
      // 弱信号：平值期权 (delta 0.35-0.55)
      return { min: 0.35, max: 0.55 };
    }
  }

  /**
   * 计算入场时机建议
   */
  private calculateEntryWindow(
    finalScore: number,
    intradayScore: number,
    direction: 'CALL' | 'PUT' | 'HOLD'
  ): { immediate: boolean; waitForPullback: boolean } {
    if (direction === 'HOLD') {
      return { immediate: false, waitForPullback: false };
    }

    const absScore = Math.abs(finalScore);
    const absIntradayScore = Math.abs(intradayScore);

    // 强信号 + 分时动量一致 → 立即入场
    if (absScore > 40 && absIntradayScore > 30) {
      return { immediate: true, waitForPullback: false };
    }

    // 中等信号 + 分时动量较弱 → 等待回调
    if (absScore > 20 && absIntradayScore < 20) {
      return { immediate: false, waitForPullback: true };
    }

    // 其他情况 → 立即入场
    return { immediate: true, waitForPullback: false };
  }

  /**
   * 评估风险等级
   */
  private assessRiskLevel(
    marketData: any,
    finalScore: number
  ): { riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'; riskMetrics: any } {
    let riskPoints = 0;

    // 1. VIX检查
    const currentVix = marketData.vix?.[marketData.vix.length - 1]?.close;
    if (marketData.vix && marketData.vix.length > 0) {
      if (currentVix > 35) riskPoints += 3;
      else if (currentVix > 25) riskPoints += 2;
      else if (currentVix > 20) riskPoints += 1;
    }

    // 2. 市场温度检查
    let temp = 0;
    if (marketData.marketTemperature) {
      if (typeof marketData.marketTemperature === 'number') {
        temp = marketData.marketTemperature;
      } else if (marketData.marketTemperature.value) {
        temp = marketData.marketTemperature.value;
      } else if (marketData.marketTemperature.temperature) {
        temp = marketData.marketTemperature.temperature;
      }

      if (temp < 20) riskPoints += 2;
      else if (temp > 80) riskPoints += 1;
    }

    // 3. 信号强度检查
    if (Math.abs(finalScore) < 20) riskPoints += 1;

    // 4. 时间窗口检查
    const timeAdjustment = this.calculateTimeWindowAdjustment();
    if (timeAdjustment < -30) riskPoints += 2; // 接近收盘

    const riskLevel =
      riskPoints >= 5 ? 'EXTREME' :
      riskPoints >= 3 ? 'HIGH' :
      riskPoints >= 1 ? 'MEDIUM' : 'LOW';

    // [检查点3] 风险评估
    logger.debug(
      `[风险评估] ${riskLevel} | 积分=${riskPoints} (VIX=${currentVix?.toFixed(1) || 'N/A'}, 温度=${temp?.toFixed(0) || 'N/A'}, 时间调整=${timeAdjustment.toFixed(1)})`
    );

    const riskMetrics = {
      vixValue: currentVix,
      temperatureValue: temp,
      riskScore: riskPoints,
    };

    return { riskLevel, riskMetrics };
  }

  /**
   * 计算时间价值衰减因子
   */
  private calculateTimeDecayFactor(): number {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    const etHour = (hour - 5 + 24) % 24;
    const etMinutes = etHour * 60 + minute;

    const marketOpen = 570; // 9:30
    const marketClose = 960; // 16:00

    if (etMinutes < marketOpen || etMinutes > marketClose) {
      return 1.0; // 盘外，不衰减
    }

    const minutesIntoMarket = etMinutes - marketOpen;
    const totalMarketMinutes = marketClose - marketOpen; // 390分钟

    // 线性衰减：从1.0衰减到0.1
    const decayFactor = 1.0 - (minutesIntoMarket / totalMarketMinutes) * 0.9;

    return Math.max(0.1, decayFactor);
  }

  /**
   * 生成推理说明
   */
  private generateReasoning(
    marketScore: number,
    intradayScore: number,
    timeWindowAdjustment: number,
    finalScore: number,
    direction: 'CALL' | 'PUT' | 'HOLD',
    marketData: any
  ): string {
    const parts: string[] = [];

    // 1. 大盘环境
    if (marketScore > 30) {
      parts.push(`大盘环境强势看多(${marketScore.toFixed(1)}分)`);
    } else if (marketScore > 10) {
      parts.push(`大盘环境偏多(${marketScore.toFixed(1)}分)`);
    } else if (marketScore < -30) {
      parts.push(`大盘环境强势看空(${marketScore.toFixed(1)}分)`);
    } else if (marketScore < -10) {
      parts.push(`大盘环境偏空(${marketScore.toFixed(1)}分)`);
    } else {
      parts.push(`大盘环境中性(${marketScore.toFixed(1)}分)`);
    }

    // 2. 分时动量
    if (intradayScore > 30) {
      parts.push(`分时动量强劲向上(${intradayScore.toFixed(1)}分)`);
    } else if (intradayScore > 10) {
      parts.push(`分时动量偏多(${intradayScore.toFixed(1)}分)`);
    } else if (intradayScore < -30) {
      parts.push(`分时动量快速下行(${intradayScore.toFixed(1)}分)`);
    } else if (intradayScore < -10) {
      parts.push(`分时动量偏空(${intradayScore.toFixed(1)}分)`);
    } else {
      parts.push(`分时动量平淡(${intradayScore.toFixed(1)}分)`);
    }

    // 3. 时间窗口
    if (timeWindowAdjustment > 10) {
      parts.push('开盘初期交易时段');
    } else if (timeWindowAdjustment < -30) {
      parts.push('临近收盘时间价值快速衰减');
    } else if (timeWindowAdjustment < -10) {
      parts.push('午盘时间价值正常衰减');
    }

    // 4. VIX风险提示
    if (marketData.vix && marketData.vix.length > 0) {
      const currentVix = marketData.vix[marketData.vix.length - 1].close;
      if (currentVix > 35) {
        parts.push(`VIX恐慌指数极高(${currentVix.toFixed(1)})，风险极大`);
      } else if (currentVix > 25) {
        parts.push(`VIX恐慌指数偏高(${currentVix.toFixed(1)})，注意风险`);
      }
    }

    // 5. 综合决策
    parts.push(`综合得分${finalScore.toFixed(1)}分，建议${direction}`);

    return parts.join('；');
  }
  /**
   * 计算 RSI-14（Wilder's Smoothed RSI）
   * @param klines 至少 15 根 K 线（含 close 字段）
   * @returns RSI 值 (0-100)，数据不足返回 undefined
   */
  calculateRSI14(klines: { close: number }[]): number | undefined {
    const period = 14;
    if (!klines || klines.length < period + 1) return undefined;

    // 计算逐根涨跌幅
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const change = klines[i].close - klines[i - 1].close;
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    // Wilder's smoothing for remaining bars
    for (let i = period + 1; i < klines.length; i++) {
      const change = klines[i].close - klines[i - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
}

export default new OptionRecommendationService();
