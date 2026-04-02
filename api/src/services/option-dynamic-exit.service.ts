/**
 * 期权动态止盈止损服务
 *
 * 基于时间衰减 + 波动率 + 价格位置的三维动态调整
 *
 * 核心逻辑：
 * 1. 时间维度：随着到期临近，收紧止盈、放宽止损容忍度
 * 2. 价格行为：突破确认后放大目标，假突破后快速止损
 * 3. 波动率：IV飙升时买方放宽止损，IV压缩时降低预期
 * 4. 移动止损：盈利达到一定比例后，止损上移至保本
 *
 * 手续费考虑：
 * - 所有盈亏计算都包含手续费
 * - 实际盈亏 = (卖出价 - 买入价) * 合约数 * 乘数 - 买入手续费 - 卖出手续费
 */

import { getOptionDetail } from './futunn-option-chain.service';
import { isTradingHours } from '../utils/trading-hours';
import longportOptionQuoteService from './longport-option-quote.service';
import { getMarketLocalDate, zonedTimeToUtc, getMarketTimeZone } from '../utils/market-time'; // 规则 #17

// ============================================
// 类型定义
// ============================================

/** 交易时段 */
export type TradingPhase = 'EARLY' | 'MID' | 'LATE' | 'FINAL';

/** 策略类型（买方/卖方） */
export type StrategySide = 'BUYER' | 'SELLER';

/** 动态参数配置 */
export interface DynamicExitParams {
  takeProfitPercent: number;    // 止盈百分比
  stopLossPercent: number;      // 止损百分比
  trailingStopTrigger: number;  // 移动止损触发点（盈利百分比）
  trailingStopPercent: number;  // 移动止损回撤百分比
  adjustmentReason: string;     // 调整原因
}

/** 用户可配置的退出规则覆盖 */
export interface ExitRulesOverride {
  takeProfitPercent?: number;   // 用户配置的止盈%（作为 EARLY 阶段基准）
  stopLossPercent?: number;     // 用户配置的止损%（作为 EARLY 阶段基准）
  non0DTECooldownMinutes?: number;  // 非0DTE入场后冷静期（分钟），默认3
  trailingStopTrigger?: number;     // 追踪止损触发点（盈利%），覆盖阶段默认值
  trailingStopPercent?: number;     // 追踪止损回撤幅度%，覆盖阶段默认值
  profitLockSteps?: { threshold: number; floor: number }[];  // 阶梯锁利台阶，覆盖默认值
  // maxHoldMinutes 已被 theta_bleed 检测替代（见 260402 分析文档）
}

/** 持仓上下文（用于计算动态参数） */
export interface PositionContext {
  entryPrice: number;           // 入场价格（期权premium）
  currentPrice: number;         // 当前价格
  quantity: number;             // 合约数量
  multiplier: number;           // 合约乘数（通常100）
  entryTime: Date;              // 入场时间
  marketCloseTime: Date;        // 当日收盘时间
  strategySide: StrategySide;   // 买方/卖方策略
  entryIV: number;              // 入场时的隐含波动率
  currentIV: number;            // 当前隐含波动率
  entryDelta?: number;          // 入场时的Delta
  currentDelta?: number;        // 当前Delta
  timeValue?: number;           // 当前时间价值
  // 手续费相关
  entryFees: number;            // 入场手续费
  estimatedExitFees: number;    // 预估出场手续费
  // 价格关键位
  dayHigh?: number;             // 当日最高价
  dayLow?: number;              // 当日最低价
  pivotHigh?: number;           // 关键阻力位
  pivotLow?: number;            // 关键支撑位
  // 0DTE 标记
  is0DTE?: boolean;             // 是否为当日到期（末日期权）
  midPrice?: number;            // (bid+ask)/2 中间价，0DTE优先使用（更稳定）
  // Phase 2 结构数据
  optionDirection?: 'CALL' | 'PUT';   // 期权方向
  vwap?: number;                // 标的当日 VWAP
  recentKlines?: { open: number; high: number; low: number; close: number; volume: number; timestamp: number }[];
  rangePct?: number;               // 标的30分钟开盘波动率（VWAP服务返回），用于追踪止盈动态化
  peakPnLPercent?: number;         // 历史最高盈亏百分比（scheduler 追踪），用于精确移动止损
  pnlSnapshots?: { ts: number; pnl: number }[];  // scheduler 每周期记录的 PnL 快照（最近 20 条，用于 theta bleed 检测）
}

