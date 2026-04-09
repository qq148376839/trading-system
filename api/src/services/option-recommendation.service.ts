/**
 * 期权专用推荐服务 (Option-Specific Recommendation Service)
 *
 * 设计理念：
 * 1. 针对0DTE日内期权交易，不依赖底层股票的日K线趋势
 * 2. 核心决策因子：大盘方向预测 + 分时动量 + 时间窗口
 * 3. 降低入场门槛，提高交易频率
 *
 * Phase 3+ 决策流程（权重 20/60/20）：
 * - 大盘环境评分 (20%): SPX日K多窗口趋势(20%) + SPX分钟级趋势(20%) + Gap
 *                        + USD日线(10%)+USD分钟(10%) + BTC日线(2-5%)+BTC分钟(3-5%)
 *                        + VIX(实时三级取值) + 温度
 * - 分时动量评分 (60%): 底层1m VW动量(30%) + 5min趋势确认(15%) + VWAP位置(15%) + SPX日内(25%) + BTC(15%)
 * - 时间窗口评分 (20%): 去偏置的中性时间衰减信号
 */

import marketDataCacheService from './market-data-cache.service';
import marketDataService from './market-data.service';
import intradayDataFilterService from './intraday-data-filter.service';
import quoteSubscriptionService from './quote-subscription.service';
import marketRegimeDetector, { DEFAULT_SMART_REVERSE_CONFIG } from './market-regime-detector.service';
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
  timeWindowScore?: number; // Phase 3: 时间窗口得分（去偏置版本）
  timeThresholdFactor?: number; // 时间阈值修正系数（供策略层使用）
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
    underlyingVWAPAvailable: boolean;
    underlyingKlineCount: number;
    spxHourlyCount: number;
  };
  // 检查点3数据（用于日志记录）
  riskMetrics?: {
    vixValue?: number;
    temperatureValue?: number;
    riskScore?: number;
  };
  rsi?: number;
  intradayComponents?: {
    underlyingMomentum: number;
    vwapPosition: number;
    spxIntraday: number;
    btcHourly: number;
    usdHourly: number;
  };
  currentVix?: number;
  vwapData?: {
    vwap: number;
    lastPrice: number;
    distancePct: number;
    priceAboveVWAP: boolean;
  } | null;
  structureCheck?: {
    mismatch: boolean;
    originalDirection: string;
    finalDirection: string;
    reason: string;
  };
}

interface MarketScoreComponents {
  spxDaily: { raw: number; weighted: number };
  spxMinute: { raw: number; weighted: number };
  gap: { pct: number; score: number };
  usdDaily: { raw: number; weighted: number };
  usdMinute: { raw: number; weighted: number };
  btcDaily: { raw: number; weighted: number; resonance: boolean };
  btcMinute: { raw: number; weighted: number };
  vix: { value: number; source: string; impact: number };
  temperature: { value: number; impact: number };
}

interface MonitorMarketScore {
  marketScore: number;
  marketComponents: MarketScoreComponents;
  intradayScore: number;
  timeWindowScore: number;
  finalScore: number;
  dynamicThreshold: number;
  direction: 'CALL' | 'PUT' | 'HOLD';
  confidence: number;
  regime: {
    type: 'MOMENTUM' | 'MEAN_REVERSION' | 'UNCERTAIN';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    label: string;
  };
  suitableStrategies: string[];
  scoreLabel: string;
  timestamp: number;
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

      // 2. 获取底层标的VWAP数据（用于日内评分）
      let underlyingVWAP: { vwap: number; dataPoints: number; rangePct: number; recentKlines: CandlestickData[] } | null = null;
      try {
        const vwapResult = await marketDataService.getIntradayVWAP(underlyingSymbol);
        if (vwapResult) {
          underlyingVWAP = {
            vwap: vwapResult.vwap,
            dataPoints: vwapResult.dataPoints,
            rangePct: vwapResult.rangePct,
            recentKlines: vwapResult.recentKlines.map(k => ({
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
              volume: k.volume,
              turnover: 0,
              timestamp: k.timestamp,
            })),
          };
        }
      } catch (err) {
        logger.warn(`[${underlyingSymbol}] VWAP数据获取失败: ${err instanceof Error ? err.message : err}`);
      }

      // 2b. 获取底层标的 5min K 线（用于趋势确认）
      let underlying5minKlines: CandlestickData[] | null = null;
      try {
        const raw5min = await marketDataService.getIntraday5minKlines(underlyingSymbol);
        if (raw5min) {
          underlying5minKlines = raw5min.map(k => ({
            open: k.open, high: k.high, low: k.low, close: k.close,
            volume: k.volume, turnover: 0, timestamp: k.timestamp,
          }));
        }
      } catch (err) {
        logger.warn(`[${underlyingSymbol}] 5min K线获取失败: ${err instanceof Error ? err.message : err}`);
      }

      // 2c. 获取 SPX 5min K 线（用于市场评分分钟级趋势）
      let spx5minKlines: CandlestickData[] | null = null;
      try {
        const rawSpx5min = await marketDataService.getIntraday5minKlines('.SPX.US');
        if (rawSpx5min) {
          spx5minKlines = rawSpx5min.map(k => ({
            open: k.open, high: k.high, low: k.low, close: k.close,
            volume: k.volume, turnover: 0, timestamp: k.timestamp,
          }));
        }
      } catch (err) {
        logger.warn(`[SPX] 5min K线获取失败: ${err instanceof Error ? err.message : err}`);
      }

      // 3. 计算大盘环境得分 (20%权重) — Phase 3+: 日线趋势 + 分钟级趋势(SPX/USD/BTC) + VIX实时
      const { score: marketScore } = await this.calculateMarketScore(
        marketData, marketData.spxHourly, spx5minKlines,
        marketData.usdIndexHourly, marketData.btcHourly
      );

