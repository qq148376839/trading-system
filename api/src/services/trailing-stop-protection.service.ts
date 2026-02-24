/**
 * TSLPPCT 跟踪止损保护服务
 *
 * 期权买入成功后，自动挂出 TSLPPCT 跟踪止损保护单作为安全网。
 * 动态监控保留全部智能逻辑，通过 replaceOrder 实时调整 TSLPPCT 参数。
 *
 * 核心功能：
 * 1. 提交 TSLPPCT 保护单
 * 2. 调整 trailing percent（replaceOrder / cancel+re-submit fallback）
 * 3. 三步确认取消保护单
 * 4. 查询保护单状态
 * 5. 根据时段/IV/盈利动态计算 trailing percent
 */

import { getTradeContext, OrderType, OrderSide, TimeInForceType, Decimal } from '../config/longport';
import { longportRateLimiter, retryWithBackoff } from '../utils/longport-rate-limiter';
import { logger } from '../utils/logger';
import pool from '../config/database';
import type { TradingPhase } from './option-dynamic-exit.service';

// ============================================
// 常量
// ============================================

const DEFAULT_TRAILING_PERCENT = 60;
const DEFAULT_LIMIT_OFFSET = 0.10;
const MIN_TRAILING_PERCENT = 8;
const MAX_TRAILING_PERCENT = 65;
const ADJUST_THRESHOLD = 3; // trailing_percent 差异≥3% 才调用 replaceOrder

const TSLP_TAG = '[TSLP]';

// ============================================
// 类型
// ============================================

interface SubmitResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

interface CancelResult {
  success: boolean;
  alreadyFilled?: boolean;
  alreadyCancelled?: boolean;
  error?: string;
}

type ProtectionStatus = 'active' | 'filled' | 'cancelled' | 'expired' | 'unknown';

interface TrailingPercentParams {
  phase: TradingPhase;
  entryIV?: number;
  currentIV?: number;
  netPnLPercent?: number;
  is0DTE?: boolean;
}

// ============================================
// 服务
// ============================================

class TrailingStopProtectionService {

