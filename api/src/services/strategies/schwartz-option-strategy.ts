/**
 * Schwartz Option Strategy (OPTION_SCHWARTZ_V1)
 *
 * 基于马丁·舒华兹 (Pit Bull) 的交易哲学：
 * - 10 EMA 硬过滤 — 只在趋势方向做单，逆趋势无例外拒绝
 * - IV Rank 过滤 — 高 IV 环境拒绝买方（渐进式：FALLBACK→FULL）
 * - 震荡区间检测 — MA 缠绕时提高入场门槛 2x
 * - 仓位缩减 — 大赚后自动缩减仓位
 *
 * 复用：
 * - optionRecommendationService 基础信号生成
 * - selectOptionContract 合约选择
 * - 退出监控、TSLPPCT 保护、Iron Dome 由调度器统一管理
 */

import { StrategyBase, TradingIntent } from './strategy-base';
import optionRecommendationService from '../option-recommendation.service';
import { selectOptionContract } from '../options-contract-selector.service';
import { estimateOptionOrderTotalCost } from '../options-fee.service';
import { logger } from '../../utils/logger';
import capitalManager from '../capital-manager.service';
import schwartzSignalFilter, {
  SchwartzFilterConfig,
  DEFAULT_SCHWARTZ_FILTER_CONFIG,
} from '../schwartz-signal-filter.service';
import {
  OptionIntradayStrategyConfig,
  DEFAULT_OPTION_STRATEGY_CONFIG,
  ExitRulesConfig,
} from './option-intraday-strategy';

// ============================================
// Schwartz 专属配置
// ============================================
export interface SchwartzOptionStrategyConfig extends OptionIntradayStrategyConfig {
  schwartz?: Partial<SchwartzFilterConfig>;
}

// Schwartz 默认配置（基于 OptionIntraday，覆盖部分参数）
const DEFAULT_SCHWARTZ_CONFIG: Partial<SchwartzOptionStrategyConfig> = {
  ...DEFAULT_OPTION_STRATEGY_CONFIG,
  riskPreference: 'CONSERVATIVE',
  entryThresholdOverride: {
    directionalScoreMin: 12, // 回测校准：实际 finalScore 范围 0~15，30 永远不入场
  },
};

// ============================================
// 策略实现
// ============================================
export class SchwartzOptionStrategy extends StrategyBase {
  private cfg: SchwartzOptionStrategyConfig;
  private schwartzCfg: SchwartzFilterConfig;
  private tradeWindowSkipLogTimes: Map<string, number> = new Map();
  private currentCycleVix?: number;

  constructor(strategyId: number, config: SchwartzOptionStrategyConfig = {}) {
    super(strategyId, config as any);
    this.cfg = { ...DEFAULT_SCHWARTZ_CONFIG, ...config };
    this.schwartzCfg = {
      ...DEFAULT_SCHWARTZ_FILTER_CONFIG,
      ...(config.schwartz || {}),
    };
  }

  /**
   * 获取 VIX 阈值因子
   */
  private getVixThresholdFactor(vixValue?: number): number {
    if (!vixValue || vixValue <= 0) return 1.0;
    return Math.max(0.5, Math.min(2.5, vixValue / 20));
  }

  /**
   * 获取入场阈值（Schwartz 默认 12，CHOP 时 24）
   */
  private getEntryScoreMin(isChop: boolean): number {
    const baseMin = this.cfg.entryThresholdOverride?.directionalScoreMin ?? 12;
    const vixFactor = this.getVixThresholdFactor(this.currentCycleVix);
    const adjusted = Math.round(baseMin * vixFactor);
    return isChop ? adjusted * 2 : adjusted;
  }

  /**
   * 检查交易时间窗口（复用 OptionIntraday 逻辑）
   */
  private isWithinTradeWindow(): { canTrade: boolean; reason?: string } {
    const window = this.cfg.tradeWindow || DEFAULT_OPTION_STRATEGY_CONFIG.tradeWindow!;
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
    const etMinutes = etHour * 60 + etMinute;

    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;
    const firstHourEnd = marketOpen + 60;

    if (etMinutes < marketOpen || etMinutes >= marketClose) {
      return { canTrade: false, reason: '非交易时间' };
    }

    if (window.firstHourOnly && etMinutes > firstHourEnd) {
      return { canTrade: false, reason: '已过开盘第一小时' };
    }

    if (window.noNewEntryBeforeCloseMinutes) {
      const noEntryTime = marketClose - window.noNewEntryBeforeCloseMinutes;
      if (etMinutes >= noEntryTime) {
        return { canTrade: false, reason: `收盘前${window.noNewEntryBeforeCloseMinutes}分钟不开新仓` };
      }
    }

    return { canTrade: true };
  }