      // 4. 计算分时动量得分 (60%权重) — Phase 3: VW动量 + 5min确认 + VWAP + SPX + BTC
      const { score: intradayScore, components: intradayComponents } = await this.calculateIntradayScore(
        marketData,
        underlyingSymbol,
        underlyingVWAP,
        marketData.spxHourly,
        underlying5minKlines
      );

      // 5. 时间窗口评分 (20%权重) — Phase 3: 去偏置，恢复为独立方向信号
      const timeWindowAdjustment = this.calculateTimeWindowAdjustment(); // 去偏置版本
      const timeThresholdFactor = this.getTimeThresholdFactor(); // 阈值修正系数（供策略层使用）

      // 6. 综合得分计算 — Phase 3: 恢复 20/60/20 权重
      const finalScore =
        marketScore * 0.2 +
        intradayScore * 0.6 +
        timeWindowAdjustment * 0.2;

      // 7. 决策逻辑（降低门槛）
      let direction: 'CALL' | 'PUT' | 'HOLD' = 'HOLD';
      let confidence = 0;

      // 260304: 动态阈值 — 基础 15，0DTE 尾盘递增
      const baseThreshold = 15;
      const entryTimeFactor = this.get0DTETimeThresholdFactor();
      const dynamicThreshold = baseThreshold * entryTimeFactor;

      if (finalScore > dynamicThreshold) {
        direction = 'CALL';
        confidence = Math.min(Math.round((finalScore / 100) * 100), 100);
        // [检查点2] 方向判定 - CALL
        logger.info(
          `[${underlyingSymbol}信号] BUY_CALL | 得分=${finalScore.toFixed(1)} (市场${marketScore.toFixed(1)}*0.2 + 日内${intradayScore.toFixed(1)}*0.6 + 时间${timeWindowAdjustment.toFixed(1)}*0.2) | 阈值=${dynamicThreshold.toFixed(1)}${entryTimeFactor > 1.0 ? ` timeFactor=${entryTimeFactor.toFixed(2)}` : ''} | 置信度=${confidence}%`
        );
      } else if (finalScore < -dynamicThreshold) {
        direction = 'PUT';
        confidence = Math.min(Math.round((Math.abs(finalScore) / 100) * 100), 100);
        // [检查点2] 方向判定 - PUT
        logger.info(
          `[${underlyingSymbol}信号] BUY_PUT | 得分=${finalScore.toFixed(1)} (市场${marketScore.toFixed(1)}*0.2 + 日内${intradayScore.toFixed(1)}*0.6 + 时间${timeWindowAdjustment.toFixed(1)}*0.2) | 阈值=${dynamicThreshold.toFixed(1)}${entryTimeFactor > 1.0 ? ` timeFactor=${entryTimeFactor.toFixed(2)}` : ''} | 置信度=${confidence}%`
        );
      } else {
        direction = 'HOLD';
        confidence = Math.round(100 - Math.abs(finalScore) * 2);
        // [检查点2] 方向判定 - HOLD
        logger.debug(
          `[${underlyingSymbol}信号] HOLD | 得分=${finalScore.toFixed(1)} 处于中性区间[-${dynamicThreshold.toFixed(1)}, ${dynamicThreshold.toFixed(1)}]${entryTimeFactor > 1.0 ? ` timeFactor=${entryTimeFactor.toFixed(2)}` : ''} | 置信度=${confidence}%`
        );
      }

      // 8. Structure alignment: verify signal direction matches VWAP structure
      let structureCheckResult: { mismatch: boolean; originalDirection: string; finalDirection: string; reason: string } | undefined;
      if (underlyingVWAP && underlyingVWAP.vwap > 0 && underlyingVWAP.recentKlines?.length >= 2 && direction !== 'HOLD') {
        const lastPrice = underlyingVWAP.recentKlines[underlyingVWAP.recentKlines.length - 1].close;
        const priceAboveVWAP = lastPrice > underlyingVWAP.vwap;
        const mismatch = (direction === 'PUT' && priceAboveVWAP) || (direction === 'CALL' && !priceAboveVWAP);

        const originalDirection = direction;
        if (mismatch && Math.abs(finalScore) < 30) {
          logger.warn(
            `[${underlyingSymbol}结构冲突] ${direction}但价格${priceAboveVWAP ? '>' : '<'}VWAP (${lastPrice.toFixed(2)} vs ${underlyingVWAP.vwap.toFixed(2)}), 得分${Math.abs(finalScore).toFixed(1)}<30, 降级HOLD`
          );
          direction = 'HOLD';
          confidence = Math.round(100 - Math.abs(finalScore) * 2);
        }
        structureCheckResult = {
          mismatch,
          originalDirection,
          finalDirection: direction,
          reason: mismatch
            ? (Math.abs(finalScore) < 30 ? `${originalDirection}与VWAP冲突,降级HOLD` : `${originalDirection}与VWAP冲突,但信号强度>=30,允许覆盖`)
            : '方向与VWAP结构一致',
        };
      }

      // 9. Delta建议（根据得分强度）
      const suggestedDelta = this.calculateSuggestedDelta(finalScore, direction);

      // 10. 入场时机建议
      const entryWindow = this.calculateEntryWindow(
        finalScore,
        intradayScore,
        direction
      );

      // 11. 风险等级评估
      const { riskLevel, riskMetrics } = this.assessRiskLevel(marketData, finalScore);

      // 12. 时间价值衰减因子
      const timeDecayFactor = this.calculateTimeDecayFactor();

      // 13. 生成推理说明
      const reasoning = this.generateReasoning(
        marketScore,
        intradayScore,
        timeWindowAdjustment,
        finalScore,
        direction,
        marketData
      );

