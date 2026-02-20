/**
 * 期权策略回测引擎 (Option Intraday Backtest)
 *
 * 回放 OPTION_INTRADAY_V1 策略在指定日期的表现。
 * 核心思路：不修改生产服务，新建独立引擎，复用评分/退出算法。
 *
 * 数据源：
 * - SPX/USD/BTC 1m K-lines: DB market_kline_history
 * - VIX 1m K-lines: Longport API (.VIX.US)
 * - 标的股票 1m K-lines: Longport API
 * - 期权合约 1m K-lines: Longport SDK
 * - 市场温度: 固定 50（中性）
 */

import pool from '../config/database';
import { getQuoteContext } from '../config/longport';
import klineHistoryService from './kline-history.service';
import intradayDataFilterService from './intraday-data-filter.service';
import { optionDynamicExitService, PositionContext, DEFAULT_FEE_CONFIG } from './option-dynamic-exit.service';
import { logger } from '../utils/logger';

// ============================================
// 类型定义
// ============================================

interface CandlestickData {
  close: number;
  open: number;
  low: number;
  high: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

interface MarketDataWindow {
  spx: CandlestickData[];
  usdIndex: CandlestickData[];
  btc: CandlestickData[];
  vix?: CandlestickData[];
  marketTemperature: number;
  // 小时级数据（用于分时评分）
  btcHourly?: CandlestickData[];
  usdIndexHourly?: CandlestickData[];
}

interface BacktestTradeRecord {
  date: string;
  symbol: string;
  optionSymbol: string;
  direction: 'CALL' | 'PUT';
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  grossPnL: number;
  netPnL: number;
  grossPnLPercent: number;
  netPnLPercent: number;
  entryReason: string;
  exitReason: string | null;
  exitTag?: string;
  entryScore: number;
  marketScore: number;
  intradayScore: number;
  timeWindowAdjustment: number;
  holdingMinutes: number;
  peakPnLPercent: number;
}

export interface OptionBacktestResult {
  id?: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  dates: string[];
  symbols: string[];
  trades: BacktestTradeRecord[];
  summary: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalGrossPnL: number;
    totalNetPnL: number;
    avgGrossPnLPercent: number;
    maxDrawdownPercent: number;
    avgHoldingMinutes: number;
    profitFactor: number;
  };
  diagnosticLog: {
    dataFetch: Array<{ source: string; date: string; count: number; ok: boolean; error?: string }>;
    signals: Array<{
      date: string;
      time: string;
      score: number;
      marketScore: number;
      intradayScore: number;
      direction: 'CALL' | 'PUT' | 'HOLD';
      action: string;
    }>;
  };
}

interface OptionBacktestConfig {
  entryThreshold?: number;           // default 15
  riskPreference?: 'AGGRESSIVE' | 'CONSERVATIVE';
  positionContracts?: number;        // default 1
  entryPriceMode?: 'CLOSE' | 'HIGH'; // default CLOSE (use candle close as entry)
  strikeOffsetPoints?: number;       // ATM offset, default 0
  tradeWindowStartET?: number;       // minutes from midnight, default 570 (9:30)
  tradeWindowEndET?: number;         // default 630 (10:30) — first hour only
  maxTradesPerDay?: number;          // default 3
}

// ============================================
// 评分算法（从 option-recommendation.service.ts 复制）
// ============================================

function analyzeMarketTrend(data: CandlestickData[]): { trendStrength: number } {
  if (!data || data.length < 20) {
    return { trendStrength: 0 };
  }
  const currentPrice = data[data.length - 1].close;
  const prices = data.slice(-20).map(d => d.close);
  const avg20 = prices.reduce((s, p) => s + p, 0) / prices.length;
  const avg10 = prices.slice(-10).reduce((s, p) => s + p, 0) / 10;

  let trendStrength = ((currentPrice - avg20) / avg20) * 100 * 10;
  if (currentPrice > avg10 && avg10 > avg20) trendStrength += 20;
  else if (currentPrice < avg10 && avg10 < avg20) trendStrength -= 20;

  return { trendStrength: Math.max(-100, Math.min(100, trendStrength)) };
}

function calculateMomentum(data: CandlestickData[]): number {
  if (!data || data.length < 5) return 0;
  const changes: number[] = [];
  for (let i = 1; i < Math.min(data.length, 10); i++) {
    changes.push((data[i].close - data[i - 1].close) / data[i - 1].close);
  }
  const avg = changes.reduce((s, c) => s + c, 0) / changes.length;
  return Math.max(-100, Math.min(100, avg * 1000));
}

function calculatePearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
  const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);
  const sumY2 = y.reduce((s, yi) => s + yi * yi, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den !== 0 ? num / den : 0;
}

