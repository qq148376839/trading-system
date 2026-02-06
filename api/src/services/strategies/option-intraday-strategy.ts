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
    noNewEntryBeforeCloseMinutes: 60,
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
    directionalScoreMin: 15,      // 单边买方最低得分
    spreadScoreMin: 20,           // 价差策略最低得分
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
   * 获取入场阈值（根据风险偏好）
   */
  private getThresholds() {
    const pref = this.cfg.riskPreference || 'CONSERVATIVE';
    return ENTRY_THRESHOLDS[pref];
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

    if (strategyType === 'DIRECTIONAL_CALL') {
      // CALL: 需要正分数超过阈值
      if (score >= thresholds.directionalScoreMin) {
        return { shouldTrade: true, direction: 'CALL', reason: `看涨信号得分${score.toFixed(1)}≥${thresholds.directionalScoreMin}` };
      }
    } else {
      // PUT: 需要负分数超过阈值（绝对值）
      if (score <= -thresholds.directionalScoreMin) {
        return { shouldTrade: true, direction: 'PUT', reason: `看跌信号得分${score.toFixed(1)}≤-${thresholds.directionalScoreMin}` };
      }
    }

    return { shouldTrade: false, direction: strategyType === 'DIRECTIONAL_CALL' ? 'CALL' : 'PUT', reason: `得分${score.toFixed(1)}未达阈值±${thresholds.directionalScoreMin}` };
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
    strategyType: 'BULL_SPREAD' | 'BEAR_SPREAD'
  ): { shouldTrade: boolean; direction: 'CALL' | 'PUT'; reason: string } {
    const thresholds = this.getThresholds();
    const marketScore = optionRec.marketScore;

    if (strategyType === 'BULL_SPREAD') {
      if (marketScore >= thresholds.spreadScoreMin) {
        return { shouldTrade: true, direction: 'CALL', reason: `大盘得分${marketScore.toFixed(1)}≥${thresholds.spreadScoreMin}，适合牛市价差` };
      }
    } else {
      if (marketScore <= -thresholds.spreadScoreMin) {
        return { shouldTrade: true, direction: 'PUT', reason: `大盘得分${marketScore.toFixed(1)}≤-${thresholds.spreadScoreMin}，适合熊市价差` };
      }
    }

    return { shouldTrade: false, direction: strategyType === 'BULL_SPREAD' ? 'CALL' : 'PUT', reason: `大盘得分${marketScore.toFixed(1)}未达阈值±${thresholds.spreadScoreMin}` };
  }

  /**
   * 记录决策日志到 system_logs
   */
  private logDecision(data: OptionDecisionLogData): void {
    const level = data.finalResult === 'SIGNAL_GENERATED' ? 'info' :
                  data.finalResult === 'ERROR' ? 'error' : 'info';

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
        console.log(`📍 [${symbol}] ${windowCheck.reason}，跳过信号生成`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = windowCheck.reason;
        logData.rejectionCheckpoint = 'trade_window';
        this.logDecision(logData);
        return null;
      }

      // 2) 获取市场推荐
      const optionRec = await optionRecommendationService.calculateOptionRecommendation(symbol);

      logData.marketScore = optionRec.marketScore;
      logData.intradayScore = optionRec.intradayScore;
      logData.finalScore = optionRec.finalScore;
      logData.signalDirection = optionRec.direction;
      logData.riskLevel = optionRec.riskLevel;

      console.log(`📊 [期权推荐] ${symbol}:`, {
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
        console.warn(`⚠️ [${symbol}跳过] 风险等级EXTREME，不生成信号`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = '风险等级为EXTREME，市场环境不适合交易';
        logData.rejectionCheckpoint = 'risk_check';
        this.logDecision(logData);
        return null;
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

        console.log(`📍 [${symbol}/${strategy}] ${evaluation.reason}`);

        if (evaluation.shouldTrade && evaluation.direction) {
          selectedStrategy = strategy;
          direction = evaluation.direction;
          strategyReason = evaluation.reason;
          break;
        }
      }

      // 5) 如果没有策略满足条件
      if (!selectedStrategy) {
        console.log(`📍 [${symbol}] 所有策略条件均不满足，不生成信号`);
        logData.finalResult = 'NO_SIGNAL';
        logData.rejectionReason = '所有启用的策略条件均不满足';
        logData.rejectionCheckpoint = 'strategy_evaluation';
        this.logDecision(logData);
        return null;
      }

      logData.selectedStrategy = selectedStrategy;

      // 6) 选择合约
      const expirationMode = this.cfg.expirationMode || '0DTE';
      const selected = await selectOptionContract({
        underlyingSymbol: symbol,
        expirationMode,
        direction,
        candidateStrikes: 8,
        liquidityFilters: this.cfg.liquidityFilters,
        greekFilters: this.cfg.greekFilters,
      });

      if (!selected) {
        console.warn(`❌ [${symbol}无合约] 未找到合适的期权合约 (${direction}, ${expirationMode})`);
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
        console.warn(`❌ [${symbol}价格无效] ${entryPriceMode}价格=${premium}，无法下单`);
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
            console.log(`📍 [${symbol}资金] 可用资金=${availableCapital.toFixed(2)}, 单标的上限=${maxPositionPerSymbol.toFixed(2)}, 预算=${budget.toFixed(2)}`);
          } catch (error: any) {
            console.warn(`⚠️ [${symbol}] 获取可用资金失败: ${error.message}，使用默认1张合约`);
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
          console.log(`📍 [${symbol}仓位] 预算=${budget.toFixed(2)}, 权利金=${premium.toFixed(2)}, 计算合约数=${contracts}`);
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

      console.log(
        `✅ [${symbol}/${selectedStrategy}] ${direction} ${selected.optionSymbol} | 合约=${contracts}, 权利金=$${premium.toFixed(2)}, 预估成本=$${est.totalCost.toFixed(2)}`
      );

      return intent;

    } catch (error: any) {
      console.error(`❌ [${symbol}策略执行失败]:`, error.message);
      logData.finalResult = 'ERROR';
      logData.rejectionReason = `策略执行异常: ${error.message}`;
      logData.rejectionCheckpoint = 'error_handler';
      this.logDecision(logData);
      return null;
    }
  }
}

