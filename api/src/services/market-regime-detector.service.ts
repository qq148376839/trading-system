/**
 * MarketRegimeDetector — 市场状态判别服务
 *
 * 在 finalScore 计算后、方向决策前，判别当前市场处于：
 * - MOMENTUM（动量延续）→ 保持原方向，正常仓位
 * - MEAN_REVERSION（均值回归）→ 翻转方向
 * - UNCERTAIN（不确定）→ 保持原方向，仓位减半
 *
 * 替代原有的 REVERSE_BEAR_SPREAD / REVERSE_BULL_SPREAD 策略类型。
 * 纯函数，无 I/O，无状态。
 */

import { logger } from '../utils/logger';

// ============================================
// 类型定义
// ============================================

export type MarketRegime = 'MOMENTUM' | 'MEAN_REVERSION' | 'UNCERTAIN';
export type RegimeConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SmartReverseConfig {
  enabled: boolean;
  thresholds: {
    marketScoreExtreme: number;       // |marketScore| 极端阈值，默认 35
    intradayScoreExtremeNeg: number;  // intradayScore 看跌极端阈值，默认 14
    intradayScoreExtremePos: number;  // intradayScore 看涨极端阈值，默认 15
    divergenceMin: number;            // 分歧度阈值，默认 0.3
    maxIntradayScoreForEntry?: number; // 反向入场日内得分上限，默认 0；intraScore 超过此值时禁止反向（均值回归窗口已过）
  };
  positionMultiplier: {
    reversed: number;                 // 反向交易仓位系数，默认 1.0
    uncertain: number;                // UNCERTAIN 仓位系数，默认 0.5
  };
}

export interface RegimeMetrics {
  normMarket: number;
  normIntraday: number;
  divergence: number;
  marketExtreme: boolean;
  intradayExtreme: boolean;
}

export interface RegimeDetectionResult {
  regime: MarketRegime;
  confidence: RegimeConfidence;
  shouldReverse: boolean;
  positionMultiplier: number;
  reason: string;
  metrics: RegimeMetrics;
}

// ============================================
// 默认配置
// ============================================

export const DEFAULT_SMART_REVERSE_CONFIG: SmartReverseConfig = {
  enabled: false,
  thresholds: {
    marketScoreExtreme: 35,
    intradayScoreExtremeNeg: 14,
    intradayScoreExtremePos: 15,
    divergenceMin: 0.3,
    maxIntradayScoreForEntry: 0,
  },
  positionMultiplier: {
    reversed: 1.0,
    uncertain: 0.5,
  },
};

// ============================================
// 归一化常量
// ============================================

// marketScore 原始范围约 [-40, +40]，用 40 归一化到 [-1, 1]
const MARKET_SCORE_NORMALIZER = 40;
// intradayScore 原始范围约 [-20, +20]，用 20 归一化到 [-1, 1]
const INTRADAY_SCORE_NORMALIZER = 20;

// ============================================
// MarketRegimeDetector
// ============================================

class MarketRegimeDetector {