  /**
   * 提交 TSLPPCT 保护单
   */
  async submitProtection(
    symbol: string,
    quantity: number,
    trailingPercent: number = DEFAULT_TRAILING_PERCENT,
    limitOffset: number = DEFAULT_LIMIT_OFFSET,
    expireDate: string,
    strategyId: number,
  ): Promise<SubmitResult> {
    try {
      const tradeCtx = await getTradeContext();

      // LongPort SDK 要求 NaiveDate 而非 JS Date
      const longport = require('longport');
      const { NaiveDate } = longport;

      // Fix 2.5: 券商要求 expireDate 必须在今天之后
      // 对于 0DTE/1DTE 期权，到期日可能是今天，导致 TSLPPCT 提交被拒绝
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      let effectiveExpireDate = expireDate;
      if (expireDate <= today) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        effectiveExpireDate = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        logger.log(
          `${TSLP_TAG} ${symbol}: 期权到期日${expireDate}不晚于今天${today}，` +
          `TSLPPCT到期日调整为${effectiveExpireDate}`
        );
      }

      const dateParts = effectiveExpireDate.split('-'); // YYYY-MM-DD
      const expireNaiveDate = new NaiveDate(
        parseInt(dateParts[0], 10),
        parseInt(dateParts[1], 10),
        parseInt(dateParts[2], 10)
      );

      const orderOptions: Record<string, unknown> = {
        symbol,
        orderType: OrderType.TSLPPCT,
        side: OrderSide.Sell,
        submittedQuantity: new Decimal(quantity.toString()),
        timeInForce: TimeInForceType.GoodTilDate,
        trailingPercent: new Decimal(trailingPercent.toString()),
        limitOffset: new Decimal(limitOffset.toString()),
        expireDate: expireNaiveDate,
        remark: 'TSLP_AUTO',
      };

      const response = await longportRateLimiter.execute(() =>
        retryWithBackoff<any>(() => tradeCtx.submitOrder(orderOptions as any) as any)
      );

      if (!response || !response.orderId) {
        const errMsg = '未返回订单ID';
        logger.log(
          `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: TSLPPCT提交失败(${errMsg})，降级到纯监控模式`,
          { dbWrite: true },
        );
        return { success: false, error: errMsg };
      }

      // 写入 execution_orders 表
      await pool.query(
        `INSERT INTO execution_orders
         (strategy_id, symbol, order_id, side, quantity, price, current_status, execution_stage)
         VALUES ($1, $2, $3, 'SELL', $4, 0, 'SUBMITTED', 1)`,
        [strategyId, symbol, response.orderId, quantity],
      );

      logger.log(
        `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: TSLPPCT保护单已提交 orderId=${response.orderId}, trailing=${trailingPercent}%`,
        { dbWrite: true },
      );

      return { success: true, orderId: response.orderId };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      logger.log(
        `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: TSLPPCT提交失败(${errMsg})，降级到纯监控模式`,
        { dbWrite: true },
      );
      return { success: false, error: errMsg };
    }
  }

  /**
   * 调整 TSLPPCT 保护单参数
   *
   * 先尝试 replaceOrder；若 SDK 不支持 trailing 参数则 fallback 到 cancel + re-submit。
   */
  async adjustProtection(
    orderId: string,
    newTrailingPercent: number,
    newLimitOffset: number,
    quantity: number,
    strategyId: number,
    symbol: string,
    expireDate?: string,
  ): Promise<SubmitResult> {
    try {
      const tradeCtx = await getTradeContext();

      // 先尝试 replaceOrder（部分 SDK 版本可能不支持 trailing 参数）
      try {
        await longportRateLimiter.execute(() =>
          retryWithBackoff<any>(() =>
            tradeCtx.replaceOrder({
              orderId,
              quantity: new Decimal(quantity.toString()),
              trailingPercent: new Decimal(newTrailingPercent.toString()),
              limitOffset: new Decimal(newLimitOffset.toString()),
            } as any) as any
          )
        );

        logger.log(
          `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: TSLPPCT调整成功 → trailing=${newTrailingPercent}%`,
          { dbWrite: true },
        );
        return { success: true, orderId };
      } catch (replaceErr: any) {
        const msg = replaceErr?.message || '';
        const code = replaceErr?.code || '';
        // 如果是"不支持修改"类错误，fallback 到 cancel + re-submit
        if (
          code === '602012' ||
          msg.includes('602012') ||
          msg.includes('not supported') ||
          msg.includes('trailing')
        ) {
          logger.warn(
            `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: replaceOrder不支持trailing参数, fallback到cancel+re-submit`,
          );
        } else {
          // 其他错误直接抛出
          throw replaceErr;
        }
      }

      // Fallback: cancel old → submit new
      await this.cancelProtection(orderId, strategyId, symbol);

      if (!expireDate) {
        // 无法重新提交（缺少 expireDate）
        return { success: false, error: 'fallback缺少expireDate' };
      }

      const resubmitResult = await this.submitProtection(
        symbol,
        quantity,
        newTrailingPercent,
        newLimitOffset,
        expireDate,
        strategyId,
      );
      return resubmitResult;
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      logger.log(
        `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: TSLPPCT调整失败: ${errMsg}`,
        { dbWrite: true },
      );
      return { success: false, error: errMsg };
    }
  }

  /**
   * 三步确认取消 TSLPPCT 保护单
   *
   * Step 1: orderDetail 查状态 → 已成交/已撤直接返回
   * Step 2: cancelOrder
   * Step 3: 等待 500ms → orderDetail 再次确认
   */
  async cancelProtection(
    orderId: string,
    strategyId: number,
    symbol: string,
  ): Promise<CancelResult> {
    try {
      const tradeCtx = await getTradeContext();

      // Step 1: 查询当前状态
      let detail: any;
      try {
        detail = await longportRateLimiter.execute(() =>
          retryWithBackoff<any>(() => tradeCtx.orderDetail(orderId) as any)
        );
      } catch {
        // 查询失败，仍尝试取消
      }

      if (detail) {
        const status = this.normalizeOrderStatus(detail.status);
        if (status === 'filled') {
          logger.log(
            `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: TSLPPCT已触发成交！无需取消`,
            { dbWrite: true },
          );
          return { success: true, alreadyFilled: true };
        }
        if (status === 'cancelled' || status === 'expired') {
          return { success: true, alreadyCancelled: true };
        }
      }

      // Step 2: 执行取消
      await longportRateLimiter.execute(() =>
        retryWithBackoff<any>(() => tradeCtx.cancelOrder(orderId) as any)
      );

      // Step 3: 等待 500ms 再确认
      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        const confirmDetail = await longportRateLimiter.execute(() =>
          retryWithBackoff<any>(() => tradeCtx.orderDetail(orderId) as any)
        );
        const confirmStatus = this.normalizeOrderStatus(confirmDetail?.status);
        if (confirmStatus === 'filled') {
          logger.log(
            `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: TSLPPCT在取消前已触发成交！`,
            { dbWrite: true },
          );
          return { success: true, alreadyFilled: true };
        }
      } catch {
        // 确认查询失败，不阻塞
      }

      logger.log(
        `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: 已取消TSLPPCT(${orderId})`,
        { dbWrite: true },
      );
      return { success: true };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      logger.warn(
        `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: 取消TSLPPCT失败: ${errMsg}`,
      );
      return { success: false, error: errMsg };
    }
  }

  /**
   * 查询 TSLPPCT 保护单状态
   */
  async checkProtectionStatus(orderId: string): Promise<ProtectionStatus> {
    try {
      const tradeCtx = await getTradeContext();
      const detail = await longportRateLimiter.execute(() =>
        retryWithBackoff<any>(() => tradeCtx.orderDetail(orderId) as any)
      );
      return this.normalizeOrderStatus(detail?.status);
    } catch {
      return 'unknown';
    }
  }

  /**
   * 根据时段 / IV / 盈利情况计算应设的 trailingPercent
   *
   * Fix 2 修订：TSLPPCT 放宽为崩溃保护安全网（55-60%），不干扰软件动态退出。
   * 仅在进程崩溃期间防止灾难性亏损。
   *
   * 规则：
   * - 时段映射: EARLY→60%, MID→58%, LATE→55%, FINAL→55%
   * - IV 调整: IV 涨>20% → +3%, IV 跌>20% → -3%（微调）
   * - 盈利收紧: 盈利>80% → min(current,45%)（仅极端盈利收紧）
   * - 0DTE: min(current, 45%)
   * - Clamp to [8%, 65%]
   */
  getTrailingPercentForPhase(params: TrailingPercentParams): number {
    // 基础映射（崩溃保护：宽松 trailing，不干扰软件退出）
    const phaseMap: Record<TradingPhase, number> = {
      EARLY: 60,
      MID: 58,
      LATE: 55,
      FINAL: 55,
    };

    let tp = phaseMap[params.phase] ?? DEFAULT_TRAILING_PERCENT;

    // IV 调整（微调）
    if (params.entryIV && params.currentIV && params.entryIV > 0) {
      const ivChange = (params.currentIV - params.entryIV) / params.entryIV;
      if (ivChange > 0.2) {
        tp += 3;
      } else if (ivChange < -0.2) {
        tp -= 3;
      }
    }

    // 盈利收紧（仅极端盈利时适度收紧，防崩溃期间回吐过多利润）
    if (params.netPnLPercent !== undefined) {
      if (params.netPnLPercent > 80) {
        tp = Math.min(tp, 45);
      }
    }

    // 0DTE: 适度收紧但仍保持安全网角色
    if (params.is0DTE) {
      tp = Math.min(tp, 45);
    }

    // Clamp
    return Math.max(MIN_TRAILING_PERCENT, Math.min(MAX_TRAILING_PERCENT, tp));
  }

  /**
   * 从 symbol 或 optionMeta 解析期权到期日（YYYY-MM-DD）
   */
  extractOptionExpireDate(tradedSymbol: string, optionMeta?: any): string {
    // 1. 优先从 optionMeta.strikeDate 取
    const strikeDateVal = optionMeta?.strikeDate;
    if (strikeDateVal) {
      const sdStr = String(strikeDateVal);
      if (sdStr.length === 8) {
        // YYYYMMDD → YYYY-MM-DD
        return `${sdStr.substring(0, 4)}-${sdStr.substring(4, 6)}-${sdStr.substring(6, 8)}`;
      }
      // 可能是时间戳（秒级）
      const ts = parseInt(sdStr, 10);
      if (!isNaN(ts) && ts > 1000000000) {
        const d = new Date(ts * 1000);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        }
      }
    }

    // 2. 从 symbol 解析 (例如 AAPL260210C100000.US)
    const core = tradedSymbol.replace(/\.(US|HK)$/i, '');
    const match = core.match(/[A-Z]+(\d{6})[CP]/);
    if (match) {
      const yymmdd = match[1]; // e.g. "260210"
      const yy = parseInt(yymmdd.substring(0, 2), 10);
      const mm = yymmdd.substring(2, 4);
      const dd = yymmdd.substring(4, 6);
      const fullYear = yy >= 50 ? 1900 + yy : 2000 + yy;
      return `${fullYear}-${mm}-${dd}`;
    }

    // 3. Fallback: 当日 +7 天
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 7);
    return fallback.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }

  // ============================================
  // LIT 止盈保护单
  // ============================================

  /**
   * 提交 LIT（触价限价单）止盈保护单
   *
   * 当价格上涨到 triggerPrice 时自动触发限价卖出。
   * 作为 TSLPPCT 的补充：TSLPPCT 防回撤，LIT 确保止盈。
   *
   * @param symbol        期权代码
   * @param quantity      合约数量
   * @param entryPrice    入场价格（用于计算触发价）
   * @param takeProfitPct 止盈百分比（如 25 表示 25%）
   * @param expireDate    到期日 YYYY-MM-DD
   * @param strategyId    策略ID
   */
  async submitTakeProfitProtection(
    symbol: string,
    quantity: number,
    entryPrice: number,
    takeProfitPct: number,
    expireDate: string,
    strategyId: number,
  ): Promise<SubmitResult> {
    try {
      if (takeProfitPct <= 0 || entryPrice <= 0) {
        return { success: false, error: `无效参数: takeProfitPct=${takeProfitPct}, entryPrice=${entryPrice}` };
      }

      const triggerPrice = entryPrice * (1 + takeProfitPct / 100);
      // 限价 = 触发价 * 0.97（留3%滑点空间确保成交）
      const limitPrice = triggerPrice * 0.97;

      const tradeCtx = await getTradeContext();

      const longport = require('longport');
      const { NaiveDate } = longport;

      // 到期日处理（同 TSLPPCT 逻辑）
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      let effectiveExpireDate = expireDate;
      if (expireDate <= today) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        effectiveExpireDate = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      }

      const dateParts = effectiveExpireDate.split('-');
      const expireNaiveDate = new NaiveDate(
        parseInt(dateParts[0], 10),
        parseInt(dateParts[1], 10),
        parseInt(dateParts[2], 10)
      );

      const orderOptions: Record<string, unknown> = {
        symbol,
        orderType: OrderType.LIT,
        side: OrderSide.Sell,
        submittedQuantity: new Decimal(quantity.toString()),
        submittedPrice: new Decimal(limitPrice.toFixed(2)),
        triggerPrice: new Decimal(triggerPrice.toFixed(2)),
        timeInForce: TimeInForceType.GoodTilDate,
        expireDate: expireNaiveDate,
        remark: 'TP_LIT_AUTO',
      };

      const response = await longportRateLimiter.execute(() =>
        retryWithBackoff<any>(() => tradeCtx.submitOrder(orderOptions as any) as any)
      );

      if (!response || !response.orderId) {
        const errMsg = '未返回订单ID';
        logger.log(
          `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: LIT止盈单提交失败(${errMsg})`,
          { dbWrite: true },
        );
        return { success: false, error: errMsg };
      }

      // 写入 execution_orders 表
      await pool.query(
        `INSERT INTO execution_orders
         (strategy_id, symbol, order_id, side, quantity, price, current_status, execution_stage)
         VALUES ($1, $2, $3, 'SELL', $4, $5, 'SUBMITTED', 1)`,
        [strategyId, symbol, response.orderId, quantity, triggerPrice],
      );

      logger.log(
        `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: LIT止盈保护单已提交 orderId=${response.orderId}, ` +
        `trigger=${triggerPrice.toFixed(2)}(+${takeProfitPct}%), limit=${limitPrice.toFixed(2)}`,
        { dbWrite: true },
      );

      return { success: true, orderId: response.orderId };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      logger.log(
        `${TSLP_TAG} 策略 ${strategyId} 期权 ${symbol}: LIT止盈单提交失败(${errMsg})`,
        { dbWrite: true },
      );
      return { success: false, error: errMsg };
    }
  }

  /**
   * 取消 LIT 止盈保护单（复用 cancelProtection 逻辑）
   */
  async cancelTakeProfitProtection(
    orderId: string,
    strategyId: number,
    symbol: string,
  ): Promise<CancelResult> {
    return this.cancelProtection(orderId, strategyId, symbol);
  }

  // ============================================
  // 内部辅助
  // ============================================

  private normalizeOrderStatus(status: any): ProtectionStatus {
    if (!status) return 'unknown';
    const s = String(status);

    if (s.includes('Filled') || s === 'FilledStatus') return 'filled';
    if (s.includes('Cancel') || s === 'CanceledStatus') return 'cancelled';
    if (s.includes('Expired') || s === 'ExpiredStatus') return 'expired';
    if (
      s.includes('New') ||
      s.includes('NotReported') ||
      s.includes('WaitTo') ||
      s.includes('Pending') ||
      s === 'NewStatus'
    ) {
      return 'active';
    }
    return 'unknown';
  }
}

// 导出常量供外部引用
export { DEFAULT_TRAILING_PERCENT, DEFAULT_LIMIT_OFFSET, ADJUST_THRESHOLD, MIN_TRAILING_PERCENT, MAX_TRAILING_PERCENT };

// 导出单例
const trailingStopProtectionService = new TrailingStopProtectionService();
export default trailingStopProtectionService;
