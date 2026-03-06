/**
 * 止损/止盈保护服务
 *
 * 期权买入成功后，自动挂出 MIT（触价市价单）保护单作为安全网。
 * MIT 在触发价到达时以市价成交，不需要设置限价，避免 paper account 不支持 LIT 的问题。
 *
 * 核心功能：
 * 1. 提交 MIT 止损保护单（submitStopLossProtection）
 * 2. 提交 MIT 止盈保护单（submitTakeProfitProtection）
 * 3. 三步确认取消保护单
 * 4. 查询保护单状态
 */

import { getTradeContext, OrderType, OrderSide, TimeInForceType, Decimal } from '../config/longport';
import { longportRateLimiter, retryWithBackoff } from '../utils/longport-rate-limiter';
import { logger } from '../utils/logger';
import pool from '../config/database';

const PROTECTION_TAG = '[PROTECTION]';

/**
 * Paper account 检测：604050 错误表示不支持条件单（LIT/MIT/TSLP 等）。
 * 首次遇到后标记，后续跳过保护单提交，纯依赖软件监控。
 */
let isPaperAccount = false;

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

// ============================================
// 服务
// ============================================

class TrailingStopProtectionService {

  /**
   * 提交 MIT（触价市价单）止损保护单
   *
   * 当价格下跌到 triggerPrice 时自动触发市价卖出。
   * 作为进程崩溃时的安全网，防止灾难性亏损。
   * MIT 不需要限价，触发后直接市价成交。
   *
   * @param symbol        期权代码
   * @param quantity      合约数量
   * @param entryPrice    入场价格（用于计算触发价）
   * @param stopLossPct   止损百分比（如 50 表示 50%，即 entryPrice × 0.5）
   * @param expireDate    到期日 YYYY-MM-DD
   * @param strategyId    策略ID
   */
  async submitStopLossProtection(
    symbol: string,
    quantity: number,
    entryPrice: number,
    stopLossPct: number,
    expireDate: string,
    strategyId: number,
  ): Promise<SubmitResult> {
    // Paper account 不支持条件单，跳过提交
    if (isPaperAccount) {
      return { success: false, error: 'paper_account_skip' };
    }
    try {
      if (stopLossPct <= 0 || stopLossPct > 100 || entryPrice <= 0) {
        return { success: false, error: `无效参数: stopLossPct=${stopLossPct}, entryPrice=${entryPrice}` };
      }

      const triggerPrice = entryPrice * (1 - stopLossPct / 100);

      const tradeCtx = await getTradeContext();

      const longport = require('longport');
      const { NaiveDate } = longport;

      // 券商要求 expireDate 必须在今天之后
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      let effectiveExpireDate = expireDate;
      if (expireDate <= today) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        effectiveExpireDate = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        logger.log(
          `${PROTECTION_TAG} ${symbol}: 期权到期日${expireDate}不晚于今天${today}，` +
          `止损单到期日调整为${effectiveExpireDate}`
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
        orderType: OrderType.MIT,
        side: OrderSide.Sell,
        submittedQuantity: new Decimal(quantity.toString()),
        triggerPrice: new Decimal(triggerPrice.toFixed(2)),
        timeInForce: TimeInForceType.GoodTilDate,
        expireDate: expireNaiveDate,
        remark: 'SL_MIT_AUTO',
      };

      const response = await longportRateLimiter.execute(() =>
        retryWithBackoff<any>(() => tradeCtx.submitOrder(orderOptions as any) as any)
      );

      if (!response || !response.orderId) {
        const errMsg = '未返回订单ID';
        logger.log(
          `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: MIT止损单提交失败(${errMsg})，降级到纯监控模式`,
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
        `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: MIT止损保护单已提交 orderId=${response.orderId}, ` +
        `trigger=${triggerPrice.toFixed(2)}(-${stopLossPct}%)`,
        { dbWrite: true },
      );

      return { success: true, orderId: response.orderId };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      // 604050 = paper account 不支持条件单，标记后永久跳过
      if (errMsg.includes('604050')) {
        isPaperAccount = true;
        logger.log(
          `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: 检测到 Paper Account（604050），后续跳过保护单提交，纯依赖软件监控`,
          { dbWrite: true },
        );
        return { success: false, error: 'paper_account_detected' };
      }
      logger.log(
        `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: MIT止损单提交失败(${errMsg})，降级到纯监控模式`,
        { dbWrite: true },
      );
      return { success: false, error: errMsg };
    }
  }

  /**
   * 三步确认取消保护单
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
            `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: 保护单已触发成交！无需取消`,
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
            `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: 保护单在取消前已触发成交！`,
            { dbWrite: true },
          );
          return { success: true, alreadyFilled: true };
        }
      } catch {
        // 确认查询失败，不阻塞
      }

      logger.log(
        `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: 已取消保护单(${orderId})`,
        { dbWrite: true },
      );
      return { success: true };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      logger.warn(
        `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: 取消保护单失败: ${errMsg}`,
      );
      return { success: false, error: errMsg };
    }
  }

  /**
   * 查询保护单状态
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
  // MIT 止盈保护单
  // ============================================

  /**
   * 提交 MIT（触价市价单）止盈保护单
   *
   * 当价格上涨到 triggerPrice 时自动触发市价卖出。
   * MIT 不需要限价，触发后直接市价成交。
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
    // Paper account 不支持条件单，跳过提交
    if (isPaperAccount) {
      return { success: false, error: 'paper_account_skip' };
    }
    try {
      if (takeProfitPct <= 0 || entryPrice <= 0) {
        return { success: false, error: `无效参数: takeProfitPct=${takeProfitPct}, entryPrice=${entryPrice}` };
      }

      const triggerPrice = entryPrice * (1 + takeProfitPct / 100);

      const tradeCtx = await getTradeContext();

      const longport = require('longport');
      const { NaiveDate } = longport;

      // 到期日处理
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
        orderType: OrderType.MIT,
        side: OrderSide.Sell,
        submittedQuantity: new Decimal(quantity.toString()),
        triggerPrice: new Decimal(triggerPrice.toFixed(2)),
        timeInForce: TimeInForceType.GoodTilDate,
        expireDate: expireNaiveDate,
        remark: 'TP_MIT_AUTO',
      };

      const response = await longportRateLimiter.execute(() =>
        retryWithBackoff<any>(() => tradeCtx.submitOrder(orderOptions as any) as any)
      );

      if (!response || !response.orderId) {
        const errMsg = '未返回订单ID';
        logger.log(
          `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: MIT止盈单提交失败(${errMsg})`,
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
        `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: MIT止盈保护单已提交 orderId=${response.orderId}, ` +
        `trigger=${triggerPrice.toFixed(2)}(+${takeProfitPct}%)`,
        { dbWrite: true },
      );

      return { success: true, orderId: response.orderId };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      if (errMsg.includes('604050')) {
        isPaperAccount = true;
        logger.log(
          `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: 检测到 Paper Account（604050），后续跳过保护单提交`,
          { dbWrite: true },
        );
        return { success: false, error: 'paper_account_detected' };
      }
      logger.log(
        `${PROTECTION_TAG} 策略 ${strategyId} 期权 ${symbol}: MIT止盈单提交失败(${errMsg})`,
        { dbWrite: true },
      );
      return { success: false, error: errMsg };
    }
  }

  /**
   * 取消 MIT 止盈保护单（复用 cancelProtection 逻辑）
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

// 导出单例
const trailingStopProtectionService = new TrailingStopProtectionService();
export default trailingStopProtectionService;