/** 盈亏计算结果 */
export interface PnLResult {
  grossPnL: number;             // 毛盈亏（不含手续费）
  netPnL: number;               // 净盈亏（含手续费）
  grossPnLPercent: number;      // 毛盈亏百分比
  netPnLPercent: number;        // 净盈亏百分比
  totalFees: number;            // 总手续费
  breakEvenPrice: number;       // 保本价格（考虑手续费）
}

// ============================================
// 常量配置
// ============================================

/** 默认手续费配置（美股期权） */
export const DEFAULT_FEE_CONFIG = {
  commissionPerContract: 0.65,      // 每张合约佣金
  minCommissionPerOrder: 1.00,      // 最低佣金
  platformFeePerContract: 0.30,     // 平台费（如有）
  regulatoryFeePerContract: 0.02,   // 监管费
};

/** 动态参数表 - 买方策略 */
const BUYER_PARAMS: Record<TradingPhase, Omit<DynamicExitParams, 'adjustmentReason'>> = {
  EARLY: {
    takeProfitPercent: 50,        // 早盘：目标50%盈利
    stopLossPercent: 35,          // 止损35%
    trailingStopTrigger: 30,      // 盈利30%后启用移动止损
    trailingStopPercent: 15,      // 移动止损：从高点回撤15%
  },
  MID: {
    takeProfitPercent: 40,        // 盘中：目标40%盈利
    stopLossPercent: 30,          // 止损30%
    trailingStopTrigger: 25,
    trailingStopPercent: 12,
  },
  LATE: {
    takeProfitPercent: 30,        // 尾盘前：目标30%盈利
    stopLossPercent: 25,          // 止损25%
    trailingStopTrigger: 20,
    trailingStopPercent: 10,
  },
  FINAL: {
    takeProfitPercent: 20,        // 最后阶段：目标20%盈利，快速了结
    stopLossPercent: 20,          // 止损20%
    trailingStopTrigger: 15,
    trailingStopPercent: 8,
  },
};

/** 动态参数表 - 卖方策略 */
const SELLER_PARAMS: Record<TradingPhase, Omit<DynamicExitParams, 'adjustmentReason'>> = {
  EARLY: {
    takeProfitPercent: 30,        // 卖方目标：收取30%权利金
    stopLossPercent: 50,          // 止损：亏损50%权利金
    trailingStopTrigger: 20,
    trailingStopPercent: 10,
  },
  MID: {
    takeProfitPercent: 25,
    stopLossPercent: 40,
    trailingStopTrigger: 15,
    trailingStopPercent: 8,
  },
  LATE: {
    takeProfitPercent: 20,
    stopLossPercent: 30,
    trailingStopTrigger: 12,
    trailingStopPercent: 6,
  },
  FINAL: {
    takeProfitPercent: 15,        // 最后阶段：只追求小利，保本为主
    stopLossPercent: 20,
    trailingStopTrigger: 10,
    trailingStopPercent: 5,
  },
};

/** 阶梯锁利配置 — 盈利达到台阶后锁定最低利润底线（更激进：更早触发、更高底线） */
const PROFIT_LOCK_STEPS = [
  { threshold: 8, floor: 2 },     // 盈利≥8% → 至少赚2%
  { threshold: 12, floor: 6 },    // 盈利≥12% → 至少赚6%
  { threshold: 18, floor: 12 },   // 盈利≥18% → 至少赚12%
  { threshold: 30, floor: 22 },   // 盈利≥30% → 至少赚22%
  { threshold: 50, floor: 38 },   // 盈利≥50% → 至少赚38%
];

// ============================================
// 核心服务类
// ============================================

class OptionDynamicExitService {
  /**
   * 计算当前交易时段
   */
  getTradingPhase(currentTime: Date, marketCloseTime: Date): TradingPhase {
    const msRemaining = marketCloseTime.getTime() - currentTime.getTime();
    const hoursRemaining = msRemaining / (1000 * 60 * 60);

    if (hoursRemaining > 5) {
      return 'EARLY';  // 开盘后约1-2小时
    } else if (hoursRemaining > 2) {
      return 'MID';    // 盘中2-5小时
    } else if (hoursRemaining > 0.5) {
      return 'LATE';   // 最后30分钟-2小时
    } else {
      return 'FINAL';  // 最后30分钟
    }
  }

