/**
 * Option intraday strategy - 支持多种末日期权策略
 *
 * 支持的策略类型:
 * - 买方策略: 单边买方(CALL/PUT)、跨式买入、宽跨式买入
 * - 卖方策略: 卖出跨式、卖出宽跨式、铁鹰、铁蝶
 * - 方向性策略: 牛市价差、熊市价差、反向牛市价差、反向熊市价差
 *
 * Exit is primarily handled by the scheduler's market-close forced exit logic.
 */
import { StrategyBase, TradingIntent } from './strategy-base';
import tradingRecommendationService from '../trading-recommendation.service';
import optionRecommendationService from '../option-recommendation.service';
import { selectOptionContract } from '../options-contract-selector.service';
import { estimateOptionOrderTotalCost } from '../options-fee.service';
import { logger } from '../../utils/logger';
import capitalManager from '../capital-manager.service';
import fastMomentumService from '../fast-momentum.service';
import marketRegimeDetector, { SmartReverseConfig, DEFAULT_SMART_REVERSE_CONFIG, RegimeDetectionResult } from '../market-regime-detector.service';
import { getQuoteContext } from '../../config/longport';
import { calculateATR } from '../../utils/technical-indicators';

// ============================================
// 策略类型定义
// ============================================

// 买方策略类型（做多波动率或方向）
export type BuyerStrategyType =
  | 'STRADDLE_BUY'      // 跨式买入 - 同时买入ATM CALL和PUT
  | 'STRANGLE_BUY'      // 宽跨式买入 - 买入OTM CALL和PUT
  | 'DIRECTIONAL_CALL'  // 单边买Call
  | 'DIRECTIONAL_PUT';  // 单边买Put

// 卖方策略类型（做空波动率）
export type SellerStrategyType =
  | 'STRADDLE_SELL'     // 卖出跨式 - 同时卖出ATM CALL和PUT
  | 'STRANGLE_SELL'     // 卖出宽跨式 - 卖出OTM CALL和PUT
  | 'IRON_CONDOR'       // 铁鹰 - 卖出宽跨式+买入更OTM的保护
  | 'IRON_BUTTERFLY';   // 铁蝶 - 卖出跨式+买入OTM保护

// 方向性策略类型（价差策略）
// 注: REVERSE_BULL_SPREAD / REVERSE_BEAR_SPREAD 已被 MarketRegimeDetector 智能反向替代
export type DirectionalStrategyType =
  | 'BULL_SPREAD'           // 牛市价差 - 买入低Strike CALL + 卖出高Strike CALL
  | 'BEAR_SPREAD'           // 熊市价差 - 买入高Strike PUT + 卖出低Strike PUT
  | 'REVERSE_BULL_SPREAD'   // [已废弃] 反向牛市价差 — 被 smartReverse 替代，保留类型兼容旧配置
  | 'REVERSE_BEAR_SPREAD';  // [已废弃] 反向熊市价差 — 被 smartReverse 替代，保留类型兼容旧配置

// 所有策略类型
export type OptionStrategyType = BuyerStrategyType | SellerStrategyType | DirectionalStrategyType;

// 风险偏好
export type RiskPreference = 'AGGRESSIVE' | 'CONSERVATIVE';

// 旧的配置类型（保留兼容性）
type DirectionMode = 'FOLLOW_SIGNAL' | 'CALL_ONLY' | 'PUT_ONLY';
type ExpirationMode = '0DTE' | 'NEAREST';
type PositionSizingMode = 'FIXED_CONTRACTS' | 'MAX_PREMIUM';

// ============================================
// 止盈止损配置
// ============================================
export interface ExitRulesConfig {
  takeProfitPercent: number;    // 止盈百分比，默认 45
  stopLossPercent: number;      // 止损百分比，默认 35
  trailingStopTrigger?: number; // 追踪止损触发点（盈利%），默认按时段：EARLY=30, MID=25, LATE=20, FINAL=15
  trailingStopPercent?: number; // 追踪止损回撤幅度%，默认按时段：EARLY=15, MID=12, LATE=10, FINAL=8
  profitLockSteps?: { threshold: number; floor: number }[];  // 阶梯锁利，默认 [{10,0},{20,10},{30,20},{50,35}]
}

// ============================================
// 交易时间窗口配置
// ============================================
export interface TradeWindowConfig {
  firstHourOnly?: boolean;            // 只在开盘第一小时交易
  avoidLast30Minutes?: boolean;       // 避免最后30分钟（默认true）
  noNewEntryBeforeCloseMinutes?: number;  // 收盘前N分钟不开新仓
  forceCloseBeforeCloseMinutes?: number;  // 收盘前N分钟强制平仓
  zdteCooldownMinutes?: number;       // 0DTE开盘禁入时长，分钟（默认0，可通过DB配置设置禁入窗口）
  nonZdteCooldownMinutes?: number;    // 非0DTE开盘冷静期，分钟（默认0）
  openImpulseGuard?: {                // 开盘冲量守卫 — 防止追高买在开盘冲量尾端
    enabled: boolean;                 // 默认 false（需手动启用）
    maxOpenMoveATR: number;           // 阈值：开盘至今移动超过此 ATR 倍数则拦截（默认 1.5）
    filterActiveMinutes: number;      // 生效窗口：开盘后 N 分钟内检查（默认 30）
    scoreOverrideMultiplier: number;  // 超强信号覆盖倍数：absScore >= scoreMin * 此值时放行（默认 2.0）
  };
}

// ============================================
// 价差策略专用配置
// ============================================
export interface SpreadConfig {
  strikeWidthPoints?: number;   // 执行价差距（点数），默认5
  maxSpreadWidth?: number;      // 最大价差宽度（USD）
}

// ============================================
// 跨式/宽跨式专用配置
// ============================================
export interface StraddleConfig {
  strikeOffset?: number;        // 宽跨式的执行价偏移（点数），默认5
}