function checkBTCSPXCorrelation(spx: CandlestickData[], btc: CandlestickData[]): number {
  if (!spx || !btc || spx.length < 10 || btc.length < 10) return 0;
  const minLen = Math.min(spx.length, btc.length, 20);
  const spxPrices = spx.slice(-minLen).map(d => d.close);
  const btcPrices = btc.slice(-minLen).map(d => d.close);
  const spxChanges: number[] = [];
  const btcChanges: number[] = [];
  for (let i = 1; i < spxPrices.length; i++) {
    spxChanges.push((spxPrices[i] - spxPrices[i - 1]) / spxPrices[i - 1]);
    btcChanges.push((btcPrices[i] - btcPrices[i - 1]) / btcPrices[i - 1]);
  }
  return calculatePearsonCorrelation(spxChanges, btcChanges);
}

/** 复制自 option-recommendation.service.ts calculateMarketScore */
function calculateMarketScore(md: MarketDataWindow): number {
  let score = 0;

  // SPX 趋势 (40%)
  const spxAnalysis = analyzeMarketTrend(md.spx);
  score += spxAnalysis.trendStrength * 0.4;

  // USD 反向 (20%)
  const usdAnalysis = analyzeMarketTrend(md.usdIndex);
  score += -usdAnalysis.trendStrength * 0.2;

  // BTC (20%)
  const btcAnalysis = analyzeMarketTrend(md.btc);
  const btcCorr = checkBTCSPXCorrelation(md.spx, md.btc);
  score += btcAnalysis.trendStrength * (btcCorr > 0.5 ? 0.2 : 0.1);

  // VIX (10%)
  if (md.vix && md.vix.length > 0) {
    const currentVix = md.vix[md.vix.length - 1].close;
    if (currentVix > 35) score -= 50;
    else if (currentVix > 25) score -= 20;
    else if (currentVix < 15) score += 10;
  }

  // 市场温度 (10%) — 回测固定 50
  const temp = md.marketTemperature;
  if (temp > 50) score += (temp - 50) * 0.3;
  else if (temp < 20) score -= (20 - temp) * 0.5;

  return Math.max(-100, Math.min(100, score));
}

/** 复制自 option-recommendation.service.ts calculateIntradayScore */
function calculateIntradayScore(md: MarketDataWindow): number {
  let score = 0;

  // BTC 小时 K 动量 (40%)
  if (md.btcHourly && md.btcHourly.length >= 10) {
    const filtered = intradayDataFilterService.filterData(md.btcHourly);
    score += calculateMomentum(filtered) * 0.4;
  }

  // USD 小时 K 动量 (20%, 反向)
  if (md.usdIndexHourly && md.usdIndexHourly.length >= 10) {
    const filtered = intradayDataFilterService.filterData(md.usdIndexHourly);
    score += -calculateMomentum(filtered) * 0.2;
  }

  // SPX 近 5 日动量 (40%)
  if (md.spx && md.spx.length > 0) {
    const recent = md.spx.slice(-5);
    score += calculateMomentum(recent) * 0.4;
  }

  return Math.max(-100, Math.min(100, score));
}

/** 复制自 option-recommendation.service.ts calculateTimeWindowAdjustment */
function calculateTimeWindowAdjustment(etMinutes: number): number {
  const marketOpen = 570;   // 9:30
  const marketClose = 960;  // 16:00
  const forceCloseTime = marketClose - 30; // 15:30

  if (etMinutes < marketOpen + 60) return 20;
  if (etMinutes > forceCloseTime) return -50;
  if (etMinutes > forceCloseTime - 60) return -30;
  if (etMinutes > marketOpen + 120) return -10;
  return 0;
}

// ============================================
// 辅助函数
// ============================================