  /**
   * 主信号生成方法
   */
  async generateSignal(symbol: string): Promise<TradingIntent | null> {
    try {
      // === 1. 交易时间窗口检查 ===
      const windowCheck = this.isWithinTradeWindow();
      if (!windowCheck.canTrade) {
        const now = Date.now();
        const lastLogTime = this.tradeWindowSkipLogTimes.get(symbol) || 0;
        if (now - lastLogTime > 5 * 60 * 1000) {
          logger.debug(`[SCHWARTZ][${symbol}] ${windowCheck.reason}，跳过`);
          this.tradeWindowSkipLogTimes.set(symbol, now);
        }
        return null;
      }

      // === 2. 获取基础信号（复用 optionRecommendationService） ===
      const optionRec = await optionRecommendationService.calculateOptionRecommendation(symbol);
      this.currentCycleVix = optionRec.currentVix;

      if (optionRec.riskLevel === 'EXTREME') {
        logger.info(`[SCHWARTZ][${symbol}] 风险EXTREME，拒绝`, { module: 'Strategy.Schwartz' });
        return null;
      }

      if (optionRec.direction === 'HOLD') {
        logger.debug(`[SCHWARTZ][${symbol}] 基础信号HOLD，跳过`);
        return null;
      }

      const direction: 'CALL' | 'PUT' = optionRec.direction === 'CALL' ? 'CALL' : 'PUT';

      // === 3. 【Schwartz 过滤层】EMA 硬过滤 ===
      const emaResult = await schwartzSignalFilter.checkEMAFilter(symbol, direction, this.schwartzCfg);
      logger.info(`[SCHWARTZ][${symbol}] EMA过滤: ${emaResult.pass ? '✓' : '✗'} ${emaResult.reason}`, {
        module: 'Strategy.Schwartz.Filter',
        strategyId: this.strategyId,
      });
      if (!emaResult.pass) {
        return null;
      }

      // === 4. 【Schwartz 过滤层】震荡区间检测 ===
      const chopResult = await schwartzSignalFilter.checkChopFilter(symbol, this.schwartzCfg);
      const isChop = !chopResult.pass;
      logger.info(`[SCHWARTZ][${symbol}] CHOP检测: ${chopResult.pass ? '无震荡' : 'CHOP'} ${chopResult.reason}`, {
        module: 'Strategy.Schwartz.Filter',
        strategyId: this.strategyId,
      });

      // === 5. 得分阈值检查（CHOP 时门槛翻倍） ===
      const scoreMin = this.getEntryScoreMin(isChop);
      const absScore = Math.abs(optionRec.finalScore);

      if (absScore < scoreMin) {
        logger.info(
          `[SCHWARTZ][${symbol}] 得分不足: |${optionRec.finalScore.toFixed(1)}|<${scoreMin}${isChop ? '(CHOP×2)' : ''}`,
          { module: 'Strategy.Schwartz', strategyId: this.strategyId }
        );
        return null;
      }

      // === 6. 0DTE 禁入窗口检查 ===
      const expirationMode = this.cfg.expirationMode || '0DTE';
      const zdteCooldownMinutes = this.cfg.tradeWindow?.zdteCooldownMinutes ?? 0;
      let skip0DTE = false;

      if (zdteCooldownMinutes > 0 && expirationMode === '0DTE') {
        const nowForCooldown = new Date();
        const etFormatterCooldown = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: 'numeric',
          hour12: false,
        });
        const etPartsCooldown = etFormatterCooldown.formatToParts(nowForCooldown);
        const etHourCooldown = parseInt(etPartsCooldown.find(p => p.type === 'hour')?.value || '0');
        const etMinuteCooldown = parseInt(etPartsCooldown.find(p => p.type === 'minute')?.value || '0');
        const etMinutesCooldown = etHourCooldown * 60 + etMinuteCooldown;
        const marketOpenMinutes = 9 * 60 + 30;
        const minutesSinceOpen = etMinutesCooldown - marketOpenMinutes;

        if (minutesSinceOpen >= 0 && minutesSinceOpen < zdteCooldownMinutes) {
          skip0DTE = true;
          logger.info(`[SCHWARTZ][${symbol}] 0DTE禁入 开盘${minutesSinceOpen}分钟`, {
            module: 'Strategy.Schwartz',
          });
        }
      }

