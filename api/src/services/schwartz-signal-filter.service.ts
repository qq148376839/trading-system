/**
 * Schwartz 信号过滤服务
 *
 * 在 optionRecommendationService 基础信号上叠加舒华兹 (Pit Bull) 风格过滤：
 * 1. 10 EMA 硬过滤 — 逆趋势无例外拒绝
 * 2. IV Rank 过滤 — 高 IV 拒绝买方
 * 3. 震荡区间检测 — MA 缠绕时提高入场门槛
 * 4. 仓位缩减 — 大赚后自动缩减
 */

import { getLatestEMA, getLatestSMA } from '../utils/ema';
import marketDataService from './market-data.service';
import pool from '../config/database';
import { logger } from '../utils/logger';

// ============================================
// 过滤结果类型
// ============================================

export interface EMAFilterResult {
  pass: boolean;
  emaValue: number | null;
  currentPrice: number | null;
  reason: string;
}

export interface IVFilterResult {
  pass: boolean;
  ivRank: number | null;
  mode: 'FULL' | 'FALLBACK' | 'SKIP';
  reason: string;
}

export interface ChopFilterResult {
  pass: boolean;
  ma10: number | null;
  ma20: number | null;
  deviation: number | null;
  reason: string;
}

export interface SchwartzFilterConfig {
  emaPeriod: number;                   // EMA 周期，默认 10
  chopThreshold: number;               // 震荡判定偏离阈值(%)，默认 0.3
  emaWrapThreshold: number;            // EMA 缠绕判定阈值(%)，默认 0.3
  ivRankRejectThreshold: number;       // IV Rank 拒绝阈值(0-100)，默认 60
  ivFallbackRejectIV: number;          // 降级模式 IV 拒绝阈值，默认 0.8
  positionShrinkAfterBigWin: boolean;  // 大赚后缩减仓位
  bigWinThreshold: number;             // 大赚定义(%)，默认 30
}

export const DEFAULT_SCHWARTZ_FILTER_CONFIG: SchwartzFilterConfig = {
  emaPeriod: 10,
  chopThreshold: 0.5,
  emaWrapThreshold: 0.3,
  ivRankRejectThreshold: 60,
  ivFallbackRejectIV: 0.8,
  positionShrinkAfterBigWin: true,
  bigWinThreshold: 30,
};

class SchwartzSignalFilterService {
  /**
   * 过滤器 1: 10 EMA 硬过滤
   * CALL 信号：标的 < 10 EMA → 拒绝
   * PUT 信号：标的 > 10 EMA → 拒绝
   * |当前价 - EMA| / EMA < emaWrapThreshold → 缠绕区间拒绝
   */
  async checkEMAFilter(
    symbol: string,
    direction: 'CALL' | 'PUT',
    config: SchwartzFilterConfig = DEFAULT_SCHWARTZ_FILTER_CONFIG
  ): Promise<EMAFilterResult> {
    try {
      const dailyData = await marketDataService.getDailyCloseHistory(symbol, 30);
      if (!dailyData || dailyData.length < config.emaPeriod) {
        return {
          pass: false,
          emaValue: null,
          currentPrice: null,
          reason: `日K数据不足(${dailyData?.length || 0}/${config.emaPeriod})，拒绝入场`,
        };
      }

      const closes = dailyData.map(d => d.close);
      const ema = getLatestEMA(closes, config.emaPeriod);
      const currentPrice = closes[closes.length - 1];

      if (ema === null || currentPrice <= 0) {
        return {
          pass: false,
          emaValue: ema,
          currentPrice,
          reason: 'EMA 计算失败或价格无效',
        };
      }

      const distancePct = Math.abs(currentPrice - ema) / ema * 100;

      // 缠绕区间检测：价格和 EMA 非常接近
      if (distancePct < config.emaWrapThreshold) {
        return {
          pass: false,
          emaValue: ema,
          currentPrice,
          reason: `EMA缠绕(偏离${distancePct.toFixed(2)}%<${config.emaWrapThreshold}%)，方向不明，拒绝`,
        };
      }

      // 方向一致性检查
      if (direction === 'CALL' && currentPrice < ema) {
        return {
          pass: false,
          emaValue: ema,
          currentPrice,
          reason: `CALL但价格(${currentPrice.toFixed(2)})<EMA${config.emaPeriod}(${ema.toFixed(2)})，逆趋势拒绝`,
        };
      }

      if (direction === 'PUT' && currentPrice > ema) {
        return {
          pass: false,
          emaValue: ema,
          currentPrice,
          reason: `PUT但价格(${currentPrice.toFixed(2)})>EMA${config.emaPeriod}(${ema.toFixed(2)})，逆趋势拒绝`,
        };
      }

      return {
        pass: true,
        emaValue: ema,
        currentPrice,
        reason: `EMA${config.emaPeriod}=${ema.toFixed(2)}, 价格=${currentPrice.toFixed(2)}, 偏离${distancePct.toFixed(2)}%，方向一致`,
      };
    } catch (error: any) {
      logger.warn(`[SCHWARTZ] EMA过滤异常: ${error.message}`);
      return {
        pass: false,
        emaValue: null,
        currentPrice: null,
        reason: `EMA过滤异常: ${error.message}`,
      };
    }
  }

