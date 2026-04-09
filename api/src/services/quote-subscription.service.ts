/**
 * Quote Subscription Service — WebSocket 实时行情订阅
 *
 * 管理 LongPort SDK 的 WebSocket 行情推送生命周期：
 * - subscribe / unsubscribe 标的报价 + K线
 * - setOnQuote / setOnCandlestick 回调驱动数据消费
 * - 降级机制：WebSocket 断线时自动回退到 5 秒轮询，重连后恢复
 * - 心跳检测 + 断线自动重连
 *
 * 数据流：
 *   WebSocket push → onQuote → feedSingleQuote (FastMomentum) + priceMap 更新 + 消费者回调
 *   WebSocket push → onCandlestick → isConfirmed 时触发 momentum 重算
 */

import { logger } from '../utils/logger';
import { getQuoteContext } from '../config/longport';
import fastMomentumService from './fast-momentum.service';
import tradingSessionService from './trading-session.service';

/** 标准化 K 线数据（与 market-data.service 一致） */
interface CandlestickBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

// LongPort SDK 枚举——延迟 require 避免模块加载顺序问题
let SubType: { Quote: number };
let Period: { Min_1: number };

function ensureLongportEnums(): void {
  if (!SubType) {
    const longport = require('longport');
    SubType = longport.SubType;
    Period = longport.Period;
  }
}

// ============================================
// 类型定义
// ============================================

/** 报价推送消费者回调 */
type QuoteConsumer = (symbol: string, price: number, timestamp: number) => void;

/** 服务运行状态 */
type ServiceStatus = 'IDLE' | 'ACTIVE' | 'DEGRADED' | 'STOPPED';

// ============================================
// 常量
// ============================================

/** 心跳检测间隔（毫秒）— 若超过此时长未收到任何推送，则判定断线 */
const HEARTBEAT_TIMEOUT_MS = 30_000;

/** 心跳检测定时器周期 */
const HEARTBEAT_CHECK_INTERVAL_MS = 10_000;

/** 重连延迟基数（毫秒）— 指数退避 */
const RECONNECT_BASE_DELAY_MS = 2_000;

/** 最大重连延迟 */
const RECONNECT_MAX_DELAY_MS = 60_000;

/** 非交易时段休眠轮询间隔（5 分钟检查一次是否开盘） */
const OFF_HOURS_CHECK_INTERVAL_MS = 5 * 60_000;

/** 降级轮询间隔 */
const FALLBACK_POLL_INTERVAL_MS = 5_000;

/** 日志节流间隔 */
const LOG_THROTTLE_MS = 60_000;

/** 大盘指数 K 线环形缓冲最大容量（120 根 = 2 小时 1min K 线） */
const KLINE_BUFFER_MAX = 120;

/** 大盘指数订阅列表 */
const MARKET_INDEX_SYMBOLS = ['SPY.US', 'UUP.US', 'IBIT.US'];

/** VIX 标的 */
const VIX_SYMBOL = '.VIX.US';

/** LongPort 订阅上限（单连接） */
const SUBSCRIPTION_LIMIT = 500;

/** 订阅预警阈值（80%） */
const SUBSCRIPTION_WARN_THRESHOLD = Math.floor(SUBSCRIPTION_LIMIT * 0.8);

// ============================================
// QuoteSubscriptionService
// ============================================

class QuoteSubscriptionService {
  /** 当前已订阅的报价标的 */
  private subscribedQuoteSymbols = new Set<string>();

  /** 当前已订阅 K 线的标的 */
  private subscribedCandlestickSymbols = new Set<string>();

  /** 最近一次收到推送的时间戳 */
  private lastPushTimestamp = 0;

  /** 服务状态 */
  private status: ServiceStatus = 'IDLE';

  /** 心跳检测定时器 */
  private heartbeatTimer: NodeJS.Timeout | null = null;

  /** 降级轮询定时器 */
  private fallbackPollTimer: NodeJS.Timeout | null = null;

  /** 重连次数（连续） */
  private reconnectAttempts = 0;

  /** 是否已注册回调 */
  private callbacksRegistered = false;

  /** quoteCtx 引用缓存 */
  private quoteCtx: ReturnType<typeof getQuoteContext> extends Promise<infer T> ? T : never = null as never;