/** 将 ET 分钟数转为 "HH:MM" 字符串 */
function etMinutesToTimeStr(etMinutes: number): string {
  const h = Math.floor(etMinutes / 60);
  const m = etMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** 构造 0DTE ATM 期权符号 */
function buildOptionSymbol(
  underlying: string,
  date: string,          // YYYY-MM-DD
  direction: 'CALL' | 'PUT',
  strikePrice: number
): string {
  // 格式: QQQ260218C480000.US
  const ticker = underlying.replace('.US', '');
  const datePart = date.replace(/-/g, '').slice(2); // YYMMDD
  const cp = direction === 'CALL' ? 'C' : 'P';
  const strikePart = (strikePrice * 1000).toFixed(0);
  return `${ticker}${datePart}${cp}${strikePart}.US`;
}

/** 将标的价格四舍五入到最近 strike（基于 strike 间距） */
function roundToStrike(price: number, underlying: string): number {
  const ticker = underlying.replace('.US', '').toUpperCase();
  let interval = 1; // 默认 $1 间距 (QQQ, SPY)
  if (ticker === 'TSLA') interval = 2.5;
  else if (ticker === 'AMZN' || ticker === 'GOOGL' || ticker === 'GOOG') interval = 2.5;
  else if (ticker === 'NVDA') interval = 1;
  else if (price > 500) interval = 5;
  else if (price > 200) interval = 2.5;
  return Math.round(price / interval) * interval;
}

/** 将 1m K-lines 聚合为小时级 */
function aggregateToHourly(minuteData: CandlestickData[]): CandlestickData[] {
  if (!minuteData || minuteData.length === 0) return [];
  const hourMap = new Map<number, CandlestickData[]>();
  for (const bar of minuteData) {
    const d = new Date(bar.timestamp);
    const hourKey = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
    if (!hourMap.has(hourKey)) hourMap.set(hourKey, []);
    hourMap.get(hourKey)!.push(bar);
  }

  const result: CandlestickData[] = [];
  for (const [hourTs, bars] of Array.from(hourMap.entries()).sort((a, b) => a[0] - b[0])) {
    result.push({
      open: bars[0].open,
      high: Math.max(...bars.map(b => b.high)),
      low: Math.min(...bars.map(b => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
      turnover: bars.reduce((s, b) => s + b.turnover, 0),
      timestamp: hourTs,
    });
  }
  return result;
}

/** 从 Longport 获取历史 1m K-lines */
async function fetchLongportMinuteKlines(
  symbol: string,
  date: string,
  count: number = 500
): Promise<CandlestickData[]> {
  try {
    const quoteCtx = await getQuoteContext();
    const longport = require('longport');
    const { Period, AdjustType } = longport;

    // 使用 historyCandlesticksByDate 获取指定日期的数据
    // date 格式 YYYY-MM-DD
    const [year, month, day] = date.split('-').map(Number);

    let candlesticks: CandlestickData[] = [];

    try {
      // 尝试使用 historyCandlesticksByOffset（从最近时间往回取）
      const resp = await quoteCtx.historyCandlesticksByOffset(
        symbol,
        Period.Min_1,
        false,           // forward = false
        undefined,       // datetime = undefined (latest)
        count
      );

      if (resp && resp.length > 0) {
        // 过滤出指定日期的数据
        const dateStr = date;
        candlesticks = resp
          .map((c: { close: number; open: number; low: number; high: number; volume: number; turnover: number; timestamp: number | Date }) => {
            const ts = typeof c.timestamp === 'number' ? c.timestamp :
                       c.timestamp instanceof Date ? c.timestamp.getTime() :
                       new Date(c.timestamp).getTime();
            return {
              close: typeof c.close === 'number' ? c.close : parseFloat(String(c.close)),
              open: typeof c.open === 'number' ? c.open : parseFloat(String(c.open)),
              low: typeof c.low === 'number' ? c.low : parseFloat(String(c.low)),
              high: typeof c.high === 'number' ? c.high : parseFloat(String(c.high)),
              volume: typeof c.volume === 'number' ? c.volume : parseFloat(String(c.volume)),
              turnover: typeof c.turnover === 'number' ? c.turnover : parseFloat(String(c.turnover || '0')),
              timestamp: ts,
            };
          })
          .filter((c: CandlestickData) => {
            // 过滤出目标日期的数据（基于美东时间）
            const d = new Date(c.timestamp);
            const etStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            return etStr === dateStr;
          });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[期权回测] historyCandlesticksByOffset 失败 (${symbol}): ${errMsg}，尝试 candlesticks`);

      // 降级：使用 candlesticks() 方法
      const resp = await quoteCtx.candlesticks(symbol, Period.Min_1, count, AdjustType.NoAdjust);
      if (resp && resp.length > 0) {
        const dateStr = date;
        candlesticks = resp
          .map((c: { close: number; open: number; low: number; high: number; volume: number; turnover: number; timestamp: number | Date }) => {
            const ts = typeof c.timestamp === 'number' ? c.timestamp :
                       c.timestamp instanceof Date ? c.timestamp.getTime() :
                       new Date(c.timestamp).getTime();
            return {
              close: typeof c.close === 'number' ? c.close : parseFloat(String(c.close)),
              open: typeof c.open === 'number' ? c.open : parseFloat(String(c.open)),
              low: typeof c.low === 'number' ? c.low : parseFloat(String(c.low)),
              high: typeof c.high === 'number' ? c.high : parseFloat(String(c.high)),
              volume: typeof c.volume === 'number' ? c.volume : parseFloat(String(c.volume)),
              turnover: typeof c.turnover === 'number' ? c.turnover : parseFloat(String(c.turnover || '0')),
              timestamp: ts,
            };
          })
          .filter((c: CandlestickData) => {
            const d = new Date(c.timestamp);
            const etStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            return etStr === dateStr;
          });
      }
    }

    return candlesticks.sort((a: CandlestickData, b: CandlestickData) => a.timestamp - b.timestamp);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[期权回测] 获取 ${symbol} 1m K-lines 失败: ${errMsg}`);
    return [];
  }
}

// ============================================
// 核心回测引擎
// ============================================

class OptionBacktestService {

  /**
   * 创建回测任务（写入 DB）
   */
  async createTask(
    dates: string[],
    symbols: string[],
    config?: OptionBacktestConfig
  ): Promise<number> {
    const res = await pool.query(
      `INSERT INTO backtest_results (
        strategy_id, start_date, end_date, config,
        status, started_at, created_at
      ) VALUES ($1, $2, $3, $4, 'PENDING', NOW(), NOW())
      RETURNING id`,
      [
        -1, // 使用 -1 表示期权回测（区别于策略回测）
        dates[0],
        dates[dates.length - 1],
        JSON.stringify({ type: 'OPTION_BACKTEST', dates, symbols, ...config }),
      ]
    );
    return res.rows[0].id;
  }

  /**
   * 更新回测状态
   */
  async updateStatus(id: number, status: string, errorMessage?: string): Promise<void> {
    await pool.query(
      `UPDATE backtest_results
       SET status = $1,
           error_message = $2,
           ${status === 'COMPLETED' || status === 'FAILED' ? 'completed_at = NOW(),' : ''}
           started_at = COALESCE(started_at, NOW())
       WHERE id = $3`,
      [status, errorMessage || null, id]
    );
  }

  /**
   * 保存回测结果
   */
  async saveResult(id: number, result: OptionBacktestResult): Promise<void> {
    await pool.query(
      `UPDATE backtest_results
       SET status = $1,
           result = $2,
           diagnostic_log = $3,
           completed_at = NOW()
       WHERE id = $4`,
      [
        result.status,
        JSON.stringify({
          dates: result.dates,
          symbols: result.symbols,
          trades: result.trades,
          summary: result.summary,
        }),
        JSON.stringify(result.diagnosticLog),
        id,
      ]
    );
  }

  /**
   * 获取回测结果
   */
  async getResult(id: number): Promise<OptionBacktestResult | null> {
    const res = await pool.query(
      `SELECT id, status, error_message, started_at, completed_at, result, diagnostic_log
       FROM backtest_results WHERE id = $1`,
      [id]
    );
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    const resultData = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
    const diagLog = typeof row.diagnostic_log === 'string' ? JSON.parse(row.diagnostic_log) : row.diagnostic_log;

    return {
      id: row.id,
      status: row.status,
      errorMessage: row.error_message,
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
      dates: resultData?.dates || [],
      symbols: resultData?.symbols || [],
      trades: resultData?.trades || [],
      summary: resultData?.summary || {
        totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
        totalGrossPnL: 0, totalNetPnL: 0, avgGrossPnLPercent: 0,
        maxDrawdownPercent: 0, avgHoldingMinutes: 0, profitFactor: 0,
      },
      diagnosticLog: diagLog || { dataFetch: [], signals: [] },
    };
  }

  /**
   * 异步执行回测
   */
  async executeAsync(
    id: number,
    dates: string[],
    symbols: string[],
    config?: OptionBacktestConfig
  ): Promise<void> {
    try {
      await this.updateStatus(id, 'RUNNING');
      const result = await this.runBacktest(dates, symbols, config);
      result.id = id;
      await this.saveResult(id, result);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[期权回测] 任务 ${id} 失败: ${errMsg}`);
      await this.updateStatus(id, 'FAILED', errMsg);
    }
  }

  /**
   * 核心回测逻辑
   */
  async runBacktest(
    dates: string[],
    symbols: string[],
    config?: OptionBacktestConfig
  ): Promise<OptionBacktestResult> {
    const cfg: Required<OptionBacktestConfig> = {
      entryThreshold: config?.entryThreshold ?? 15,
      riskPreference: config?.riskPreference ?? 'CONSERVATIVE',
      positionContracts: config?.positionContracts ?? 1,
      entryPriceMode: config?.entryPriceMode ?? 'CLOSE',
      strikeOffsetPoints: config?.strikeOffsetPoints ?? 0,
      tradeWindowStartET: config?.tradeWindowStartET ?? 570, // 9:30
      tradeWindowEndET: config?.tradeWindowEndET ?? 630,     // 10:30
      maxTradesPerDay: config?.maxTradesPerDay ?? 3,
    };

    const allTrades: BacktestTradeRecord[] = [];
    const diagnosticLog: OptionBacktestResult['diagnosticLog'] = {
      dataFetch: [],
      signals: [],
    };

    for (const date of dates) {
      for (const symbol of symbols) {
        logger.info(`[期权回测] 开始回测 ${symbol} @ ${date}`);
        const dayTrades = await this.runSingleDay(date, symbol, cfg, diagnosticLog);
        allTrades.push(...dayTrades);
        logger.info(`[期权回测] ${symbol} @ ${date} 完成: ${dayTrades.length} 笔交易`);
      }
    }

    // 计算汇总
    const summary = this.calculateSummary(allTrades);

    return {
      status: 'COMPLETED',
      dates,
      symbols,
      trades: allTrades,
      summary,
      diagnosticLog,
    };
  }

  /**
   * 单日回测
   */
  private async runSingleDay(
    date: string,
    symbol: string,
    cfg: Required<OptionBacktestConfig>,
    diagnosticLog: OptionBacktestResult['diagnosticLog']
  ): Promise<BacktestTradeRecord[]> {
    // ── 1. 预加载数据 ──
    const [spxData, usdData, btcData] = await Promise.all([
      this.loadDBKlines('SPX', date, diagnosticLog),
      this.loadDBKlines('USD_INDEX', date, diagnosticLog),
      this.loadDBKlines('BTC', date, diagnosticLog),
    ]);

    // 标的股票 1m K-lines (from Longport)
    const underlyingData = await this.loadLongportKlines(symbol, date, diagnosticLog);

    // VIX 1m K-lines (from Longport)
    const vixData = await this.loadLongportKlines('.VIX.US', date, diagnosticLog);

    // 验证数据充足性
    if (spxData.length < 50) {
      logger.warn(`[期权回测] ${date} SPX 数据不足 (${spxData.length}), 跳过`);
      return [];
    }
    if (underlyingData.length < 50) {
      logger.warn(`[期权回测] ${date} ${symbol} 数据不足 (${underlyingData.length}), 跳过`);
      return [];
    }

    // 预计算小时级数据
    const btcHourly = aggregateToHourly(btcData);
    const usdHourly = aggregateToHourly(usdData);

    // 构建按分钟索引的 Map（基于 ET 分钟数）
    const underlyingByMinute = this.buildMinuteMap(underlyingData);

    // ── 2. 每分钟 tick 循环 ──
    const trades: BacktestTradeRecord[] = [];
    let state: 'IDLE' | 'HOLDING' = 'IDLE';
    let dayTradeCount = 0;

    // 持仓状态
    let holdingDirection: 'CALL' | 'PUT' = 'CALL';
    let holdingOptionSymbol = '';
    let holdingEntryPrice = 0;
    let holdingEntryTime = 0; // ET minutes
    let holdingEntryScore = 0;
    let holdingMarketScore = 0;
    let holdingIntradayScore = 0;
    let holdingTimeAdj = 0;
    let holdingEntryReason = '';
    let holdingEntryUnderlyingPrice = 0;
    let holdingPeakPnLPercent = 0;

    // 期权合约 K-line 数据
    let optionKlines: CandlestickData[] = [];
    let optionByMinute: Map<number, CandlestickData> = new Map();

    // 市场收盘时间
    const marketCloseET = 960; // 16:00

    for (let etMin = cfg.tradeWindowStartET; etMin <= marketCloseET; etMin++) {
      // ── IDLE: 评分 + 入场 ──
      if (state === 'IDLE' && etMin <= cfg.tradeWindowEndET && dayTradeCount < cfg.maxTradesPerDay) {
        // 构建滑动窗口 market data
        const window = this.buildMarketDataWindow(
          spxData, usdData, btcData, vixData, btcHourly, usdHourly, etMin, date
        );

        if (!window) continue;

        // 评分
        const marketScore = calculateMarketScore(window);
        const intradayScore = calculateIntradayScore(window);
        const timeAdj = calculateTimeWindowAdjustment(etMin);
        const finalScore = marketScore * 0.4 + intradayScore * 0.4 + timeAdj * 0.2;

        // 方向判定
        let direction: 'CALL' | 'PUT' | 'HOLD' = 'HOLD';
        if (finalScore > cfg.entryThreshold) direction = 'CALL';
        else if (finalScore < -cfg.entryThreshold) direction = 'PUT';

        diagnosticLog.signals.push({
          date, time: etMinutesToTimeStr(etMin),
          score: parseFloat(finalScore.toFixed(2)),
          marketScore: parseFloat(marketScore.toFixed(2)),
          intradayScore: parseFloat(intradayScore.toFixed(2)),
          direction,
          action: direction === 'HOLD' ? 'SKIP' : 'ENTRY',
        });

        if (direction === 'HOLD') continue;

        // 获取标的当前价格
        const underlyingBar = underlyingByMinute.get(etMin);
        if (!underlyingBar) continue;

        const underlyingPrice = underlyingBar.close;
        const strike = roundToStrike(underlyingPrice + cfg.strikeOffsetPoints, symbol);
        const optSymbol = buildOptionSymbol(symbol, date, direction, strike);

        // 拉取期权合约 1m K-lines
        const optKlines = await this.loadOptionKlines(optSymbol, date, diagnosticLog);
        if (optKlines.length === 0) {
          diagnosticLog.signals[diagnosticLog.signals.length - 1].action = 'SKIP_NO_OPT_DATA';
          logger.warn(`[期权回测] ${optSymbol} 无数据，跳过入场`);
          continue;
        }

        const optMinuteMap = this.buildMinuteMap(optKlines);
        const optBar = optMinuteMap.get(etMin);
        if (!optBar) {
          diagnosticLog.signals[diagnosticLog.signals.length - 1].action = 'SKIP_NO_OPT_BAR';
          continue;
        }

        // 入场
        const entryPrice = cfg.entryPriceMode === 'HIGH' ? optBar.high : optBar.close;
        if (entryPrice <= 0) continue;

        state = 'HOLDING';
        holdingDirection = direction;
        holdingOptionSymbol = optSymbol;
        holdingEntryPrice = entryPrice;
        holdingEntryTime = etMin;
        holdingEntryScore = finalScore;
        holdingMarketScore = marketScore;
        holdingIntradayScore = intradayScore;
        holdingTimeAdj = timeAdj;
        holdingEntryReason = `${direction} score=${finalScore.toFixed(1)} (mkt=${marketScore.toFixed(1)}, intra=${intradayScore.toFixed(1)}, time=${timeAdj.toFixed(0)}) strike=${strike}`;
        holdingEntryUnderlyingPrice = underlyingPrice;
        holdingPeakPnLPercent = 0;
        optionKlines = optKlines;
        optionByMinute = optMinuteMap;
        dayTradeCount++;

        logger.info(`[期权回测] 入场: ${optSymbol} @ $${entryPrice.toFixed(2)} | ${holdingEntryReason}`);
      }

      // ── HOLDING: 检查退出 ──
      if (state === 'HOLDING') {
        const optBar = optionByMinute.get(etMin);
        if (!optBar) continue; // 该分钟无数据，跳过

        const currentPrice = optBar.close;
        const quantity = cfg.positionContracts;
        const multiplier = 100;
        const entryFees = optionDynamicExitService.calculateFees(quantity);
        const exitFees = optionDynamicExitService.calculateFees(quantity);

        // 构建 marketCloseTime Date 对象
        const [yr, mo, dy] = date.split('-').map(Number);
        const marketCloseTime = new Date(`${date}T16:00:00-05:00`);

        // 构建虚拟当前时间
        const virtualNowHour = Math.floor(etMin / 60);
        const virtualNowMin = etMin % 60;
        const virtualNow = new Date(`${date}T${virtualNowHour.toString().padStart(2, '0')}:${virtualNowMin.toString().padStart(2, '0')}:00-05:00`);

        // 构建入场时间
        const entryHour = Math.floor(holdingEntryTime / 60);
        const entryMinute = holdingEntryTime % 60;
        const virtualEntryTime = new Date(`${date}T${entryHour.toString().padStart(2, '0')}:${entryMinute.toString().padStart(2, '0')}:00-05:00`);

        // 获取标的当前 K-line（用于结构失效检查）
        const underlyingBar = underlyingByMinute.get(etMin);
        const prevUnderlyingBar = underlyingByMinute.get(etMin - 1);
        const recentKlines: { open: number; high: number; low: number; close: number; volume: number; timestamp: number }[] = [];
        if (prevUnderlyingBar) recentKlines.push(prevUnderlyingBar);
        if (underlyingBar) recentKlines.push(underlyingBar);

        // 追踪 peak PnL
        const costBasis = holdingEntryPrice * quantity * multiplier + entryFees;
        const grossPnL = (currentPrice - holdingEntryPrice) * quantity * multiplier;
        const grossPnLPercent = costBasis > 0 ? (grossPnL / costBasis) * 100 : 0;
        if (grossPnLPercent > holdingPeakPnLPercent) {
          holdingPeakPnLPercent = grossPnLPercent;
        }

        // 构建 PositionContext
        const ctx: PositionContext = {
          entryPrice: holdingEntryPrice,
          currentPrice,
          quantity,
          multiplier,
          entryTime: virtualEntryTime,
          marketCloseTime,
          strategySide: 'BUYER',
          entryIV: 0,
          currentIV: 0,
          entryFees,
          estimatedExitFees: exitFees,
          is0DTE: true,
          midPrice: currentPrice, // 回测中 close ≈ mid
          optionDirection: holdingDirection,
          recentKlines,
          entryUnderlyingPrice: holdingEntryUnderlyingPrice,
          peakPnLPercent: holdingPeakPnLPercent,
        };

        // 临时 monkey-patch Date 让 checkExitCondition 使用虚拟时间
        const origDateNow = Date.now;
        const origDateCtor = global.Date;
        const virtualNowMs = virtualNow.getTime();

        // 覆盖 getDynamicExitParams 使用的 new Date()
        // checkExitCondition 内部通过 `new Date()` 获取当前时间
        // 我们通过修改 ctx 的 entryTime + marketCloseTime 间接控制时间相关逻辑
        // 但 holdingMinutes 和 minutesToClose 计算依赖 `now`
        // 需要临时替换
        try {
          // @ts-ignore
          global.Date = class extends origDateCtor {
            constructor(...args: unknown[]) {
              if (args.length === 0) {
                super(virtualNowMs);
              } else {
                // @ts-ignore
                super(...args);
              }
            }
            static now(): number {
              return virtualNowMs;
            }
          } as DateConstructor;
          // 保留 UTC/parse 等静态方法
          Object.setPrototypeOf(global.Date, origDateCtor);

          const exitResult = optionDynamicExitService.checkExitCondition(ctx);

          if (exitResult) {
            const holdingMinutes = etMin - holdingEntryTime;
            const trade: BacktestTradeRecord = {
              date,
              symbol,
              optionSymbol: holdingOptionSymbol,
              direction: holdingDirection,
              entryTime: `${date}T${etMinutesToTimeStr(holdingEntryTime)}:00-05:00`,
              exitTime: `${date}T${etMinutesToTimeStr(etMin)}:00-05:00`,
              entryPrice: holdingEntryPrice,
              exitPrice: currentPrice,
              quantity,
              grossPnL: exitResult.pnl.grossPnL,
              netPnL: exitResult.pnl.netPnL,
              grossPnLPercent: exitResult.pnl.grossPnLPercent,
              netPnLPercent: exitResult.pnl.netPnLPercent,
              entryReason: holdingEntryReason,
              exitReason: `${exitResult.action}: ${exitResult.reason}`,
              exitTag: exitResult.exitTag,
              entryScore: holdingEntryScore,
              marketScore: holdingMarketScore,
              intradayScore: holdingIntradayScore,
              timeWindowAdjustment: holdingTimeAdj,
              holdingMinutes,
              peakPnLPercent: holdingPeakPnLPercent,
            };
            trades.push(trade);
            state = 'IDLE';

            logger.info(
              `[期权回测] 退出: ${holdingOptionSymbol} @ $${currentPrice.toFixed(2)} | ` +
              `PnL=${exitResult.pnl.grossPnLPercent.toFixed(1)}% | ${exitResult.action} | ${exitResult.reason}`
            );
          }
        } finally {
          global.Date = origDateCtor;
        }
      }
    }

    // 如果收盘仍持仓，强制平仓
    if (state === 'HOLDING') {
      const lastOptBar = optionByMinute.get(marketCloseET) ||
        optionByMinute.get(marketCloseET - 1) ||
        optionKlines[optionKlines.length - 1];

      if (lastOptBar) {
        const currentPrice = lastOptBar.close;
        const quantity = cfg.positionContracts;
        const multiplier = 100;
        const entryFees = optionDynamicExitService.calculateFees(quantity);
        const exitFees = optionDynamicExitService.calculateFees(quantity);
        const costBasis = holdingEntryPrice * quantity * multiplier + entryFees;
        const grossPnL = (currentPrice - holdingEntryPrice) * quantity * multiplier;
        const netPnL = grossPnL - entryFees - exitFees;
        const grossPnLPercent = costBasis > 0 ? (grossPnL / costBasis) * 100 : 0;
        const netPnLPercent = costBasis > 0 ? (netPnL / costBasis) * 100 : 0;
        const holdingMinutes = marketCloseET - holdingEntryTime;

        trades.push({
          date,
          symbol,
          optionSymbol: holdingOptionSymbol,
          direction: holdingDirection,
          entryTime: `${date}T${etMinutesToTimeStr(holdingEntryTime)}:00-05:00`,
          exitTime: `${date}T16:00:00-05:00`,
          entryPrice: holdingEntryPrice,
          exitPrice: currentPrice,
          quantity,
          grossPnL,
          netPnL,
          grossPnLPercent,
          netPnLPercent,
          entryReason: holdingEntryReason,
          exitReason: 'MARKET_CLOSE: 收盘强制平仓',
          entryScore: holdingEntryScore,
          marketScore: holdingMarketScore,
          intradayScore: holdingIntradayScore,
          timeWindowAdjustment: holdingTimeAdj,
          holdingMinutes,
          peakPnLPercent: holdingPeakPnLPercent,
        });

        logger.info(`[期权回测] 收盘平仓: ${holdingOptionSymbol} @ $${currentPrice.toFixed(2)} | PnL=${grossPnLPercent.toFixed(1)}%`);
      }
    }

    return trades;
  }

  // ── 数据加载辅助方法 ──

  private async loadDBKlines(
    source: string,
    date: string,
    diagnosticLog: OptionBacktestResult['diagnosticLog']
  ): Promise<CandlestickData[]> {
    try {
      const data = await klineHistoryService.getIntradayByDate(source, date, '04:00', '20:00');
      diagnosticLog.dataFetch.push({ source, date, count: data.length, ok: data.length > 0 });
      return data;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      diagnosticLog.dataFetch.push({ source, date, count: 0, ok: false, error: errMsg });
      return [];
    }
  }

  private async loadLongportKlines(
    symbol: string,
    date: string,
    diagnosticLog: OptionBacktestResult['diagnosticLog']
  ): Promise<CandlestickData[]> {
    try {
      const data = await fetchLongportMinuteKlines(symbol, date);
      diagnosticLog.dataFetch.push({ source: `longport:${symbol}`, date, count: data.length, ok: data.length > 0 });
      return data;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      diagnosticLog.dataFetch.push({ source: `longport:${symbol}`, date, count: 0, ok: false, error: errMsg });
      return [];
    }
  }

  private async loadOptionKlines(
    optionSymbol: string,
    date: string,
    diagnosticLog: OptionBacktestResult['diagnosticLog']
  ): Promise<CandlestickData[]> {
    try {
      const data = await fetchLongportMinuteKlines(optionSymbol, date, 500);
      diagnosticLog.dataFetch.push({ source: `option:${optionSymbol}`, date, count: data.length, ok: data.length > 0 });
      return data;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      diagnosticLog.dataFetch.push({ source: `option:${optionSymbol}`, date, count: 0, ok: false, error: errMsg });
      return [];
    }
  }

  // ── 时间 / 窗口辅助方法 ──

  /**
   * 将 1m K-line 数组建立为 <ET分钟数 → CandlestickData> 映射
   */
  private buildMinuteMap(data: CandlestickData[]): Map<number, CandlestickData> {
    const map = new Map<number, CandlestickData>();
    for (const bar of data) {
      const d = new Date(bar.timestamp);
      // 转换为美东时间
      const etStr = d.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      const parts = etStr.split(':');
      const etHour = parseInt(parts[0], 10);
      const etMinute = parseInt(parts[1], 10);
      const etMin = etHour * 60 + etMinute;
      map.set(etMin, bar);
    }
    return map;
  }

  /**
   * 构建当前时刻的 MarketDataWindow（滑动窗口）
   * 取截止到 currentETMin 的数据
   */
  private buildMarketDataWindow(
    spxAll: CandlestickData[],
    usdAll: CandlestickData[],
    btcAll: CandlestickData[],
    vixAll: CandlestickData[],
    btcHourly: CandlestickData[],
    usdHourly: CandlestickData[],
    currentETMin: number,
    date: string
  ): MarketDataWindow | null {
    // 将 currentETMin 转为近似 timestamp 来截断数据
    // 日期 + ET 分钟 → UTC timestamp
    const etHour = Math.floor(currentETMin / 60);
    const etMinute = currentETMin % 60;
    const cutoffStr = `${date}T${etHour.toString().padStart(2, '0')}:${etMinute.toString().padStart(2, '0')}:59-05:00`;
    const cutoffTs = new Date(cutoffStr).getTime();

    const spx = spxAll.filter(d => d.timestamp <= cutoffTs);
    const usd = usdAll.filter(d => d.timestamp <= cutoffTs);
    const btc = btcAll.filter(d => d.timestamp <= cutoffTs);
    const vix = vixAll.filter(d => d.timestamp <= cutoffTs);

    // 需要至少 50 根 SPX（日 K 逻辑需要 20 根，这里用 1m 数据代替，取 100 根）
    // 实际上 calculateMarketScore 中的 analyzeMarketTrend 需要 20 根数据
    // 1m bar 相当于高频数据，100 根 = ~100 分钟 ≈ 1.7 小时
    if (spx.length < 20) return null;

    const btcH = btcHourly.filter(d => d.timestamp <= cutoffTs);
    const usdH = usdHourly.filter(d => d.timestamp <= cutoffTs);

    return {
      spx: spx.slice(-100), // 最近 100 根 1m bar
      usdIndex: usd.slice(-100),
      btc: btc.slice(-100),
      vix: vix.length > 0 ? vix.slice(-10) : undefined,
      marketTemperature: 50, // 固定中性
      btcHourly: btcH.slice(-24),
      usdIndexHourly: usdH.slice(-24),
    };
  }

  // ── 统计汇总 ──

  private calculateSummary(trades: BacktestTradeRecord[]): OptionBacktestResult['summary'] {
    if (trades.length === 0) {
      return {
        totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
        totalGrossPnL: 0, totalNetPnL: 0, avgGrossPnLPercent: 0,
        maxDrawdownPercent: 0, avgHoldingMinutes: 0, profitFactor: 0,
      };
    }

    const winningTrades = trades.filter(t => t.grossPnL > 0);
    const losingTrades = trades.filter(t => t.grossPnL <= 0);

    const totalGrossPnL = trades.reduce((s, t) => s + t.grossPnL, 0);
    const totalNetPnL = trades.reduce((s, t) => s + t.netPnL, 0);
    const avgGrossPnLPercent = trades.reduce((s, t) => s + t.grossPnLPercent, 0) / trades.length;
    const avgHoldingMinutes = trades.reduce((s, t) => s + t.holdingMinutes, 0) / trades.length;

    // 最大回撤计算（基于累计 PnL 曲线）
    let peak = 0;
    let maxDD = 0;
    let cumPnL = 0;
    for (const t of trades) {
      cumPnL += t.grossPnL;
      if (cumPnL > peak) peak = cumPnL;
      const dd = peak - cumPnL;
      if (dd > maxDD) maxDD = dd;
    }
    // 回撤百分比（相对于初始资本，近似以 entry cost 计算）
    const avgCost = trades.length > 0
      ? trades.reduce((s, t) => s + t.entryPrice * t.quantity * 100, 0) / trades.length
      : 1;
    const maxDrawdownPercent = avgCost > 0 ? (maxDD / avgCost) * 100 : 0;

    // 盈利因子 = 总盈利 / 总亏损
    const totalProfit = winningTrades.reduce((s, t) => s + t.grossPnL, 0);
    const totalLoss = Math.abs(losingTrades.reduce((s, t) => s + t.grossPnL, 0));
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: parseFloat(((winningTrades.length / trades.length) * 100).toFixed(2)),
      totalGrossPnL: parseFloat(totalGrossPnL.toFixed(2)),
      totalNetPnL: parseFloat(totalNetPnL.toFixed(2)),
      avgGrossPnLPercent: parseFloat(avgGrossPnLPercent.toFixed(2)),
      maxDrawdownPercent: parseFloat(maxDrawdownPercent.toFixed(2)),
      avgHoldingMinutes: parseFloat(avgHoldingMinutes.toFixed(1)),
      profitFactor: profitFactor === Infinity ? 999 : parseFloat(profitFactor.toFixed(2)),
    };
  }
}

export default new OptionBacktestService();
