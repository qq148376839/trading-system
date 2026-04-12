/**
 * 正股趋势评分引擎
 * 评分模型: 趋势分(40%) + 动量分(30%) + 环境分(30%) = 百分制
 *
 * 趋势分: Robin 核心 — MA系统(20) + 52W高点(10) + SPX一致性(10)
 * 动量分: RS排名(15) + 成交量确认(10) + Gap信号(5)
 * 环境分: 复用期权策略已验证信号 — VIX(10) + BTC(5) + USD(5) + 温度(10)
 */

import marketDataService from './market-data.service';
import optionRecommendationService from './option-recommendation.service';
import { calculateATR } from '../utils/technical-indicators';
import { getLatestSMA } from '../utils/ema';
import { StandardCandlestickData } from '../utils/candlestick-formatter';
import { logger } from '../utils/logger';

// === 接口定义 ===

export interface TrendFollowingScore {
  totalScore: number;         // 百分制总分 (0-100)
  trendScore: number;         // 趋势分 (0-40)
  momentumScore: number;      // 动量分 (0-30)
  envScore: number;           // 环境分 (0-30)
  effectiveThreshold: number; // VIX 调整后的入场阈值
  atr: number;                // 14日 ATR (入场时传给 context)
  ma50: number | null;
  ma200: number | null;
  details: {
    currentPrice: number;
    maScore: number;
    highScore: number;
    spxConsistencyScore: number;
    rsScore: number;
    rsRank: number;
    volumeScore: number;
    gapScore: number;         // SPX gap 评分分量
    stockGapPct: number;      // 个股跳空百分比 (入场过滤用)
    chopDetected: boolean;
    chopDeviation: number;
  };
}

export interface TrendFollowingConfig {
  maFastPeriod: number;
  maSlowPeriod: number;
  weekHigh52Threshold: number;
  rsLookbackDays: number;
  volumeConfirmMultiple: number;
  atrPeriod: number;
  atrTrailingMultiple: number;
  atrTightenMultiple: number;
  maxConcurrentPositions: number;
  maxConcentration: number;
  leveragedEtfMaxConcentration: number;
  leveragedEtfMaxDays: number;
  dailyLossLimitPct: number;
  entryScoreThreshold: number;
  absoluteScoreFloor: number;
  maxGapUpPct: number;
  chopThreshold: number;
  weights?: {
    trend: number;
    momentum: number;
    environment: number;
  };
}

export const DEFAULT_TREND_FOLLOWING_CONFIG: TrendFollowingConfig = {
  maFastPeriod: 50,
  maSlowPeriod: 200,
  weekHigh52Threshold: 85,
  rsLookbackDays: 20,
  volumeConfirmMultiple: 1.5,
  atrPeriod: 14,
  atrTrailingMultiple: 2.0,
  atrTightenMultiple: 1.0,
  maxConcurrentPositions: 5,
  maxConcentration: 0.15,
  leveragedEtfMaxConcentration: 0.10,
  leveragedEtfMaxDays: 5,
  dailyLossLimitPct: 2,
  entryScoreThreshold: 65,
  absoluteScoreFloor: 45,
  maxGapUpPct: 2,
  chopThreshold: 0.5,
};

// 杠杆 ETF 列表
export const LEVERAGED_ETFS = ['TQQQ.US', 'SQQQ.US', 'SPXL.US', 'SPXS.US'];

// === 缓存 ===

// 个股 OHLCV: per-symbol Map, 5 分钟 TTL (日线数据日内不变)
const ohlcvCache = new Map<string, { data: StandardCandlestickData[]; timestamp: number }>();
const OHLCV_CACHE_TTL = 5 * 60 * 1000;

// SPX 日线: per-cycle, 5 分钟 TTL
let spxCache: { closes: number[]; timestamp: number } | null = null;
const SPX_CACHE_TTL = 5 * 60 * 1000;

class StockTrendRecommendationService {

  private config: TrendFollowingConfig = { ...DEFAULT_TREND_FOLLOWING_CONFIG };

  updateConfig(config: Partial<TrendFollowingConfig>): void {
    this.config = { ...DEFAULT_TREND_FOLLOWING_CONFIG, ...config };
  }

