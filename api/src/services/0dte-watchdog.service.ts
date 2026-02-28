// 审计修复: C-6 — 0DTE 强平独立看门狗
/**
 * 0DTE 强平独立看门狗服务
 *
 * 问题：0DTE 强制平仓仅在 option-dynamic-exit.service.ts 中生成 TIME_STOP 信号，
 * 但不直接执行。如果策略调度器延迟或崩溃，0DTE 期权可能到期 ITM（自动行权）
 * 或 OTM（过期归零）。
 *
 * 方案：独立定时器（每60秒）扫描所有当日到期的 HOLDING 持仓，直接执行强制平仓。
 * 作为策略调度器的安全网，确保 0DTE 期权在收盘前被平仓。
 *
 * 活跃窗口：3:00 PM ET ~ 4:00 PM ET（收盘前60分钟）
 * 定位：策略调度器 forceCloseBeforeCloseMinutes=30（3:30 PM）的安全网，
 * 比主逻辑晚 30 分钟启动，确保主逻辑有机会先正常平仓。
 */

import pool from '../config/database';
import { logger } from '../utils/logger';
import basicExecutionService from './basic-execution.service';
import { TradingIntent } from './strategies/strategy-base';

/** 从 strategy_instances 查询到的 0DTE 持仓记录 */
interface ZeroDTEPosition {
  strategyId: number;
  symbol: string;            // strategy_instances.symbol（underlying，如 QQQ.US）
  tradedSymbol: string;      // 实际期权合约代码（如 QQQ260219C485000.US）
  quantity: number;
  entryPrice: number;
  context: Record<string, unknown>;
}

/** 扫描间隔（毫秒） */
const SCAN_INTERVAL_MS = 60_000;

/** 最大重试次数 */
const MAX_RETRIES = 3;

/** 重试间隔（毫秒） */
const RETRY_DELAY_MS = 10_000;

/** 强平开始时间（美东时间 15:00，即收盘前60分钟 — 作为策略主逻辑 3:30PM 强平的安全网） */
const FORCE_CLOSE_HOUR_ET = 15;
const FORCE_CLOSE_MINUTE_ET = 0;

/** 市场收盘时间（美东时间 16:00） */
const MARKET_CLOSE_HOUR_ET = 16;
const MARKET_CLOSE_MINUTE_ET = 0;