// ============================================
// 主配置接口
// ============================================
export interface OptionIntradayStrategyConfig {
  assetClass?: 'OPTION';
  expirationMode?: ExpirationMode;

  // ===== 新增：策略类型配置（多选） =====
  strategyTypes?: {
    buyer?: BuyerStrategyType[];        // 买方策略（可多选）
    seller?: SellerStrategyType[];      // 卖方策略（可多选）
    directional?: DirectionalStrategyType[];  // 方向性策略（可多选）
  };

  // ===== 新增：风险偏好（单选） =====
  riskPreference?: RiskPreference;      // 默认 CONSERVATIVE

  // ===== 新增：止盈止损配置 =====
  exitRules?: ExitRulesConfig;

  // ===== 新增：价差和跨式配置 =====
  spreadConfig?: SpreadConfig;
  straddleConfig?: StraddleConfig;

  // ===== 旧配置（保留兼容性） =====
  directionMode?: DirectionMode;        // 已弃用，使用 strategyTypes.buyer

  positionSizing?: {
    mode: PositionSizingMode;
    fixedContracts?: number;
    maxPremiumUsd?: number;
  };

  liquidityFilters?: {
    minOpenInterest?: number;
    maxBidAskSpreadAbs?: number;
    maxBidAskSpreadPct?: number;
  };

  greekFilters?: {
    deltaMin?: number;
    deltaMax?: number;
    thetaMaxAbs?: number;
  };

  tradeWindow?: TradeWindowConfig;

  // ===== 入场阈值覆盖（预设系统使用） =====
  entryThresholdOverride?: {
    directionalScoreMin?: number;  // 覆盖 ENTRY_THRESHOLDS 的 directionalScoreMin
    spreadScoreMin?: number;       // 覆盖 ENTRY_THRESHOLDS 的 spreadScoreMin
  };

  feeModel?: {
    commissionPerContract?: number;
    minCommissionPerOrder?: number;
    platformFeePerContract?: number;
  };

  entryPriceMode?: 'ASK' | 'MID';

  // ===== 智能反向配置（替代 REVERSE_BEAR/BULL_SPREAD）=====
  smartReverse?: SmartReverseConfig;
}

// ============================================
// 默认配置
// ============================================
export const DEFAULT_OPTION_STRATEGY_CONFIG: Partial<OptionIntradayStrategyConfig> = {
  assetClass: 'OPTION',
  expirationMode: '0DTE',
  strategyTypes: {
    buyer: ['DIRECTIONAL_CALL', 'DIRECTIONAL_PUT', 'STRADDLE_BUY'],
  },
  riskPreference: 'CONSERVATIVE',
  exitRules: {
    takeProfitPercent: 45,
    stopLossPercent: 35,
  },
  tradeWindow: {
    firstHourOnly: true,
    avoidLast30Minutes: true,
    noNewEntryBeforeCloseMinutes: 120,
    forceCloseBeforeCloseMinutes: 30,
  },
  positionSizing: {
    mode: 'FIXED_CONTRACTS',
    fixedContracts: 1,
  },
  entryPriceMode: 'ASK',
};

// ============================================
// 入场阈值配置（根据风险偏好调整）
// ============================================
export const ENTRY_THRESHOLDS = {
  AGGRESSIVE: {
    directionalScoreMin: 5,       // 单边买方最低得分
    spreadScoreMin: 5,            // 价差策略最低得分
    straddleIvThreshold: 0,       // 跨式IV阈值（相对当前）
  },
  CONSERVATIVE: {
    directionalScoreMin: 12,      // 单边买方最低得分（更高）
    spreadScoreMin: 12,           // 价差策略最低得分（更高）
    straddleIvThreshold: 0.1,     // 跨式IV阈值（比当前高10%）
  },
};

// ============================================
// 决策日志数据结构（用于写入 system_logs）
// ============================================
interface OptionDecisionLogData {
  strategyId: number;
  underlyingSymbol: string;
  strategyTypes: string[];
  riskPreference: string;
  marketScore: number;
  intradayScore: number;
  finalScore: number;
  signalDirection: string;
  riskLevel: string;
  selectedStrategy?: string;
  entrySignal?: {
    direction: 'CALL' | 'PUT';
    optionSymbol?: string;
    contracts?: number;
    premium?: number;
    delta?: number;
    theta?: number;
    estimatedCost?: number;
  };
  finalResult: 'SIGNAL_GENERATED' | 'NO_SIGNAL' | 'ERROR';
  rejectionReason?: string;
  rejectionCheckpoint?: string;
  momentumSnapshot?: {
    intraScore: number;
    marketScore: number;
    slope60s: number | null;
    decelRatio: number | null;
    longSlope: number | null;
    direction: 'CALL' | 'PUT';
    regime: string;
  };
}

export class OptionIntradayStrategy extends StrategyBase {
  private cfg: OptionIntradayStrategyConfig;
  // 非交易时间日志限频（每标的每5分钟最多打印一次）
  private tradeWindowSkipLogTimes: Map<string, number> = new Map();
  // 260317: 资金预检拦截缓存（symbol → 拦截到期时间），避免已知超预算标的每周期重复评估
  private capitalPrecheckRejectUntil: Map<string, number> = new Map();
  // 当前评估周期的VIX值（在generateSignal开始时设置）
  private currentCycleVix?: number;

  constructor(strategyId: number, config: OptionIntradayStrategyConfig = {}) {
    super(strategyId, config as any);
    // 合并默认配置
    this.cfg = { ...DEFAULT_OPTION_STRATEGY_CONFIG, ...config };
  }

