/**
 * Option intraday strategy - 支持多种末日期权策略
 *
 * 支持的策略类型:
 * - 买方策略: 单边买方(CALL/PUT)、跨式买入、宽跨式买入
 * - 卖方策略: 卖出跨式、卖出宽跨式、铁鹰、铁蝶
 * - 方向性策略: 牛市价差、熊市价差
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
export type DirectionalStrategyType =
  | 'BULL_SPREAD'       // 牛市价差 - 买入低Strike CALL + 卖出高Strike CALL
  | 'BEAR_SPREAD';      // 熊市价差 - 买入高Strike PUT + 卖出低Strike PUT

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
  useTrailingStop: boolean;     // 是否使用移动止损
  trailingStopPercent?: number; // 移动止损触发点
}

// ============================================
// 交易时间窗口配置
// ============================================
export interface TradeWindowConfig {
  firstHourOnly?: boolean;            // 只在开盘第一小时交易
  avoidLast30Minutes?: boolean;       // 避免最后30分钟（默认true）
  noNewEntryBeforeCloseMinutes?: number;  // 收盘前N分钟不开新仓
  forceCloseBeforeCloseMinutes?: number;  // 收盘前N分钟强制平仓
  directionConfirmMinutes?: number;   // 开盘后N分钟内方向确认窗口（默认30）
  zdteCooldownMinutes?: number;       // 0DTE开盘禁入时长，分钟（默认30，即09:30-10:00禁止0DTE新仓）
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

  // ===== LATE时段配置 =====
  latePeriod?: {
    cooldownMinutes?: number;        // 同一标的平仓后N分钟内不重新开仓（默认3）
    minProfitThreshold?: number;     // LATE时段最低信号得分阈值提高比例（默认0.10=10%）
  };

  // ===== 0DTE 风控配置 =====
  zdteEntryThreshold?: number;           // 0DTE入场得分阈值（默认12，非0DTE使用ENTRY_THRESHOLDS）
  consecutiveConfirmCycles?: number;     // 连续确认次数（默认2，设为1禁用连续确认）

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

  feeModel?: {
    commissionPerContract?: number;
    minCommissionPerOrder?: number;
    platformFeePerContract?: number;
  };

  entryPriceMode?: 'ASK' | 'MID';
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
    useTrailingStop: false,
  },
  tradeWindow: {
    firstHourOnly: true,
    avoidLast30Minutes: true,
    noNewEntryBeforeCloseMinutes: 180,
    forceCloseBeforeCloseMinutes: 30,
    directionConfirmMinutes: 30,
  },
  positionSizing: {
    mode: 'FIXED_CONTRACTS',
    fixedContracts: 1,
  },
  latePeriod: {
    cooldownMinutes: 3,
    minProfitThreshold: 0.10,
  },
  entryPriceMode: 'ASK',
};

// ============================================
// 入场阈值配置（根据风险偏好调整）
// ============================================
export const ENTRY_THRESHOLDS = {
  AGGRESSIVE: {
    directionalScoreMin: 10,      // 单边买方最低得分
    spreadScoreMin: 10,           // 价差策略最低得分
    straddleIvThreshold: 0,       // 跨式IV阈值（相对当前）
  },
  CONSERVATIVE: {
    directionalScoreMin: 30,      // 单边买方最低得分（更高）
    spreadScoreMin: 40,           // 价差策略最低得分（更高）
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
}

export class OptionIntradayStrategy extends StrategyBase {
  private cfg: OptionIntradayStrategyConfig;
  // 连续确认状态（内存级别，策略重启自动重置）
  private consecutiveStates: Map<string, { direction: string; count: number; lastTime: number }> = new Map();

  constructor(strategyId: number, config: OptionIntradayStrategyConfig = {}) {
    super(strategyId, config as any);
    // 深度合并默认配置：确保嵌套对象也正确继承默认值
    this.cfg = {
      ...DEFAULT_OPTION_STRATEGY_CONFIG,
      ...config,
      tradeWindow: { ...DEFAULT_OPTION_STRATEGY_CONFIG.tradeWindow, ...config.tradeWindow },
      exitRules: { ...DEFAULT_OPTION_STRATEGY_CONFIG.exitRules, ...config.exitRules },
      positionSizing: { ...DEFAULT_OPTION_STRATEGY_CONFIG.positionSizing, ...config.positionSizing },
      latePeriod: { ...DEFAULT_OPTION_STRATEGY_CONFIG.latePeriod, ...config.latePeriod },
    };
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
   * 获取入场阈值（根据风险偏好 + LATE时段提高）
   */
  private getThresholds(isLatePeriod: boolean = false) {
    const pref = this.cfg.riskPreference || 'CONSERVATIVE';
    const base = ENTRY_THRESHOLDS[pref];
    if (!isLatePeriod) return base;

    // LATE时段：提高入场阈值
    const boost = 1 + (this.cfg.latePeriod?.minProfitThreshold ?? 0.10);
    return {
      directionalScoreMin: Math.round(base.directionalScoreMin * boost),
      spreadScoreMin: Math.round(base.spreadScoreMin * boost),
      straddleIvThreshold: base.straddleIvThreshold,
    };
  }

  /**
   * 判断当前是否为 LATE 交易时段（收盘前0.5~2小时）
   */
  private isLatePeriod(): boolean {
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
    const marketClose = 16 * 60; // 16:00
    const minutesToClose = marketClose - etMinutes;
    return minutesToClose > 30 && minutesToClose <= 120; // 30min~2h before close
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
    strategyType: 'DIRECTIONAL_CALL' | 'DIRECTIONAL_PUT',
    isLate: boolean = false,
    is0DTE: boolean = false
  ): { shouldTrade: boolean; direction: 'CALL' | 'PUT'; reason: string } {
    const thresholds = this.getThresholds(isLate);
    const score = optionRec.finalScore;

    // 0DTE使用更严格阈值：取 ENTRY_THRESHOLDS 与 zdteEntryThreshold 的较大值
    const effectiveMin = is0DTE
      ? Math.max(thresholds.directionalScoreMin, this.cfg.zdteEntryThreshold ?? 12)
      : thresholds.directionalScoreMin;
    const tag = is0DTE && effectiveMin > thresholds.directionalScoreMin ? '(0DTE加严)' : '';

    if (strategyType === 'DIRECTIONAL_CALL') {
      if (score >= effectiveMin) {
        return { shouldTrade: true, direction: 'CALL', reason: `看涨信号得分${score.toFixed(1)}≥${effectiveMin}${tag}` };
      }
    } else {
      if (score <= -effectiveMin) {
        return { shouldTrade: true, direction: 'PUT', reason: `看跌信号得分${score.toFixed(1)}≤-${effectiveMin}${tag}` };
      }
    }

    return { shouldTrade: false, direction: strategyType === 'DIRECTIONAL_CALL' ? 'CALL' : 'PUT', reason: `得分${score.toFixed(1)}未达阈值±${effectiveMin}` };
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
   */
  private evaluateSpreadStrategy(
    optionRec: any,
    strategyType: 'BULL_SPREAD' | 'BEAR_SPREAD',
    isLate: boolean = false,
    is0DTE: boolean = false
  ): { shouldTrade: boolean; direction: 'CALL' | 'PUT'; reason: string } {
    const thresholds = this.getThresholds(isLate);
    const score = optionRec.finalScore;

    // 0DTE使用更严格阈值
    const effectiveMin = is0DTE
      ? Math.max(thresholds.spreadScoreMin, this.cfg.zdteEntryThreshold ?? 12)
      : thresholds.spreadScoreMin;
    const tag = is0DTE && effectiveMin > thresholds.spreadScoreMin ? '(0DTE加严)' : '';

    if (strategyType === 'BULL_SPREAD') {
      if (score >= effectiveMin) {
        return { shouldTrade: true, direction: 'CALL', reason: `综合得分${score.toFixed(1)}≥${effectiveMin}${tag}，适合牛市价差` };
      }
    } else {
      if (score <= -effectiveMin) {
        return { shouldTrade: true, direction: 'PUT', reason: `综合得分${score.toFixed(1)}≤-${effectiveMin}${tag}，适合熊市价差` };
      }
    }

    return { shouldTrade: false, direction: strategyType === 'BULL_SPREAD' ? 'CALL' : 'PUT', reason: `综合得分${score.toFixed(1)}未达阈值±${effectiveMin}` };
  }

  /**
   * 记录决策日志到 system_logs
   */
  private logDecision(data: OptionDecisionLogData): void {
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
      // 1) 检查交易时间窗口
      const windowCheck = this.isWithinTradeWindow();
      if (!windowCheck.canTrade) {
        logger.debug(`[${symbol}] ${windowCheck.reason}，跳过信号生成`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = windowCheck.reason;
        logData.rejectionCheckpoint = 'trade_window';
        this.logDecision(logData);
        return null;
      }

      // 1.5) 开盘方向确认窗口检查（开盘后N分钟内限制交易方向）
      const directionConfirmMinutes = this.cfg.tradeWindow?.directionConfirmMinutes ?? 30;
      const nowForConfirm = new Date();
      const etFormatterConfirm = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      const etPartsConfirm = etFormatterConfirm.formatToParts(nowForConfirm);
      const etHourConfirm = parseInt(etPartsConfirm.find(p => p.type === 'hour')?.value || '0');
      const etMinuteConfirm = parseInt(etPartsConfirm.find(p => p.type === 'minute')?.value || '0');
      const etMinutesConfirm = etHourConfirm * 60 + etMinuteConfirm;
      const marketOpenMinutes = 9 * 60 + 30; // 9:30 ET
      const minutesSinceOpen = etMinutesConfirm - marketOpenMinutes;
      const isInDirectionConfirmWindow = minutesSinceOpen >= 0 && minutesSinceOpen < directionConfirmMinutes;

      // 1.6) 0DTE 开盘禁入窗口：开盘后 N 分钟内禁止 0DTE 合约，可降级到 1DTE/2DTE
      const zdteCooldownMinutes = this.cfg.tradeWindow?.zdteCooldownMinutes ?? 30;
      const isInZdteCooldown = minutesSinceOpen >= 0 && minutesSinceOpen < zdteCooldownMinutes;
      const expirationMode = this.cfg.expirationMode || '0DTE';
      // 在禁入期内，0DTE模式跳过当日到期合约
      const skip0DTE = expirationMode === '0DTE' && isInZdteCooldown;
      // 如果配置为0DTE模式且不在禁入期，预判为0DTE入场（用于加严阈值）
      const is0DTEEntry = expirationMode === '0DTE' && !isInZdteCooldown;

      if (skip0DTE) {
        logger.info(`[0DTE禁入] ${symbol} 开盘${minutesSinceOpen}分钟内禁止0DTE新仓，将降级选择非0DTE合约`);
      }

      // 2) 获取市场推荐
      const optionRec = await optionRecommendationService.calculateOptionRecommendation(symbol);

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

      // 3.5) 开盘方向确认窗口：前30分钟只允许与大盘方向一致的交易
      if (isInDirectionConfirmWindow) {
        const marketScore = optionRec.marketScore;
        if (marketScore > -5 && marketScore < 5) {
          logger.info(`[方向确认] ${symbol} 开盘${minutesSinceOpen}分钟内，大盘得分${marketScore.toFixed(1)}在[-5,5]区间，趋势不明确，不开仓`);
          logData.finalResult = 'NO_SIGNAL';
          logData.rejectionReason = `开盘方向确认窗口：大盘得分${marketScore.toFixed(1)}趋势不明确`;
          logData.rejectionCheckpoint = 'direction_confirm';
          this.logDecision(logData);
          return null;
        }
        // 大盘偏多只允许 CALL/BULL_SPREAD，偏空只允许 PUT/BEAR_SPREAD
        const allowedDirection = marketScore > 0 ? 'BULLISH' : 'BEARISH';
        logger.info(`[方向确认] ${symbol} 开盘${minutesSinceOpen}分钟内，大盘得分${marketScore.toFixed(1)}，仅允许${allowedDirection === 'BULLISH' ? 'CALL/BULL_SPREAD' : 'PUT/BEAR_SPREAD'}方向`);
      }

      // 4) 遍历启用的策略，找到第一个满足条件的
      const isLate = this.isLatePeriod();
      let selectedStrategy: OptionStrategyType | null = null;
      let direction: 'CALL' | 'PUT' = 'CALL';
      let strategyReason = '';

      for (const strategy of enabledStrategies) {
        let evaluation: { shouldTrade: boolean; direction?: 'CALL' | 'PUT'; reason: string };

        switch (strategy) {
          case 'DIRECTIONAL_CALL':
          case 'DIRECTIONAL_PUT':
            evaluation = this.evaluateDirectionalBuyer(optionRec, strategy, isLate, is0DTEEntry);
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
            evaluation = this.evaluateSpreadStrategy(optionRec, strategy, isLate, is0DTEEntry);
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
          // 方向确认窗口过滤：开盘30分钟内只允许与大盘方向一致的交易
          if (isInDirectionConfirmWindow) {
            const marketScore = optionRec.marketScore;
            const isBullish = marketScore > 0;
            const dirAllowed = isBullish
              ? (evaluation.direction === 'CALL' || strategy === 'BULL_SPREAD')
              : (evaluation.direction === 'PUT' || strategy === 'BEAR_SPREAD');
            if (!dirAllowed) {
              logger.debug(`[${symbol}/${strategy}] 方向确认窗口过滤：大盘${isBullish ? '偏多' : '偏空'}，${evaluation.direction}方向不允许`);
              continue; // 跳过此策略，尝试下一个
            }
          }

          selectedStrategy = strategy;
          direction = evaluation.direction;
          strategyReason = evaluation.reason;
          break;
        }
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

      // 5.5) 连续确认：信号需连续N个评估周期同向达标才允许入场
      const requiredCycles = this.cfg.consecutiveConfirmCycles ?? 2;
      if (requiredCycles > 1) {
        const state = this.consecutiveStates.get(symbol);
        const nowMs = Date.now();
        const expectedDir = direction === 'CALL' ? 'BULLISH' : 'BEARISH';

        if (state && state.direction === expectedDir && (nowMs - state.lastTime) < 15000) {
          // 同方向且在15秒（3个评估周期）容忍窗口内
          state.count++;
          state.lastTime = nowMs;
          if (state.count < requiredCycles) {
            logger.info(`[连续确认] ${symbol} ${expectedDir} ${state.count}/${requiredCycles}，等待下次确认`);
            logData.finalResult = 'NO_SIGNAL';
            logData.rejectionReason = `连续确认 ${state.count}/${requiredCycles}`;
            logData.rejectionCheckpoint = 'consecutive_confirm';
            this.logDecision(logData);
            return null;
          }
          // 达到要求，清除状态并继续
          this.consecutiveStates.delete(symbol);
          logger.info(`[连续确认] ${symbol} ${expectedDir} ${state.count}/${requiredCycles} 通过，允许入场`);
        } else {
          // 首次达标、方向变化或超时 → 重新计数
          this.consecutiveStates.set(symbol, { direction: expectedDir, count: 1, lastTime: nowMs });
          logger.info(`[连续确认] ${symbol} ${expectedDir} 1/${requiredCycles}，等待下次确认`);
          logData.finalResult = 'NO_SIGNAL';
          logData.rejectionReason = `连续确认 1/${requiredCycles}`;
          logData.rejectionCheckpoint = 'consecutive_confirm';
          this.logDecision(logData);
          return null;
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
        skip0DTE,
      });

      if (!selected) {
        logger.warn(`[${symbol}无合约] 未找到合适的期权合约 (${direction}, ${expirationMode})`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = `未找到合适的期权合约 (方向=${direction}, 模式=${expirationMode})`;
        logData.rejectionCheckpoint = 'contract_selection';
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
          contracts = Math.max(1, n - 1);
          logger.debug(`[${symbol}仓位] 预算=${budget.toFixed(2)}, 权利金=${premium.toFixed(2)}, 计算合约数=${contracts}`);
        }
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