class ZeroDTEWatchdogService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  /**
   * 获取当前美东时间（DST 安全）
   * 使用 Intl.DateTimeFormat 确保夏令时自动处理
   */
  private getCurrentETTime(): { hour: number; minute: number; dateStr: string } {
    const now = new Date();

    // 获取 ET 小时和分钟
    const timeFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const timeParts = timeFmt.formatToParts(now);
    const hour = parseInt(timeParts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(timeParts.find(p => p.type === 'minute')?.value ?? '0', 10);

    // 获取 ET 日期（YYYYMMDD 格式，用于 0DTE 判定）
    const dateStr = now
      .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      .replace(/-/g, '');

    return { hour, minute, dateStr };
  }

  /**
   * 判断当前是否在活跃窗口内（3:00 PM ET ~ 4:00 PM ET）
   */
  private isInActiveWindow(): boolean {
    const { hour, minute } = this.getCurrentETTime();
    const currentMinutes = hour * 60 + minute;
    const startMinutes = FORCE_CLOSE_HOUR_ET * 60 + FORCE_CLOSE_MINUTE_ET;
    const endMinutes = MARKET_CLOSE_HOUR_ET * 60 + MARKET_CLOSE_MINUTE_ET;
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  /**
   * 从期权合约代码解析到期日（YYYYMMDD）
   * 例：QQQ260219C485000.US -> 20260219
   */
  private parseExpiryFromSymbol(symbol: string): string | null {
    const core = symbol.replace(/\.(US|HK)$/i, '');
    const match = core.match(/[A-Z]+(\d{6})[CP]/);
    if (!match) return null;

    const yymmdd = match[1];
    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);
    const fullYear = yy >= 50 ? 1900 + yy : 2000 + yy;
    return `${fullYear}${mm}${dd}`;
  }

  /**
   * 查询所有当日到期的 HOLDING 期权持仓
   *
   * 查询 strategy_instances 表：
   * - current_state = 'HOLDING'
   * - context->>'tradedSymbol' 存在（期权合约）
   * - 到期日为今天（通过合约代码或 optionMeta.strikeDate 判断）
   */
  private async scan0DTEPositions(): Promise<ZeroDTEPosition[]> {
    const { dateStr: todayStr } = this.getCurrentETTime();

    const result = await pool.query(
      `SELECT
         si.strategy_id,
         si.symbol,
         si.context
       FROM strategy_instances si
       WHERE si.current_state = 'HOLDING'
         AND si.context->>'tradedSymbol' IS NOT NULL`
    );

    const positions: ZeroDTEPosition[] = [];

    for (const row of result.rows) {
      const context = row.context || {};
      const tradedSymbol = context.tradedSymbol as string;
      if (!tradedSymbol) continue;

      // 判断是否为 0DTE
      let is0DTE = false;

      // 方法1：从合约代码解析到期日
      const expiryFromSymbol = this.parseExpiryFromSymbol(tradedSymbol);
      if (expiryFromSymbol === todayStr) {
        is0DTE = true;
      }

      // 方法2：从 optionMeta.strikeDate 判断
      if (!is0DTE) {
        const optionMeta = context.optionMeta as Record<string, unknown> | undefined;
        const strikeDateVal = optionMeta?.strikeDate || context.strikeDate;
        if (strikeDateVal) {
          const sdStr = String(strikeDateVal);
          let dateStr = sdStr;
          if (sdStr.length !== 8) {
            // 可能是时间戳（秒级），转为 YYYYMMDD
            const d = new Date(parseInt(sdStr, 10) * 1000);
            if (!isNaN(d.getTime())) {
              dateStr = d
                .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
                .replace(/-/g, '');
            }
          }
          if (dateStr === todayStr) {
            is0DTE = true;
          }
        }
      }

      if (!is0DTE) continue;

      const quantity = typeof context.quantity === 'number'
        ? context.quantity
        : parseInt(String(context.quantity ?? '0'), 10);
      const entryPrice = typeof context.entryPrice === 'number'
        ? context.entryPrice
        : parseFloat(String(context.entryPrice ?? '0'));

      if (quantity <= 0) continue;

      positions.push({
        strategyId: row.strategy_id,
        symbol: row.symbol,
        tradedSymbol,
        quantity,
        entryPrice,
        context,
      });
    }

    return positions;
  }

  /**
   * 对单个持仓执行强制平仓，带重试机制
   */
  private async forceClosePosition(position: ZeroDTEPosition): Promise<boolean> {
    const { strategyId, symbol, tradedSymbol, quantity } = position;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.warn(
          `[0DTE看门狗] 检测到到期持仓: ${tradedSymbol} (underlying=${symbol}, ` +
          `策略=${strategyId}, 数量=${quantity}), 执行强制平仓 (尝试 ${attempt}/${MAX_RETRIES})`
        );

        // 获取当前期权价格作为卖出价
        let sellPrice = 0.01; // 最低保底价
        try {
          const { default: longportOptionQuoteService } = await import('./longport-option-quote.service');
          const optionMeta = position.context.optionMeta as Record<string, unknown> | undefined;
          const priceResult = await longportOptionQuoteService.getOptionPrice(tradedSymbol, {
            optionId: optionMeta?.optionId ? String(optionMeta.optionId) : undefined,
            underlyingStockId: optionMeta?.underlyingStockId ? String(optionMeta.underlyingStockId) : undefined,
            marketType: typeof optionMeta?.marketType === 'number' ? optionMeta.marketType : 2,
          });
          if (priceResult && priceResult.price > 0) {
            sellPrice = priceResult.price;
          }
        } catch (priceErr: unknown) {
          const errMsg = priceErr instanceof Error ? priceErr.message : String(priceErr);
          logger.warn(`[0DTE看门狗] 获取 ${tradedSymbol} 价格失败: ${errMsg}, 使用保底价 $${sellPrice.toFixed(2)}`);
        }

        const sellIntent: TradingIntent = {
          action: 'SELL',
          symbol: tradedSymbol,
          entryPrice: position.entryPrice,
          sellPrice,
          quantity,
          reason: `[0DTE看门狗] 当日到期强制平仓`,
          metadata: {
            ...(position.context.metadata as Record<string, unknown> || {}),
            ...(position.context.optionMeta as Record<string, unknown> || {}),
            forceClose: true,
            exitReason: '0dte_watchdog_force_close',
            assetClass: 'OPTION',
          },
        };

        const result = await basicExecutionService.executeSellIntent(sellIntent, strategyId);

        if (result.success || result.submitted) {
          logger.warn(
            `[0DTE看门狗] ${tradedSymbol} 强制平仓成功 (orderId=${result.orderId || 'N/A'}, ` +
            `status=${result.orderStatus || 'submitted'})`
          );
          return true;
        }

        logger.error(
          `[0DTE看门狗] ${tradedSymbol} 强制平仓失败 (尝试 ${attempt}/${MAX_RETRIES}): ${result.error}`
        );
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          `[0DTE看门狗] ${tradedSymbol} 强制平仓异常 (尝试 ${attempt}/${MAX_RETRIES}): ${errMsg}`
        );
      }

      // 如果不是最后一次尝试，等待后重试
      if (attempt < MAX_RETRIES) {
        await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    // 所有重试均失败
    logger.error(
      `[0DTE看门狗] 强制平仓失败: ${tradedSymbol} (策略=${strategyId}), ` +
      `${MAX_RETRIES}次尝试均失败, 需要人工干预`
    );
    return false;
  }

  /**
   * 执行一轮扫描
   */
  private async runScanCycle(): Promise<void> {
    // 仅在活跃窗口内执行
    if (!this.isInActiveWindow()) {
      return;
    }

    try {
      const positions = await this.scan0DTEPositions();

      if (positions.length === 0) {
        return;
      }

      logger.warn(
        `[0DTE看门狗] 扫描到 ${positions.length} 个当日到期持仓, ` +
        `开始强制平仓: ${positions.map(p => p.tradedSymbol).join(', ')}`
      );

      // 逐个平仓，避免并发冲击 API
      for (const position of positions) {
        await this.forceClosePosition(position);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[0DTE看门狗] 扫描周期异常: ${errMsg}`);
    }
  }

  /**
   * 启动看门狗服务
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[0DTE看门狗] 服务已在运行');
      return;
    }

    this.isRunning = true;
    logger.log('[0DTE看门狗] 服务已启动 (扫描间隔: 60秒, 活跃窗口: 3:00 PM - 4:00 PM ET)');

    // 立即执行一次扫描
    this.runScanCycle().catch(err => {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[0DTE看门狗] 初始扫描失败: ${errMsg}`);
    });

    // 设置定时扫描
    this.intervalId = setInterval(() => {
      this.runScanCycle().catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[0DTE看门狗] 定时扫描失败: ${errMsg}`);
      });
    }, SCAN_INTERVAL_MS);
  }

  /**
   * 停止看门狗服务
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.log('[0DTE看门狗] 服务已停止');
  }
}

// 导出单例
const zeroDTEWatchdogService = new ZeroDTEWatchdogService();
export default zeroDTEWatchdogService;