  /**
   * 获取当前持仓的交易时段（公开 helper，供 TSLPPCT 服务调用）
   */
  getPhaseForPosition(marketCloseTime?: Date): TradingPhase {
    const closeTime = marketCloseTime || this.getMarketCloseTime();
    return this.getTradingPhase(new Date(), closeTime);
  }

  /**
   * 计算盈亏（含手续费）
   */
  calculatePnL(ctx: PositionContext): PnLResult {
    // 防御性数值化：强制 Number() 转换，防止字符串/null/undefined 导致 NaN
    const entryPrice = Number(ctx.entryPrice) || 0;
    const currentPrice = Number(ctx.currentPrice) || 0;
    const quantity = Number(ctx.quantity) || 0;
    const multiplier = Number(ctx.multiplier) || 100;
    const entryFees = Number(ctx.entryFees) || 0;
    const estimatedExitFees = Number(ctx.estimatedExitFees) || 0;

    // 0DTE优先使用mid价格（bid/ask中间价更稳定，避免lastDone跳动放大PnL波动）
    const effectivePrice = (ctx.is0DTE && ctx.midPrice && Number(ctx.midPrice) > 0) ? Number(ctx.midPrice) : currentPrice;

    // 毛盈亏 = (当前价 - 入场价) * 数量 * 乘数
    // 注意：买方做多期权，卖方做空期权（此处统一按买方计算，卖方需反向）
    const isBuyer = ctx.strategySide === 'BUYER';
    const priceDiff = isBuyer ? (effectivePrice - entryPrice) : (entryPrice - effectivePrice);
    const grossPnL = priceDiff * quantity * multiplier;

    // 净盈亏 = 毛盈亏 - 入场手续费 - 出场手续费
    const totalFees = entryFees + estimatedExitFees;
    const netPnL = grossPnL - totalFees;

    // 成本基础 = 入场价 * 数量 * 乘数 + 入场手续费
    const costBasis = entryPrice * quantity * multiplier + entryFees;

    // 盈亏百分比
    let grossPnLPercent = costBasis > 0 ? (grossPnL / costBasis) * 100 : 0;
    let netPnLPercent = costBasis > 0 ? (netPnL / costBasis) * 100 : 0;

    // 安全回退：当 costBasis 异常（<=0 或 NaN）但有价格差异时，使用简化公式
    if ((!isFinite(grossPnLPercent) || (grossPnL !== 0 && grossPnLPercent === 0)) && entryPrice > 0) {
      grossPnLPercent = (priceDiff / entryPrice) * 100;
      netPnLPercent = entryPrice > 0 ? ((priceDiff / entryPrice) * 100) - ((totalFees / (entryPrice * quantity * multiplier || 1)) * 100) : 0;
      // 诊断日志：帮助追踪 costBasis 异常原因
      console.warn(
        `[PnL诊断] costBasis异常，启用回退公式 | ` +
        `entryPrice=${ctx.entryPrice}(type=${typeof ctx.entryPrice}) ` +
        `quantity=${ctx.quantity}(type=${typeof ctx.quantity}) ` +
        `multiplier=${ctx.multiplier}(type=${typeof ctx.multiplier}) ` +
        `entryFees=${ctx.entryFees}(type=${typeof ctx.entryFees}) ` +
        `costBasis=${costBasis} grossPnL=${grossPnL.toFixed(2)} ` +
        `回退grossPnLPercent=${grossPnLPercent.toFixed(2)}%`
      );
    }

    // 最终 NaN 兜底
    if (!isFinite(grossPnLPercent)) grossPnLPercent = 0;
    if (!isFinite(netPnLPercent)) netPnLPercent = 0;

    // 保本价格 = 入场价 + (总手续费 / 数量 / 乘数)
    const breakEvenPrice = (quantity > 0 && multiplier > 0)
      ? (isBuyer
          ? entryPrice + (totalFees / quantity / multiplier)
          : entryPrice - (totalFees / quantity / multiplier))
      : entryPrice;

    return {
      grossPnL,
      netPnL,
      grossPnLPercent,
      netPnLPercent,
      totalFees,
      breakEvenPrice,
    };
  }