      // 14. 构建检查点1数据
      const dataCheck = {
        spxCount: marketData.spx?.length || 0,
        usdCount: marketData.usdIndex?.length || 0,
        btcCount: marketData.btc?.length || 0,
        vixAvailable: !!(marketData.vix && marketData.vix.length > 0),
        temperatureAvailable: marketData.marketTemperature !== undefined,
        underlyingVWAPAvailable: !!underlyingVWAP,
        underlyingKlineCount: underlyingVWAP?.recentKlines?.length || 0,
        spxHourlyCount: marketData.spxHourly?.length || 0,
      };

      // 15. 提取当前VIX值
      const currentVix = (marketData.vix && marketData.vix.length > 0)
        ? marketData.vix[marketData.vix.length - 1].close
        : undefined;

      // 16. 构建VWAP数据摘要
      let vwapData: { vwap: number; lastPrice: number; distancePct: number; priceAboveVWAP: boolean } | null = null;
      if (underlyingVWAP && underlyingVWAP.vwap > 0 && underlyingVWAP.recentKlines?.length > 0) {
        const lastPrice = underlyingVWAP.recentKlines[underlyingVWAP.recentKlines.length - 1].close;
        const distancePct = ((lastPrice - underlyingVWAP.vwap) / underlyingVWAP.vwap) * 100;
        vwapData = {
          vwap: underlyingVWAP.vwap,
          lastPrice,
          distancePct,
          priceAboveVWAP: lastPrice > underlyingVWAP.vwap,
        };
      }