  /**
   * 获取启用的策略类型列表
   */
  private getEnabledStrategies(): OptionStrategyType[] {
    const types = this.cfg.strategyTypes || DEFAULT_OPTION_STRATEGY_CONFIG.strategyTypes;
    const enabled: OptionStrategyType[] = [];
    if (types?.buyer) enabled.push(...types.buyer);
    if (types?.seller) enabled.push(...types.seller);
    if (types?.directional) enabled.push(...types.directional);
    return enabled;
  }

  /**
   * 计算VIX阈值因子
   * VIX=20 → factor=1.0（基准）
   * VIX=10 → factor=0.5（低波动，降低阈值更容易入场）
   * VIX=50 → factor=2.5（高波动，抬高阈值更难入场）
   */
  private getVixThresholdFactor(vixValue?: number): number {
    if (!vixValue || vixValue <= 0) return 1.0;
    return Math.max(0.5, Math.min(2.5, vixValue / 20));
  }

  /**
   * 获取入场阈值（根据风险偏好 + entryThresholdOverride + VIX自适应）
   */
  private getThresholds() {
    const pref = this.cfg.riskPreference || 'CONSERVATIVE';
    const tableBase = ENTRY_THRESHOLDS[pref] || ENTRY_THRESHOLDS.CONSERVATIVE;
    const override = this.cfg.entryThresholdOverride;
    const vixFactor = this.getVixThresholdFactor(this.currentCycleVix);

    return {
      directionalScoreMin: Math.round((override?.directionalScoreMin ?? tableBase.directionalScoreMin) * vixFactor),
      spreadScoreMin: Math.round((override?.spreadScoreMin ?? tableBase.spreadScoreMin) * vixFactor),
      straddleIvThreshold: tableBase.straddleIvThreshold,
      vixFactor,
    };
  }

  /**
   * 检查是否在交易时间窗口内
   */
  private isWithinTradeWindow(): { canTrade: boolean; reason?: string } {
    const window = this.cfg.tradeWindow || DEFAULT_OPTION_STRATEGY_CONFIG.tradeWindow!;
    const now = new Date();

    // 获取美东时间
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

    // 市场时间: 9:30 = 570, 16:00 = 960
    const marketOpen = 9 * 60 + 30;   // 9:30
    const marketClose = 16 * 60;       // 16:00
    const firstHourEnd = marketOpen + 60; // 10:30

    // 检查是否在交易时间
    if (etMinutes < marketOpen || etMinutes >= marketClose) {
      return { canTrade: false, reason: '非交易时间' };
    }

    // 检查是否只在开盘第一小时交易
    if (window.firstHourOnly && etMinutes > firstHourEnd) {
      return { canTrade: false, reason: '已过开盘第一小时' };
    }

    // 检查是否避免最后30分钟
    const last30Minutes = marketClose - 30;
    if (window.avoidLast30Minutes && etMinutes >= last30Minutes) {
      return { canTrade: false, reason: '收盘前30分钟不开新仓' };
    }

    // 检查自定义的收盘前N分钟限制
    if (window.noNewEntryBeforeCloseMinutes) {
      const noEntryTime = marketClose - window.noNewEntryBeforeCloseMinutes;
      if (etMinutes >= noEntryTime) {
        return { canTrade: false, reason: `收盘前${window.noNewEntryBeforeCloseMinutes}分钟不开新仓` };
      }
    }

    return { canTrade: true };
  }

  /**
   * 评估单边买方策略（DIRECTIONAL_CALL / DIRECTIONAL_PUT）
   */
  private evaluateDirectionalBuyer(
    optionRec: any,
    strategyType: 'DIRECTIONAL_CALL' | 'DIRECTIONAL_PUT'
  ): { shouldTrade: boolean; direction: 'CALL' | 'PUT'; reason: string } {
    const thresholds = this.getThresholds();
    const score = optionRec.finalScore;
    const vixInfo = `VIX因子=${thresholds.vixFactor.toFixed(2)}`;

    if (strategyType === 'DIRECTIONAL_CALL') {
      // CALL: 需要正分数超过阈值
      if (score >= thresholds.directionalScoreMin) {
        return { shouldTrade: true, direction: 'CALL', reason: `得分${score.toFixed(1)}≥${thresholds.directionalScoreMin} (${vixInfo})` };
      }
    } else {
      // PUT: 需要负分数超过阈值（绝对值）
      if (score <= -thresholds.directionalScoreMin) {
        return { shouldTrade: true, direction: 'PUT', reason: `得分${score.toFixed(1)}≤-${thresholds.directionalScoreMin} (${vixInfo})` };
      }
    }

    return { shouldTrade: false, direction: strategyType === 'DIRECTIONAL_CALL' ? 'CALL' : 'PUT', reason: `得分${score.toFixed(1)}未达阈值±${thresholds.directionalScoreMin} (${vixInfo})` };
  }

  /**
   * 评估跨式买入策略（STRADDLE_BUY）
   * 适合预期大波动但方向不确定的情况
   */
  private evaluateStraddleBuy(optionRec: any): { shouldTrade: boolean; reason: string } {
    const thresholds = this.getThresholds();
    const vix = optionRec.riskMetrics?.vixValue || 0;

    // 跨式买入条件：VIX处于较高水平（预期波动）
    // 激进模式：VIX > 18
    // 保守模式：VIX > 22
    const vixThreshold = this.cfg.riskPreference === 'AGGRESSIVE' ? 18 : 22;

    if (vix >= vixThreshold) {
      return { shouldTrade: true, reason: `VIX=${vix.toFixed(1)}≥${vixThreshold}，预期高波动` };
    }

    return { shouldTrade: false, reason: `VIX=${vix.toFixed(1)}<${vixThreshold}，波动率不足` };
  }