  /**
   * 计算手续费
   */
  calculateFees(
    quantity: number,
    feeConfig: typeof DEFAULT_FEE_CONFIG = DEFAULT_FEE_CONFIG
  ): number {
    const commission = Math.max(
      quantity * feeConfig.commissionPerContract,
      feeConfig.minCommissionPerOrder
    );
    const platformFee = quantity * feeConfig.platformFeePerContract;
    const regulatoryFee = quantity * feeConfig.regulatoryFeePerContract;
    return commission + platformFee + regulatoryFee;
  }

  /**
   * 获取动态止盈止损参数
   *
   * 核心逻辑：
   * 1. 基于时间获取基础参数
   * 2. 基于波动率调整参数
   * 3. 基于价格行为调整参数
   * 4. 应用移动止损逻辑
   */
  getDynamicExitParams(ctx: PositionContext, exitRulesOverride?: ExitRulesOverride): DynamicExitParams {
    const now = new Date();
    const phase = this.getTradingPhase(now, ctx.marketCloseTime);

    // 1. 获取基础参数（基于时间和策略类型）
    const baseParams = ctx.strategySide === 'BUYER'
      ? { ...BUYER_PARAMS[phase] }
      : { ...SELLER_PARAMS[phase] };

    // 用户配置缩放：以 EARLY 阶段为基准，按时间阶段比例递减
    if (exitRulesOverride) {
      const refParams = ctx.strategySide === 'BUYER' ? BUYER_PARAMS.EARLY : SELLER_PARAMS.EARLY;
      if (exitRulesOverride.takeProfitPercent && exitRulesOverride.takeProfitPercent > 0) {
        const ratio = baseParams.takeProfitPercent / refParams.takeProfitPercent;
        baseParams.takeProfitPercent = Math.round(exitRulesOverride.takeProfitPercent * ratio);
      }
      if (exitRulesOverride.stopLossPercent && exitRulesOverride.stopLossPercent > 0) {
        const ratio = baseParams.stopLossPercent / refParams.stopLossPercent;
        baseParams.stopLossPercent = Math.round(exitRulesOverride.stopLossPercent * ratio);
      }
      // 追踪止损参数覆盖（直接使用用户值，不缩放——用户明确设定的值应被尊重）
      if (exitRulesOverride.trailingStopTrigger && exitRulesOverride.trailingStopTrigger > 0) {
        baseParams.trailingStopTrigger = exitRulesOverride.trailingStopTrigger;
      }
      if (exitRulesOverride.trailingStopPercent && exitRulesOverride.trailingStopPercent > 0) {
        baseParams.trailingStopPercent = exitRulesOverride.trailingStopPercent;
      }
    }

    const reasons: string[] = [`时段=${phase}`];

    // 2. 波动率调整
    if (ctx.entryIV > 0 && ctx.currentIV > 0) {
      const ivChange = (ctx.currentIV - ctx.entryIV) / ctx.entryIV;

      if (ivChange > 0.2) {
        // IV上升超过20%
        if (ctx.strategySide === 'BUYER') {
          // 买方：IV上升有利，可放宽止损
          baseParams.stopLossPercent = Math.min(baseParams.stopLossPercent + 10, 50);
          reasons.push(`IV↑${(ivChange * 100).toFixed(0)}%,放宽止损`);
        } else {
          // 卖方：IV上升不利，收紧止损
          baseParams.stopLossPercent = Math.max(baseParams.stopLossPercent - 10, 15);
          reasons.push(`IV↑${(ivChange * 100).toFixed(0)}%,收紧止损`);
        }
      } else if (ivChange < -0.2) {
        // IV下降超过20%
        if (ctx.strategySide === 'BUYER') {
          // 买方：IV下降不利，降低预期
          baseParams.takeProfitPercent = Math.max(baseParams.takeProfitPercent - 10, 15);
          reasons.push(`IV↓${(ivChange * 100).toFixed(0)}%,降低预期`);
        } else {
          // 卖方：IV下降有利，可放宽止盈目标
          baseParams.takeProfitPercent = Math.min(baseParams.takeProfitPercent + 5, 40);
          reasons.push(`IV↓${(ivChange * 100).toFixed(0)}%,扩大目标`);
        }
      }
    }

    // 3. 时间价值检查（买方策略）
    if (ctx.strategySide === 'BUYER' && ctx.timeValue !== undefined) {
      if (ctx.timeValue < 0.1 && phase === 'FINAL') {
        // 时间价值几乎为零，压缩目标
        baseParams.takeProfitPercent = Math.min(baseParams.takeProfitPercent, 15);
        baseParams.stopLossPercent = Math.min(baseParams.stopLossPercent, 15);
        reasons.push(`时间价值≈0,快速了结`);
      }
    }

    // 4. 价格行为调整（突破检测，使用 grossPnLPercent 避免 NaN）
    const pnl = this.calculatePnL(ctx);
    if (pnl.grossPnLPercent > 0 && ctx.dayHigh && ctx.dayLow) {
      const priceRange = ctx.dayHigh - ctx.dayLow;
      const currentRelativePosition = priceRange > 0
        ? (ctx.currentPrice - ctx.dayLow) / priceRange
        : 0.5;

      // 如果当前价格在日内高位（>80%）且盈利
      if (currentRelativePosition > 0.8 && pnl.grossPnLPercent > 20) {
        baseParams.takeProfitPercent = Math.min(baseParams.takeProfitPercent + 15, 80);
        reasons.push(`突破日高,扩大目标`);
      }
    }

    // 5. 移动止损逻辑（已盈利时）
    // 0DTE 波动率分桶：根据 rangePct 动态调整 trigger / trail（rangePct 为百分比，如 0.65 表示 0.65%）
    if (ctx.is0DTE && ctx.rangePct !== undefined && ctx.rangePct > 0) {
      if (ctx.rangePct >= 0.65) {
        // 高波动：早触发，收紧回撤（减少高位利润回吐）
        baseParams.trailingStopTrigger = 8;
        baseParams.trailingStopPercent = 12;
        reasons.push(`0DTE高波(${ctx.rangePct.toFixed(2)}%),trail=8/12`);
      } else if (ctx.rangePct >= 0.45) {
        // 中波动
        baseParams.trailingStopTrigger = 8;
        baseParams.trailingStopPercent = 10;
        reasons.push(`0DTE中波(${ctx.rangePct.toFixed(2)}%),trail=8/10`);
      } else {
        // 低波动：早触发，紧回撤
        baseParams.trailingStopTrigger = 8;
        baseParams.trailingStopPercent = 8;
        reasons.push(`0DTE低波(${ctx.rangePct.toFixed(2)}%),trail=8/8`);
      }
    }

    if (pnl.grossPnLPercent >= baseParams.trailingStopTrigger) {
      // 触发移动止损：止损价上移至保本
      reasons.push(`盈利${pnl.grossPnLPercent.toFixed(1)}%≥${baseParams.trailingStopTrigger}%,启用移动止损`);
    }

    return {
      ...baseParams,
      adjustmentReason: reasons.join('; '),
    };
  }