      // === 7. 选择期权合约 ===
      const selected = await selectOptionContract({
        underlyingSymbol: symbol,
        expirationMode,
        direction,
        candidateStrikes: 8,
        liquidityFilters: this.cfg.liquidityFilters,
        greekFilters: this.cfg.greekFilters,
        noNewEntryBeforeCloseMinutes: this.cfg.tradeWindow?.noNewEntryBeforeCloseMinutes,
        skip0DTE,
      });

      if (!selected) {
        logger.warn(`[SCHWARTZ][${symbol}] 未找到合适合约(${direction}, ${expirationMode})`);
        return null;
      }

      if (selected.greeksUnavailable) {
        logger.warn(`[SCHWARTZ][${symbol}] Greeks不可用，拒绝 ${selected.optionSymbol}`);
        return null;
      }

      // === 8. 【Schwartz 过滤层】IV Rank 过滤 ===
      const contractIV = Number(selected.impliedVolatility) || 0;
      const vixValue = optionRec.currentVix || 0;
      const ivResult = await schwartzSignalFilter.checkIVFilter(symbol, contractIV, vixValue, this.schwartzCfg);
      logger.info(`[SCHWARTZ][${symbol}] IV过滤: ${ivResult.pass ? '✓' : '✗'} ${ivResult.reason}`, {
        module: 'Strategy.Schwartz.Filter',
        strategyId: this.strategyId,
      });
      if (!ivResult.pass) {
        return null;
      }

      // 记录当天 IV（异步，不阻塞）
      if (contractIV > 0 && vixValue > 0) {
        schwartzSignalFilter.recordDailyIV(symbol, contractIV, vixValue).catch(() => {});
      }

      // === 9. 确定入场价格 ===
      const entryPriceMode = this.cfg.entryPriceMode || 'ASK';
      const premium = entryPriceMode === 'MID'
        ? (selected.mid || selected.last)
        : (selected.ask || selected.mid || selected.last);

      if (!premium || premium <= 0) {
        logger.warn(`[SCHWARTZ][${symbol}] 价格无效 ${entryPriceMode}=${premium}`);
        return null;
      }

      // === 10. 确定合约数量 ===
      const sizing = this.cfg.positionSizing || { mode: 'FIXED_CONTRACTS' as const, fixedContracts: 1 };
      let contracts = 1;

      if (sizing.mode === 'FIXED_CONTRACTS') {
        contracts = Math.max(1, Math.floor(sizing.fixedContracts || 1));
      } else if (sizing.mode === 'MAX_PREMIUM') {
        let budget = Math.max(0, (sizing.maxPremiumUsd || 0));
        if (budget === 0) {
          try {
            const availableCapital = await capitalManager.getAvailableCapital(this.strategyId);
            const maxPositionPerSymbol = await capitalManager.getMaxPositionPerSymbol(this.strategyId);
            budget = Math.min(availableCapital, maxPositionPerSymbol);
          } catch (error: any) {
            logger.warn(`[SCHWARTZ][${symbol}] 资金获取失败: ${error.message}`);
            budget = 0;
          }
        }

        if (budget > 0) {
          let n = 1;
          for (; n <= 50; n++) {
            const est = estimateOptionOrderTotalCost({
              premium,
              contracts: n,
              multiplier: selected.multiplier,
              feeModel: this.cfg.feeModel,
            });
            if (est.totalCost > budget) break;
          }
          contracts = Math.max(1, n - 1);
        }
      }