  /**
   * 判别市场状态（纯函数，无 I/O）
   *
   * 时间窗口由 tradeWindow.noNewEntryBeforeCloseMinutes 控制，
   * 此处不再重复检查时间——如果信号能到达这里，说明时间窗口已通过。
   *
   * @param marketScore     原始 marketScore（大盘环境得分，-100 ~ 100）
   * @param intradayScore   原始 intradayScore（分时动量得分，-100 ~ 100）
   * @param config          智能反向配置
   */
  detectRegime(
    marketScore: number,
    intradayScore: number,
    config: SmartReverseConfig
  ): RegimeDetectionResult {

    const defaultMetrics: RegimeMetrics = {
      normMarket: 0,
      normIntraday: 0,
      divergence: 0,
      marketExtreme: false,
      intradayExtreme: false,
    };

    // 0. 未启用 → 直接返回 MOMENTUM（保持原方向）
    if (!config.enabled) {
      return {
        regime: 'MOMENTUM',
        confidence: 'HIGH',
        shouldReverse: false,
        positionMultiplier: 1.0,
        reason: '智能反向未启用',
        metrics: defaultMetrics,
      };
    }

    // 1. 归一化 + 极端度计算
    const normMarket = marketScore / MARKET_SCORE_NORMALIZER;
    const normIntraday = intradayScore / INTRADAY_SCORE_NORMALIZER;

    const marketExtreme = Math.abs(marketScore) > config.thresholds.marketScoreExtreme;
    const intradayExtreme =
      intradayScore < -config.thresholds.intradayScoreExtremeNeg ||
      intradayScore > config.thresholds.intradayScoreExtremePos;

    // 3. 分歧度计算
    const divergence = Math.abs(normMarket - normIntraday);

    const metrics: RegimeMetrics = {
      normMarket,
      normIntraday,
      divergence,
      marketExtreme,
      intradayExtreme,
    };

    // === intraScore 反向入场过滤 ===
    // 当 marketScore 极端看跌但 intradayScore 已转正（超过阈值），说明均值回归窗口已过，
    // 此时再买入 CALL 实际是追涨日内反弹的尾巴，概率显著更低。
    // 反之亦然：marketScore 极端看涨但 intradayScore 已转负。
    const maxIntra = config.thresholds.maxIntradayScoreForEntry ?? 0;
    const reversionExhausted =
      (marketScore < 0 && intradayScore > maxIntra) ||   // 熊市极端但日内已回升过头
      (marketScore > 0 && intradayScore < -maxIntra);    // 牛市极端但日内已回落过头
    if (reversionExhausted) {
      logger.info(
        `[SmartReverse] 均值回归窗口已过，禁止反向入场 | ` +
        `mkt=${marketScore.toFixed(1)}, intra=${intradayScore.toFixed(1)}, maxIntra=${maxIntra}`
      );
      return {
        regime: 'MOMENTUM',
        confidence: 'HIGH',
        shouldReverse: false,
        positionMultiplier: 1.0,
        reason: `均值回归窗口已过(intra=${intradayScore.toFixed(1)}超过阈值${maxIntra})，保持原方向`,
        metrics,
      };
    }

    // === 高置信反向 ===
    // marketScore 极端 + intradayScore 不极端 + 分歧度高
    // 大盘过度反应但日内已企稳，均值回归概率最高
    if (marketExtreme && !intradayExtreme && divergence > config.thresholds.divergenceMin) {
      return {
        regime: 'MEAN_REVERSION',
        confidence: 'HIGH',
        shouldReverse: true,
        positionMultiplier: config.positionMultiplier.reversed,
        reason: `大盘极端(${marketScore.toFixed(1)})但日内企稳(${intradayScore.toFixed(1)})，分歧度=${divergence.toFixed(2)}`,
        metrics,
      };
    }

    // === 中等置信反向 ===
    // 两个分量都极端且同向 → 全面过度反应
    if (marketExtreme && intradayExtreme) {
      const sameDirection =
        (marketScore < 0 && intradayScore < 0) ||
        (marketScore > 0 && intradayScore > 0);

      if (sameDirection) {
        return {
          regime: 'MEAN_REVERSION',
          confidence: 'MEDIUM',
          shouldReverse: true,
          positionMultiplier: config.positionMultiplier.reversed,
          reason: `双极端同向(mkt=${marketScore.toFixed(1)}, intra=${intradayScore.toFixed(1)})，过度反应`,
          metrics,
        };
      }
      // 极端但反向（罕见：大盘极端看跌但日内极端看涨，或反之）→ 不确定
      return {
        regime: 'UNCERTAIN',
        confidence: 'LOW',
        shouldReverse: false,
        positionMultiplier: config.positionMultiplier.uncertain,
        reason: `双极端反向(mkt=${marketScore.toFixed(1)}, intra=${intradayScore.toFixed(1)})，信号矛盾`,
        metrics,
      };
    }

    // === 仅 intradayScore 极端（marketScore 不极端）===
    // 日内过度反应但大盘未确认 → UNCERTAIN
    if (!marketExtreme && intradayExtreme) {
      return {
        regime: 'UNCERTAIN',
        confidence: 'LOW',
        shouldReverse: false,
        positionMultiplier: config.positionMultiplier.uncertain,
        reason: `仅日内极端(${intradayScore.toFixed(1)})，大盘未确认(${marketScore.toFixed(1)})`,
        metrics,
      };
    }

    // === 默认：动量延续 ===
    // 中等区域，信号有效，顺势操作
    return {
      regime: 'MOMENTUM',
      confidence: 'HIGH',
      shouldReverse: false,
      positionMultiplier: 1.0,
      reason: '分数在中等区域，顺势操作',
      metrics,
    };
  }
}

export default new MarketRegimeDetector();