  /**
   * 评估牛市/熊市价差策略
   * 注: REVERSE_BULL_SPREAD / REVERSE_BEAR_SPREAD 已被 MarketRegimeDetector 替代，
   *     此处保留类型签名兼容旧配置但不再执行反向逻辑。
   */
  private evaluateSpreadStrategy(
    optionRec: any,
    strategyType: 'BULL_SPREAD' | 'BEAR_SPREAD' | 'REVERSE_BULL_SPREAD' | 'REVERSE_BEAR_SPREAD'
  ): { shouldTrade: boolean; direction: 'CALL' | 'PUT'; reason: string } {
    const thresholds = this.getThresholds();
    const score = optionRec.finalScore;
    const vixInfo = `VIX因子=${thresholds.vixFactor.toFixed(2)}`;

    if (strategyType === 'BULL_SPREAD') {
      if (score >= thresholds.spreadScoreMin) {
        return { shouldTrade: true, direction: 'CALL', reason: `得分${score.toFixed(1)}≥${thresholds.spreadScoreMin}，适合牛市价差 (${vixInfo})` };
      }
    } else if (strategyType === 'BEAR_SPREAD') {
      if (score <= -thresholds.spreadScoreMin) {
        return { shouldTrade: true, direction: 'PUT', reason: `得分${score.toFixed(1)}≤-${thresholds.spreadScoreMin}，适合熊市价差 (${vixInfo})` };
      }
    } else if (strategyType === 'REVERSE_BULL_SPREAD' || strategyType === 'REVERSE_BEAR_SPREAD') {
      // [已废弃] REVERSE_* 由 MarketRegimeDetector 统一处理，此处回退为对应的正向策略
      if (strategyType === 'REVERSE_BULL_SPREAD' && score >= thresholds.spreadScoreMin) {
        return { shouldTrade: true, direction: 'CALL', reason: `得分${score.toFixed(1)}≥${thresholds.spreadScoreMin}，REVERSE_BULL已废弃→按BULL执行，方向由smartReverse控制 (${vixInfo})` };
      }
      if (strategyType === 'REVERSE_BEAR_SPREAD' && score <= -thresholds.spreadScoreMin) {
        return { shouldTrade: true, direction: 'PUT', reason: `得分${score.toFixed(1)}≤-${thresholds.spreadScoreMin}，REVERSE_BEAR已废弃→按BEAR执行，方向由smartReverse控制 (${vixInfo})` };
      }
    }

    const defaultDirection = strategyType === 'BEAR_SPREAD' || strategyType === 'REVERSE_BULL_SPREAD' ? 'PUT' : 'CALL';
    return { shouldTrade: false, direction: defaultDirection, reason: `得分${score.toFixed(1)}未达阈值±${thresholds.spreadScoreMin} (${vixInfo})` };
  }

  /**
   * 记录决策日志到 system_logs
   */
  private logDecision(data: OptionDecisionLogData): void {
    // 非交易时间的 NO_SIGNAL 决策不打印，避免大量冗余日志
    if (data.rejectionCheckpoint === 'trade_window') {
      return;
    }

    // 市场数据不可用是基础设施问题，降级为 warn 而非 error
    const isDataError = data.rejectionReason && (
      data.rejectionReason.includes('数据不足') ||
      data.rejectionReason.includes('数据获取失败') ||
      data.rejectionReason.includes('无法提供交易建议')
    );
    const level = data.finalResult === 'SIGNAL_GENERATED' ? 'info' :
                  (data.finalResult === 'ERROR' && !isDataError) ? 'error' :
                  data.finalResult === 'ERROR' ? 'warn' : 'info';

    const message = data.finalResult === 'SIGNAL_GENERATED'
      ? `期权信号生成: ${data.entrySignal?.direction} ${data.entrySignal?.optionSymbol}`
      : `期权决策: ${data.finalResult} - ${data.rejectionReason || ''}`;

    logger[level](message, {
      module: 'OptionStrategy',
      strategyId: data.strategyId,
      underlying: data.underlyingSymbol,
      strategyTypes: data.strategyTypes,
      riskPreference: data.riskPreference,
      scores: {
        market: data.marketScore,
        intraday: data.intradayScore,
        final: data.finalScore,
      },
      signalDirection: data.signalDirection,
      riskLevel: data.riskLevel,
      selectedStrategy: data.selectedStrategy,
      entrySignal: data.entrySignal,
      result: data.finalResult,
      rejection: data.rejectionReason ? {
        reason: data.rejectionReason,
        checkpoint: data.rejectionCheckpoint,
      } : undefined,
    });
  }