  /**
   * 检查是否应该平仓
   *
   * 返回：
   * - null: 不需要平仓
   * - { action: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'TIME_STOP', reason: string }
   */
  checkExitCondition(
    ctx: PositionContext,
    params?: DynamicExitParams,
    exitRulesOverride?: ExitRulesOverride
  ): { action: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'TIME_STOP'; reason: string; pnl: PnLResult; exitTag?: string } | null {
    const dynamicParams = params || this.getDynamicExitParams(ctx, exitRulesOverride);
    const pnl = this.calculatePnL(ctx);
    const now = new Date();

    // 0. 0DTE 强制平仓：收盘前180分钟（1:00 PM ET），末日期权不论盈亏全部市价平仓
    const msToClose = ctx.marketCloseTime.getTime() - now.getTime();
    const minutesToClose = msToClose / (1000 * 60);
    if (ctx.is0DTE && minutesToClose <= 180 && minutesToClose > 0) {
      return {
        action: 'TIME_STOP',
        reason: `0DTE期权收盘前${minutesToClose.toFixed(0)}分钟，强制平仓 | 盈亏=${pnl.grossPnLPercent.toFixed(1)}%`,
        pnl,
        exitTag: '0dte_time_stop',
      };
    }

    // 1. 时间止损：收盘前10分钟强制平仓（非0DTE）
    if (minutesToClose <= 10 && minutesToClose > 0) {
      return {
        action: 'TIME_STOP',
        reason: `收盘前${minutesToClose.toFixed(0)}分钟，时间止损 | 盈亏=${pnl.grossPnLPercent.toFixed(1)}%`,
        pnl,
      };
    }

    // 2. 止盈检查（使用 grossPnLPercent：美股T+1结算，手续费数据不可靠）
    if (pnl.grossPnLPercent >= dynamicParams.takeProfitPercent) {
      return {
        action: 'TAKE_PROFIT',
        reason: `盈利${pnl.grossPnLPercent.toFixed(1)}% ≥ 目标${dynamicParams.takeProfitPercent}% | ${dynamicParams.adjustmentReason}`,
        pnl,
      };
    }

    // 2.8 阶梯锁利检查 — 盈利踩上台阶后不允许跌回下一台阶
    // 使用 peakPnLPercent（历史最高盈利）确定锁定的底线
    const lockSteps = exitRulesOverride?.profitLockSteps?.length
      ? exitRulesOverride.profitLockSteps
      : PROFIT_LOCK_STEPS;
    const peakForLock = Math.max(ctx.peakPnLPercent ?? 0, pnl.grossPnLPercent);
    if (peakForLock >= lockSteps[0].threshold) {
      // 找到峰值对应的最高台阶
      let lockedFloor = 0;
      let lockedThreshold = lockSteps[0].threshold;
      for (const step of lockSteps) {
        if (peakForLock >= step.threshold) {
          lockedFloor = step.floor;
          lockedThreshold = step.threshold;
        } else {
          break;
        }
      }
      // 当前盈利跌破底线 → 触发锁利退出
      if (pnl.grossPnLPercent <= lockedFloor) {
        return {
          action: 'TRAILING_STOP',
          reason: `阶梯锁利：峰值${peakForLock.toFixed(1)}%踩上${lockedThreshold}%台阶，底线${lockedFloor}%，当前${pnl.grossPnLPercent.toFixed(1)}% ≤ 底线`,
          pnl,
          exitTag: 'ratchet_profit_lock',
        };
      }
    }

    // 3. 移动止损检查
    if (pnl.grossPnLPercent >= dynamicParams.trailingStopTrigger ||
        (ctx.peakPnLPercent !== undefined && ctx.peakPnLPercent >= dynamicParams.trailingStopTrigger)) {
      // 使用 scheduler 追踪的 peakPnLPercent（更精确），否则用当前值
      const peakPnLPercent = Math.max(
        ctx.peakPnLPercent ?? 0,
        pnl.grossPnLPercent
      );

      const drawdown = peakPnLPercent - pnl.grossPnLPercent;
      if (drawdown >= dynamicParams.trailingStopPercent) {
        return {
          action: 'TRAILING_STOP',
          reason: `移动止损触发：峰值${peakPnLPercent.toFixed(1)}% → 当前${pnl.grossPnLPercent.toFixed(1)}%，回撤${drawdown.toFixed(1)}% ≥ ${dynamicParams.trailingStopPercent}%`,
          pnl,
          exitTag: 'trailing_stop',
        };
      }
    }

    // 3.5 Theta Bleed 检测（替代固定计时器 maxHoldMinutes，基于 PnL 轨迹斜率）
    // 参数推导: 63 笔实测交易数据，见 docs/analysis/260402-PnL轨迹检测方案第一性原理分析.md
    const holdingMinutesForBleed = (now.getTime() - (ctx.entryTime || now).getTime()) / 60000;
    const BLEED_WARMUP = 5;           // 预热期: 2× 盈利交易平均持仓 2.5min
    const BLEED_STEEP = -0.5;         // %/min: 超此斜率 = 方向错误（最缓方向错 -0.60 的上方）
    const BLEED_PNL_UPPER = 4;        // 与阶梯锁利第一台阶对齐
    const BLEED_PNL_LOWER = -10;      // 不抢 STOP_LOSS (20%) 的管辖
    const BLEED_PEAK_THRESHOLD = 4;   // 曾盈利 ≥4% = 有方向证据，不算 theta bleed
    const BLEED_LOOKBACK_MS = 3 * 60 * 1000; // 3 分钟回看窗口
    const BLEED_MIN_SNAPSHOTS = 8;    // 至少 8 条快照（~2min @15s）才做线性回归

    if (holdingMinutesForBleed >= BLEED_WARMUP
        && (ctx.peakPnLPercent ?? 0) < BLEED_PEAK_THRESHOLD
        && pnl.grossPnLPercent >= BLEED_PNL_LOWER
        && pnl.grossPnLPercent < BLEED_PNL_UPPER) {

      const snapshots = (ctx.pnlSnapshots ?? [])
        .filter(s => now.getTime() - s.ts < BLEED_LOOKBACK_MS);

      if (snapshots.length >= BLEED_MIN_SNAPSHOTS) {
        // 线性回归斜率（平滑微幅波动）
        const n = snapshots.length;
        const tMean = snapshots.reduce((sum, s) => sum + s.ts, 0) / n;
        const pMean = snapshots.reduce((sum, s) => sum + s.pnl, 0) / n;
        let num = 0;
        let den = 0;
        for (const s of snapshots) {
          num += (s.ts - tMean) * (s.pnl - pMean);
          den += (s.ts - tMean) ** 2;
        }
        const slopePerMs = den > 0 ? num / den : 0;
        const slopePerMin = slopePerMs * 60000; // 转为 %/min

        // 核心判断: slope 在 (BLEED_STEEP, 0] = theta bleed（非方向错误）
        const isBleed = slopePerMin > BLEED_STEEP && slopePerMin <= 0;

        // 连续非改善: 窗口内所有点 ≤ 首点 + 0.5% 容差
        const baseline = snapshots[0].pnl;
        const allNonImproving = snapshots.every(s => s.pnl <= baseline + 0.5);

        if (isBleed && allNonImproving) {
          return {
            action: 'TIME_STOP',
            reason: `Theta侵蚀检测：持仓${holdingMinutesForBleed.toFixed(0)}min，slope=${slopePerMin.toFixed(3)}%/min（${n}点回归），PnL=${pnl.grossPnLPercent.toFixed(1)}%`,
            pnl,
            exitTag: 'theta_bleed',
          };
        }
      }
    }

    // 4. 0DTE PnL 兜底止损（使用策略配置止损，在冷却期逻辑之前检查）
    if (ctx.is0DTE) {
      const zdtePnlFloor = dynamicParams.stopLossPercent; // 与策略配置一致
      if (pnl.grossPnLPercent <= -zdtePnlFloor) {
        return {
          action: 'STOP_LOSS',
          reason: `0DTE兜底止损：亏损${pnl.grossPnLPercent.toFixed(1)}% ≤ -${zdtePnlFloor}%(0DTE策略止损)`,
          pnl,
          exitTag: '0dte_pnl_floor',
        };
      }
    }

    // 5. 止损检查（持仓时间感知冷静期，使用 grossPnLPercent）
    const holdingMinutes = (now.getTime() - (ctx.entryTime || now).getTime()) / 60000;

    if (ctx.is0DTE) {
      // 0DTE：禁用冷却期放宽，全程使用标准止损阈值
      if (pnl.grossPnLPercent <= -dynamicParams.stopLossPercent) {
        return {
          action: 'STOP_LOSS',
          reason: `亏损${pnl.grossPnLPercent.toFixed(1)}% ≤ -${dynamicParams.stopLossPercent}%(0DTE不放宽, 持仓${holdingMinutes.toFixed(0)}min) | ${dynamicParams.adjustmentReason}`,
          pnl,
          exitTag: '0dte_stop_loss_no_widen',
        };
      }
    } else if (holdingMinutes < (exitRulesOverride?.non0DTECooldownMinutes ?? 3)) {
      // 非0DTE 冷静期内: 仅安全阀生效，跳过常规止损
      // fall through 到下面的安全阀检查
    } else if (holdingMinutes < (exitRulesOverride?.non0DTECooldownMinutes ?? 3) + 7) {
      // 非0DTE 冷静期~冷静期+7分钟: 止损线放宽1.5倍
      const widenedSL = dynamicParams.stopLossPercent * 1.5;
      if (pnl.grossPnLPercent <= -widenedSL) {
        return {
          action: 'STOP_LOSS',
          reason: `亏损${pnl.grossPnLPercent.toFixed(1)}% ≤ -${widenedSL.toFixed(1)}%(冷静期1.5x, 持仓${holdingMinutes.toFixed(0)}min) | ${dynamicParams.adjustmentReason}`,
          pnl,
        };
      }
    } else {
      // 非0DTE 冷静期+7分钟后: 标准止损
      if (pnl.grossPnLPercent <= -dynamicParams.stopLossPercent) {
        return {
          action: 'STOP_LOSS',
          reason: `亏损${pnl.grossPnLPercent.toFixed(1)}% ≤ -${dynamicParams.stopLossPercent}% | ${dynamicParams.adjustmentReason}`,
          pnl,
        };
      }
    }

    // 6. 强制止损：单笔最大亏损限制（安全阀）
    const maxLossPercent = 40; // 单笔最大亏损40%（硬上限，无视冷静期）
    if (pnl.grossPnLPercent <= -maxLossPercent) {
      return {
        action: 'STOP_LOSS',
        reason: `强制止损：亏损${pnl.grossPnLPercent.toFixed(1)}%超过安全阈值${maxLossPercent}%`,
        pnl,
      };
    }

    return null;
  }

