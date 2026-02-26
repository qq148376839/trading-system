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
import { ENTRY_THRESHOLDS } from './strategies/option-intraday-strategy';
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
  spx: CandlestickData[];       // 日级数据（用于 analyzeMarketTrend）
  usdIndex: CandlestickData[];  // 日级数据
  btc: CandlestickData[];       // 日级数据
  vix?: CandlestickData[];      // 日级 VIX
  marketTemperature: number;
  // 小时级数据（用于分时评分）
  btcHourly?: CandlestickData[];
  usdIndexHourly?: CandlestickData[];
  // 1分钟级数据（用于分时评分 — 与实盘完全对齐）
  spxIntraday?: CandlestickData[];     // SPX 1m（SPX intraday momentum 25%）
  underlying?: CandlestickData[];       // 标的 1m（underlying momentum 30% + VWAP 15%）
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
      vixFactor?: number;
      dynamicThreshold?: number;
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
  avoidFirstMinutes?: number;           // 开盘禁入分钟数, default 15
  noNewEntryBeforeCloseMinutes?: number; // 收盘前N分钟禁开新仓, default 180
  forceCloseBeforeCloseMinutes?: number; // 收盘前N分钟强平, default 30
  vixAdjustThreshold?: boolean;         // 是否用VIX动态调整阈值, default true
}

// ============================================
// 评分算法（从 option-recommendation.service.ts 复制）
// ============================================

function analyzeMarketTrend(data: CandlestickData[]): { trendStrength: number } {
  if (!data || data.length < 20) {
    return { trendStrength: 0 };
  }
  const currentPrice = data[data.length - 1].close;

  // 自适应窗口：用所有可用数据，最多 20 根
  const longWindow = Math.min(data.length, 20);
  const shortWindow = Math.min(data.length, 10);
  const prices = data.slice(-longWindow).map(d => d.close);
  const avg20 = prices.reduce((s, p) => s + p, 0) / prices.length;
  const shortPrices = data.slice(-shortWindow).map(d => d.close);
  const avg10 = shortPrices.reduce((s, p) => s + p, 0) / shortPrices.length;

  let trendStrength = ((currentPrice - avg20) / avg20) * 100 * 5; // 与实盘对齐（从10降到5）
  if (currentPrice > avg10 && avg10 > avg20) trendStrength += 20;
  else if (currentPrice < avg10 && avg10 < avg20) trendStrength -= 20;

  return { trendStrength: Math.max(-100, Math.min(100, trendStrength)) };
}

function calculateMomentum(data: CandlestickData[]): number {
  if (!data || data.length < 2) return 0;
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
  if (temp > 50) {
    const tempCoeff = temp >= 65 ? 0.5 : 0.3; // 与实盘对齐：高温时提升权重
    score += (temp - 50) * tempCoeff;
  } else if (temp < 20) {
    score -= (20 - temp) * 0.5;
  }

  return Math.max(-100, Math.min(100, score));
}

/** 从 1m OHLCV 数据计算 VWAP（复制自 market-data.service.ts） */
function calculateVWAP(bars: CandlestickData[]): { vwap: number; lastPrice: number } | null {
  if (!bars || bars.length < 5) return null;
  let sumTPV = 0, sumV = 0;
  for (const k of bars) {
    const tp = (k.high + k.low + k.close) / 3;
    sumTPV += tp * k.volume;
    sumV += k.volume;
  }
  if (sumV <= 0) return null;
  return { vwap: sumTPV / sumV, lastPrice: bars[bars.length - 1].close };
}

