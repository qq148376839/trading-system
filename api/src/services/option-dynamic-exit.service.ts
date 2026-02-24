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
  entryUnderlyingPrice?: number;  // 入场时标的价格（时间止损用）
  timeStopMinutes?: number;       // 该仓位的时间止损 T（波动率分桶）
  rangePct?: number;               // 标的30分钟开盘波动率（VWAP服务返回），用于追踪止盈动态化
  peakPnLPercent?: number;         // 历史最高盈亏百分比（scheduler 追踪），用于精确移动止损
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
        // 高波动：提前锁利，宽松回撤
        baseParams.trailingStopTrigger = 15;
        baseParams.trailingStopPercent = 15;
        reasons.push(`0DTE高波(${ctx.rangePct.toFixed(2)}%),trail=15/15`);
      } else if (ctx.rangePct >= 0.45) {
        // 中波动
        baseParams.trailingStopTrigger = 15;
        baseParams.trailingStopPercent = 12;
        reasons.push(`0DTE中波(${ctx.rangePct.toFixed(2)}%),trail=15/12`);
      } else {
        // 低波动：更紧的回撤保护
        baseParams.trailingStopTrigger = 15;
        baseParams.trailingStopPercent = 10;
        reasons.push(`0DTE低波(${ctx.rangePct.toFixed(2)}%),trail=15/10`);
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

    // 2.5 结构失效止损（Level A）：标的价格反转回 VWAP 另一侧
    if (ctx.vwap && ctx.vwap > 0 && ctx.recentKlines && ctx.recentKlines.length >= 2 && ctx.optionDirection) {
      const last2 = ctx.recentKlines.slice(-2);
      const vwap = ctx.vwap;

      if (ctx.optionDirection === 'PUT') {
        // PUT持仓：标的连续2根1m收盘站回VWAP上方 → 做空结构失效
        const allAbove = last2.every(k => k.close > vwap);
        if (allAbove) {
          return {
            action: 'STOP_LOSS',
            reason: `结构失效：PUT持仓但标的连续2根1m收盘(${last2.map(k => k.close.toFixed(2)).join(',')})站回VWAP(${vwap.toFixed(2)})上方`,
            pnl,
            exitTag: 'structure_invalidation',
          };
        }
      } else if (ctx.optionDirection === 'CALL') {
        // CALL持仓：标的连续2根1m收盘跌破VWAP → 做多结构失效
        const allBelow = last2.every(k => k.close < vwap);
        if (allBelow) {
          return {
            action: 'STOP_LOSS',
            reason: `结构失效：CALL持仓但标的连续2根1m收盘(${last2.map(k => k.close.toFixed(2)).join(',')})跌破VWAP(${vwap.toFixed(2)})`,
            pnl,
            exitTag: 'structure_invalidation',
          };
        }
      }
    }

    // 2.6 时间止损（Level B）：入场后T分钟内未出现顺风延续
    if (ctx.timeStopMinutes && ctx.timeStopMinutes > 0 && ctx.entryUnderlyingPrice && ctx.entryUnderlyingPrice > 0) {
      const holdingMs = now.getTime() - (ctx.entryTime || now).getTime();
      const holdingMin = holdingMs / 60000;
      if (holdingMin >= ctx.timeStopMinutes) {
        // 检查是否有顺风延续
        let hasTailwind = false;

        // 方式A：标的创新低(PUT)/新高(CALL)
        if (ctx.recentKlines && ctx.recentKlines.length > 0) {
          const latestClose = ctx.recentKlines[ctx.recentKlines.length - 1].close;
          if (ctx.optionDirection === 'PUT' && latestClose < ctx.entryUnderlyingPrice) {
            hasTailwind = true; // 标的创新低，PUT有利
          } else if (ctx.optionDirection === 'CALL' && latestClose > ctx.entryUnderlyingPrice) {
            hasTailwind = true; // 标的创新高，CALL有利
          }
        }

        // 方式B：期权mid盈利 >= +5%
        if (pnl.grossPnLPercent >= 5) {
          hasTailwind = true;
        }

        if (!hasTailwind) {
          return {
            action: 'STOP_LOSS',
            reason: `时间止损：持仓${holdingMin.toFixed(0)}min ≥ T=${ctx.timeStopMinutes}min，无顺风延续 | 盈亏=${pnl.grossPnLPercent.toFixed(1)}%`,
            pnl,
            exitTag: 'time_stop_no_tailwind',
          };
        }
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

    // 4. 0DTE PnL 兜底止损（比标准止损更紧，在冷却期逻辑之前检查）
    if (ctx.is0DTE) {
      const zdtePnlFloor = 25; // 0DTE 兜底止损 -25%
      if (pnl.grossPnLPercent <= -zdtePnlFloor) {
        return {
          action: 'STOP_LOSS',
          reason: `0DTE兜底止损：亏损${pnl.grossPnLPercent.toFixed(1)}% ≤ -${zdtePnlFloor}%(0DTE收紧)`,
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
    } else if (holdingMinutes < 3) {
      // 非0DTE 0-3分钟: 仅安全阀生效，跳过常规止损
      // fall through 到下面的安全阀检查
    } else if (holdingMinutes < 10) {
      // 非0DTE 3-10分钟: 止损线放宽1.5倍
      const widenedSL = dynamicParams.stopLossPercent * 1.5;
      if (pnl.grossPnLPercent <= -widenedSL) {
        return {
          action: 'STOP_LOSS',
          reason: `亏损${pnl.grossPnLPercent.toFixed(1)}% ≤ -${widenedSL.toFixed(1)}%(冷静期1.5x, 持仓${holdingMinutes.toFixed(0)}min) | ${dynamicParams.adjustmentReason}`,
          pnl,
        };
      }
    } else {
      // 非0DTE 10+分钟: 标准止损
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
   */
  getMarketCloseTime(date: Date = new Date()): Date {
    // 260225 Fix F: DST 自适应 — 用 Intl API 获取当前 ET 偏移量，不硬编码 -05:00
    // 获取美东时间的日期部分
    const etDateStr = date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const [month, day, year] = etDateStr.split('/').map(Number);

    // 计算当前 UTC 与 ET 的偏移量（自动适应 EST/EDT）
    // 原理：同一个 UTC 时刻，转成 ET 字符串再解析回 Date，差值就是 UTC-ET 偏移
    const utcMs = date.getTime();
    const etStr = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etAsLocal = new Date(etStr);
    const offsetMs = utcMs - etAsLocal.getTime();

    // 构造 ET 16:00:00 的本地时间表示，再加上偏移量得到真实 UTC 时间
    const et1600Local = new Date(year, month - 1, day, 16, 0, 0, 0);
    const closeTimeUtc = new Date(et1600Local.getTime() + offsetMs);

    return closeTimeUtc;
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