      // === 11. 【Schwartz 过滤层】仓位缩减 ===
      // 从 context 获取上笔交易信息
      try {
        const instance = await this.stateManager.getInstanceState(this.strategyId, symbol);
        const ctx = instance?.context || {};
        const lastPnLPercent = Number(ctx.lastTradePnLPercent) || 0;
        const consecutiveWins = Number(ctx.consecutiveWins) || 0;

        const sizeResult = schwartzSignalFilter.calculatePositionSize(
          contracts,
          lastPnLPercent,
          consecutiveWins,
          this.schwartzCfg
        );
        if (sizeResult.contracts !== contracts) {
          logger.info(`[SCHWARTZ][${symbol}] 仓位缩减: ${contracts}→${sizeResult.contracts} ${sizeResult.reason}`, {
            module: 'Strategy.Schwartz',
          });
          contracts = sizeResult.contracts;
        }
      } catch {
        // 获取上笔信息失败，保持原始仓位
      }

      // === 12. 计算预估成本 ===
      const est = estimateOptionOrderTotalCost({
        premium,
        contracts,
        multiplier: selected.multiplier,
        feeModel: this.cfg.feeModel,
      });

      // === 13. 生成交易意图 ===
      const intent: TradingIntent = {
        action: 'BUY',
        symbol: selected.optionSymbol,
        entryPrice: premium,
        quantity: contracts,
        reason: `[SCHWARTZ] ${direction} | EMA✓ | ${isChop ? 'CHOP(2x)' : 'TREND'} | IV=${ivResult.mode}`,
        metadata: {
          assetClass: 'OPTION',
          strategyMode: 'SCHWARTZ',
          underlyingSymbol: symbol,
          optionDirection: direction,
          optionType: selected.optionType,
          optionSymbol: selected.optionSymbol,
          optionId: selected.optionId,
          underlyingStockId: selected.underlyingStockId,
          marketType: selected.marketType,
          strikeDate: selected.strikeDate,
          strikePrice: selected.strikePrice,
          multiplier: selected.multiplier,
          bid: selected.bid,
          ask: selected.ask,
          mid: selected.mid,
          openInterest: selected.openInterest,
          impliedVolatility: selected.impliedVolatility,
          delta: selected.delta,
          theta: selected.theta,
          estimatedFees: est.fees,
          allocationAmountOverride: est.totalCost,
          exitRules: this.cfg.exitRules || DEFAULT_OPTION_STRATEGY_CONFIG.exitRules,
          selectedStrategy: 'DIRECTIONAL_' + direction,
          // R5v2: 评分信息 — 用于跨标的竞价排序
          finalScore: optionRec.finalScore,
          marketScore: optionRec.marketScore,
          intradayScore: optionRec.intradayScore,
          // Schwartz 专属过滤结果
          schwartzFilters: {
            ema: { pass: emaResult.pass, value: emaResult.emaValue, price: emaResult.currentPrice },
            chop: { isChop, deviation: chopResult.deviation },
            iv: { pass: ivResult.pass, rank: ivResult.ivRank, mode: ivResult.mode },
            scoreMin,
          },
        },
      };

      const signalId = await this.logSignal(intent);
      intent.metadata = { ...(intent.metadata || {}), signalId };

      logger.info(
        `[SCHWARTZ][${symbol}信号] ${direction} ${selected.optionSymbol} | 得分=${optionRec.finalScore.toFixed(1)} | ` +
        `EMA=✓ | IV=${ivResult.pass ? 'PASS' : 'FAIL'}(${ivResult.mode}${ivResult.ivRank !== null ? ',rank=' + ivResult.ivRank.toFixed(0) : ''}) | ` +
        `CHOP=${isChop ? '✓(2x)' : '✗'} | 合约=${contracts} | 成本=$${est.totalCost.toFixed(2)}`,
        { module: 'Strategy.Schwartz', strategyId: this.strategyId }
      );

      return intent;

    } catch (error: any) {
      const isDataError = error.message && (
        error.message.includes('数据不足') ||
        error.message.includes('数据获取失败') ||
        error.message.includes('无法提供交易建议')
      );
      if (isDataError) {
        logger.warn(`[SCHWARTZ][${symbol}] 数据不可用: ${error.message}`);
      } else {
        logger.error(`[SCHWARTZ][${symbol}] 策略异常: ${error.message}`);
      }
      return null;
    }
  }
}
