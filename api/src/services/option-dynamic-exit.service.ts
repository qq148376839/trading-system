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
   * 计算盈亏（含手续费）
   */
  calculatePnL(ctx: PositionContext): PnLResult {
    const { entryPrice, currentPrice, quantity, multiplier, entryFees, estimatedExitFees } = ctx;

    // 毛盈亏 = (当前价 - 入场价) * 数量 * 乘数
    // 注意：买方做多期权，卖方做空期权（此处统一按买方计算，卖方需反向）
    const isBuyer = ctx.strategySide === 'BUYER';
    const priceDiff = isBuyer ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
    const grossPnL = priceDiff * quantity * multiplier;

    // 净盈亏 = 毛盈亏 - 入场手续费 - 出场手续费
    const totalFees = entryFees + estimatedExitFees;
    const netPnL = grossPnL - totalFees;

    // 成本基础 = 入场价 * 数量 * 乘数 + 入场手续费
    const costBasis = entryPrice * quantity * multiplier + entryFees;

    // 盈亏百分比
    const grossPnLPercent = costBasis > 0 ? (grossPnL / costBasis) * 100 : 0;
    const netPnLPercent = costBasis > 0 ? (netPnL / costBasis) * 100 : 0;

    // 保本价格 = 入场价 + (总手续费 / 数量 / 乘数)
    const breakEvenPrice = isBuyer
      ? entryPrice + (totalFees / quantity / multiplier)
      : entryPrice - (totalFees / quantity / multiplier);

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
  getDynamicExitParams(ctx: PositionContext): DynamicExitParams {
    const now = new Date();
    const phase = this.getTradingPhase(now, ctx.marketCloseTime);

    // 1. 获取基础参数（基于时间和策略类型）
    const baseParams = ctx.strategySide === 'BUYER'
      ? { ...BUYER_PARAMS[phase] }
      : { ...SELLER_PARAMS[phase] };

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

    // 4. 价格行为调整（突破检测）
    const pnl = this.calculatePnL(ctx);
    if (pnl.netPnLPercent > 0 && ctx.dayHigh && ctx.dayLow) {
      const priceRange = ctx.dayHigh - ctx.dayLow;
      const currentRelativePosition = priceRange > 0
        ? (ctx.currentPrice - ctx.dayLow) / priceRange
        : 0.5;

      // 如果当前价格在日内高位（>80%）且盈利
      if (currentRelativePosition > 0.8 && pnl.netPnLPercent > 20) {
        baseParams.takeProfitPercent = Math.min(baseParams.takeProfitPercent + 15, 80);
        reasons.push(`突破日高,扩大目标`);
      }
    }

    // 5. 移动止损逻辑（已盈利时）
    if (pnl.netPnLPercent >= baseParams.trailingStopTrigger) {
      // 触发移动止损：止损价上移至保本
      reasons.push(`盈利${pnl.netPnLPercent.toFixed(1)}%≥${baseParams.trailingStopTrigger}%,启用移动止损`);
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
    params?: DynamicExitParams
  ): { action: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'TIME_STOP'; reason: string; pnl: PnLResult } | null {
    const dynamicParams = params || this.getDynamicExitParams(ctx);
    const pnl = this.calculatePnL(ctx);
    const now = new Date();

    // 1. 时间止损：收盘前10分钟强制平仓
    const msToClose = ctx.marketCloseTime.getTime() - now.getTime();
    const minutesToClose = msToClose / (1000 * 60);
    if (minutesToClose <= 10 && minutesToClose > 0) {
      return {
        action: 'TIME_STOP',
        reason: `收盘前${minutesToClose.toFixed(0)}分钟，时间止损 | 净盈亏=${pnl.netPnLPercent.toFixed(1)}%`,
        pnl,
      };
    }

    // 2. 止盈检查
    if (pnl.netPnLPercent >= dynamicParams.takeProfitPercent) {
      return {
        action: 'TAKE_PROFIT',
        reason: `净盈利${pnl.netPnLPercent.toFixed(1)}% ≥ 目标${dynamicParams.takeProfitPercent}% | ${dynamicParams.adjustmentReason}`,
        pnl,
      };
    }

    // 3. 移动止损检查
    if (pnl.netPnLPercent >= dynamicParams.trailingStopTrigger) {
      // 已触发移动止损，检查回撤
      // 注意：这里需要追踪历史最高盈利，简化实现使用当前检查
      // 实际应该在context中记录peakPnLPercent
      const peakPnLPercent = ctx.currentPrice > ctx.entryPrice
        ? pnl.netPnLPercent * 1.1  // 假设当前接近峰值（实际应追踪）
        : pnl.netPnLPercent;

      const drawdown = peakPnLPercent - pnl.netPnLPercent;
      if (drawdown >= dynamicParams.trailingStopPercent) {
        return {
          action: 'TRAILING_STOP',
          reason: `移动止损触发：从峰值回撤${drawdown.toFixed(1)}% ≥ ${dynamicParams.trailingStopPercent}%`,
          pnl,
        };
      }
    }

    // 4. 止损检查（持仓时间感知冷静期）
    const holdingMinutes = (now.getTime() - (ctx.entryTime || now).getTime()) / 60000;

    if (holdingMinutes < 3) {
      // 0-3分钟: 仅安全阀(50%)生效，跳过常规止损
      // fall through 到下面的安全阀检查
    } else if (holdingMinutes < 10) {
      // 3-10分钟: 止损线放宽1.5倍
      const widenedSL = dynamicParams.stopLossPercent * 1.5;
      if (pnl.netPnLPercent <= -widenedSL) {
        return {
          action: 'STOP_LOSS',
          reason: `净亏损${pnl.netPnLPercent.toFixed(1)}% ≤ -${widenedSL.toFixed(1)}%(冷静期1.5x, 持仓${holdingMinutes.toFixed(0)}min) | ${dynamicParams.adjustmentReason}`,
          pnl,
        };
      }
    } else {
      // 10+分钟: 标准止损（原逻辑）
      if (pnl.netPnLPercent <= -dynamicParams.stopLossPercent) {
        return {
          action: 'STOP_LOSS',
          reason: `净亏损${pnl.netPnLPercent.toFixed(1)}% ≤ -${dynamicParams.stopLossPercent}% | ${dynamicParams.adjustmentReason}`,
          pnl,
        };
      }
    }

    // 5. 强制止损：单笔最大亏损限制（安全阀）
    const maxLossPercent = 50; // 单笔最大亏损50%
    if (pnl.netPnLPercent <= -maxLossPercent) {
      return {
        action: 'STOP_LOSS',
        reason: `强制止损：净亏损${pnl.netPnLPercent.toFixed(1)}%超过安全阈值${maxLossPercent}%`,
        pnl,
      };
    }

    return null;
  }

  /**
   * 获取美股收盘时间（美东时间16:00）
   */
  getMarketCloseTime(date: Date = new Date()): Date {
    // 获取美东时间的日期
    const etDateStr = date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const [month, day, year] = etDateStr.split('/').map(Number);

    // 创建美东时间16:00的Date对象
    const closeTime = new Date(`${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T16:00:00-05:00`);

    // 夏令时调整（简化处理）
    const etHour = parseInt(date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }));

    // 如果当前ET时间和创建的时间差异大，说明夏令时不同
    // 这是简化处理，实际应使用更精确的时区库
    return closeTime;
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

    // 尝试获取期权详情（含IV、Delta等）
    if (optionId && underlyingStockId) {
      try {
        const detail = await getOptionDetail(optionId, underlyingStockId, marketType);
        if (detail && detail.option) {
          ctx.currentIV = detail.option.impliedVolatility || 0;
          ctx.currentDelta = detail.option.greeks?.hpDelta || detail.option.greeks?.delta || 0;
          ctx.timeValue = detail.option.timeValue || 0;
        }
      } catch (error) {
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
