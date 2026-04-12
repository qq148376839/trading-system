/**
 * 正股趋势跟踪策略
 * 自选股模式: 用户配置固定标的池 → 评分排名 → 入场
 * 评分引擎: stock-trend-recommendation.service.ts
 */

import { StrategyBase, TradingIntent } from './strategy-base';
import stockTrendRecommendationService, {
  TrendFollowingConfig,
  DEFAULT_TREND_FOLLOWING_CONFIG,
  LEVERAGED_ETFS,
} from '../stock-trend-recommendation.service';
import { logger } from '../../utils/logger';

export class TrendFollowingStrategy extends StrategyBase {
  private trendConfig: TrendFollowingConfig;

  constructor(strategyId: number, config: Record<string, any> = {}) {
    super(strategyId, config);
    this.trendConfig = { ...DEFAULT_TREND_FOLLOWING_CONFIG, ...config };
    stockTrendRecommendationService.updateConfig(this.trendConfig);
  }

  async generateSignal(symbol: string, _marketData?: any): Promise<TradingIntent | null> {
    try {
      const score = await stockTrendRecommendationService.evaluateSymbol(
        symbol,
        this.trendConfig,
        this.getConfig<number>('_currentRsRank', 10) as number
      );

      if (!score) return null;

      // 1. CHOP 过滤
      if (score.details.chopDetected) {
        logger.debug(`[TREND] ${symbol} CHOP 检测震荡期, deviation=${score.details.chopDeviation.toFixed(3)}`);
        return null;
      }

      // 2. MA 门控 (空头排列不入场)
      if (score.details.maScore === 0) return null;

      // 3. 分数不够
      if (score.totalScore < score.effectiveThreshold) return null;

      // 4. 个股跳空过滤 (不追涨 > maxGapUpPct 的跳空)
      const maxGap = this.trendConfig.maxGapUpPct;
      if (score.details.stockGapPct > maxGap) {
        logger.debug(`[TREND] ${symbol} 跳空 ${score.details.stockGapPct.toFixed(1)}% > ${maxGap}%, 不追`);
        return null;
      }

      // 5. 杠杆 ETF 浓度调整
      const isLeveraged = LEVERAGED_ETFS.includes(symbol);
      const maxConc = isLeveraged
        ? this.trendConfig.leveragedEtfMaxConcentration
        : this.trendConfig.maxConcentration;

      const initialStopLoss = score.details.currentPrice - this.trendConfig.atrTrailingMultiple * score.atr;

      const intent: TradingIntent = {
        action: 'BUY',
        symbol,
        entryPrice: score.details.currentPrice,
        stopLoss: initialStopLoss,
        reason: `趋势=${score.trendScore.toFixed(0)} 动量=${score.momentumScore.toFixed(0)} 环境=${score.envScore.toFixed(0)} 总分=${score.totalScore.toFixed(0)}/${score.effectiveThreshold.toFixed(0)}`,
        metadata: {
          totalScore: score.totalScore,
          trendScore: score.trendScore,
          momentumScore: score.momentumScore,
          envScore: score.envScore,
          atrAtEntry: score.atr,
          initialStopLoss,
          ma50: score.ma50,
          ma200: score.ma200,
          maxConcentration: maxConc,
          isLeveraged,
          rsRank: score.details.rsRank,
        },
      };

      // 记录信号到 DB
      const signalId = await this.logSignal(intent);
      intent.metadata = { ...intent.metadata, signalId };

      return intent;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[TREND] 策略 ${this.strategyId} 生成信号失败 (${symbol}):`, errMsg);
      return null;
    }
  }
}