  /**
   * 过滤器 2: IV Rank 过滤
   * FULL 模式（>=30 天历史）：ivRank > 阈值 → 拒绝买方
   * FALLBACK 模式（<30 天历史）：VIX > 25 且 contractIV > 配置阈值 → 拒绝买方
   */
  async checkIVFilter(
    symbol: string,
    contractIV: number,
    vix: number,
    config: SchwartzFilterConfig = DEFAULT_SCHWARTZ_FILTER_CONFIG
  ): Promise<IVFilterResult> {
    try {
      // 查询 iv_history 近 60 天
      const ivResult = await pool.query(
        `SELECT atm_iv FROM iv_history
         WHERE symbol = $1 AND recorded_date >= CURRENT_DATE - INTERVAL '60 days'
         ORDER BY recorded_date DESC`,
        [symbol]
      );

      const ivRecords = ivResult.rows.map((r: any) => Number(r.atm_iv));

      if (ivRecords.length >= 30) {
        // FULL 模式
        const min = Math.min(...ivRecords);
        const max = Math.max(...ivRecords);
        const range = max - min;

        if (range <= 0) {
          return { pass: true, ivRank: 50, mode: 'FULL', reason: 'IV 区间为零，跳过过滤' };
        }

        const ivRank = ((contractIV - min) / range) * 100;

        if (ivRank > config.ivRankRejectThreshold) {
          return {
            pass: false,
            ivRank,
            mode: 'FULL',
            reason: `IVRank=${ivRank.toFixed(1)}>${config.ivRankRejectThreshold}，IV偏高拒绝买方`,
          };
        }

        return {
          pass: true,
          ivRank,
          mode: 'FULL',
          reason: `IVRank=${ivRank.toFixed(1)}(${ivRecords.length}天数据)，正常`,
        };
      }

      // FALLBACK 模式
      if (vix > 25 && contractIV > config.ivFallbackRejectIV) {
        return {
          pass: false,
          ivRank: null,
          mode: 'FALLBACK',
          reason: `降级模式: VIX=${vix.toFixed(1)}>25且IV=${contractIV.toFixed(3)}>${config.ivFallbackRejectIV}，拒绝`,
        };
      }

      return {
        pass: true,
        ivRank: null,
        mode: 'FALLBACK',
        reason: `降级模式(${ivRecords.length}天数据): VIX=${vix.toFixed(1)}, IV=${contractIV.toFixed(3)}，通过`,
      };
    } catch (error: any) {
      logger.warn(`[SCHWARTZ] IV过滤异常: ${error.message}`);
      // IV 过滤异常时放行，不因数据问题阻止交易
      return { pass: true, ivRank: null, mode: 'SKIP', reason: `IV过滤异常，跳过: ${error.message}` };
    }
  }