/** 与实盘完全对齐的分时评分 — 5组件 (option-recommendation.service.ts lines 378-466) */
function calculateIntradayScore(md: MarketDataWindow): number {
  let score = 0;

  // 1. Underlying 1m momentum (30% — 与实盘对齐)
  if (md.underlying && md.underlying.length >= 5) {
    const recent = md.underlying.slice(-10);
    score += calculateMomentum(recent) * 0.30;
  }

  // 2. VWAP position (15% — 与实盘对齐)
  // distancePct = (lastPrice - vwap) / vwap * 100, rawScore = distancePct * 200
  if (md.underlying && md.underlying.length >= 20) {
    const vwapResult = calculateVWAP(md.underlying);
    if (vwapResult && vwapResult.vwap > 0) {
      const distancePct = ((vwapResult.lastPrice - vwapResult.vwap) / vwapResult.vwap) * 100;
      const vwapScore = Math.max(-100, Math.min(100, distancePct * 200));
      score += vwapScore * 0.15;
    }
  }

  // 3. SPX intraday momentum (25% — 与实盘对齐)
  if (md.spxIntraday && md.spxIntraday.length >= 5) {
    const recent = md.spxIntraday.slice(-10);
    score += calculateMomentum(recent) * 0.25;
  }

  // 4. BTC hourly momentum (15% — 与实盘对齐)
  if (md.btcHourly && md.btcHourly.length >= 10) {
    const filtered = intradayDataFilterService.filterData(md.btcHourly);
    score += calculateMomentum(filtered) * 0.15;
  }

  // 5. USD hourly momentum (15%, inverted — 与实盘对齐)
  if (md.usdIndexHourly && md.usdIndexHourly.length >= 10) {
    const filtered = intradayDataFilterService.filterData(md.usdIndexHourly);
    score += -calculateMomentum(filtered) * 0.15;
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

/** 将多日 1m K-lines 聚合为日级 K-lines（按 ET 交易日分组） */
function aggregateToDaily(minuteData: CandlestickData[]): CandlestickData[] {
  if (!minuteData || minuteData.length === 0) return [];
  const dayMap = new Map<string, CandlestickData[]>();
  for (const bar of minuteData) {
    const d = new Date(bar.timestamp);
    const etDate = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (!dayMap.has(etDate)) dayMap.set(etDate, []);
    dayMap.get(etDate)!.push(bar);
  }
  const result: CandlestickData[] = [];
  for (const [, bars] of Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (bars.length === 0) continue;
    result.push({
      open: bars[0].open,
      high: Math.max(...bars.map(b => b.high)),
      low: Math.min(...bars.map(b => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
      turnover: bars.reduce((s, b) => s + b.turnover, 0),
      timestamp: bars[bars.length - 1].timestamp,
    });
  }
  return result;
}

/**
 * 计算标的 VWAP 和 rangePct（30分钟开盘波动率）
 * 与生产 marketDataService.getIntradayVWAP 对齐
 */
function calculateVWAPFromMinuteData(
  underlyingByMinute: Map<number, CandlestickData>,
  currentETMin: number
): { vwap: number; rangePct: number; recentKlines: { open: number; high: number; low: number; close: number; volume: number; timestamp: number }[] } | null {
  // 收集开盘到当前分钟的数据
  const bars: CandlestickData[] = [];
  for (let m = 570; m <= currentETMin; m++) { // 9:30 开始
    const bar = underlyingByMinute.get(m);
    if (bar) bars.push(bar);
  }
  if (bars.length < 5) return null;

  // VWAP = sum(typical_price * volume) / sum(volume)
  let sumTPV = 0;
  let sumVol = 0;
  for (const bar of bars) {
    const tp = (bar.high + bar.low + bar.close) / 3;
    sumTPV += tp * bar.volume;
    sumVol += bar.volume;
  }
  const vwap = sumVol > 0 ? sumTPV / sumVol : bars[bars.length - 1].close;

  // rangePct = (开盘30分钟最高 - 最低) / 开盘价 * 100
  const first30 = bars.filter((_, i) => i < 30);
  const openPrice = first30[0].open;
  const rangeHigh = Math.max(...first30.map(b => b.high));
  const rangeLow = Math.min(...first30.map(b => b.low));
  const rangePct = openPrice > 0 ? ((rangeHigh - rangeLow) / openPrice) * 100 : 0;

  // 最近 2 根 K 线（结构失效检查用）
  const recentKlines = bars.slice(-2).map(b => ({
    open: b.open, high: b.high, low: b.low, close: b.close,
    volume: b.volume, timestamp: b.timestamp,
  }));

  return { vwap, rangePct, recentKlines };
}

/**
 * 估算市场温度（从 VIX + SPX 近期走势推导）
 * 生产环境用 marketDataService 的真实温度，回测用代理指标
 * 温度范围 0-100，50 为中性
 */
function estimateMarketTemperature(
  vixBars: CandlestickData[],
  spxDailyBars: CandlestickData[]
): number {
  let temp = 50; // 基准中性

  // VIX 对温度的影响：VIX 低 → 温度高（贪婪），VIX 高 → 温度低（恐惧）
  if (vixBars.length > 0) {
    const vix = vixBars[vixBars.length - 1].close;
    // VIX 12 → temp ~75; VIX 20 → temp ~50; VIX 30 → temp ~25; VIX 40 → temp ~5
    temp = Math.max(0, Math.min(100, 100 - vix * 2.5));
  }

  // SPX 近期趋势修正：连涨 → 升温，连跌 → 降温
  if (spxDailyBars.length >= 5) {
    const recent5 = spxDailyBars.slice(-5);
    let upDays = 0;
    for (const bar of recent5) {
      if (bar.close > bar.open) upDays++;
    }
    // 5天全涨 → +15; 5天全跌 → -15
    temp += (upDays - 2.5) * 6;
  }

  return Math.max(0, Math.min(100, temp));
}

/**
 * 从期权 1m K-lines 估算 IV 代理值
 * 使用期权价格的标准化波动幅度作为 IV 近似
 */
function estimateIVFromOptionBars(bars: CandlestickData[]): number {
  if (!bars || bars.length < 10) return 0.3; // 默认 30% IV
  // 计算最近 N 根 bar 的 (high-low)/close 平均值，年化
  const recent = bars.slice(-30);
  const ranges: number[] = [];
  for (const bar of recent) {
    if (bar.close > 0) {
      ranges.push((bar.high - bar.low) / bar.close);
    }
  }
  if (ranges.length === 0) return 0.3;
  const avgRange = ranges.reduce((s, r) => s + r, 0) / ranges.length;
  // 1m bar 的 range → 年化: avgRange * sqrt(390 * 252)
  // 390 分钟/天, 252 天/年
  const annualized = avgRange * Math.sqrt(390 * 252);
  return Math.max(0.1, Math.min(2.0, annualized));
}

/** 解析 Longport K-line 响应为标准格式 */
function parseLongportCandlesticks(
  resp: Array<{ close: number; open: number; low: number; high: number; volume: number; turnover: number; timestamp: number | Date }>,
  dateFilter: string
): CandlestickData[] {
  return resp
    .map(c => {
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
      return etStr === dateFilter;
    });
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
    const { Period, AdjustType, NaiveDate: LbNaiveDate, Time: LbTime, NaiveDatetime, TradeSessions } = longport;

    // 构造目标日期的收盘时间作为 NaiveDatetime 锚点
    // 美东时间当天 16:00（收盘）
    const [year, month, day] = date.split('-').map(Number);
    const endOfDayDate = new LbNaiveDate(year, month, day);
    const endOfDayTime = new LbTime(16, 0, 0);
    const targetEndOfDay = new NaiveDatetime(endOfDayDate, endOfDayTime);

    let candlesticks: CandlestickData[] = [];

    try {
      // 方法1: historyCandlesticksByOffset — 以目标日期收盘时间为锚点，向前取 count 根
      const tradeSessions = TradeSessions?.All || 100;
      const resp = await quoteCtx.historyCandlesticksByOffset(
        symbol,
        Period.Min_1,
        AdjustType.NoAdjust,
        false,             // forward = false (向历史回溯)
        targetEndOfDay,    // 锚定到目标日期收盘时间
        count,
        tradeSessions
      );

      if (resp && resp.length > 0) {
        candlesticks = parseLongportCandlesticks(resp, date);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[期权回测] historyCandlesticksByOffset 失败 (${symbol} @ ${date}): ${errMsg}，尝试 candlesticks`);

      try {
        // 方法2: candlesticks() — 通用方法，拉取最近 count 根
        const resp = await quoteCtx.candlesticks(symbol, Period.Min_1, count, AdjustType.NoAdjust);
        if (resp && resp.length > 0) {
          candlesticks = parseLongportCandlesticks(resp, date);
        }
      } catch (err2: unknown) {
        const errMsg2 = err2 instanceof Error ? err2.message : String(err2);
        logger.warn(`[期权回测] candlesticks 也失败 (${symbol} @ ${date}): ${errMsg2}`);
      }
    }

    if (candlesticks.length === 0) {
      logger.warn(`[期权回测] ${symbol} @ ${date}: 所有 API 方法均无法获取数据`);
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
    strategyId: number,
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
        strategyId,
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
   * 根据 strategyId 从 DB 获取策略配置中的 symbols
   */
  async getStrategySymbols(strategyId: number): Promise<string[]> {
    const res = await pool.query(
      `SELECT symbol_pool_config FROM strategies WHERE id = $1`,
      [strategyId]
    );
    if (res.rows.length === 0) return [];
    const symbolPoolConfig = typeof res.rows[0].symbol_pool_config === 'string'
      ? JSON.parse(res.rows[0].symbol_pool_config)
      : res.rows[0].symbol_pool_config;
    return symbolPoolConfig?.symbols || [];
  }

  /**
   * 异步执行回测
   */
  async executeAsync(
    id: number,
    strategyId: number,
    dates: string[],
    symbols: string[],
    config?: OptionBacktestConfig
  ): Promise<void> {
    try {
      await this.updateStatus(id, 'RUNNING');
      const result = await this.runBacktest(strategyId, dates, symbols, config);
      result.id = id;
      await this.saveResult(id, result);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[期权回测] 任务 ${id} 失败: ${errMsg}`);
      await this.updateStatus(id, 'FAILED', errMsg);
    }
  }

  /**
   * 从策略 DB 配置中解析完整回测参数
   * 对齐实盘 OptionIntradayStrategy.getThresholds() 逻辑：
   *   entryThresholdOverride.directionalScoreMin ?? ENTRY_THRESHOLDS[riskPreference].directionalScoreMin
   */
  private async resolveStrategyConfig(strategyId: number): Promise<{
    baseThreshold: number;
    riskPreference: 'AGGRESSIVE' | 'CONSERVATIVE';
    positionContracts: number;
    tradeWindowStartET: number;
    tradeWindowEndET: number;
    maxTradesPerDay: number;
    avoidFirstMinutes: number;
    noNewEntryBeforeCloseMinutes: number;
    forceCloseBeforeCloseMinutes: number;
    vixAdjustThreshold: boolean;
  }> {
    const defaults = {
      baseThreshold: 15,
      riskPreference: 'CONSERVATIVE' as const,
      positionContracts: 1,
      tradeWindowStartET: 570,
      tradeWindowEndET: 630,
      maxTradesPerDay: 3,
      avoidFirstMinutes: 15,
      noNewEntryBeforeCloseMinutes: 180,
      forceCloseBeforeCloseMinutes: 30,
      vixAdjustThreshold: true,
    };
    try {
      const res = await pool.query(`SELECT config FROM strategies WHERE id = $1`, [strategyId]);
      if (res.rows.length === 0) return defaults;

      const stratConfig = typeof res.rows[0].config === 'string'
        ? JSON.parse(res.rows[0].config)
        : res.rows[0].config;

      const pref: 'AGGRESSIVE' | 'CONSERVATIVE' = stratConfig?.riskPreference || 'CONSERVATIVE';
      const tableBase = ENTRY_THRESHOLDS[pref] || ENTRY_THRESHOLDS.CONSERVATIVE;
      const override = stratConfig?.entryThresholdOverride;
      const baseThreshold = override?.directionalScoreMin ?? tableBase.directionalScoreMin;

      const resolved = {
        baseThreshold,
        riskPreference: pref,
        positionContracts: stratConfig?.positionContracts ?? defaults.positionContracts,
        tradeWindowStartET: stratConfig?.tradeWindowStartET ?? defaults.tradeWindowStartET,
        tradeWindowEndET: stratConfig?.tradeWindowEndET ?? defaults.tradeWindowEndET,
        maxTradesPerDay: stratConfig?.maxTradesPerDay ?? defaults.maxTradesPerDay,
        avoidFirstMinutes: stratConfig?.avoidFirstMinutes ?? defaults.avoidFirstMinutes,
        noNewEntryBeforeCloseMinutes: stratConfig?.noNewEntryBeforeCloseMinutes ?? defaults.noNewEntryBeforeCloseMinutes,
        forceCloseBeforeCloseMinutes: stratConfig?.forceCloseBeforeCloseMinutes ?? defaults.forceCloseBeforeCloseMinutes,
        vixAdjustThreshold: stratConfig?.vixAdjustThreshold ?? defaults.vixAdjustThreshold,
      };

      logger.info(`[期权回测] 策略#${strategyId} resolved config: threshold=${resolved.baseThreshold}, pref=${pref}, contracts=${resolved.positionContracts}, window=${resolved.tradeWindowStartET}-${resolved.tradeWindowEndET}`);
      return resolved;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[期权回测] 读取策略配置失败: ${errMsg}, 使用默认配置`);
      return defaults;
    }
  }

  /**
   * 核心回测逻辑
   */
  async runBacktest(
    strategyId: number,
    dates: string[],
    symbols: string[],
    config?: OptionBacktestConfig
  ): Promise<OptionBacktestResult> {
    // 从策略 DB 配置解析完整参数（与实盘对齐）
    const resolved = await this.resolveStrategyConfig(strategyId);

    const cfg: Required<OptionBacktestConfig> = {
      entryThreshold: config?.entryThreshold ?? resolved.baseThreshold,
      riskPreference: config?.riskPreference ?? resolved.riskPreference,
      positionContracts: config?.positionContracts ?? resolved.positionContracts,
      entryPriceMode: config?.entryPriceMode ?? 'CLOSE',
      strikeOffsetPoints: config?.strikeOffsetPoints ?? 0,
      tradeWindowStartET: config?.tradeWindowStartET ?? resolved.tradeWindowStartET,
      tradeWindowEndET: config?.tradeWindowEndET ?? resolved.tradeWindowEndET,
      maxTradesPerDay: config?.maxTradesPerDay ?? resolved.maxTradesPerDay,
      avoidFirstMinutes: config?.avoidFirstMinutes ?? resolved.avoidFirstMinutes,
      noNewEntryBeforeCloseMinutes: config?.noNewEntryBeforeCloseMinutes ?? resolved.noNewEntryBeforeCloseMinutes,
      forceCloseBeforeCloseMinutes: config?.forceCloseBeforeCloseMinutes ?? resolved.forceCloseBeforeCloseMinutes,
      vixAdjustThreshold: config?.vixAdjustThreshold ?? resolved.vixAdjustThreshold,
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
   * 加载多日 1m 数据并聚合为日级 bar（用于 analyzeMarketTrend 等日级指标）
   * 从目标日期往前回溯 lookbackDays 个自然日
   */
  private async loadMultiDayDailyBars(
    source: string,
    targetDate: string,
    lookbackDays: number,
    diagnosticLog: OptionBacktestResult['diagnosticLog']
  ): Promise<CandlestickData[]> {
    const endDate = new Date(`${targetDate}T23:59:59-05:00`);
    const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 3600 * 1000);
    const startDateStr = startDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    try {
      const startTs = new Date(`${startDateStr}T04:00:00-05:00`).getTime();
      const endTs = new Date(`${targetDate}T20:00:00-05:00`).getTime();
      const data = await klineHistoryService.getIntradayData(source, startTs, endTs);
      const dailyBars = aggregateToDaily(data);
      diagnosticLog.dataFetch.push({
        source: `${source}_daily`, date: targetDate,
        count: dailyBars.length, ok: dailyBars.length > 0,
      });
      return dailyBars;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      diagnosticLog.dataFetch.push({
        source: `${source}_daily`, date: targetDate,
        count: 0, ok: false, error: errMsg,
      });
      return [];
    }
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
    // 加载当日 1m 数据（用于分时评分、VWAP 计算等）
    const [spxData, usdData, btcData] = await Promise.all([
      this.loadDBKlines('SPX', date, diagnosticLog),
      this.loadDBKlines('USD_INDEX', date, diagnosticLog),
      this.loadDBKlines('BTC', date, diagnosticLog),
    ]);

    // 加载多日历史数据并聚合为日级 bar（用于 analyzeMarketTrend 等日级指标）
    // 回溯 35 自然日 ≈ 20+ 交易日，满足 20-period MA 要求
    const [spxDaily, usdDaily, btcDaily] = await Promise.all([
      this.loadMultiDayDailyBars('SPX', date, 35, diagnosticLog),
      this.loadMultiDayDailyBars('USD_INDEX', date, 35, diagnosticLog),
      this.loadMultiDayDailyBars('BTC', date, 35, diagnosticLog),
    ]);

    // 标的股票 1m K-lines (from Longport)
    const underlyingData = await this.loadLongportKlines(symbol, date, diagnosticLog);

    // VIX 1m K-lines (from Longport)
    const vixData = await this.loadLongportKlines('.VIX.US', date, diagnosticLog);

    // 验证数据充足性
    if (spxData.length < 20) {
      logger.warn(`[期权回测] ${date} SPX 数据不足 (${spxData.length}), 跳过`);
      return [];
    }
    if (underlyingData.length < 10) {
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
    let holdingEntryIV = 0;

    // 期权合约 K-line 数据
    let optionKlines: CandlestickData[] = [];
    let optionByMinute: Map<number, CandlestickData> = new Map();

    // 市场收盘时间
    const marketCloseET = 960; // 16:00

    // VIX 按分钟索引（用于逐分钟动态阈值，与实盘每周期重新计算对齐）
    const vixByMinute = this.buildMinuteMap(vixData);

    // 有效入场窗口（综合开盘禁入 + 收盘前禁入 + tradeWindow）
    const effectiveStartET = cfg.tradeWindowStartET + cfg.avoidFirstMinutes;
    const effectiveEndET = Math.min(cfg.tradeWindowEndET, marketCloseET - cfg.noNewEntryBeforeCloseMinutes);

    for (let etMin = cfg.tradeWindowStartET; etMin <= marketCloseET; etMin++) {
      // ── IDLE: 评分 + 入场 ──
      if (state === 'IDLE' && etMin >= effectiveStartET && etMin <= effectiveEndET && dayTradeCount < cfg.maxTradesPerDay) {
        // 构建滑动窗口 market data（日级 + 小时级）
        const window = this.buildMarketDataWindow(
          spxDaily, usdDaily, btcDaily, vixData, btcHourly, usdHourly, etMin, date,
          spxData, underlyingData,
        );

        if (!window) continue;

        // 评分
        const marketScore = calculateMarketScore(window);
        const intradayScore = calculateIntradayScore(window);
        const timeAdj = calculateTimeWindowAdjustment(etMin);
        const finalScore = marketScore * 0.2 + intradayScore * 0.6 + timeAdj * 0.2; // 与实盘对齐（大盘20% + 日内60% + 时间20%）

        // VIX 动态阈值（逐分钟，与实盘每周期重新计算对齐）
        let vixFactor = 1.0;
        let dynamicEntryThreshold = cfg.entryThreshold;
        if (cfg.vixAdjustThreshold) {
          // 取当前分钟或最近可用的 VIX close
          const vixBar = vixByMinute.get(etMin) || vixByMinute.get(etMin - 1) || vixByMinute.get(etMin - 2);
          if (vixBar) {
            vixFactor = Math.max(0.5, Math.min(2.5, vixBar.close / 20));
            dynamicEntryThreshold = Math.round(cfg.entryThreshold * vixFactor);
          }
        }

        // 方向判定
        let direction: 'CALL' | 'PUT' | 'HOLD' = 'HOLD';
        if (finalScore > dynamicEntryThreshold) direction = 'CALL';
        else if (finalScore < -dynamicEntryThreshold) direction = 'PUT';

        diagnosticLog.signals.push({
          date, time: etMinutesToTimeStr(etMin),
          score: parseFloat(finalScore.toFixed(2)),
          marketScore: parseFloat(marketScore.toFixed(2)),
          intradayScore: parseFloat(intradayScore.toFixed(2)),
          direction,
          action: direction === 'HOLD' ? 'SKIP' : 'ENTRY',
          vixFactor: parseFloat(vixFactor.toFixed(2)),
          dynamicThreshold: dynamicEntryThreshold,
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
        holdingEntryIV = estimateIVFromOptionBars(optKlines.filter(b => {
          const bET = this.getETMinutes(b.timestamp);
          return bET <= etMin;
        }));
        optionKlines = optKlines;
        optionByMinute = optMinuteMap;
        dayTradeCount++;

        logger.info(`[期权回测] 入场: ${optSymbol} @ $${entryPrice.toFixed(2)} | ${holdingEntryReason}`);
      }

      // ── HOLDING: 检查退出 ──
      if (state === 'HOLDING') {
        const optBar = optionByMinute.get(etMin);
        if (!optBar) continue; // 该分钟无数据，跳过

        // 收盘前强平安全网（在 checkExitCondition 之前检查）
        if (etMin >= marketCloseET - cfg.forceCloseBeforeCloseMinutes) {
          const forcePrice = optBar.close;
          const forceQty = cfg.positionContracts;
          const forceMul = 100;
          const forceEntryFees = optionDynamicExitService.calculateFees(forceQty);
          const forceExitFees = optionDynamicExitService.calculateFees(forceQty);
          const forceCost = holdingEntryPrice * forceQty * forceMul + forceEntryFees;
          const forceGrossPnL = (forcePrice - holdingEntryPrice) * forceQty * forceMul;
          const forceNetPnL = forceGrossPnL - forceEntryFees - forceExitFees;
          const forceGrossPnLPct = forceCost > 0 ? (forceGrossPnL / forceCost) * 100 : 0;
          const forceNetPnLPct = forceCost > 0 ? (forceNetPnL / forceCost) * 100 : 0;
          const forceHoldMin = etMin - holdingEntryTime;

          trades.push({
            date,
            symbol,
            optionSymbol: holdingOptionSymbol,
            direction: holdingDirection,
            entryTime: `${date}T${etMinutesToTimeStr(holdingEntryTime)}:00-05:00`,
            exitTime: `${date}T${etMinutesToTimeStr(etMin)}:00-05:00`,
            entryPrice: holdingEntryPrice,
            exitPrice: forcePrice,
            quantity: forceQty,
            grossPnL: forceGrossPnL,
            netPnL: forceNetPnL,
            grossPnLPercent: forceGrossPnLPct,
            netPnLPercent: forceNetPnLPct,
            entryReason: holdingEntryReason,
            exitReason: `FORCE_CLOSE: 收盘前${cfg.forceCloseBeforeCloseMinutes}分钟强平`,
            entryScore: holdingEntryScore,
            marketScore: holdingMarketScore,
            intradayScore: holdingIntradayScore,
            timeWindowAdjustment: holdingTimeAdj,
            holdingMinutes: forceHoldMin,
            peakPnLPercent: holdingPeakPnLPercent,
          });
          state = 'IDLE';

          logger.info(
            `[期权回测] 强平: ${holdingOptionSymbol} @ $${forcePrice.toFixed(2)} | ` +
            `PnL=${forceGrossPnLPct.toFixed(1)}% | 收盘前${cfg.forceCloseBeforeCloseMinutes}分钟强平`
          );
          continue;
        }

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

        // 计算 VWAP 和 rangePct（与生产 strategy-scheduler 对齐）
        const vwapData = calculateVWAPFromMinuteData(underlyingByMinute, etMin);

        // 波动率分桶确定 timeStopMinutes（与生产逻辑对齐）
        let timeStopMinutes: number | undefined;
        if (vwapData) {
          const { rangePct: rp } = vwapData;
          if (rp >= 0.65) timeStopMinutes = 3;       // 高波动：3 分钟
          else if (rp >= 0.45) timeStopMinutes = 5;   // 中波动：5 分钟
          else timeStopMinutes = 8;                    // 低波动：8 分钟
        }

        // 估算 IV（从期权 1m bar 波动推导）
        const optBarsUpToNow = optionKlines.filter(b => {
          const bET = this.getETMinutes(b.timestamp);
          return bET <= etMin;
        });
        const currentEstIV = estimateIVFromOptionBars(optBarsUpToNow);

        // 构建 PositionContext（与生产 strategy-scheduler 的 ctx 对齐）
        const ctx: PositionContext = {
          entryPrice: holdingEntryPrice,
          currentPrice,
          quantity,
          multiplier,
          entryTime: virtualEntryTime,
          marketCloseTime,
          strategySide: 'BUYER',
          entryIV: holdingEntryIV,
          currentIV: currentEstIV,
          entryFees,
          estimatedExitFees: exitFees,
          is0DTE: true,
          midPrice: currentPrice, // 回测中 close ≈ mid
          optionDirection: holdingDirection,
          recentKlines: vwapData?.recentKlines || recentKlines,
          entryUnderlyingPrice: holdingEntryUnderlyingPrice,
          peakPnLPercent: holdingPeakPnLPercent,
          vwap: vwapData?.vwap,
          timeStopMinutes,
          rangePct: vwapData?.rangePct,
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

  /** 获取 timestamp 对应的 ET 分钟数 */
  private getETMinutes(timestamp: number): number {
    const d = new Date(timestamp);
    const etStr = d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric', minute: 'numeric', hour12: false,
    });
    const parts = etStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

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
  /**
   * 构建当前时刻的 MarketDataWindow
   *
   * 关键修复：spxDaily/usdDaily/btcDaily 是多日聚合的日级 bar，
   * 与生产 marketDataCacheService.getMarketData() 返回的日级数据一致，
   * 确保 analyzeMarketTrend 的 20-period MA 是真正的 20 交易日均线。
   */
  private buildMarketDataWindow(
    spxDaily: CandlestickData[],
    usdDaily: CandlestickData[],
    btcDaily: CandlestickData[],
    vixAll: CandlestickData[],
    btcHourly: CandlestickData[],
    usdHourly: CandlestickData[],
    currentETMin: number,
    date: string,
    spxIntraday?: CandlestickData[],
    underlyingIntraday?: CandlestickData[],
  ): MarketDataWindow | null {
    const etHour = Math.floor(currentETMin / 60);
    const etMinute = currentETMin % 60;
    const cutoffStr = `${date}T${etHour.toString().padStart(2, '0')}:${etMinute.toString().padStart(2, '0')}:59-05:00`;
    const cutoffTs = new Date(cutoffStr).getTime();

    // 日级数据：截止到当前日期（包含）
    const spx = spxDaily.filter(d => d.timestamp <= cutoffTs);
    const usd = usdDaily.filter(d => d.timestamp <= cutoffTs);
    const btc = btcDaily.filter(d => d.timestamp <= cutoffTs);

    // analyzeMarketTrend 自适应窗口，最少 3 根日级 bar 即可工作
    // （精度降低但不阻塞回测）
    if (spx.length < 2) return null;

    // VIX 日级聚合：从 1m 数据中取当日最新值
    const vix = vixAll.filter(d => d.timestamp <= cutoffTs);
    // 将 VIX 1m 数据聚合为单一日级 bar（取最新 close）
    const vixDaily: CandlestickData[] = [];
    if (vix.length > 0) {
      vixDaily.push({
        open: vix[0].open,
        high: Math.max(...vix.map(v => v.high)),
        low: Math.min(...vix.map(v => v.low)),
        close: vix[vix.length - 1].close,
        volume: 0, turnover: 0,
        timestamp: vix[vix.length - 1].timestamp,
      });
    }

    // 1分钟级数据截止到当前时刻（用于分时评分 5 组件）
    const spxIntra = spxIntraday ? spxIntraday.filter(d => d.timestamp <= cutoffTs) : [];
    const underlyingIntra = underlyingIntraday ? underlyingIntraday.filter(d => d.timestamp <= cutoffTs) : [];

    // 小时级数据截止到当前时刻
    const btcH = btcHourly.filter(d => d.timestamp <= cutoffTs);
    const usdH = usdHourly.filter(d => d.timestamp <= cutoffTs);

    // 估算市场温度（替代硬编码 50）
    const marketTemp = estimateMarketTemperature(vixDaily, spx);

    return {
      spx: spx.slice(-30),       // 最近 30 日级 bar（满足 20MA + 余量）
      usdIndex: usd.slice(-30),
      btc: btc.slice(-30),
      vix: vixDaily.length > 0 ? vixDaily : undefined,
      marketTemperature: marketTemp,
      btcHourly: btcH.slice(-24),
      usdIndexHourly: usdH.slice(-24),
      spxIntraday: spxIntra.slice(-60),       // 最近 60 根 1m bar（1小时窗口）
      underlying: underlyingIntra.slice(-240), // 全天 1m bar（用于 VWAP 从开盘累计）
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