      return {
        direction,
        confidence,
        reasoning,
        marketScore,
        intradayScore,
        finalScore,
        timeWindowScore: timeWindowAdjustment, // Phase 3: 去偏置时间窗口得分
        timeThresholdFactor, // 时间阈值修正系数，供策略层使用
        suggestedDelta,
        entryWindow,
        riskLevel,
        timeDecayFactor,
        dataCheck,
        riskMetrics,
        intradayComponents,
        currentVix,
        vwapData,
        structureCheck: structureCheckResult,
      };
    } catch (error: any) {
      logger.error(`计算期权推荐失败 (${underlyingSymbol}):`, error.message);
      throw error;
    }
  }

  /**
   * 获取当前市场评分（监控大屏专用）
   * 直接复用 calculateOptionRecommendation 的完整计算路径（SPX 作为标的），
   * 确保 finalScore / direction / intradayScore 与策略实际使用的值一致。
   */
  async getCurrentMarketScore(): Promise<MonitorMarketScore> {
    // 直接调用策略使用的完整推荐计算（SPX 作为代理标的）
    const rec = await this.calculateOptionRecommendation('.SPX.US');

    // 补算 marketComponents（rec 里没有，需要单独取）
    const marketData = await marketDataCacheService.getMarketData(100, true);
    let spx5minKlines: CandlestickData[] | null = null;
    try {
      const raw = await marketDataService.getIntraday5minKlines('.SPX.US');
      if (raw) {
        spx5minKlines = raw.map(k => ({
          open: k.open, high: k.high, low: k.low, close: k.close,
          volume: k.volume, turnover: 0, timestamp: k.timestamp,
        }));
      }
    } catch {
      // marketComponents 获取失败不影响核心数据
    }
    const { components: marketComponents } = await this.calculateMarketScore(
      marketData, marketData.spxHourly, spx5minKlines,
      marketData.usdIndexHourly, marketData.btcHourly
    );

    // 市场环境判定（使用与策略一致的 marketScore + intradayScore）
    const regimeResult = marketRegimeDetector.detectRegime(
      rec.marketScore, rec.intradayScore, DEFAULT_SMART_REVERSE_CONFIG
    );
    const regimeLabels: Record<string, string> = {
      MOMENTUM: '趋势行情',
      MEAN_REVERSION: '均值回归',
      UNCERTAIN: '方向不明',
    };

    // 适用策略推荐
    let suitableStrategies: string[] = [];
    if (regimeResult.regime === 'MOMENTUM') {
      if (rec.direction === 'CALL') {
        suitableStrategies = ['单边做多(CALL)', '牛市价差'];
      } else if (rec.direction === 'PUT') {
        suitableStrategies = ['单边做空(PUT)', '熊市价差'];
      } else {
        suitableStrategies = ['等待方向确认'];
      }
    } else if (regimeResult.regime === 'MEAN_REVERSION') {
      suitableStrategies = ['卖出跨式/宽跨式', '铁鹰策略'];
    } else {
      suitableStrategies = ['观望为主', '小仓位跨式买入'];
    }

    // 总分中文解读
    const absFinal = Math.abs(rec.finalScore);
    let scoreLabel: string;
    if (absFinal > 40) {
      scoreLabel = rec.finalScore > 0 ? '强烈看涨' : '强烈看跌';
    } else if (absFinal > 20) {
      scoreLabel = rec.finalScore > 0 ? '温和看涨' : '温和看跌';
    } else {
      scoreLabel = '中性震荡';
    }

    const dynamicThreshold = 15 * this.get0DTETimeThresholdFactor();

    return {
      marketScore: rec.marketScore,
      marketComponents,
      intradayScore: rec.intradayScore,
      timeWindowScore: rec.timeWindowScore ?? 0,
      finalScore: rec.finalScore,
      dynamicThreshold,
      direction: rec.direction,
      confidence: rec.confidence,
      regime: {
        type: regimeResult.regime,
        confidence: regimeResult.confidence,
        label: regimeLabels[regimeResult.regime] || regimeResult.regime,
      },
      suitableStrategies,
      scoreLabel,
      timestamp: Date.now(),
    };
  }

  /**
   * 计算大盘环境得分
   * Phase 3: 日线趋势权重从 40% → 20%，新增 SPX 分钟级趋势 20%
   * 考虑因素：SPX日线趋势(20%) + SPX分钟级趋势(20%) + Gap + USD + BTC + VIX + 温度
   */
  private async calculateMarketScore(
    marketData: any,
    spxHourly?: CandlestickData[] | null,
    spx5minKlines?: CandlestickData[] | null,
    usdHourly?: CandlestickData[] | null,
    btcHourly?: CandlestickData[] | null,
  ): Promise<{ score: number; components: MarketScoreComponents }> {
    let score = 0;
    const logParts: string[] = [];
    const comp: MarketScoreComponents = {
      spxDaily: { raw: 0, weighted: 0 },
      spxMinute: { raw: 0, weighted: 0 },
      gap: { pct: 0, score: 0 },
      usdDaily: { raw: 0, weighted: 0 },
      usdMinute: { raw: 0, weighted: 0 },
      btcDaily: { raw: 0, weighted: 0, resonance: false },
      btcMinute: { raw: 0, weighted: 0 },
      vix: { value: 0, source: '', impact: 0 },
      temperature: { value: 0, impact: 0 },
    };

    // 用分时/时K最新价修正当天日K的close，消除日K缓存延迟
    this.correctDailyCloseWithIntraday(marketData.spx, marketData.spxHourly);
    this.correctDailyCloseWithIntraday(marketData.usdIndex, marketData.usdIndexHourly);
    this.correctDailyCloseWithIntraday(marketData.btc, marketData.btcHourly);

    // 1. SPX日线趋势分析 — Phase 3: 权重从 40% → 20%
    const spxAnalysis = this.analyzeMarketTrendMultiWindow(marketData.spx);
    comp.spxDaily = { raw: spxAnalysis.trendStrength, weighted: spxAnalysis.trendStrength * 0.2 };
    score += comp.spxDaily.weighted;
    logParts.push(`SPX日线${spxAnalysis.trendStrength.toFixed(1)}(${spxAnalysis.windowWeights})*0.2→${comp.spxDaily.weighted.toFixed(1)}`);

    // 1c. SPX 分钟级趋势 — Phase 3: 新增 20% 权重
    const spxMinuteTrend = this.calculateSpxMinuteTrend(spxHourly, spx5minKlines);
    comp.spxMinute = { raw: spxMinuteTrend, weighted: spxMinuteTrend * 0.2 };
    score += comp.spxMinute.weighted;
    logParts.push(`SPX分钟级=${spxMinuteTrend.toFixed(1)}*0.2→${comp.spxMinute.weighted.toFixed(1)}`);

    // 1b. Gap 检测 — Phase 3B: 隔夜信息作为方向补充
    const gapAnalysis = this.calculateGapSignal(marketData.spx);
    comp.gap = { pct: gapAnalysis.gapPct, score: gapAnalysis.gapScore };
    if (gapAnalysis.gapScore !== 0) {
      score += gapAnalysis.gapScore;
      logParts.push(`Gap${gapAnalysis.gapPct > 0 ? '+' : ''}${gapAnalysis.gapPct.toFixed(2)}%→${gapAnalysis.gapScore > 0 ? '+' : ''}${gapAnalysis.gapScore.toFixed(1)}`);
    }

    // 2. USD Index 日线趋势 (权重10%, 反向)
    const usdAnalysis = this.analyzeMarketTrend(marketData.usdIndex, 'USD');
    comp.usdDaily = { raw: usdAnalysis.trendStrength, weighted: -usdAnalysis.trendStrength * 0.1 };
    score += comp.usdDaily.weighted;
    logParts.push(`USD日线${usdAnalysis.trendStrength.toFixed(1)}*-0.1→${comp.usdDaily.weighted.toFixed(1)}`);

    // 2b. USD 分钟级趋势 (权重10%, 反向)
    const usdMinuteTrend = this.calculateMinuteTrend(usdHourly);
    comp.usdMinute = { raw: usdMinuteTrend, weighted: -usdMinuteTrend * 0.1 };
    score += comp.usdMinute.weighted;
    logParts.push(`USD分钟级=${usdMinuteTrend.toFixed(1)}*-0.1→${comp.usdMinute.weighted.toFixed(1)}`);

    // 3. BTC 日线趋势 — 共振5%, 非共振2%
    const btcAnalysis = this.analyzeMarketTrend(marketData.btc, 'BTC');
    const btcCorrelation = this.checkBTCSPXCorrelation(marketData.spx, marketData.btc);
    const btcDayWeight = btcCorrelation > 0.5 ? 0.05 : 0.02;
    comp.btcDaily = { raw: btcAnalysis.trendStrength, weighted: btcAnalysis.trendStrength * btcDayWeight, resonance: btcCorrelation > 0.5 };
    score += comp.btcDaily.weighted;
    logParts.push(`BTC日线${btcAnalysis.trendStrength.toFixed(1)}*${btcDayWeight}${btcCorrelation > 0.5 ? '(共振)' : ''}→${comp.btcDaily.weighted.toFixed(1)}`);

    // 3b. BTC 分钟级趋势 — 共振5%, 非共振3%
    const btcMinuteTrend = this.calculateMinuteTrend(btcHourly);
    const btcMinWeight = btcCorrelation > 0.5 ? 0.05 : 0.03;
    comp.btcMinute = { raw: btcMinuteTrend, weighted: btcMinuteTrend * btcMinWeight };
    score += comp.btcMinute.weighted;
    logParts.push(`BTC分钟级=${btcMinuteTrend.toFixed(1)}*${btcMinWeight}→${comp.btcMinute.weighted.toFixed(1)}`);

    // 4. VIX恐慌指数 — 三级取值：分K缓冲 > 推送报价 > 日K收盘
    let currentVix = 0;
    let vixSource = '';
    if (marketData.vixHourly && marketData.vixHourly.length > 0) {
      currentVix = marketData.vixHourly[marketData.vixHourly.length - 1].close;
      vixSource = '分K';
    } else {
      const vixPrice = quoteSubscriptionService.getPrice('.VIX.US');
      if (vixPrice && vixPrice > 0) {
        currentVix = vixPrice;
        vixSource = '推送';
      } else if (marketData.vix && marketData.vix.length > 0) {
        currentVix = marketData.vix[marketData.vix.length - 1].close;
        vixSource = '日K';
      }
    }
    let vixImpact = 0;
    if (currentVix > 0) {
      if (currentVix > 35) {
        vixImpact = -50;
      } else if (currentVix > 25) {
        vixImpact = -20;
      } else if (currentVix < 15) {
        vixImpact = 10;
      }
      score += vixImpact;
      if (vixImpact !== 0) {
        logParts.push(`VIX=${currentVix.toFixed(1)}(${vixSource})→${vixImpact > 0 ? '+' : ''}${vixImpact}`);
      } else {
        logParts.push(`VIX=${currentVix.toFixed(1)}(${vixSource})`);
      }
    }
    comp.vix = { value: currentVix, source: vixSource, impact: vixImpact };

    // 5. 市场温度 (权重10%)
    let tempValue = 0;
    let tempImpact = 0;
    if (marketData.marketTemperature) {
      if (typeof marketData.marketTemperature === 'number') {
        tempValue = marketData.marketTemperature;
      } else if (marketData.marketTemperature.value) {
        tempValue = marketData.marketTemperature.value;
      } else if (marketData.marketTemperature.temperature) {
        tempValue = marketData.marketTemperature.temperature;
      }

      if (tempValue > 50) {
        const tempCoeff = tempValue >= 65 ? 0.5 : 0.3;
        tempImpact = (tempValue - 50) * tempCoeff;
        score += tempImpact;
        logParts.push(`温度=${tempValue.toFixed(0)}(coeff=${tempCoeff})→+${tempImpact.toFixed(1)}`);
      } else if (tempValue < 20) {
        tempImpact = -(20 - tempValue) * 0.5;
        score += tempImpact;
        logParts.push(`温度=${tempValue.toFixed(0)}→${tempImpact.toFixed(1)}`);
      }
    }
    comp.temperature = { value: tempValue, impact: tempImpact };

    const finalMarketScore = Math.max(-100, Math.min(100, score));
    logger.info(`[大盘评分明细] 总分=${finalMarketScore.toFixed(1)} | ${logParts.join(' | ')}`);

    return { score: finalMarketScore, components: comp };
  }

  /**
   * 用分时K线最新价修正日K当天最后一根bar的close
   * 解决日K数据缓存延迟导致趋势计算滞后的问题
   */
  private correctDailyCloseWithIntraday(
    dailyBars: CandlestickData[] | undefined,
    intradayBars: CandlestickData[] | undefined
  ): void {
    if (!dailyBars || dailyBars.length === 0) return;
    if (!intradayBars || intradayBars.length === 0) return;

    const latestIntraday = intradayBars[intradayBars.length - 1];
    const lastDaily = dailyBars[dailyBars.length - 1];

    // 仅当分时数据比日K更新时才修正
    if (latestIntraday.timestamp >= lastDaily.timestamp) {
      lastDaily.close = latestIntraday.close;
      // 同步更新 high/low（如果分时突破了日K范围）
      if (latestIntraday.high > lastDaily.high) {
        lastDaily.high = latestIntraday.high;
      }
      if (latestIntraday.low < lastDaily.low) {
        lastDaily.low = latestIntraday.low;
      }
    }
  }

  /**
   * 计算分时动量得分 — Phase 3 重构
   * 内部权重（恢复后的 60% 总权重内）：
   *   底层1min VW动量: 30%  (原 45%)
   *   5min趋势确认:    15%  (新增)
   *   VWAP位置:        15%  (原 20%)
   *   SPX分时:         25%  (原 35%)
   *   BTC/USD时K:      15%  (恢复，原 0%，降噪但不归零)
   */
  private async calculateIntradayScore(
    marketData: any,
    underlyingSymbol: string,
    underlyingVWAP?: { vwap: number; dataPoints: number; rangePct: number; recentKlines: CandlestickData[] } | null,
    spxHourly?: CandlestickData[] | null,
    underlying5minKlines?: CandlestickData[] | null
  ): Promise<{ score: number; components: { underlyingMomentum: number; vwapPosition: number; spxIntraday: number; btcHourly: number; usdHourly: number } }> {
    let score = 0;
    const logParts: string[] = [];
    const componentScores = {
      underlyingMomentum: 0,
      vwapPosition: 0,
      spxIntraday: 0,
      btcHourly: 0,
      usdHourly: 0,
    };

    // Phase 3 权重分配: 底层1min VW 30% + 5min确认 15% + VWAP 15% + SPX日内 25% + BTC/USD 15%

    // 1. Underlying 1m volume-weighted momentum (30%)
    // Phase 3: 标的 K 线也过 intradayDataFilterService + 最低 15 根
    let underlying1mMomentum = 0;
    if (underlyingVWAP?.recentKlines && underlyingVWAP.recentKlines.length >= 15) {
      const filteredUnderlying = intradayDataFilterService.filterData(underlyingVWAP.recentKlines);
      if (filteredUnderlying.length >= 15) {
        underlying1mMomentum = this.calculateMomentum(filteredUnderlying);
        const weighted = underlying1mMomentum * 0.30;
        componentScores.underlyingMomentum = weighted;
        score += weighted;
        logParts.push(`底层1mVW=${underlying1mMomentum.toFixed(1)}*0.30→${weighted.toFixed(1)}`);
      } else {
        logParts.push(`底层1mVW=N/A(过滤后${filteredUnderlying.length}根<15)`);
      }
    } else {
      logParts.push(`底层1mVW=N/A(K线${underlyingVWAP?.recentKlines?.length || 0}根<15)`);
    }

    // 2. 5min 趋势确认 (15%) — Phase 3 新增
    if (underlying5minKlines && underlying5minKlines.length >= 15) {
      const trendConfirmation = this.calculate5minTrendConfirmation(
        underlying5minKlines,
        underlying1mMomentum
      );
      const weighted = trendConfirmation * 0.15;
      score += weighted;
      logParts.push(`5min确认=${trendConfirmation.toFixed(1)}*0.15→${weighted.toFixed(1)}`);
    } else {
      logParts.push(`5min确认=N/A(${underlying5minKlines?.length || 0}根<15)`);
    }

    // 3. VWAP position score (15%)
    if (underlyingVWAP && underlyingVWAP.vwap > 0 && underlyingVWAP.recentKlines?.length > 0) {
      const lastPrice = underlyingVWAP.recentKlines[underlyingVWAP.recentKlines.length - 1].close;
      const distancePct = ((lastPrice - underlyingVWAP.vwap) / underlyingVWAP.vwap) * 100;
      const rawScore = Math.max(-100, Math.min(100, distancePct * 50)); // 2%偏离才饱和
      const weighted = rawScore * 0.15;
      componentScores.vwapPosition = weighted;
      score += weighted;
      logParts.push(`VWAP位置=${distancePct.toFixed(3)}%→raw${rawScore.toFixed(1)}*0.15→${weighted.toFixed(1)}`);
    } else {
      logParts.push(`VWAP位置=N/A`);
    }

    // 4. SPX intraday momentum (25%)
    if (spxHourly && spxHourly.length >= 15) {
      const filteredSPXHourly = intradayDataFilterService.filterData(spxHourly);
      if (filteredSPXHourly.length >= 15) {
        const spxMomentum = this.calculateMomentum(filteredSPXHourly);
        const weighted = spxMomentum * 0.25;
        componentScores.spxIntraday = weighted;
        score += weighted;
        logParts.push(`SPX日内=${spxMomentum.toFixed(1)}*0.25→${weighted.toFixed(1)}`);
      } else {
        logParts.push(`SPX日内=N/A(过滤后${filteredSPXHourly.length}根<15)`);
      }
    } else {
      logParts.push(`SPX日内=N/A(${spxHourly?.length || 0}根<15)`);
    }

    // 5. BTC/USD hourly momentum — Phase 3: 恢复 15% 权重（降噪但不归零）
    // BTC 10% + USD 5%（反向），合计 15%
    if (marketData.btcHourly && marketData.btcHourly.length >= 15) {
      const filteredBTCHourly = intradayDataFilterService.filterData(
        marketData.btcHourly
      );
      const btcHourlyMomentum = this.calculateMomentum(filteredBTCHourly);
      const btcWeighted = btcHourlyMomentum * 0.10;
      componentScores.btcHourly = btcWeighted;
      score += btcWeighted;
      logParts.push(`BTC时K=${btcHourlyMomentum.toFixed(1)}*0.10→${btcWeighted.toFixed(1)}`);
    } else {
      logParts.push(`BTC时K=N/A`);
    }

    if (marketData.usdIndexHourly && marketData.usdIndexHourly.length >= 15) {
      const filteredUSDHourly = intradayDataFilterService.filterData(
        marketData.usdIndexHourly
      );
      const usdHourlyMomentum = this.calculateMomentum(filteredUSDHourly);
      const usdWeighted = -usdHourlyMomentum * 0.05; // USD 反向
      componentScores.usdHourly = usdWeighted;
      score += usdWeighted;
      logParts.push(`USD时K=${usdHourlyMomentum.toFixed(1)}*-0.05→${usdWeighted.toFixed(1)}`);
    } else {
      logParts.push(`USD时K=N/A`);
    }

    const finalIntradayScore = Math.max(-100, Math.min(100, score));
    logger.info(`[${underlyingSymbol}分时评分明细] 总分=${finalIntradayScore.toFixed(1)} | ${logParts.join(' | ')}`);

    return { score: finalIntradayScore, components: componentScores };
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
    let trendStrength = ((currentPrice - avg20) / avg20) * 100 * 5; // 放大5倍（从10倍降低，避免微小偏差被过度放大）

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
   * Phase 3B: 多窗口趋势分析（仅用于SPX）
   * 3d/10d/20d 窗口加权 — 权重由趋势一致性动态决定
   * 所有窗口同向 → 长期权重高（强趋势确认）
   * 短期与长期反向 → 短期权重高（可能是转折点）
   */
  private analyzeMarketTrendMultiWindow(
    data: CandlestickData[]
  ): { trendStrength: number; trend: string; windowWeights: string } {
    if (!data || data.length < 20) {
      return { trendStrength: 0, trend: '数据不足', windowWeights: 'N/A' };
    }

    const currentPrice = data[data.length - 1].close;

    // 计算三个时间窗口的趋势
    const avg3 = data.slice(-3).reduce((s, d) => s + d.close, 0) / Math.min(3, data.length);
    const avg10 = data.slice(-10).reduce((s, d) => s + d.close, 0) / Math.min(10, data.length);
    const avg20 = data.slice(-20).reduce((s, d) => s + d.close, 0) / Math.min(20, data.length);

    const trend3d = ((currentPrice - avg3) / avg3) * 100;
    const trend10d = ((currentPrice - avg10) / avg10) * 100;
    const trend20d = ((currentPrice - avg20) / avg20) * 100;

    // 权重由趋势一致性决定
    let weights: { d3: number; d10: number; d20: number };
    const sign3 = Math.sign(trend3d);
    const sign10 = Math.sign(trend10d);
    const sign20 = Math.sign(trend20d);

    if (sign3 === sign10 && sign10 === sign20 && sign3 !== 0) {
      // 所有窗口同向 → 强趋势 → 中长期权重高
      weights = { d3: 0.3, d10: 0.4, d20: 0.3 };
    } else if (sign3 !== sign20 && sign3 !== 0 && sign20 !== 0) {
      // 短期与长期反向 → 转折点 → 短期权重高
      weights = { d3: 0.7, d10: 0.2, d20: 0.1 };
    } else {
      // 混合状态
      weights = { d3: 0.5, d10: 0.3, d20: 0.2 };
    }

    // 硬限: 短期窗口最大 0.8, 长期最小 0.05
    weights.d3 = Math.min(0.8, weights.d3);
    weights.d20 = Math.max(0.05, weights.d20);

    const trendScore = trend3d * weights.d3 + trend10d * weights.d10 + trend20d * weights.d20;

    // 放大5倍（与原 analyzeMarketTrend 尺度一致）+ 短期趋势加成
    let trendStrength = trendScore * 5;
    if (currentPrice > avg10 && avg10 > avg20) {
      trendStrength += 20;
    } else if (currentPrice < avg10 && avg10 < avg20) {
      trendStrength -= 20;
    }

    trendStrength = Math.max(-100, Math.min(100, trendStrength));

    let trend = '盘整';
    if (trendStrength > 20) trend = '强势上涨';
    else if (trendStrength > 5) trend = '上涨';
    else if (trendStrength < -20) trend = '强势下跌';
    else if (trendStrength < -5) trend = '下跌';

    const windowWeights = `d3=${weights.d3}|d10=${weights.d10}|d20=${weights.d20}`;
    return { trendStrength, trend, windowWeights };
  }

  /**
   * Phase 3B: Gap 信号检测
   * 隔夜跳空作为方向补充信号
   * gapPct > +0.5% → 多头信号 | gapPct < -0.5% → 空头信号
   */
  private calculateGapSignal(
    dailyData: CandlestickData[]
  ): { gapPct: number; gapScore: number } {
    if (!dailyData || dailyData.length < 2) {
      return { gapPct: 0, gapScore: 0 };
    }

    const today = dailyData[dailyData.length - 1];
    const prevDay = dailyData[dailyData.length - 2];
    const gapPct = ((today.open - prevDay.close) / prevDay.close) * 100;

    // 只有显著跳空才产生信号（±0.3% 以上）
    if (Math.abs(gapPct) < 0.3) {
      return { gapPct, gapScore: 0 };
    }

    // Gap 信号强度: 线性映射，0.3%→2分，1%→8分，2%→15分，封顶±15
    const gapScore = Math.max(-15, Math.min(15, gapPct * 8));
    return { gapPct, gapScore };
  }

  /**
   * Phase 3: 5min 趋势确认
   * 计算 5min 级别的 volume-weighted momentum + 趋势方向
   * 当 1min 和 5min 方向不一致时，降低信号置信度
   *
   * @param klines5min 5分钟 K 线（至少 10 根）
   * @param momentum1min 1 分钟 momentum（用于方向一致性检查）
   * @returns 趋势确认分数 (-100 ~ +100)
   */
  private calculate5minTrendConfirmation(
    klines5min: CandlestickData[],
    momentum1min: number
  ): number {
    if (!klines5min || klines5min.length < 15) return 0;

    // 1. 计算 5min 级别的 volume-weighted momentum
    const fiveMinMomentum = this.calculateMomentum(klines5min);

    // 2. 方向一致性检查
    const sign1m = Math.sign(momentum1min);
    const sign5m = Math.sign(fiveMinMomentum);

    if (sign1m !== 0 && sign5m !== 0 && sign1m !== sign5m) {
      // 1min 和 5min 方向不一致 → 衰减系数 0.5-0.7
      // 分歧越大衰减越多
      const divergence = Math.abs(momentum1min - fiveMinMomentum);
      const decayFactor = divergence > 50 ? 0.5 : 0.7;
      const dampened = fiveMinMomentum * decayFactor;
      logger.debug(
        `[5min趋势确认] 方向分歧: 1m=${momentum1min.toFixed(1)} vs 5m=${fiveMinMomentum.toFixed(1)}, 衰减=${decayFactor}→${dampened.toFixed(1)}`
      );
      return dampened;
    }

    // 方向一致 → 直接使用 5min momentum 作为确认分数
    return fiveMinMomentum;
  }

  /**
   * Phase 3: SPX 分钟级趋势
   * 使用 SPX 1min/5min K 线计算分钟级方向
   * 权重: 1min 40% + 5min 60%（5min 更稳定）
   *
   * @param spxHourly SPX 分时 K 线（实际是 1min 数据）
   * @param spx5min SPX 5min K 线
   * @returns 趋势分数 (-100 ~ +100)
   */
  private calculateSpxMinuteTrend(
    spxHourly?: CandlestickData[] | null,
    spx5min?: CandlestickData[] | null
  ): number {
    let momentum1m = 0;
    let momentum5m = 0;
    let has1m = false;
    let has5m = false;

    // 1min 趋势
    if (spxHourly && spxHourly.length >= 15) {
      const filtered = intradayDataFilterService.filterData(spxHourly);
      if (filtered.length >= 15) {
        momentum1m = this.calculateMomentum(filtered);
        has1m = true;
      }
    }

    // 5min 趋势
    if (spx5min && spx5min.length >= 15) {
      const filtered5m = intradayDataFilterService.filterData(spx5min);
      if (filtered5m.length >= 15) {
        momentum5m = this.calculateMomentum(filtered5m);
        has5m = true;
      }
    }

    // 混合: 1min 40% + 5min 60%
    if (has1m && has5m) {
      return Math.max(-100, Math.min(100, momentum1m * 0.4 + momentum5m * 0.6));
    } else if (has5m) {
      return momentum5m;
    } else if (has1m) {
      return momentum1m;
    }
    return 0;
  }

  /**
   * 通用分钟级趋势计算（用于 USD/BTC 等）
   * 只使用 1min K 线计算 VW 动量，过滤后最低 15 根
   */
  private calculateMinuteTrend(hourlyData?: CandlestickData[] | null): number {
    if (!hourlyData || hourlyData.length < 15) return 0;
    const filtered = intradayDataFilterService.filterData(hourlyData);
    if (filtered.length < 15) return 0;
    return Math.max(-100, Math.min(100, this.calculateMomentum(filtered)));
  }

  /**
   * 计算动量 — Phase 3: Volume-Weighted + ATR归一化
   * vwChanges = Σ((close[i] - close[i-1]) / close[i-1] * volume[i]) / Σ(volume[i])
   * momentum = (vwChanges / atrPct) * 50
   * 使用全部可用 K 线（不再 slice），最低数据要求从 5 根提高到 15 根
   */
  private calculateMomentum(data: CandlestickData[]): number {
    if (!data || data.length < 15) return 0;

    // 1. 计算ATR（Average True Range）作为归一化基准
    const trueRanges: number[] = [];
    for (let i = 1; i < data.length; i++) {
      const high = data[i].high;
      const low = data[i].low;
      const prevClose = data[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trueRanges.push(tr);
    }
    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
    const currentPrice = data[data.length - 1].close;
    const atrPct = currentPrice > 0 ? atr / currentPrice : 0;

    // 2. Volume-weighted 价格变化率（使用全部可用 K 线）
    let sumWeightedChange = 0;
    let sumVolume = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i - 1].close <= 0) continue;
      const change = (data[i].close - data[i - 1].close) / data[i - 1].close;
      const vol = data[i].volume > 0 ? data[i].volume : 1; // 防零除
      sumWeightedChange += change * vol;
      sumVolume += vol;
    }
    const vwChange = sumVolume > 0 ? sumWeightedChange / sumVolume : 0;

    // 3. ATR归一化: vwChange / atrPct，乘以50覆盖 ±100 范围
    let momentum: number;
    if (atrPct > 0) {
      momentum = (vwChange / atrPct) * 50;
    } else {
      momentum = vwChange * 1000; // ATR为0时降级
    }
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

  /** 获取当前美东时间的分钟数（自动处理 EST/EDT 夏令时） */
  private getETMinutes(): number {
    const now = new Date();
    const etFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const etParts = etFormatter.formatToParts(now);
    const etHour = parseInt(etParts.find(p => p.type === 'hour')?.value || '0');
    const etMinute = parseInt(etParts.find(p => p.type === 'minute')?.value || '0');
    return etHour * 60 + etMinute;
  }

  /**
   * 计算时间窗口调整 — Phase 3: 去偏置版本
   * 原版有方向偏置（开盘 +20 = CALL偏向）。恢复时去除偏置，确保中性。
   * 输出范围 -100 ~ +100，仅反映时间衰减对信号可靠性的影响：
   *   正值 = 交易时段好（不偏向任何方向，仅表示时间窗口有利于开仓）
   *   负值 = 时间不利（尾盘衰减，应该提高入场门槛而非偏向方向）
   *   0 = 中性
   */
  private calculateTimeWindowAdjustment(): number {
    const etMinutes = this.getETMinutes();

    // 9:30 = 570分钟，16:00 = 960分钟
    const marketOpen = 570;
    const marketClose = 960;
    const forceCloseTime = marketClose - 30; // 15:30

    // Phase 3 去偏置: 所有值都是对称的（不含方向偏置）
    // 正值表示"时间条件好，可以放宽信号"，负值表示"时间不利，应收紧信号"
    if (etMinutes < marketOpen || etMinutes > marketClose) {
      return 0; // 盘外中性
    }

    if (etMinutes < marketOpen + 30) {
      // 开盘前30分钟：波动大但流动性好，轻微正向（对称：不偏多也不偏空）
      return 10;
    } else if (etMinutes < marketOpen + 60) {
      // 开盘30-60分钟：最佳交易窗口
      return 5;
    } else if (etMinutes > forceCloseTime) {
      // 收盘前30分钟：时间价值急速衰减，强烈负向
      return -50;
    } else if (etMinutes > forceCloseTime - 60) {
      // 收盘前90-30分钟：时间价值衰减加速
      return -30;
    } else if (etMinutes > marketOpen + 120) {
      // 开盘后2小时以上：时间价值正常衰减
      return -10;
    }

    return 0; // 开盘1-2小时：中性
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
    const etMinutes = this.getETMinutes();

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

  /**
   * Phase 3B: 策略层时间阈值修正系数
   * 替代 timeWindowAdjustment 的方向偏置，改为对称性阈值调整
   * 开盘第1小时: 0.85（降低阈值更容易入场，但不偏向任何方向）
   * 正常时段: 1.0
   * 尾盘: 递增（更难入场，与 get0DTETimeThresholdFactor 合并）
   */
  private getTimeThresholdFactor(): number {
    const etMinutes = this.getETMinutes();
    const marketOpen = 570; // 9:30
    const firstHourEnd = marketOpen + 60; // 10:30
    const midDay = 12 * 60;
    const afternoon = 14 * 60;
    const lateAfternoon = 15 * 60;
    const finalWindow = 15 * 60 + 30;

    if (etMinutes < firstHourEnd) {
      return 0.85; // 开盘第1小时：降低阈值但不偏向方向
    } else if (etMinutes <= midDay) {
      return 1.0;
    } else if (etMinutes <= afternoon) {
      const progress = (etMinutes - midDay) / (afternoon - midDay);
      return 1.0 + progress * 0.3;
    } else if (etMinutes <= lateAfternoon) {
      const progress = (etMinutes - afternoon) / (lateAfternoon - afternoon);
      return 1.3 + progress * 0.5;
    } else if (etMinutes <= finalWindow) {
      const progress = (etMinutes - lateAfternoon) / (finalWindow - lateAfternoon);
      return 1.8 + progress * 0.7;
    } else {
      return 3.0;
    }
  }

  /**
   * 0DTE 尾盘阈值递增因子（推荐层使用，与 getTimeThresholdFactor 对齐）
   */
  private get0DTETimeThresholdFactor(): number {
    return this.getTimeThresholdFactor();
  }
}

export default new OptionRecommendationService();