  /**
   * 过滤器 3: 震荡区间检测
   * 10MA 与 20MA 偏离度 < chopThreshold → CHOP 区间
   */
  async checkChopFilter(
    symbol: string,
    config: SchwartzFilterConfig = DEFAULT_SCHWARTZ_FILTER_CONFIG
  ): Promise<ChopFilterResult> {
    try {
      const dailyData = await marketDataService.getDailyCloseHistory(symbol, 30);
      if (!dailyData || dailyData.length < 20) {
        return { pass: true, ma10: null, ma20: null, deviation: null, reason: '数据不足，跳过CHOP检测' };
      }

      const closes = dailyData.map(d => d.close);
      const ma10 = getLatestSMA(closes, 10);
      const ma20 = getLatestSMA(closes, 20);

      if (ma10 === null || ma20 === null || ma20 === 0) {
        return { pass: true, ma10, ma20, deviation: null, reason: 'MA计算失败，跳过CHOP检测' };
      }

      const deviation = Math.abs(ma10 - ma20) / ma20 * 100;

      if (deviation < config.chopThreshold) {
        return {
          pass: false,
          ma10,
          ma20,
          deviation,
          reason: `CHOP区间: MA10/MA20偏离${deviation.toFixed(2)}%<${config.chopThreshold}%，趋势不明`,
        };
      }

      return {
        pass: true,
        ma10,
        ma20,
        deviation,
        reason: `MA10/MA20偏离${deviation.toFixed(2)}%>=${config.chopThreshold}%，有趋势`,
      };
    } catch (error: any) {
      logger.warn(`[SCHWARTZ] CHOP检测异常: ${error.message}`);
      return { pass: true, ma10: null, ma20: null, deviation: null, reason: `CHOP检测异常，跳过: ${error.message}` };
    }
  }

  /**
   * 过滤器 4: 仓位缩减
   * 上笔盈利 > bigWinThreshold → contracts * 0.5
   * 连续 2 笔盈利 > 20% → contracts = 1
   */
  calculatePositionSize(
    baseContracts: number,
    lastTradePnLPercent: number,
    consecutiveWins: number,
    config: SchwartzFilterConfig = DEFAULT_SCHWARTZ_FILTER_CONFIG
  ): { contracts: number; reason: string } {
    if (!config.positionShrinkAfterBigWin) {
      return { contracts: baseContracts, reason: '仓位缩减已禁用' };
    }

    // 连续 2+ 笔盈利 > 20% → 最小仓位
    if (consecutiveWins >= 2 && lastTradePnLPercent > 20) {
      return { contracts: 1, reason: `连胜${consecutiveWins}笔(>20%)，缩至最小1张` };
    }

    // 上笔大赚 → 缩减 50%
    if (lastTradePnLPercent > config.bigWinThreshold) {
      const shrunk = Math.max(1, Math.floor(baseContracts * 0.5));
      return { contracts: shrunk, reason: `上笔盈利${lastTradePnLPercent.toFixed(1)}%>${config.bigWinThreshold}%，缩至${shrunk}张` };
    }

    return { contracts: baseContracts, reason: '无需缩减' };
  }

  /**
   * IV 历史采集 — 每日记录一次
   * INSERT ... ON CONFLICT 更新
   */
  async recordDailyIV(symbol: string, atmIV: number, vixValue: number): Promise<void> {
    try {
      const iv = Number(atmIV);
      const vix = Number(vixValue);
      if (isNaN(iv) || isNaN(vix)) {
        logger.warn(`[SCHWARTZ] recordDailyIV: 无效数值 iv=${atmIV}, vix=${vixValue}`);
        return;
      }

      await pool.query(
        `INSERT INTO iv_history (symbol, atm_iv, vix_value, recorded_date)
         VALUES ($1, $2, $3, CURRENT_DATE)
         ON CONFLICT (symbol, recorded_date) DO UPDATE SET
           atm_iv = EXCLUDED.atm_iv,
           vix_value = EXCLUDED.vix_value`,
        [symbol, iv, vix]
      );
    } catch (error: any) {
      logger.warn(`[SCHWARTZ] IV记录失败(${symbol}): ${error.message}`);
    }
  }
}

export default new SchwartzSignalFilterService();