  /**
   * 主信号生成方法
   */
  async generateSignal(symbol: string): Promise<TradingIntent | null> {
    const enabledStrategies = this.getEnabledStrategies();

    // 初始化决策日志
    const logData: OptionDecisionLogData = {
      strategyId: this.strategyId,
      underlyingSymbol: symbol,
      strategyTypes: enabledStrategies,
      riskPreference: this.cfg.riskPreference || 'CONSERVATIVE',
      marketScore: 0,
      intradayScore: 0,
      finalScore: 0,
      signalDirection: 'HOLD',
      riskLevel: 'MEDIUM',
      finalResult: 'NO_SIGNAL',
    };

    try {
      // 0) 260317: 资金预检缓存 — 最近被拦截的标的直接跳过，避免重复评估
      const precheckUntil = this.capitalPrecheckRejectUntil.get(symbol) || 0;
      if (Date.now() < precheckUntil) {
        return null;  // 静默跳过，日志已在首次拦截时输出
      }

      // 1) 检查交易时间窗口
      const windowCheck = this.isWithinTradeWindow();
      if (!windowCheck.canTrade) {
        const now = Date.now();
        const lastLogTime = this.tradeWindowSkipLogTimes.get(symbol) || 0;
        if (now - lastLogTime > 5 * 60 * 1000) {
          logger.debug(`[${symbol}] ${windowCheck.reason}，跳过信号生成`);
          this.tradeWindowSkipLogTimes.set(symbol, now);
        }
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = windowCheck.reason;
        logData.rejectionCheckpoint = 'trade_window';
        this.logDecision(logData);
        return null;
      }

      // 1.5) 开盘冷静期检查（0DTE + 非0DTE）
      const expirationMode = this.cfg.expirationMode || '0DTE';

      // 计算 minutesSinceOpen（冷静期 + 冲量守卫共用）
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

      // 1.5a) 0DTE 冷静期
      const zdteCooldownMinutes = this.cfg.tradeWindow?.zdteCooldownMinutes ?? 0;
      if (zdteCooldownMinutes > 0 && expirationMode === '0DTE') {
        if (minutesSinceOpen >= 0 && minutesSinceOpen < zdteCooldownMinutes) {
          logger.info(`[0DTE禁入] ${symbol} 开盘${minutesSinceOpen}分钟内禁止入场（${zdteCooldownMinutes}分钟窗口）`);
          logData.finalResult = 'NO_SIGNAL';
          logData.rejectionReason = `0DTE禁入窗口：开盘${minutesSinceOpen}/${zdteCooldownMinutes}分钟`;
          logData.rejectionCheckpoint = '0dte_cooldown';
          this.logDecision(logData);
          return null;
        }
      }

      // 1.5b) 非0DTE 冷静期
      const nonZdteCooldownMinutes = this.cfg.tradeWindow?.nonZdteCooldownMinutes ?? 0;
      if (nonZdteCooldownMinutes > 0 && expirationMode !== '0DTE') {
        if (minutesSinceOpen >= 0 && minutesSinceOpen < nonZdteCooldownMinutes) {
          logger.info(`[非0DTE禁入] ${symbol} 开盘${minutesSinceOpen}分钟内禁止入场（${nonZdteCooldownMinutes}分钟窗口）`);
          logData.finalResult = 'NO_SIGNAL';
          logData.rejectionReason = `非0DTE禁入窗口：开盘${minutesSinceOpen}/${nonZdteCooldownMinutes}分钟`;
          logData.rejectionCheckpoint = 'non_0dte_cooldown';
          this.logDecision(logData);
          return null;
        }
      }

      // 2) 获取市场推荐
      const optionRec = await optionRecommendationService.calculateOptionRecommendation(symbol);

      // 设置当前周期VIX值，供getThresholds()使用
      this.currentCycleVix = optionRec.currentVix;

      logData.marketScore = optionRec.marketScore;
      logData.intradayScore = optionRec.intradayScore;
      logData.finalScore = optionRec.finalScore;
      logData.signalDirection = optionRec.direction;
      logData.riskLevel = optionRec.riskLevel;

      logger.debug(`[期权推荐] ${symbol}:`, {
        direction: optionRec.direction,
        confidence: optionRec.confidence,
        marketScore: optionRec.marketScore,
        intradayScore: optionRec.intradayScore,
        finalScore: optionRec.finalScore,
        riskLevel: optionRec.riskLevel,
        reasoning: optionRec.reasoning
      });

      // 3) 检查风险等级
      if (optionRec.riskLevel === 'EXTREME') {
        logger.warn(`[${symbol}跳过] 风险等级EXTREME，不生成信号`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = '风险等级为EXTREME，市场环境不适合交易';
        logData.rejectionCheckpoint = 'risk_check';
        this.logDecision(logData);
        return null;
      }

      // 3.5) 市场状态判别（智能反向）
      // 时间窗口由 tradeWindow.noNewEntryBeforeCloseMinutes 控制，regime detection 不重复检查
      const smartReverseConfig: SmartReverseConfig = {
        ...DEFAULT_SMART_REVERSE_CONFIG,
        ...this.cfg.smartReverse,
        thresholds: { ...DEFAULT_SMART_REVERSE_CONFIG.thresholds, ...this.cfg.smartReverse?.thresholds },
        positionMultiplier: { ...DEFAULT_SMART_REVERSE_CONFIG.positionMultiplier, ...this.cfg.smartReverse?.positionMultiplier },
      };

      const regimeResult: RegimeDetectionResult = marketRegimeDetector.detectRegime(
        optionRec.marketScore,
        optionRec.intradayScore,
        smartReverseConfig
      );

      (logData as any).regimeDetection = {
        regime: regimeResult.regime,
        confidence: regimeResult.confidence,
        shouldReverse: regimeResult.shouldReverse,
        positionMultiplier: regimeResult.positionMultiplier,
        reason: regimeResult.reason,
        metrics: regimeResult.metrics,
      };

      if (smartReverseConfig.enabled) {
        logger.info(
          `[${symbol}] Regime: ${regimeResult.regime} (${regimeResult.confidence}) | ` +
          `reverse=${regimeResult.shouldReverse} | multiplier=${regimeResult.positionMultiplier} | ` +
          `${regimeResult.reason}`,
          { module: 'OptionStrategy.Regime', strategyId: this.strategyId }
        );
      }

      // 4) 遍历启用的策略，找到第一个满足条件的
      let selectedStrategy: OptionStrategyType | null = null;
      let direction: 'CALL' | 'PUT' = 'CALL';
      let strategyReason = '';

      for (const strategy of enabledStrategies) {
        let evaluation: { shouldTrade: boolean; direction?: 'CALL' | 'PUT'; reason: string };

        switch (strategy) {
          case 'DIRECTIONAL_CALL':
          case 'DIRECTIONAL_PUT':
            evaluation = this.evaluateDirectionalBuyer(optionRec, strategy);
            break;

          case 'STRADDLE_BUY':
            // 跨式买入：同时买CALL和PUT（当前简化为跟随信号方向）
            evaluation = this.evaluateStraddleBuy(optionRec);
            if (evaluation.shouldTrade) {
              // 跨式策略在高波动时，跟随信号方向
              evaluation = { ...evaluation, direction: optionRec.direction === 'CALL' ? 'CALL' : 'PUT' };
            }
            break;

          case 'BULL_SPREAD':
          case 'BEAR_SPREAD':
          case 'REVERSE_BULL_SPREAD':
          case 'REVERSE_BEAR_SPREAD':
            evaluation = this.evaluateSpreadStrategy(optionRec, strategy);
            break;

          // TODO: 实现卖方策略
          case 'STRANGLE_BUY':
          case 'STRADDLE_SELL':
          case 'STRANGLE_SELL':
          case 'IRON_CONDOR':
          case 'IRON_BUTTERFLY':
            evaluation = { shouldTrade: false, reason: `策略${strategy}暂未实现` };
            break;

          default:
            evaluation = { shouldTrade: false, reason: `未知策略类型` };
        }

        logger.debug(`[${symbol}/${strategy}] ${evaluation.reason}`);

        if (evaluation.shouldTrade && evaluation.direction) {
          selectedStrategy = strategy;
          direction = evaluation.direction;
          strategyReason = evaluation.reason;
          break;
        }
      }

      // 4.5) 应用智能反向：翻转方向
      if (selectedStrategy && regimeResult.shouldReverse) {
        const originalDirection = direction;
        direction = direction === 'CALL' ? 'PUT' : 'CALL';
        strategyReason += ` → 智能反向: ${originalDirection}→${direction} (${regimeResult.reason})`;
        (logData as any).reversed = true;
        (logData as any).originalDirection = originalDirection;
        logger.info(
          `[${symbol}] 智能反向触发: ${originalDirection} → ${direction} | ${regimeResult.reason}`,
          { module: 'OptionStrategy.Regime', strategyId: this.strategyId }
        );
      }

      // 5) 如果没有策略满足条件
      if (!selectedStrategy) {
        logger.debug(`[${symbol}] 所有策略条件均不满足，不生成信号`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = '所有启用的策略条件均不满足';
        logData.rejectionCheckpoint = 'strategy_evaluation';
        this.logDecision(logData);
        return null;
      }

      logData.selectedStrategy = selectedStrategy;

      // 5.5) 快动量 Gate — 防追高
      const fastMoResult = fastMomentumService.checkGate(symbol, direction);
      if (!fastMoResult.pass) {
        logger.info(
          `[${symbol}] FastMo过滤: ✗ ${fastMoResult.reason} slope=${fastMoResult.slope?.toFixed(6) ?? 'N/A'} decel=${fastMoResult.deceleration?.toFixed(3) ?? 'N/A'}`,
          { module: 'OptionStrategy.FastMo', strategyId: this.strategyId }
        );
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = `快动量过滤: ${fastMoResult.reason}`;
        logData.rejectionCheckpoint = 'fast_momentum';
        this.logDecision(logData);
        return null;
      }
      logger.info(
        `[${symbol}] FastMo过滤: ✓ (${fastMoResult.dataPoints}pts, slope=${fastMoResult.slope?.toFixed(6) ?? 'N/A'})`,
        { module: 'OptionStrategy.FastMo', strategyId: this.strategyId }
      );

      // 5.55) 日内动量极值入场加强过滤
      // 原理：|intraScore| > 15 表明日内动量已大量释放，继续追涨/追跌的边际收益递减
      // 此时仅 slope 方向正确不够，需确认 slope 强度和持续性
      const INTRA_EXTREME_THRESHOLD = 15;
      const intraAbs = Math.abs(optionRec.intradayScore);
      if (intraAbs > INTRA_EXTREME_THRESHOLD && fastMoResult.slope !== null) {
        const slopeAbs = Math.abs(fastMoResult.slope);
        const decel = fastMoResult.deceleration ?? 1.0;
        const STRONG_SLOPE_MIN = 0.001;
        const STRONG_DECEL_MIN = 0.7;
        if (slopeAbs < STRONG_SLOPE_MIN || decel < STRONG_DECEL_MIN) {
          logger.info(
            `[${symbol}] 日内极值入场过滤: ✗ intra=${optionRec.intradayScore.toFixed(1)}, ` +
            `|slope|=${slopeAbs.toFixed(6)}(需>${STRONG_SLOPE_MIN}), decel=${decel.toFixed(3)}(需>${STRONG_DECEL_MIN})`,
            { module: 'OptionStrategy.IntraExtremeFilter', strategyId: this.strategyId }
          );
          logData.finalResult = 'NO_SIGNAL';
          logData.rejectionReason = `日内极值过滤: intra=${optionRec.intradayScore.toFixed(1)}, |slope|=${slopeAbs.toFixed(6)}, decel=${decel.toFixed(3)}`;
          logData.rejectionCheckpoint = 'intra_extreme_filter';
          this.logDecision(logData);
          return null;
        }
        logger.info(
          `[${symbol}] 日内极值入场过滤: ✓ intra=${optionRec.intradayScore.toFixed(1)}, ` +
          `|slope|=${slopeAbs.toFixed(6)}, decel=${decel.toFixed(3)}`,
          { module: 'OptionStrategy.IntraExtremeFilter', strategyId: this.strategyId }
        );
      }

      // Peak Reversal 数据采集：|intraScore| > 10 时记录详细动量快照
      if (Math.abs(optionRec.intradayScore) > 10) {
        logData.momentumSnapshot = {
          intraScore: optionRec.intradayScore,
          marketScore: optionRec.marketScore,
          slope60s: fastMoResult.slope,
          decelRatio: fastMoResult.deceleration,
          longSlope: fastMoResult.longSlope,
          direction,
          regime: regimeResult.regime,
        };
      }

      // 5.6) 开盘冲量守卫（Opening Impulse Exhaustion Filter）
      const impulseGuard = this.cfg.tradeWindow?.openImpulseGuard;
      const filterActiveMinutes = impulseGuard?.filterActiveMinutes ?? 30;

      if (minutesSinceOpen >= 0 && minutesSinceOpen < filterActiveMinutes) {
        try {
          const quoteCtx = await getQuoteContext();
          const longport = require('longport');
          const { Period, AdjustType, TradeSessions } = longport;
          const { formatLongbridgeCandlestick } = require('../../utils/candlestick-formatter');

          const dailyCandles = await quoteCtx.candlesticks(
            symbol, Period.Day, 20, AdjustType.NoAdjust,
            TradeSessions?.All || 100,
          );
          const formattedDaily = dailyCandles.map((c: any) => formatLongbridgeCandlestick(c));
          const atr14 = calculateATR(formattedDaily, 14);

          if (atr14 > 0 && formattedDaily.length > 0) {
            const todayBar = formattedDaily[formattedDaily.length - 1];
            const openPrice = todayBar.open;
            const currentPrice = todayBar.close;
            const moveFromOpen = currentPrice - openPrice;
            const moveATR = Math.abs(moveFromOpen) / atr14;
            const isMoveInSignalDirection =
              (direction === 'CALL' && moveFromOpen > 0) ||
              (direction === 'PUT' && moveFromOpen < 0);

            logger.info(
              `[${symbol}] 开盘冲量: move=${moveFromOpen > 0 ? '+' : ''}${moveFromOpen.toFixed(2)} ` +
              `(${moveATR.toFixed(2)} ATR) | open=${openPrice.toFixed(2)} now=${currentPrice.toFixed(2)} | ` +
              `ATR14=${atr14.toFixed(2)} | 方向一致=${isMoveInSignalDirection} | 开盘${minutesSinceOpen}min`,
              { module: 'OptionStrategy.ImpulseGuard', strategyId: this.strategyId },
            );

            const maxOpenMoveATR = impulseGuard?.maxOpenMoveATR ?? 1.5;
            if (impulseGuard?.enabled && isMoveInSignalDirection && moveATR > maxOpenMoveATR) {
              // 检查超强信号覆盖
              const thresholds = this.getThresholds();
              const absScore = Math.abs(optionRec.finalScore);
              const overrideMultiplier = impulseGuard.scoreOverrideMultiplier ?? 2.0;
              const overrideThreshold = thresholds.directionalScoreMin * overrideMultiplier;

              if (absScore >= overrideThreshold) {
                logger.info(
                  `[${symbol}] 开盘冲量守卫: 超强信号覆盖放行 |score|=${absScore.toFixed(1)} >= ${overrideThreshold.toFixed(1)}`,
                  { module: 'OptionStrategy.ImpulseGuard', strategyId: this.strategyId },
                );
              } else {
                logger.info(
                  `[${symbol}] 开盘冲量守卫: 拦截 moveATR=${moveATR.toFixed(2)} > ${maxOpenMoveATR} | ` +
                  `|score|=${absScore.toFixed(1)} < override=${overrideThreshold.toFixed(1)}`,
                  { module: 'OptionStrategy.ImpulseGuard', strategyId: this.strategyId },
                );
                logData.finalResult = 'NO_SIGNAL';
                logData.rejectionReason = `开盘冲量守卫: moveATR=${moveATR.toFixed(2)} > ${maxOpenMoveATR}`;
                logData.rejectionCheckpoint = 'impulse_guard';
                this.logDecision(logData);
                return null;
              }
            }
          }
        } catch (impulseErr: any) {
          logger.warn(`[${symbol}] 开盘冲量守卫数据获取失败: ${impulseErr.message}`, {
            module: 'OptionStrategy.ImpulseGuard',
          });
        }
      }

      // 6) 选择合约
      const selected = await selectOptionContract({
        underlyingSymbol: symbol,
        expirationMode,
        direction,
        candidateStrikes: 8,
        liquidityFilters: this.cfg.liquidityFilters,
        greekFilters: this.cfg.greekFilters,
        noNewEntryBeforeCloseMinutes: this.cfg.tradeWindow?.noNewEntryBeforeCloseMinutes,
      });

      if (!selected) {
        logger.warn(`[${symbol}无合约] 未找到合适的期权合约 (${direction}, ${expirationMode})`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = `未找到合适的期权合约 (方向=${direction}, 模式=${expirationMode})`;
        logData.rejectionCheckpoint = 'contract_selection';
        this.logDecision(logData);
        return null;
      }

      // 6.5) Greeks 可用性检查 — 拒绝在 Greeks 数据不可用时自动交易
      if (selected.greeksUnavailable) {
        logger.warn(`[${symbol}Greeks不可用] 合约 ${selected.optionSymbol} 的 Greeks 数据不可用 (delta=${selected.delta}, theta=${selected.theta})，拒绝自动交易`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = `Greeks 数据不可用 (合约=${selected.optionSymbol}, greeksSource=${selected.greeksSource || 'unknown'})`;
        logData.rejectionCheckpoint = 'greeks_validation';
        this.logDecision(logData);
        return null;
      }

      // 7) 确定入场价格
      const entryPriceMode = this.cfg.entryPriceMode || 'ASK';
      const premium = entryPriceMode === 'MID'
        ? (selected.mid || selected.last)
        : (selected.ask || selected.mid || selected.last);

      if (!premium || premium <= 0) {
        logger.warn(`[${symbol}价格无效] ${entryPriceMode}价格=${premium}，无法下单`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = `入场价格无效 (${entryPriceMode}=${premium})`;
        logData.rejectionCheckpoint = 'pricing';
        this.logDecision(logData);
        return null;
      }

      // 8) 确定合约数量
      const sizing = this.cfg.positionSizing || { mode: 'FIXED_CONTRACTS' as const, fixedContracts: 1 };
      let contracts = 1;

      if (sizing.mode === 'FIXED_CONTRACTS') {
        contracts = Math.max(1, Math.floor(sizing.fixedContracts || 1));
      } else if (sizing.mode === 'MAX_PREMIUM') {
        // 获取策略可用资金作为预算
        let budget = Math.max(0, (sizing.maxPremiumUsd || 0));

        // 如果配置中没有设置 maxPremiumUsd，使用策略的可用资金
        if (budget === 0) {
          try {
            const availableCapital = await capitalManager.getAvailableCapital(this.strategyId);
            const maxPositionPerSymbol = await capitalManager.getMaxPositionPerSymbol(this.strategyId);
            budget = Math.min(availableCapital, maxPositionPerSymbol);
            logger.debug(`[${symbol}资金] 可用资金=${availableCapital.toFixed(2)}, 单标的上限=${maxPositionPerSymbol.toFixed(2)}, 预算=${budget.toFixed(2)}`);
          } catch (error: any) {
            logger.warn(`[${symbol}] 获取可用资金失败: ${error.message}，使用默认1张合约`);
            budget = 0;
          }
        }

        if (budget > 0) {
          // 计算在预算内能购买的最大合约数
          let n = 1;
          for (; n <= 50; n++) { // 最多50张合约
            const est = estimateOptionOrderTotalCost({
              premium,
              contracts: n,
              multiplier: selected.multiplier,
              feeModel: this.cfg.feeModel,
            });
            if (est.totalCost > budget) break;
          }
          // 260317: 资金预检 — 1张合约都超预算时拒绝信号，避免生成无法执行的 PENDING 信号
          if (n === 1) {
            const singleCost = estimateOptionOrderTotalCost({
              premium,
              contracts: 1,
              multiplier: selected.multiplier,
              feeModel: this.cfg.feeModel,
            });
            logger.warn(
              `[${symbol}] 资金预检拦截: 1张合约成本=$${singleCost.totalCost.toFixed(2)} 超过预算=$${budget.toFixed(2)}，跳过信号`,
              { module: 'OptionStrategy.CapitalPrecheck', strategyId: this.strategyId }
            );
            // 缓存拦截结果5分钟，避免每15秒重复评估
            this.capitalPrecheckRejectUntil.set(symbol, Date.now() + 5 * 60_000);
            logData.finalResult = 'NO_SIGNAL';
            logData.rejectionReason = `资金预检: 最低1张合约成本$${singleCost.totalCost.toFixed(2)}超过单标的预算$${budget.toFixed(2)}`;
            logData.rejectionCheckpoint = 'capital_precheck';
            this.logDecision(logData);
            return null;
          }
          contracts = n - 1;
          logger.debug(`[${symbol}仓位] 预算=${budget.toFixed(2)}, 权利金=${premium.toFixed(2)}, 计算合约数=${contracts}`);
        }
      }

      // 8.5) 应用 regime 仓位系数（UNCERTAIN 时减仓至 50%）
      if (regimeResult.positionMultiplier < 1.0 && contracts > 1) {
        const originalContracts = contracts;
        contracts = Math.max(1, Math.round(contracts * regimeResult.positionMultiplier));
        logger.info(
          `[${symbol}] Regime仓位调整: ${originalContracts} → ${contracts} (x${regimeResult.positionMultiplier})`,
          { module: 'OptionStrategy.Regime', strategyId: this.strategyId }
        );
      }

      const est = estimateOptionOrderTotalCost({
        premium,
        contracts,
        multiplier: selected.multiplier,
        feeModel: this.cfg.feeModel,
      });

      // 9) 生成交易意图
      const intent: TradingIntent = {
        action: 'BUY',
        symbol: selected.optionSymbol,
        entryPrice: premium,
        quantity: contracts,
        reason: `[${selectedStrategy}] ${strategyReason}`.trim(),
        metadata: {
          assetClass: 'OPTION',
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
          timeValue: selected.timeValue,
          estimatedFees: est.fees,
          allocationAmountOverride: est.totalCost,
          // 新增：止盈止损配置
          exitRules: this.cfg.exitRules || DEFAULT_OPTION_STRATEGY_CONFIG.exitRules,
          selectedStrategy: selectedStrategy,
          // R5v2: 评分信息 — 用于跨标的竞价排序
          finalScore: optionRec.finalScore,
          marketScore: optionRec.marketScore,
          intradayScore: optionRec.intradayScore,
          // 智能反向: regime detection 结果
          regimeDetection: {
            regime: regimeResult.regime,
            confidence: regimeResult.confidence,
            shouldReverse: regimeResult.shouldReverse,
            positionMultiplier: regimeResult.positionMultiplier,
          },
          ...((logData as any).reversed ? { reversed: true, originalDirection: (logData as any).originalDirection } : {}),
        },
      };

      const signalId = await this.logSignal(intent);
      intent.metadata = { ...(intent.metadata || {}), signalId };

      // 10) 记录成功日志
      logData.entrySignal = {
        direction,
        optionSymbol: selected.optionSymbol,
        contracts,
        premium,
        delta: selected.delta,
        theta: selected.theta,
        estimatedCost: est.totalCost,
      };
      logData.finalResult = 'SIGNAL_GENERATED';
      this.logDecision(logData);

      logger.info(
        `[${symbol}/${selectedStrategy}] ${direction} ${selected.optionSymbol} | 合约=${contracts}, 权利金=$${premium.toFixed(2)}, 预估成本=$${est.totalCost.toFixed(2)}`
      );

      return intent;

    } catch (error: any) {
      // 区分市场数据不可用（基础设施问题）和真正的策略错误
      const isDataError = error.message && (
        error.message.includes('数据不足') ||
        error.message.includes('数据获取失败') ||
        error.message.includes('无法提供交易建议')
      );
      if (isDataError) {
        logger.warn(`[${symbol}策略执行失败]: 市场数据不可用 - ${error.message}`);
      } else {
        logger.error(`[${symbol}策略执行失败]:`, error.message);
      }
      logData.finalResult = 'ERROR';
      logData.rejectionReason = `策略执行异常: ${error.message}`;
      logData.rejectionCheckpoint = 'error_handler';
      this.logDecision(logData);
      return null;
    }
  }
}