  /**
   * 获取美股收盘时间（美东时间16:00）
   * 使用统一 market-time 模块（Intl.formatToParts 迭代收敛），自动处理 DST // 规则 #17
   */
  getMarketCloseTime(date: Date = new Date()): Date {
    const { year, month, day } = getMarketLocalDate(date, 'US'); // 规则 #17
    const timeZone = getMarketTimeZone('US'); // 规则 #17
    return zonedTimeToUtc({ year, month, day, hour: 16, minute: 0, timeZone }); // 规则 #17
  }

  /**
   * 从期权详情构建持仓上下文
   */
  async buildPositionContext(
    optionSymbol: string,
    entryPrice: number,
    currentPrice: number,
    quantity: number,
    entryTime: Date,
    strategySide: StrategySide,
    optionId?: string,
    underlyingStockId?: string,
    marketType: number = 2,
    entryFees: number = 0
  ): Promise<PositionContext> {
    const now = new Date();
    const marketCloseTime = this.getMarketCloseTime(now);
    const multiplier = 100; // 美股期权标准乘数

    // 计算预估出场手续费
    const estimatedExitFees = this.calculateFees(quantity);

    // 如果入场手续费未提供，估算它
    const actualEntryFees = entryFees > 0 ? entryFees : this.calculateFees(quantity);

    // 基础上下文
    const ctx: PositionContext = {
      entryPrice,
      currentPrice,
      quantity,
      multiplier,
      entryTime,
      marketCloseTime,
      strategySide,
      entryIV: 0,
      currentIV: 0,
      entryFees: actualEntryFees,
      estimatedExitFees,
    };

    // 主源：LongPort optionQuote 获取 IV
    try {
      const optQuote = await longportOptionQuoteService.getOptionQuote(optionSymbol);
      if (optQuote && optQuote.iv > 0) {
        ctx.currentIV = optQuote.iv;
      }
    } catch {
      // 忽略错误，降级到富途
    }

    // 备用：富途 getOptionDetail（含 IV + Delta + timeValue）
    if ((ctx.currentIV <= 0 || !ctx.currentDelta) && optionId && underlyingStockId) {
      try {
        const detail = await getOptionDetail(optionId, underlyingStockId, marketType);
        if (detail && detail.option) {
          if (ctx.currentIV <= 0) {
            ctx.currentIV = detail.option.impliedVolatility || 0;
          }
          ctx.currentDelta = detail.option.greeks?.hpDelta || detail.option.greeks?.delta || 0;
          ctx.timeValue = detail.option.timeValue || 0;
        }
      } catch {
        // 忽略错误，使用默认值
      }
    }

    return ctx;
  }

  /**
   * 格式化盈亏信息（用于日志）
   */
  formatPnLInfo(pnl: PnLResult, ctx: PositionContext): string {
    const { netPnL, netPnLPercent, totalFees, breakEvenPrice } = pnl;
    const sign = netPnL >= 0 ? '+' : '';
    return `净盈亏=${sign}$${netPnL.toFixed(2)} (${sign}${netPnLPercent.toFixed(1)}%), ` +
           `手续费=$${totalFees.toFixed(2)}, ` +
           `保本价=$${breakEvenPrice.toFixed(2)}, ` +
           `当前价=$${ctx.currentPrice.toFixed(2)}`;
  }
}

// 导出单例
export const optionDynamicExitService = new OptionDynamicExitService();
export default optionDynamicExitService;