  /** 外部报价消费者 */
  private quoteConsumers: QuoteConsumer[] = [];

  /** 实时价格缓存（供外部读取） */
  private priceMap = new Map<string, number>();

  /** 日志节流缓存 */
  private lastLogTime = new Map<string, number>();

  /** 大盘指数 1min K 线环形缓冲（symbol → 最近 N 根 K 线） */
  private klineBuffers = new Map<string, CandlestickBar[]>();

  /** 大盘指数是否已订阅 */
  private marketIndicesSubscribed = false;

  // ========================================
  // 公共 API
  // ========================================

  /**
   * 初始化服务：获取 quoteCtx 并注册推送回调
   * 应在策略调度器启动时调用一次
   */
  async init(): Promise<void> {
    if (this.status === 'ACTIVE' || this.status === 'DEGRADED') {
      logger.debug('[QuoteSub] 服务已初始化，跳过重复调用');
      return;
    }

    try {
      ensureLongportEnums();
      this.quoteCtx = await getQuoteContext();
      this.registerCallbacks();
      this.startHeartbeatCheck();
      this.status = 'ACTIVE';
      this.reconnectAttempts = 0;
      logger.log('[QuoteSub] WebSocket 行情订阅服务已初始化');

      // 自动订阅大盘指数 K 线（USD/BTC/VIX 分K实时化）
      this.subscribeMarketIndices().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[QuoteSub] 大盘指数订阅失败（不影响主流程）: ${msg}`);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[QuoteSub] 初始化失败，进入降级模式: ${msg}`);
      this.status = 'DEGRADED';
      this.startFallbackPolling();
    }
  }

  /**
   * 订阅标的报价 + 1 分钟 K 线
   * 幂等：已订阅的标的不会重复订阅
   */
  async subscribeSymbols(symbols: string[]): Promise<void> {
    if (symbols.length === 0) return;

    // 过滤已订阅的
    const newQuoteSymbols = symbols.filter(s => !this.subscribedQuoteSymbols.has(s));
    const newCandleSymbols = symbols.filter(s => !this.subscribedCandlestickSymbols.has(s));

    if (this.status !== 'ACTIVE') {
      // 降级模式下仅记录意图，由 fallback polling 覆盖
      for (const s of symbols) {
        this.subscribedQuoteSymbols.add(s);
        this.subscribedCandlestickSymbols.add(s);
      }
      return;
    }

    // 订阅报价（批量）
    if (newQuoteSymbols.length > 0) {
      try {
        await this.quoteCtx.subscribe(newQuoteSymbols, [SubType.Quote], true);
        for (const s of newQuoteSymbols) this.subscribedQuoteSymbols.add(s);
        logger.info(`[QuoteSub] 订阅报价: ${newQuoteSymbols.length} 个标的 [${newQuoteSymbols.slice(0, 5).join(', ')}${newQuoteSymbols.length > 5 ? '...' : ''}]`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[QuoteSub] 订阅报价失败: ${msg}`);
        // 仍然标记为已订阅（降级后 fallback 会覆盖）
        for (const s of newQuoteSymbols) this.subscribedQuoteSymbols.add(s);
      }
    }

    // 订阅 1 分钟 K 线（逐个，API 限制）
    for (const sym of newCandleSymbols) {
      try {
        await this.quoteCtx.subscribeCandlesticks(sym, Period.Min_1);
        this.subscribedCandlestickSymbols.add(sym);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.throttledLog(`candle_sub_fail_${sym}`, `[QuoteSub] K线订阅失败 ${sym}: ${msg}`);
        this.subscribedCandlestickSymbols.add(sym); // 降级处理
      }
    }

    // 订阅数量预警
    const totalSubs = this.subscribedQuoteSymbols.size;
    if (totalSubs > SUBSCRIPTION_WARN_THRESHOLD) {
      logger.warn(
        `[QuoteSub] 订阅数量预警: ${totalSubs}/${SUBSCRIPTION_LIMIT} (${Math.round(totalSubs / SUBSCRIPTION_LIMIT * 100)}%)，` +
        `接近上限，请检查是否有订阅泄漏`
      );
    }
  }

  /**
   * 取消订阅标的
   */
  async unsubscribeSymbols(symbols: string[]): Promise<void> {
    if (symbols.length === 0) return;

    const toUnsub = symbols.filter(s => this.subscribedQuoteSymbols.has(s));

    if (this.status === 'ACTIVE' && toUnsub.length > 0) {
      try {
        await this.quoteCtx.unsubscribe(toUnsub, [SubType.Quote]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug(`[QuoteSub] 取消报价订阅失败: ${msg}`);
      }

      for (const sym of toUnsub) {
        if (this.subscribedCandlestickSymbols.has(sym)) {
          try {
            await this.quoteCtx.unsubscribeCandlesticks(sym, Period.Min_1);
          } catch {
            // 忽略取消 K 线订阅失败
          }
        }
      }
    }

    for (const s of symbols) {
      this.subscribedQuoteSymbols.delete(s);
      this.subscribedCandlestickSymbols.delete(s);
      this.priceMap.delete(s);
    }
  }

  /**
   * 注册外部报价消费者回调
   */
  addQuoteConsumer(consumer: QuoteConsumer): void {
    this.quoteConsumers.push(consumer);
  }

  /**
   * 获取最新价格（从 WebSocket 推送缓存）
   */
  getPrice(symbol: string): number | undefined {
    return this.priceMap.get(symbol);
  }

  /**
   * 获取所有已缓存价格的 Map 引用（只读用途）
   */
  getPriceMap(): ReadonlyMap<string, number> {
    return this.priceMap;
  }

  /**
   * 当前服务状态
   */
  getStatus(): ServiceStatus {
    return this.status;
  }

  /**
   * 当前是否处于活跃的 WebSocket 模式（非降级）
   */
  isWebSocketActive(): boolean {
    return this.status === 'ACTIVE';
  }

  /**
   * 获取当前已订阅的 symbol 列表
   */
  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedQuoteSymbols);
  }

  /**
   * 获取当前订阅数量
   */
  getSubscriptionCount(): number {
    return this.subscribedQuoteSymbols.size;
  }

  /**
   * 对账：与实际需要的 symbol 集合对比，取消不再需要的订阅
   * @param neededSymbols 当前所有运行中策略需要的 symbol 集合
   * @returns 被清理的 symbol 列表
   */
  async reconcile(neededSymbols: Set<string>): Promise<string[]> {
    // 大盘指数标的受保护，不被对账清理
    const protectedSymbols = new Set([...MARKET_INDEX_SYMBOLS, VIX_SYMBOL]);
    const staleSymbols: string[] = [];
    for (const sym of this.subscribedQuoteSymbols) {
      if (!neededSymbols.has(sym) && !protectedSymbols.has(sym)) {
        staleSymbols.push(sym);
      }
    }

    if (staleSymbols.length === 0) return [];

    await this.unsubscribeSymbols(staleSymbols);
    logger.info(
      `[QuoteSub] 对账清理 ${staleSymbols.length} 个废弃订阅: ${staleSymbols.join(', ')}，` +
      `剩余 ${this.subscribedQuoteSymbols.size} 个`
    );

    return staleSymbols;
  }

  /**
   * 停止服务，清理所有资源
   */
  async stop(): Promise<void> {
    this.status = 'STOPPED';

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.fallbackPollTimer) {
      clearInterval(this.fallbackPollTimer);
      this.fallbackPollTimer = null;
    }

    // 尝试取消所有订阅
    if (this.quoteCtx && this.subscribedQuoteSymbols.size > 0) {
      try {
        const allSymbols = Array.from(this.subscribedQuoteSymbols);
        await this.quoteCtx.unsubscribe(allSymbols, [SubType.Quote]);
      } catch {
        // 停止时忽略错误
      }
    }

    this.subscribedQuoteSymbols.clear();
    this.subscribedCandlestickSymbols.clear();
    this.priceMap.clear();
    this.klineBuffers.clear();
    this.marketIndicesSubscribed = false;
    this.quoteConsumers = [];
    this.callbacksRegistered = false;

    logger.log('[QuoteSub] 服务已停止');
  }

  // ========================================
  // 内部实现
  // ========================================

  /**
   * 注册 WebSocket 推送回调
   */
  private registerCallbacks(): void {
    if (this.callbacksRegistered) return;

    // 报价推送回调
    this.quoteCtx.setOnQuote((err: Error | null, event: { symbol: string; data: { lastDone: { toNumber(): number }; timestamp: Date; tradeSession: number } }) => {
      if (err) {
        this.throttledLog('onQuoteErr', `[QuoteSub] onQuote 错误: ${err.message}`);
        return;
      }

      this.lastPushTimestamp = Date.now();
      const symbol = event.symbol;
      const price = Number(event.data.lastDone.toNumber());
      const timestamp = event.data.timestamp.getTime();

      if (isNaN(price) || price <= 0) return;

      // 更新价格缓存
      this.priceMap.set(symbol, price);

      // 喂入快动量服务
      fastMomentumService.feedSingleQuote(symbol, price, timestamp);

      // 通知外部消费者
      for (const consumer of this.quoteConsumers) {
        try {
          consumer(symbol, price, timestamp);
        } catch (consumerErr: unknown) {
          const msg = consumerErr instanceof Error ? consumerErr.message : String(consumerErr);
          this.throttledLog('consumerErr', `[QuoteSub] 消费者回调异常: ${msg}`);
        }
      }
    });

    // K 线推送回调
    this.quoteCtx.setOnCandlestick((err: Error | null, event: { symbol: string; data: { isConfirmed: boolean; candlestick: { open: { toNumber(): number }; high: { toNumber(): number }; low: { toNumber(): number }; close: { toNumber(): number }; volume: number; timestamp: Date } } }) => {
      if (err) {
        this.throttledLog('onCandleErr', `[QuoteSub] onCandlestick 错误: ${err.message}`);
        return;
      }

      this.lastPushTimestamp = Date.now();

      // 仅在 K 线收线（confirmed）时更新价格，避免中间态噪声
      if (event.data.isConfirmed) {
        const symbol = event.symbol;
        const closePrice = Number(event.data.candlestick.close.toNumber());
        if (!isNaN(closePrice) && closePrice > 0) {
          this.priceMap.set(symbol, closePrice);
          // 收线价格同样喂入快动量作为补充数据点
          fastMomentumService.feedSingleQuote(symbol, closePrice, event.data.candlestick.timestamp.getTime());

          // 大盘指数 K 线写入环形缓冲
          if (MARKET_INDEX_SYMBOLS.includes(symbol) || symbol === VIX_SYMBOL) {
            const bar: CandlestickBar = {
              open: Number(event.data.candlestick.open?.toNumber() || closePrice),
              high: Number(event.data.candlestick.high?.toNumber() || closePrice),
              low: Number(event.data.candlestick.low?.toNumber() || closePrice),
              close: closePrice,
              volume: Number(event.data.candlestick.volume || 0),
              turnover: 0,
              timestamp: event.data.candlestick.timestamp.getTime(),
            };
            this.appendKlineBuffer(symbol, bar);
          }
        }
      }
    });

    this.callbacksRegistered = true;
    logger.debug('[QuoteSub] WebSocket 回调已注册');
  }

  /**
   * 心跳检测：定期检查是否仍在接收推送数据
   * 非交易时段跳过检测 — 没有推送是正常的，不触发重连
   */
  private startHeartbeatCheck(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(async () => {
      if (this.status !== 'ACTIVE') return;
      if (this.subscribedQuoteSymbols.size === 0) return;

      // 非交易时段不检测心跳 — 没有推送是正常的
      try {
        const inSession = await tradingSessionService.isInTradingSession('US');
        if (!inSession) return;
      } catch {
        // 交易时段查询失败时保守跳过，不误触重连
        return;
      }

      const elapsed = Date.now() - this.lastPushTimestamp;
      if (this.lastPushTimestamp > 0 && elapsed > HEARTBEAT_TIMEOUT_MS) {
        logger.warn(`[QuoteSub] 心跳超时: ${(elapsed / 1000).toFixed(0)}s 未收到推送，尝试重连`);
        this.handleDisconnect();
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  }

  /**
   * 处理断线：进入降级模式并尝试重连
   */
  private handleDisconnect(): void {
    this.status = 'DEGRADED';
    this.callbacksRegistered = false;
    this.startFallbackPolling();
    this.scheduleReconnect();
  }

  /**
   * 调度重连（指数退避）
   * 非交易时段自动暂停重连，转入休眠轮询等待开盘
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    );

    logger.info(`[QuoteSub] 将在 ${(delay / 1000).toFixed(0)}s 后尝试第 ${this.reconnectAttempts} 次重连`);

    setTimeout(async () => {
      const currentStatus: ServiceStatus = this.status;
      if (currentStatus === 'STOPPED') return;

      // 非交易时段：暂停重连，进入休眠等待开盘
      try {
        const inSession = await tradingSessionService.isInTradingSession('US');
        if (!inSession) {
          logger.info(`[QuoteSub] 非交易时段，暂停重连（已尝试 ${this.reconnectAttempts} 次），${OFF_HOURS_CHECK_INTERVAL_MS / 60_000} 分钟后重新检查`);
          this.reconnectAttempts = 0; // 重置计数，开盘后从头退避
          this.waitForTradingSession();
          return;
        }
      } catch {
        // 交易时段查询失败，保守继续重连
      }

      try {
        this.quoteCtx = await getQuoteContext();
        this.registerCallbacks();
        this.lastPushTimestamp = Date.now();

        const allSymbols = Array.from(this.subscribedQuoteSymbols);
        if (allSymbols.length > 0) {
          await this.quoteCtx.subscribe(allSymbols, [SubType.Quote], true);
          for (const sym of this.subscribedCandlestickSymbols) {
            await this.quoteCtx.subscribeCandlesticks(sym, Period.Min_1);
          }
        }

        this.status = 'ACTIVE';
        this.reconnectAttempts = 0;
        this.stopFallbackPolling();
        logger.info(`[QuoteSub] 重连成功，恢复 WebSocket 推送（已重新订阅 ${allSymbols.length} 个标的）`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[QuoteSub] 重连失败(第${this.reconnectAttempts}次): ${msg}`);
        const statusAfter: ServiceStatus = this.status;
        if (statusAfter !== 'STOPPED') {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * 非交易时段休眠：每 5 分钟检查一次是否进入交易时段，是则触发重连
   */
  private waitForTradingSession(): void {
    const timer = setTimeout(async () => {
      if (this.status === 'STOPPED') return;
      if (this.status === 'ACTIVE') return; // 已被外部恢复

      try {
        const inSession = await tradingSessionService.isInTradingSession('US');
        if (inSession) {
          logger.info('[QuoteSub] 交易时段已开始，触发重连');
          this.scheduleReconnect();
        } else {
          this.waitForTradingSession(); // 继续等待
        }
      } catch {
        this.waitForTradingSession(); // 查询失败也继续等待
      }
    }, OFF_HOURS_CHECK_INTERVAL_MS);

    // 如果服务被 stop()，需要能清理这个 timer
    // 复用 heartbeatTimer 不合适，用一次性 setTimeout 让 GC 自然回收
    // stop() 时 status=STOPPED 会在回调入口处拦截
    if (timer.unref) timer.unref(); // 不阻止进程退出
  }

  /**
   * 启动降级轮询（5 秒间隔批量请求报价）
   */
  private startFallbackPolling(): void {
    if (this.fallbackPollTimer) return; // 避免重复启动

    logger.info('[QuoteSub] 启动降级轮询模式（5秒间隔）');

    this.fallbackPollTimer = setInterval(async () => {
      if (this.status === 'ACTIVE' || this.status === 'STOPPED') {
        this.stopFallbackPolling();
        return;
      }

      const symbols = Array.from(this.subscribedQuoteSymbols);
      if (symbols.length === 0) return;

      try {
        const quoteCtx = await getQuoteContext();
        const quotes = await quoteCtx.quote(symbols);
        const now = Date.now();

        for (const q of quotes) {
          const price = Number(q.lastDone?.toString() || '0');
          if (isNaN(price) || price <= 0) continue;

          this.priceMap.set(q.symbol, price);
          fastMomentumService.feedSingleQuote(q.symbol, price, now);

          for (const consumer of this.quoteConsumers) {
            try {
              consumer(q.symbol, price, now);
            } catch {
              // 消费者异常不阻塞轮询
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.throttledLog('fallbackPollErr', `[QuoteSub] 降级轮询失败: ${msg}`);
      }
    }, FALLBACK_POLL_INTERVAL_MS);
  }

  /**
   * 停止降级轮询
   */
  private stopFallbackPolling(): void {
    if (this.fallbackPollTimer) {
      clearInterval(this.fallbackPollTimer);
      this.fallbackPollTimer = null;
      logger.debug('[QuoteSub] 降级轮询已停止');
    }
  }

  /**
   * 节流日志：同一 key 在 LOG_THROTTLE_MS 内只打印一次
   */
  private throttledLog(key: string, message: string): void {
    const now = Date.now();
    const last = this.lastLogTime.get(key) || 0;
    if (now - last > LOG_THROTTLE_MS) {
      logger.warn(message);
      this.lastLogTime.set(key, now);
    }
  }

  // ========================================
  // 大盘指数 K 线订阅 + 缓冲
  // ========================================

  /**
   * 订阅大盘指数 1min K 线推送（SPY/UUP/IBIT + VIX）
   * 应在 init() 成功后调用一次
   */
  async subscribeMarketIndices(): Promise<void> {
    if (this.marketIndicesSubscribed) return;
    if (this.status !== 'ACTIVE') {
      logger.debug('[QuoteSub] 非 ACTIVE 状态，跳过大盘指数订阅');
      return;
    }

    ensureLongportEnums();

    // 1. 订阅 SPY/UUP/IBIT 1min K 线
    for (const sym of MARKET_INDEX_SYMBOLS) {
      if (!this.subscribedCandlestickSymbols.has(sym)) {
        try {
          await this.quoteCtx.subscribeCandlesticks(sym, Period.Min_1);
          this.subscribedCandlestickSymbols.add(sym);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[QuoteSub] 大盘 K 线订阅失败 ${sym}: ${msg}`);
        }
      }
    }

    // 同时订阅报价（保证 priceMap 有最新价）
    const newQuoteSymbols = MARKET_INDEX_SYMBOLS.filter(s => !this.subscribedQuoteSymbols.has(s));
    if (newQuoteSymbols.length > 0) {
      try {
        await this.quoteCtx.subscribe(newQuoteSymbols, [SubType.Quote], true);
        for (const s of newQuoteSymbols) this.subscribedQuoteSymbols.add(s);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[QuoteSub] 大盘报价订阅失败: ${msg}`);
      }
    }

    // 2. VIX：尝试 K 线订阅，失败降级到报价订阅
    if (!this.subscribedCandlestickSymbols.has(VIX_SYMBOL) && !this.subscribedQuoteSymbols.has(VIX_SYMBOL)) {
      try {
        await this.quoteCtx.subscribeCandlesticks(VIX_SYMBOL, Period.Min_1);
        this.subscribedCandlestickSymbols.add(VIX_SYMBOL);
        logger.info('[QuoteSub] VIX K 线订阅成功');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[QuoteSub] VIX K 线订阅失败，降级到报价: ${msg}`);
        try {
          await this.quoteCtx.subscribe([VIX_SYMBOL], [SubType.Quote], true);
          this.subscribedQuoteSymbols.add(VIX_SYMBOL);
        } catch (err2: unknown) {
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          logger.warn(`[QuoteSub] VIX 报价订阅也失败: ${msg2}`);
        }
      }
    }

    this.marketIndicesSubscribed = true;
    logger.info(
      `[QuoteSub] 大盘指数订阅完成: ${[...MARKET_INDEX_SYMBOLS, VIX_SYMBOL].join(', ')}` +
      ` (K线: ${this.subscribedCandlestickSymbols.size}, 报价: ${this.subscribedQuoteSymbols.size})`
    );
  }

  /**
   * 获取指定标的的近期 K 线缓冲（从推送数据）
   * @returns 按时间升序排列的 K 线数组，无数据时返回空数组
   */
  getRecentKlines(symbol: string): CandlestickBar[] {
    return this.klineBuffers.get(symbol) || [];
  }

  /**
   * 追加 K 线到环形缓冲
   */
  private appendKlineBuffer(symbol: string, bar: CandlestickBar): void {
    let buffer = this.klineBuffers.get(symbol);
    if (!buffer) {
      buffer = [];
      this.klineBuffers.set(symbol, buffer);
    }
    buffer.push(bar);
    // 环形：超过上限则移除最早的
    while (buffer.length > KLINE_BUFFER_MAX) {
      buffer.shift();
    }
  }
}

export default new QuoteSubscriptionService();
export { QuoteSubscriptionService };
export type { QuoteConsumer, ServiceStatus, CandlestickBar };