  // === 缓存层 ===

  private async getCachedOHLCV(symbol: string, count: number): Promise<StandardCandlestickData[]> {
    const cached = ohlcvCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < OHLCV_CACHE_TTL && cached.data.length >= count) {
      return cached.data;
    }
    const data = await marketDataService.getDailyOHLCV(symbol, count);
    if (data.length > 0) {
      ohlcvCache.set(symbol, { data, timestamp: Date.now() });
    }
    return data;
  }

  private async getCachedSPXCloses(count: number): Promise<number[]> {
    if (spxCache && Date.now() - spxCache.timestamp < SPX_CACHE_TTL && spxCache.closes.length >= count) {
      return spxCache.closes;
    }
    const spxData = await marketDataService.getSPXCandlesticks(count);
    const closes = spxData.map((d: any) => Number(d.close));
    if (closes.length > 0) {
      spxCache = { closes, timestamp: Date.now() };
    }
    return closes;
  }

  // === 趋势分 (0-40) ===

  /**
   * MA50/MA200 位置关系 (0-20)
   */
  private calculateMAScore(
    closes: number[], fastPeriod: number, slowPeriod: number
  ): { score: number; ma50: number | null; ma200: number | null } {
    const ma50 = getLatestSMA(closes, fastPeriod);
    const ma200 = getLatestSMA(closes, slowPeriod);
    const price = closes[closes.length - 1];

    if (ma50 === null || ma200 === null) {
      return { score: 0, ma50, ma200 };
    }

    let score = 0;
    if (price > ma50 && ma50 > ma200) score = 20;       // 多头排列
    else if (price > ma50 && ma50 <= ma200) score = 10;  // 价在 MA50 上但未金叉
    else if (price > ma200 && price <= ma50) score = 5;   // 回踩区间
    // else 0: 空头排列

    return { score, ma50, ma200 };
  }

  /**
   * 52 周高点距离 (0-10)
   */
  private calculate52WHighScore(dailyData: StandardCandlestickData[], currentPrice: number): number {
    if (dailyData.length < 20) return 0;

    const high52w = Math.max(...dailyData.map(d => d.high));
    if (high52w <= 0) return 0;
    const distancePct = (currentPrice / high52w) * 100;

    if (distancePct >= 95) return 10;
    if (distancePct >= 90) return 8;
    if (distancePct >= 85) return 5;
    if (distancePct >= 75) return 2;
    return 0;
  }

  /**
   * SPX 多窗口一致性 (0-10)
   * 复用 optionRecommendation 中 SPX 日线趋势评分
   */
  private calculateSPXConsistencyScore(marketScore: any): number {
    const spxRaw = marketScore?.marketComponents?.spxDaily?.raw ?? 0;
    // -100~+100 归一化到 0-10
    return Math.max(0, Math.min(10, (spxRaw + 100) / 20));
  }

  // === 动量分 (0-30) ===

  /**
   * 相对强度 RS 排名 (0-15)
   */
  private calculateRSScoreByRank(rank: number): number {
    if (rank <= 3) return 15;
    if (rank <= 5) return 12;
    if (rank <= 10) return 8;
    return 3;
  }

  /**
   * 成交量确认 (0-10)
   */
  private calculateVolumeScore(volumes: number[]): number {
    if (volumes.length < 21) return 5; // 数据不足给中间分
    const recent20 = volumes.slice(-21, -1);
    const avgVolume = recent20.reduce((a, b) => a + b, 0) / recent20.length;
    if (avgVolume <= 0) return 5;

    const todayVolume = volumes[volumes.length - 1];
    const ratio = todayVolume / avgVolume;

    if (ratio >= 2.0) return 10;
    if (ratio >= 1.5) return 8;
    if (ratio >= 1.0) return 5;
    return 2;
  }

  /**
   * Gap 信号 (0-5) — 复用 optionRecommendation 的 SPX Gap
   */
  private calculateGapScore(marketScore: any): number {
    const gapRawScore = marketScore?.marketComponents?.gap?.score ?? 0;
    // -15~+15 归一化到 0-5
    return Math.max(0, Math.min(5, (gapRawScore + 15) / 6));
  }

  /**
   * 个股跳空百分比 (入场过滤用，不参与评分)
   */
  private calculateStockGapPct(dailyData: StandardCandlestickData[]): number {
    if (dailyData.length < 2) return 0;
    const today = dailyData[dailyData.length - 1];
    const prevDay = dailyData[dailyData.length - 2];
    if (prevDay.close <= 0) return 0;
    return ((today.open - prevDay.close) / prevDay.close) * 100;
  }

  // === 环境分 (0-30) ===

  private calculateEnvironmentScore(marketScore: any): number {
    const comp = marketScore?.marketComponents;
    if (!comp) return 15; // 无数据给中间分

    // VIX (0-10): impact -100~+100
    const vixImpact = comp.vix?.impact ?? 0;
    const vixScore = Math.max(0, Math.min(10, (vixImpact + 100) / 20));

    // BTC (0-5): raw -100~+100
    const btcRaw = comp.btcDaily?.raw ?? 0;
    const btcScore = Math.max(0, Math.min(5, (btcRaw + 100) / 40));

    // USD (0-5): raw -100~+100, 逆相关 — 美元走强对股票不利
    const usdRaw = comp.usdDaily?.raw ?? 0;
    const usdScore = Math.max(0, Math.min(5, (-usdRaw + 100) / 40));

    // 市场温度 (0-10): value 0~100
    const tempValue = comp.temperature?.value ?? 50;
    const tempScore = Math.max(0, Math.min(10, tempValue / 10));

    return vixScore + btcScore + usdScore + tempScore;
  }

  // === CHOP 震荡检测 ===

  private detectChop(closes: number[], threshold: number): { isChop: boolean; deviation: number } {
    const ma10 = getLatestSMA(closes, 10);
    const ma20 = getLatestSMA(closes, 20);

    if (ma10 === null || ma20 === null || ma20 === 0) {
      return { isChop: false, deviation: 0 }; // 数据不足默认放行
    }

    const deviation = Math.abs(ma10 - ma20) / ma20 * 100;
    return { isChop: deviation < threshold, deviation };
  }

  // === 动态阈值 ===

  private calculateDynamicThreshold(marketScore: any, config: TrendFollowingConfig): number {
    const vixValue = marketScore?.marketComponents?.vix?.value ?? 20;

    let vixFactor = 1.0;
    if (vixValue < 15) vixFactor = 0.9;
    else if (vixValue <= 20) vixFactor = 1.0;
    else if (vixValue <= 25) vixFactor = 1.1;
    else if (vixValue <= 30) vixFactor = 1.3;
    else vixFactor = 1.5;

    return Math.max(config.absoluteScoreFloor, config.entryScoreThreshold * vixFactor);
  }

  // === 综合评估 ===

  /**
   * 评估单个标的
   * @param rsRank RS 排名 (1-based), 由 batchEvaluate 跨标的计算后注入
   */
  async evaluateSymbol(
    symbol: string,
    config: TrendFollowingConfig = this.config,
    rsRank: number = 10
  ): Promise<TrendFollowingScore | null> {
    try {
      // 1. 日线 OHLCV (5min 缓存)
      const neededCount = Math.max(252, config.maSlowPeriod + 10);
      const dailyData = await this.getCachedOHLCV(symbol, neededCount);
      if (dailyData.length < config.maFastPeriod) {
        logger.warn(`[TREND] ${symbol} 日线数据不足: ${dailyData.length} < ${config.maFastPeriod}`);
        return null;
      }

      const closes = dailyData.map(d => d.close);
      const currentPrice = closes[closes.length - 1];

      // 2. 环境评分 (复用 optionRecommendation 动态缓存)
      let marketScore: any = null;
      try {
        marketScore = await optionRecommendationService.getCurrentMarketScore();
      } catch {
        logger.warn('[TREND] 环境评分获取失败, 使用中性值');
      }

      // 3. 趋势分 (0-40)
      const maResult = this.calculateMAScore(closes, config.maFastPeriod, config.maSlowPeriod);
      const highScore = this.calculate52WHighScore(dailyData, currentPrice);
      const spxConsistencyScore = this.calculateSPXConsistencyScore(marketScore);
      const trendScore = maResult.score + highScore + spxConsistencyScore;

      // 4. 动量分 (0-30)
      const rsScore = this.calculateRSScoreByRank(rsRank);
      const volumes = dailyData.map(d => d.volume);
      const volumeScore = this.calculateVolumeScore(volumes);
      const gapScore = this.calculateGapScore(marketScore);
      const momentumScore = rsScore + volumeScore + gapScore;

      // 5. 环境分 (0-30)
      const envScore = this.calculateEnvironmentScore(marketScore);

      // 6. 总分 (0-100)
      const totalScore = trendScore + momentumScore + envScore;

      // 7. CHOP (内联，复用已拉取的 closes)
      const chopResult = this.detectChop(closes, config.chopThreshold);

      // 8. 动态阈值
      const effectiveThreshold = this.calculateDynamicThreshold(marketScore, config);

      // 9. ATR
      const atr = dailyData.length >= config.atrPeriod
        ? calculateATR(
            dailyData.map(d => ({ open: d.open, high: d.high, low: d.low, close: d.close })),
            config.atrPeriod
          )
        : 0;

      // 10. 个股跳空 (入场过滤)
      const stockGapPct = this.calculateStockGapPct(dailyData);

      return {
        totalScore,
        trendScore,
        momentumScore,
        envScore,
        effectiveThreshold,
        atr,
        ma50: maResult.ma50,
        ma200: maResult.ma200,
        details: {
          currentPrice,
          maScore: maResult.score,
          highScore,
          spxConsistencyScore,
          rsScore,
          rsRank,
          volumeScore,
          gapScore,
          stockGapPct,
          chopDetected: chopResult.isChop,
          chopDeviation: chopResult.deviation,
        },
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[TREND] 评估 ${symbol} 失败:`, errMsg);
      return null;
    }
  }

  /**
   * 批量评估: 先收集超额收益率 → RS 排名 → 完整评分
   */
  async batchEvaluate(
    symbols: string[],
    config: TrendFollowingConfig = this.config
  ): Promise<Map<string, TrendFollowingScore>> {
    const results = new Map<string, TrendFollowingScore>();
    if (symbols.length === 0) return results;

    // Phase 1: 预拉取 SPX + 各标的数据, 计算超额收益率
    const spxCloses = await this.getCachedSPXCloses(config.rsLookbackDays + 5);
    let spxReturn = 0;
    if (spxCloses.length > config.rsLookbackDays) {
      const spxCurr = spxCloses[spxCloses.length - 1];
      const spxPast = spxCloses[spxCloses.length - 1 - config.rsLookbackDays];
      if (spxPast > 0) spxReturn = (spxCurr - spxPast) / spxPast;
    }

    const returnData: { symbol: string; excessReturn: number }[] = [];
    const neededCount = Math.max(252, config.maSlowPeriod + 10);

    for (const symbol of symbols) {
      const dailyData = await this.getCachedOHLCV(symbol, neededCount);
      if (dailyData.length <= config.rsLookbackDays) continue;

      const closes = dailyData.map(d => d.close);
      const curr = closes[closes.length - 1];
      const past = closes[closes.length - 1 - config.rsLookbackDays];
      if (past > 0) {
        const symbolReturn = (curr - past) / past;
        returnData.push({ symbol, excessReturn: symbolReturn - spxReturn });
      }
    }

    // Phase 2: RS 排名 (超额收益率降序)
    returnData.sort((a, b) => b.excessReturn - a.excessReturn);
    const rankMap = new Map<string, number>();
    returnData.forEach((d, i) => rankMap.set(d.symbol, i + 1));

    // Phase 3: 完整评估 (注入 RS 排名)
    for (const symbol of symbols) {
      const rank = rankMap.get(symbol) ?? symbols.length;
      const score = await this.evaluateSymbol(symbol, config, rank);
      if (score) {
        results.set(symbol, score);
      }
    }

    return results;
  }
}

export default new StockTrendRecommendationService();
