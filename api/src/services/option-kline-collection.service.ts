/**
 * 期权交易K线采集服务
 * 定时在收盘后采集当日期权订单对应的正向 + 反向期权K线数据并持久化到数据库
 * 避免期权过期后无法获取历史K线
 */

import pool from '../config/database';
import { getQuoteContext, getTradeContext, OrderStatus, Market } from '../config/longport';
import configService from './config.service';
import { parseOptionSymbol, isLikelyOptionSymbol } from '../utils/options-symbol';
import { logger } from '../utils/logger';

interface CollectOrderParams {
  orderId: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  executedAt: Date;
  tradeDate: string;
}

interface CollectionSummary {
  total: number;
  success: number;
  partial: number;
  failed: number;
  skipped: number;
  noData: number;
}

class OptionKlineCollectionService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private collecting = false;
  private enabled = true;
  private delayMinutes = 5;
  private readonly INTER_REQUEST_DELAY_MS = 800;
  private readonly BATCH_SIZE = 100;

  /**
   * 初始化服务：加载配置并调度每日采集
   */
  async init(): Promise<void> {
    try {
      await this.loadConfig();

      if (!this.enabled) {
        logger.info('[期权K线采集] 采集已禁用（option_kline_collection_enabled=false）');
        return;
      }

      logger.info(`[期权K线采集] 服务启动 — 收盘后延迟 ${this.delayMinutes} 分钟采集`);
      this.scheduleDailyCollection();
    } catch (error: any) {
      logger.error(`[期权K线采集] 初始化失败: ${error.message}`);
    }
  }

  /**
   * 停止服务
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('[期权K线采集] 服务已停止');
  }

  /**
   * 是否正在采集中
   */
  isCollecting(): boolean {
    return this.collecting;
  }

  /**
   * 从 system_config 加载配置
   */
  private async loadConfig(): Promise<void> {
    const enabledStr = await configService.getConfig('option_kline_collection_enabled');
    this.enabled = enabledStr !== 'false';

    const delayStr = await configService.getConfig('option_kline_collection_delay_minutes');
    if (delayStr) this.delayMinutes = Number(delayStr) || 5;
  }

  /**
   * 推导反向期权 symbol
   * CALL ↔ PUT，其他参数不变
   */
  deriveReverseSymbol(symbol: string): string | null {
    const parsed = parseOptionSymbol(symbol);
    if (!parsed) return null;

    const reverseType = parsed.optionType === 'CALL' ? 'P' : 'C';
    // 重建 strike 部分：还原为原始整数格式
    const strikeStr = String(Math.round(parsed.strikePrice * 1000));

    // 重建日期部分 YYMMDD
    const dateParts = parsed.expirationDate.split('-');
    const yy = dateParts[0].slice(2);
    const mm = dateParts[1];
    const dd = dateParts[2];

    return `${parsed.underlying}${yy}${mm}${dd}${reverseType}${strikeStr}.${parsed.market}`;
  }

  /**
   * 采集指定日期的所有期权订单K线
   */
  async collectForDate(date: string): Promise<CollectionSummary> {
    if (this.collecting) {
      logger.warn('[期权K线采集] 采集正在进行中，跳过');
      return { total: 0, success: 0, partial: 0, failed: 0, skipped: 0, noData: 0 };
    }

    this.collecting = true;
    const summary: CollectionSummary = { total: 0, success: 0, partial: 0, failed: 0, skipped: 0, noData: 0 };

    try {
      await this.loadConfig();
      if (!this.enabled) {
        logger.info('[期权K线采集] 采集已被运行时禁用');
        return summary;
      }

      // 查询当日已成交的期权订单
      const orders = await this.fetchFilledOptionOrders(date);
      summary.total = orders.length;

      if (orders.length === 0) {
        logger.info(`[期权K线采集] ${date} 无期权成交订单`);
        return summary;
      }

      logger.info(`[期权K线采集] ${date} 发现 ${orders.length} 笔期权订单，开始采集`);

      // 配对买卖订单 → 提取独立交易
      const trades = this.pairOrders(orders);

      for (let i = 0; i < trades.length; i++) {
        if (i > 0) {
          await new Promise(r => setTimeout(r, this.INTER_REQUEST_DELAY_MS));
        }

        try {
          const result = await this.collectForOrder(trades[i]);
          if (result === 'SUCCESS') summary.success++;
          else if (result === 'PARTIAL') summary.partial++;
          else if (result === 'NO_DATA') summary.noData++;
          else if (result === 'SKIPPED') summary.skipped++;
          else summary.failed++;
        } catch (error: any) {
          summary.failed++;
          logger.warn(`[期权K线采集] 订单 ${trades[i].orderId} 采集失败: ${error.message}`);
        }
      }

      logger.info(
        `[期权K线采集] ${date} 完成 — 总计:${summary.total} 成功:${summary.success} 部分:${summary.partial} 失败:${summary.failed} 跳过:${summary.skipped} 无数据:${summary.noData}`
      );

      // 自动补充分析数据
      await this.enrichAnalysisFromSignals();
    } finally {
      this.collecting = false;
    }

    return summary;
  }

  /**
   * 采集日期范围内的K线数据
   */
  async collectForDateRange(startDate: string, endDate: string): Promise<Record<string, CollectionSummary>> {
    const results: Record<string, CollectionSummary> = {};
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      // 跳过周末
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;

      results[dateStr] = await this.collectForDate(dateStr);
      // 日期间延迟
      await new Promise(r => setTimeout(r, 2000));
    }

    return results;
  }

  /**
   * 采集单笔交易的正向 + 反向K线
   */
  async collectForOrder(params: CollectOrderParams): Promise<string> {
    const { orderId, symbol, tradeDate } = params;

    // 检查是否已成功采集
    const existing = await pool.query(
      `SELECT collection_status FROM option_trade_analysis WHERE order_id = $1`,
      [orderId]
    );
    if (existing.rows.length > 0 && existing.rows[0].collection_status === 'SUCCESS') {
      return 'SKIPPED';
    }

    const parsed = parseOptionSymbol(symbol);
    if (!parsed) {
      logger.warn(`[期权K线采集] 无法解析期权 symbol: ${symbol}`);
      return 'FAILED';
    }

    const reverseSymbol = this.deriveReverseSymbol(symbol);

    let originalCount = 0;
    let reverseCount = 0;
    let errorMsg: string | null = null;

    // 采集正向K线
    try {
      const originalCandles = await this.fetchCandlesticks(symbol, tradeDate);
      if (originalCandles.length > 0) {
        originalCount = await this.upsertKlines(orderId, symbol, 'ORIGINAL', parsed.underlying, tradeDate, originalCandles);
      }
    } catch (error: any) {
      errorMsg = `正向采集失败: ${error.message}`;
      logger.warn(`[期权K线采集] ${symbol} 正向K线获取失败: ${error.message}`);
    }

    // 延迟后采集反向K线
    if (reverseSymbol) {
      await new Promise(r => setTimeout(r, this.INTER_REQUEST_DELAY_MS));
      try {
        const reverseCandles = await this.fetchCandlesticks(reverseSymbol, tradeDate);
        if (reverseCandles.length > 0) {
          reverseCount = await this.upsertKlines(orderId, reverseSymbol, 'REVERSE', parsed.underlying, tradeDate, reverseCandles);
        }
      } catch (error: any) {
        const revErr = `反向采集失败: ${error.message}`;
        errorMsg = errorMsg ? `${errorMsg}; ${revErr}` : revErr;
        logger.warn(`[期权K线采集] ${reverseSymbol} 反向K线获取失败: ${error.message}`);
      }
    }

    // 计算反向分析数据
    let reverseAnalysis: {
      reversePriceAtEntry: number | null;
      reversePriceAtExit: number | null;
      reversePnl: number | null;
      reversePnlPct: number | null;
      reverseHigh: number | null;
      reverseLow: number | null;
    } = {
      reversePriceAtEntry: null,
      reversePriceAtExit: null,
      reversePnl: null,
      reversePnlPct: null,
      reverseHigh: null,
      reverseLow: null,
    };

    if (reverseSymbol && reverseCount > 0) {
      reverseAnalysis = await this.calculateReverseAnalysis(orderId, reverseSymbol, params);
    }

    // 确定采集状态
    let status = 'FAILED';
    if (originalCount > 0 && reverseCount > 0) status = 'SUCCESS';
    else if (originalCount > 0 || reverseCount > 0) status = 'PARTIAL';
    else if (!errorMsg) status = 'NO_DATA';

    // 更新或插入 analysis summary
    await pool.query(
      `INSERT INTO option_trade_analysis
        (order_id, original_symbol, reverse_symbol, underlying, trade_date,
         original_entry_price, original_qty, entry_time,
         reverse_price_at_entry, reverse_price_at_exit, reverse_pnl, reverse_pnl_pct,
         reverse_high, reverse_low,
         original_candle_count, reverse_candle_count,
         collection_status, error_message, collected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
       ON CONFLICT (order_id) DO UPDATE SET
         original_candle_count = $15,
         reverse_candle_count = $16,
         reverse_price_at_entry = COALESCE($9, option_trade_analysis.reverse_price_at_entry),
         reverse_price_at_exit = COALESCE($10, option_trade_analysis.reverse_price_at_exit),
         reverse_pnl = COALESCE($11, option_trade_analysis.reverse_pnl),
         reverse_pnl_pct = COALESCE($12, option_trade_analysis.reverse_pnl_pct),
         reverse_high = COALESCE($13, option_trade_analysis.reverse_high),
         reverse_low = COALESCE($14, option_trade_analysis.reverse_low),
         collection_status = $17,
         error_message = $18,
         collected_at = NOW()`,
      [
        orderId,
        symbol,
        reverseSymbol,
        parsed.underlying,
        tradeDate,
        params.price,
        params.quantity,
        params.executedAt,
        reverseAnalysis.reversePriceAtEntry,
        reverseAnalysis.reversePriceAtExit,
        reverseAnalysis.reversePnl,
        reverseAnalysis.reversePnlPct,
        reverseAnalysis.reverseHigh,
        reverseAnalysis.reverseLow,
        originalCount,
        reverseCount,
        status,
        errorMsg,
      ]
    );

    return status;
  }

  /**
   * 通过 Longbridge SDK 获取K线数据
   */
  private async fetchCandlesticks(
    symbol: string,
    tradeDate: string
  ): Promise<Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number; turnover: number }>> {
    const quoteCtx = await getQuoteContext();
    const longport = require('longport');
    const { Period, AdjustType, NaiveDate: LbNaiveDate, Time: LbTime, NaiveDatetime } = longport;

    // 构建目标日期时间（交易日收盘 23:59:59，确保获取全天数据）
    const [yearStr, monthStr, dayStr] = tradeDate.split('-');
    const targetNaiveDate = new LbNaiveDate(
      parseInt(yearStr, 10),
      parseInt(monthStr, 10),
      parseInt(dayStr, 10)
    );
    const targetNaiveTime = new LbTime(23, 59, 59);
    const targetNaiveDatetime = new NaiveDatetime(targetNaiveDate, targetNaiveTime);

    const tradeSessionsAll = longport.TradeSessions?.All || 100;

    const candlesticks = await quoteCtx.historyCandlesticksByOffset(
      symbol,
      Period.Min_1,
      AdjustType.NoAdjust,
      false,
      targetNaiveDatetime,
      500,
      tradeSessionsAll
    );

    if (!candlesticks || !Array.isArray(candlesticks)) {
      return [];
    }

    // 过滤当日数据并转换格式
    const tradeDateObj = new Date(tradeDate);
    const dayStart = new Date(tradeDateObj);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(tradeDateObj);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    dayEnd.setUTCHours(23, 59, 59, 999);

    return candlesticks
      .map((c: any) => {
        const ts = typeof c.timestamp === 'object' && c.timestamp.getTime
          ? c.timestamp.getTime()
          : typeof c.timestamp === 'number'
            ? c.timestamp
            : new Date(c.timestamp).getTime();

        return {
          timestamp: ts,
          open: Number(c.open?.toString?.() ?? c.open),
          high: Number(c.high?.toString?.() ?? c.high),
          low: Number(c.low?.toString?.() ?? c.low),
          close: Number(c.close?.toString?.() ?? c.close),
          volume: Number(c.volume?.toString?.() ?? c.volume ?? 0),
          turnover: Number(c.turnover?.toString?.() ?? c.turnover ?? 0),
        };
      })
      .filter((c: { timestamp: number; close: number }) => {
        // 过滤有效数据
        return c.timestamp > 0 && c.close > 0;
      });
  }

  /**
   * 批量写入K线数据（ON CONFLICT DO NOTHING）
   */
  private async upsertKlines(
    orderId: string,
    symbol: string,
    klineType: 'ORIGINAL' | 'REVERSE',
    underlying: string,
    tradeDate: string,
    candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number; turnover: number }>
  ): Promise<number> {
    let totalInserted = 0;

    for (let i = 0; i < candles.length; i += this.BATCH_SIZE) {
      const batch = candles.slice(i, i + this.BATCH_SIZE);
      const values: (string | number)[] = [];
      const placeholders: string[] = [];

      batch.forEach((c, idx) => {
        const offset = idx * 11;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
        );
        values.push(
          orderId, symbol, klineType, underlying, tradeDate,
          '1m', c.timestamp, c.open, c.high, c.low, c.close
        );
      });

      const sql = `
        INSERT INTO option_trade_kline (order_id, symbol, kline_type, underlying, trade_date, period, timestamp, open, high, low, close)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (symbol, kline_type, period, timestamp) DO NOTHING
      `;

      const client = await pool.connect();
      try {
        const res = await client.query(sql, values);
        totalInserted += res.rowCount || 0;
      } finally {
        client.release();
      }
    }

    return totalInserted;
  }

  /**
   * 计算反向期权的分析数据
   */
  private async calculateReverseAnalysis(
    orderId: string,
    reverseSymbol: string,
    params: CollectOrderParams
  ): Promise<{
    reversePriceAtEntry: number | null;
    reversePriceAtExit: number | null;
    reversePnl: number | null;
    reversePnlPct: number | null;
    reverseHigh: number | null;
    reverseLow: number | null;
  }> {
    // 获取已存储的反向K线
    const klines = await pool.query(
      `SELECT timestamp, open, high, low, close FROM option_trade_kline
       WHERE order_id = $1 AND kline_type = 'REVERSE'
       ORDER BY timestamp ASC`,
      [orderId]
    );

    if (klines.rows.length === 0) {
      return { reversePriceAtEntry: null, reversePriceAtExit: null, reversePnl: null, reversePnlPct: null, reverseHigh: null, reverseLow: null };
    }

    // 找到最接近买入时间的K线作为入场价
    const entryTs = params.executedAt.getTime();
    let entryCandle = klines.rows[0];
    let minEntryDiff = Math.abs(Number(klines.rows[0].timestamp) - entryTs);
    for (const row of klines.rows) {
      const diff = Math.abs(Number(row.timestamp) - entryTs);
      if (diff < minEntryDiff) {
        minEntryDiff = diff;
        entryCandle = row;
      }
    }

    // 最后一根K线作为退出参考价
    const exitCandle = klines.rows[klines.rows.length - 1];

    // 计算持仓期间最高/最低价
    let reverseHigh = Number(klines.rows[0].high);
    let reverseLow = Number(klines.rows[0].low);
    for (const row of klines.rows) {
      const h = Number(row.high);
      const l = Number(row.low);
      if (h > reverseHigh) reverseHigh = h;
      if (l < reverseLow) reverseLow = l;
    }

    const reversePriceAtEntry = Number(entryCandle.close);
    const reversePriceAtExit = Number(exitCandle.close);

    const reversePnl = reversePriceAtEntry > 0
      ? (reversePriceAtExit - reversePriceAtEntry) * params.quantity * 100
      : null;
    const reversePnlPct = reversePriceAtEntry > 0
      ? ((reversePriceAtExit - reversePriceAtEntry) / reversePriceAtEntry) * 100
      : null;

    return {
      reversePriceAtEntry,
      reversePriceAtExit,
      reversePnl,
      reversePnlPct,
      reverseHigh,
      reverseLow,
    };
  }

  /**
   * 查询指定日期已成交的期权订单
   */
  private async fetchFilledOptionOrders(date: string): Promise<CollectOrderParams[]> {
    try {
      const tradeCtx = await getTradeContext();

      const startDate = new Date(`${date}T00:00:00Z`);
      const endDate = new Date(`${date}T23:59:59Z`);

      const orders = await tradeCtx.historyOrders({
        market: Market.US,
        status: [OrderStatus.Filled],
        startAt: startDate,
        endAt: endDate,
      });

      if (!orders || !Array.isArray(orders)) return [];

      return orders
        .filter((o: any) => {
          const sym = String(o.symbol || o.stockName || '');
          return isLikelyOptionSymbol(sym);
        })
        .map((o: any) => ({
          orderId: String(o.orderId || o.order_id || ''),
          symbol: String(o.symbol || ''),
          side: String(o.side || ''),
          quantity: Number(o.quantity?.toString?.() ?? o.quantity ?? 0),
          price: Number(o.executedPrice?.toString?.() ?? o.price?.toString?.() ?? 0),
          executedAt: o.updatedAt ? new Date(o.updatedAt) : new Date(o.createdAt || date),
          tradeDate: date,
        }));
    } catch (error: any) {
      logger.error(`[期权K线采集] 获取 ${date} 订单失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 配对买卖订单，提取独立交易（简化版：每笔订单独立处理）
   */
  private pairOrders(orders: CollectOrderParams[]): CollectOrderParams[] {
    // 按 symbol 分组，优先取买入订单
    const bySymbol = new Map<string, CollectOrderParams>();
    for (const o of orders) {
      const key = o.symbol;
      if (!bySymbol.has(key)) {
        bySymbol.set(key, o);
      }
    }
    return Array.from(bySymbol.values());
  }

  /**
   * 调度每日采集：收盘后延迟执行
   */
  private scheduleDailyCollection(): void {
    const now = new Date();
    const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etNow = new Date(etStr);

    // 目标时间：今日 16:00 ET + delay
    const targetET = new Date(etNow);
    targetET.setHours(16, this.delayMinutes, 0, 0);

    let delayMs = targetET.getTime() - etNow.getTime();

    // 如果目标时间已过，调度到明天
    if (delayMs <= 0) {
      delayMs += 24 * 60 * 60 * 1000;
    }

    this.timer = setTimeout(async () => {
      try {
        await this.loadConfig();
        if (!this.enabled) {
          logger.info('[期权K线采集] 采集已被运行时禁用，跳过');
        } else {
          const today = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
          const todayDate = new Date(today).toISOString().split('T')[0];
          await this.collectForDate(todayDate);
        }
      } catch (error: any) {
        logger.error(`[期权K线采集] 每日采集异常: ${error.message}`);
      }
      // 继续调度下一天
      this.scheduleDailyCollection();
    }, delayMs);

    const nextRunET = new Date(etNow.getTime() + delayMs);
    logger.debug(`[期权K线采集] 下次采集调度于美东 ${nextRunET.toLocaleString('en-US')}（约 ${Math.round(delayMs / 60000)} 分钟后）`);
  }

  /**
   * 获取采集状态概览
   */
  async getStatus(): Promise<{
    enabled: boolean;
    collecting: boolean;
    recentAnalysis: any[];
    stats: { total: number; success: number; pending: number; failed: number };
  }> {
    const statsRes = await pool.query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE collection_status = 'SUCCESS') as success,
         COUNT(*) FILTER (WHERE collection_status = 'PENDING') as pending,
         COUNT(*) FILTER (WHERE collection_status IN ('FAILED', 'NO_DATA')) as failed
       FROM option_trade_analysis`
    );

    const recentRes = await pool.query(
      `SELECT order_id, original_symbol, reverse_symbol, underlying, trade_date,
              collection_status, original_candle_count, reverse_candle_count, collected_at
       FROM option_trade_analysis
       ORDER BY created_at DESC LIMIT 20`
    );

    const stats = statsRes.rows[0] || { total: 0, success: 0, pending: 0, failed: 0 };

    return {
      enabled: this.enabled,
      collecting: this.collecting,
      recentAnalysis: recentRes.rows,
      stats: {
        total: Number(stats.total),
        success: Number(stats.success),
        pending: Number(stats.pending),
        failed: Number(stats.failed),
      },
    };
  }

  /**
   * 从 strategy_signals 补充 option_trade_analysis 中缺失的字段
   * 逻辑: 先找 BUY 信号（取 entry_time + score/strategy），再找其后的 SELL 信号（取 exit_time + pnl）
   * @param force 强制重新补充所有记录（覆盖已有数据）
   */
  async enrichAnalysisFromSignals(force = false): Promise<number> {
    const whereClause = force
      ? ''
      : 'WHERE original_pnl IS NULL OR strategy IS NULL OR exit_time IS NULL';
    const incomplete = await pool.query(
      `SELECT order_id, original_symbol, trade_date, entry_time FROM option_trade_analysis ${whereClause}`
    );

    if (incomplete.rows.length === 0) return 0;

    let enriched = 0;
    for (const row of incomplete.rows) {
      const symbol = row.original_symbol;
      const tradeDate = row.trade_date;

      // 1. 找 BUY 信号（同 symbol，同日，最近的一条）— 含 price 字段
      const buyRes = await pool.query(
        `SELECT price, metadata, created_at FROM strategy_signals
         WHERE symbol = $1 AND signal_type = 'BUY' AND status = 'EXECUTED'
           AND created_at::date = $2::date
         ORDER BY created_at DESC
         LIMIT 1`,
        [symbol, tradeDate]
      );
      const buyRow = buyRes.rows[0];
      const buyMeta = buyRow?.metadata;
      const buyTime = buyRow?.created_at;
      const buyPrice = buyRow?.price ? Number(buyRow.price) : null;

      // 2. 找 SELL 信号（同 symbol，在 BUY 之后）— 含 price 字段
      const sellAnchor = buyTime || row.entry_time;
      const sellRes = await pool.query(
        `SELECT price, metadata, created_at FROM strategy_signals
         WHERE symbol = $1 AND signal_type = 'SELL' AND status = 'EXECUTED'
           AND created_at > $2::timestamptz
         ORDER BY created_at ASC
         LIMIT 1`,
        [symbol, sellAnchor]
      );
      const sellRow = sellRes.rows[0];
      const sellMeta = sellRow?.metadata;
      const sellTime = sellRow?.created_at;
      const sellPrice = sellRow?.price ? Number(sellRow.price) : null;

      if (!buyRow && !sellRow) continue;

      const strategy = String(buyMeta?.selectedStrategy ?? '');
      const direction = String(buyMeta?.optionDirection ?? '');
      const signalScore = buyMeta?.finalScore !== undefined ? Number(buyMeta.finalScore) : null;

      const netPnl = sellMeta?.netPnL !== undefined ? Number(sellMeta.netPnL) : null;
      const netPnlPct = sellMeta?.netPnLPercent !== undefined ? Number(sellMeta.netPnLPercent) : null;
      const exitType = String(sellMeta?.exitAction ?? '');

      // 用信号数据覆盖（信号 price 比订单 executedPrice 更准确）
      await pool.query(
        `UPDATE option_trade_analysis SET
           strategy = COALESCE(NULLIF($2, ''), strategy),
           direction = COALESCE(NULLIF($3, ''), direction),
           signal_score = COALESCE($4, signal_score),
           original_entry_price = COALESCE($5, original_entry_price),
           original_exit_price = COALESCE($6, original_exit_price),
           original_pnl = COALESCE($7, original_pnl),
           original_pnl_pct = COALESCE($8, original_pnl_pct),
           exit_type = COALESCE(NULLIF($9, ''), exit_type),
           entry_time = COALESCE($10, entry_time),
           exit_time = COALESCE($11, exit_time)
         WHERE order_id = $1`,
        [row.order_id, strategy, direction, signalScore, buyPrice, sellPrice, netPnl, netPnlPct, exitType, buyTime, sellTime]
      );
      enriched++;
    }

    logger.info(`[期权K线采集] 补充分析数据完成: ${enriched}/${incomplete.rows.length} 条已更新`);
    return enriched;
  }

  /**
   * 查询分析摘要（支持过滤）
   */
  async getAnalysis(params: {
    startDate?: string;
    endDate?: string;
    underlying?: string;
    orderId?: string;
  }): Promise<any[]> {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    let idx = 1;

    if (params.startDate) {
      conditions.push(`trade_date >= $${idx++}`);
      values.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push(`trade_date <= $${idx++}`);
      values.push(params.endDate);
    }
    if (params.underlying) {
      conditions.push(`underlying = $${idx++}`);
      values.push(params.underlying);
    }
    if (params.orderId) {
      conditions.push(`order_id = $${idx++}`);
      values.push(params.orderId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await pool.query(
      `SELECT * FROM option_trade_analysis ${where} ORDER BY trade_date DESC, entry_time DESC`,
      values
    );
    return res.rows;
  }

  /**
   * 查询K线数据
   */
  async getCandles(orderId: string, klineType?: string): Promise<any[]> {
    const conditions = ['order_id = $1'];
    const values: string[] = [orderId];

    if (klineType) {
      conditions.push('kline_type = $2');
      values.push(klineType);
    }

    const res = await pool.query(
      `SELECT * FROM option_trade_kline WHERE ${conditions.join(' AND ')} ORDER BY timestamp ASC`,
      values
    );
    return res.rows;
  }
}

export default new OptionKlineCollectionService();
