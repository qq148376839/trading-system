/**
 * 入场时机数据验证脚本
 *
 * 核心假设: 入场时 momentum 评分已达峰值，标的价格已完成主要移动。
 * 如果提前 3-5 分钟入场，盈利可提高 30%+。
 *
 * 数据来源:
 *   - strategy_signals (BUY / SELL)
 *   - execution_orders (下单时间)
 *   - auto_trades (实际 PnL)
 *   - option_strategy_decision_logs (评分轨迹，每分钟一条)
 *   - option_trade_kline (期权 1 分钟 K 线，用于反推历史价格)
 *
 * 用法:
 *   cd api && npx tsx ../scripts/analyze-entry-timing.ts
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// ─── 环境初始化 ─────────────────────────────────────────────────
// Try multiple .env locations: api/.env from script dir, cwd .env, cwd api/.env
dotenv.config({ path: path.resolve(__dirname, '../api/.env') });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), 'api/.env') });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

// ─── 常量 ────────────────────────────────────────────────────────
const DATA_START_DATE = '2026-03-01';
const LOOKBACK_MINUTES = [1, 3, 5] as const;
const SELL_MATCH_WINDOW_HOURS = 4;
const SEPARATOR = '='.repeat(90);
const SUB_SEPARATOR = '-'.repeat(90);

// ─── 类型定义 ────────────────────────────────────────────────────

interface TradeRow {
  buy_signal_id: number;
  symbol: string;
  underlying: string;
  entry_signal_time: Date;
  entry_score: string | null;
  buy_order_time: Date;
  exit_signal_time: Date | null;
  exit_reason: string | null;
  actual_pnl: string | null;
  buy_price: string | null;
  actual_close_time: Date | null;
  quantity: number | null;
}

interface ScoreSnapshot {
  time: Date;
  final_score: number | null;
  direction: string | null;
  market_score: number | null;
  intraday_score: number | null;
}

interface KlinePoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TimingAnalysis {
  buy_signal_id: number;
  symbol: string;
  underlying: string;
  entry_signal_time: string;
  buy_order_time: string;
  exit_signal_time: string | null;
  exit_reason: string | null;
  actual_pnl: number | null;
  entry_score: number | null;
  buy_price: number | null;
  sell_price: number | null;
  score_snapshots: Array<{
    minutes_before: number;
    time: string;
    final_score: number | null;
    direction: string | null;
  }>;
  hypothetical: Array<{
    minutes_before: number;
    kline_price: number | null;
    hypothetical_pnl: number | null;
    pnl_improvement: number | null;
    pnl_improvement_pct: string | null;
  }>;
}

interface SummaryStats {
  total_trades: number;
  trades_with_kline: number;
  avg_actual_pnl: number | null;
  by_lookback: Array<{
    minutes_before: number;
    avg_hypothetical_pnl: number | null;
    avg_improvement: number | null;
    avg_improvement_pct: number | null;
    trades_improved: number;
    trades_worsened: number;
  }>;
}

// ─── Step 1: 拉取所有 EXECUTED BUY 信号 + 对应 SELL + 实际 PnL ──

async function fetchTrades(): Promise<TradeRow[]> {
  const query = `
    SELECT
      bs.id               AS buy_signal_id,
      bs.symbol,
      SPLIT_PART(bs.symbol, ' ', 1) AS underlying,
      bs.created_at       AS entry_signal_time,
      bs.metadata->>'finalScore' AS entry_score,
      eo_buy.created_at   AS buy_order_time,
      ss.created_at       AS exit_signal_time,
      ss.metadata->>'exitReason' AS exit_reason,
      at_buy.pnl::text     AS actual_pnl,
      at_buy.avg_price::text  AS buy_price,
      at_buy.close_time    AS actual_close_time,
      at_buy.quantity       AS quantity
    FROM strategy_signals bs
    JOIN execution_orders eo_buy
      ON bs.id = eo_buy.signal_id AND eo_buy.side = 'BUY'
    LEFT JOIN LATERAL (
      SELECT ss2.created_at, ss2.metadata
      FROM strategy_signals ss2
      WHERE ss2.strategy_id = bs.strategy_id
        AND ss2.symbol = bs.symbol
        AND ss2.signal_type = 'SELL'
        AND ss2.created_at > bs.created_at
        AND ss2.created_at < bs.created_at + INTERVAL '${SELL_MATCH_WINDOW_HOURS} hours'
      ORDER BY ss2.created_at ASC
      LIMIT 1
    ) ss ON true
    LEFT JOIN LATERAL (
      SELECT at1.avg_price, at1.pnl, at1.close_time, at1.quantity
      FROM auto_trades at1
      WHERE at1.symbol = bs.symbol
        AND at1.side = 'BUY'
        AND at1.pnl IS NOT NULL
        AND at1.open_time BETWEEN bs.created_at - INTERVAL '1 minute'
                               AND bs.created_at + INTERVAL '5 minutes'
      ORDER BY at1.open_time ASC
      LIMIT 1
    ) at_buy ON true
    WHERE bs.signal_type = 'BUY'
      AND bs.status = 'EXECUTED'
      AND bs.created_at >= $1
    ORDER BY bs.created_at
  `;
  const result = await pool.query(query, [DATA_START_DATE]);
  return result.rows as TradeRow[];
}

// ─── Step 2: 查询入场前 N 分钟的评分快照 ─────────────────────────

async function fetchScoreSnapshots(
  underlying: string,
  entryTime: Date,
): Promise<ScoreSnapshot[]> {
  const query = `
    SELECT
      execution_time AS time,
      signal_final_score AS final_score,
      signal_direction   AS direction,
      signal_market_score AS market_score,
      signal_intraday_score AS intraday_score
    FROM option_strategy_decision_logs
    WHERE underlying_symbol = $1
      AND execution_time BETWEEN $2::timestamptz - INTERVAL '6 minutes'
                              AND $2::timestamptz
    ORDER BY execution_time
  `;
  const result = await pool.query(query, [underlying, entryTime.toISOString()]);
  return result.rows.map((r) => ({
    time: new Date(r.time),
    final_score: r.final_score !== null ? Number(r.final_score) : null,
    direction: r.direction,
    market_score: r.market_score !== null ? Number(r.market_score) : null,
    intraday_score: r.intraday_score !== null ? Number(r.intraday_score) : null,
  }));
}

// ─── Step 3: 从 option_trade_kline 获取历史 K 线价格 ─────────────

async function fetchKlineAroundEntry(
  symbol: string,
  entryTime: Date,
): Promise<KlinePoint[]> {
  // option_trade_kline.timestamp 存储为毫秒级 Unix 时间戳
  const startTs = entryTime.getTime() - 6 * 60 * 1000;
  const endTs = entryTime.getTime() + 60 * 1000;

  const query = `
    SELECT timestamp, open::float, high::float, low::float, close::float
    FROM option_trade_kline
    WHERE symbol = $1
      AND kline_type = 'ORIGINAL'
      AND timestamp BETWEEN $2 AND $3
    ORDER BY timestamp
  `;
  const result = await pool.query(query, [symbol, startTs, endTs]);
  return result.rows.map((r) => ({
    timestamp: Number(r.timestamp),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
  }));
}

function findPriceAtMinutesBefore(
  klines: KlinePoint[],
  entryTime: Date,
  minutesBefore: number,
): number | null {
  // timestamps are in milliseconds
  const targetTs = entryTime.getTime() - minutesBefore * 60 * 1000;
  let best: KlinePoint | null = null;
  let bestDiff = Infinity;
  for (const k of klines) {
    const diff = Math.abs(k.timestamp - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  // 90 秒容差（毫秒）
  if (best && bestDiff <= 90_000) {
    return best.close;
  }
  return null;
}

// ─── 分析单笔交易 ───────────────────────────────────────────────

async function analyzeTrade(trade: TradeRow): Promise<TimingAnalysis> {
  const entryTime = new Date(trade.entry_signal_time);
  const underlying = trade.underlying;
  const entryScore = trade.entry_score !== null ? Number(trade.entry_score) : null;
  const actualPnl = trade.actual_pnl !== null ? Number(trade.actual_pnl) : null;
  const buyPrice = trade.buy_price !== null ? Number(trade.buy_price) : null;
  const quantity = trade.quantity !== null ? Number(trade.quantity) : null;
  // 从 BUY 侧数据反推卖出价: sellPrice = buyPrice + pnl / (quantity * 100)
  const sellPrice = (buyPrice !== null && actualPnl !== null && quantity !== null && quantity > 0)
    ? buyPrice + actualPnl / (quantity * 100)
    : null;

  // Fetch scoring trail (注: decision_logs 仅有 2 月数据，3 月后无)
  const snapshots = await fetchScoreSnapshots(underlying, entryTime);

  // Build score snapshots at each lookback interval
  const scoreSnapshotsResult: TimingAnalysis['score_snapshots'] = [];
  for (const minBefore of LOOKBACK_MINUTES) {
    const targetTime = new Date(entryTime.getTime() - minBefore * 60 * 1000);
    // Find closest snapshot within 45 seconds
    let closest: ScoreSnapshot | null = null;
    let closestDiff = Infinity;
    for (const s of snapshots) {
      const diff = Math.abs(s.time.getTime() - targetTime.getTime());
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = s;
      }
    }
    scoreSnapshotsResult.push({
      minutes_before: minBefore,
      time: closest && closestDiff <= 60_000 ? closest.time.toISOString() : targetTime.toISOString(),
      final_score: closest && closestDiff <= 60_000 ? closest.final_score : null,
      direction: closest && closestDiff <= 60_000 ? closest.direction : null,
    });
  }

  // Fetch K-line data for hypothetical price
  const klines = await fetchKlineAroundEntry(trade.symbol, entryTime);

  const hypotheticalResults: TimingAnalysis['hypothetical'] = [];
  for (const minBefore of LOOKBACK_MINUTES) {
    const earlierPrice = findPriceAtMinutesBefore(klines, entryTime, minBefore);
    let hypotheticalPnl: number | null = null;
    let pnlImprovement: number | null = null;
    let pnlImprovementPct: string | null = null;

    if (earlierPrice !== null && buyPrice !== null && actualPnl !== null && quantity !== null && quantity > 0) {
      // 假设: 提前入场买入价 = earlierPrice, 卖出价不变 = sellPrice
      // 期权 PnL = (sellPrice - buyPrice) * quantity * 100
      // 假设 PnL = (sellPrice - earlierPrice) * quantity * 100
      // 即: hypotheticalPnl = actualPnl + (buyPrice - earlierPrice) * quantity * 100
      const priceDiff = buyPrice - earlierPrice;
      hypotheticalPnl = actualPnl + priceDiff * quantity * 100;
      pnlImprovement = hypotheticalPnl - actualPnl;
      if (Math.abs(actualPnl) > 0.01) {
        pnlImprovementPct = ((pnlImprovement / Math.abs(actualPnl)) * 100).toFixed(1);
      }
    }

    hypotheticalResults.push({
      minutes_before: minBefore,
      kline_price: earlierPrice,
      hypothetical_pnl: hypotheticalPnl !== null ? Number(hypotheticalPnl.toFixed(2)) : null,
      pnl_improvement: pnlImprovement !== null ? Number(pnlImprovement.toFixed(2)) : null,
      pnl_improvement_pct: pnlImprovementPct,
    });
  }

  return {
    buy_signal_id: trade.buy_signal_id,
    symbol: trade.symbol,
    underlying,
    entry_signal_time: entryTime.toISOString(),
    buy_order_time: new Date(trade.buy_order_time).toISOString(),
    exit_signal_time: trade.exit_signal_time ? new Date(trade.exit_signal_time).toISOString() : null,
    exit_reason: trade.exit_reason,
    actual_pnl: actualPnl,
    entry_score: entryScore,
    buy_price: buyPrice,
    sell_price: sellPrice,
    score_snapshots: scoreSnapshotsResult,
    hypothetical: hypotheticalResults,
  };
}

// ─── 汇总统计 ────────────────────────────────────────────────────

function computeSummary(analyses: TimingAnalysis[]): SummaryStats {
  const withPnl = analyses.filter((a) => a.actual_pnl !== null);
  const avgActual = withPnl.length > 0
    ? withPnl.reduce((s, a) => s + (a.actual_pnl ?? 0), 0) / withPnl.length
    : null;

  const byLookback = LOOKBACK_MINUTES.map((min) => {
    const valid = analyses.filter((a) => {
      const h = a.hypothetical.find((x) => x.minutes_before === min);
      return h && h.hypothetical_pnl !== null && a.actual_pnl !== null;
    });

    if (valid.length === 0) {
      return {
        minutes_before: min,
        avg_hypothetical_pnl: null,
        avg_improvement: null,
        avg_improvement_pct: null,
        trades_improved: 0,
        trades_worsened: 0,
      };
    }

    let sumHypo = 0;
    let sumImpr = 0;
    let sumImprPct = 0;
    let improved = 0;
    let worsened = 0;

    for (const a of valid) {
      const h = a.hypothetical.find((x) => x.minutes_before === min);
      if (!h || h.hypothetical_pnl === null || h.pnl_improvement === null) continue;
      sumHypo += h.hypothetical_pnl;
      sumImpr += h.pnl_improvement;
      if (h.pnl_improvement_pct !== null) {
        sumImprPct += Number(h.pnl_improvement_pct);
      }
      if (h.pnl_improvement > 0) improved++;
      if (h.pnl_improvement < 0) worsened++;
    }

    return {
      minutes_before: min,
      avg_hypothetical_pnl: Number((sumHypo / valid.length).toFixed(2)),
      avg_improvement: Number((sumImpr / valid.length).toFixed(2)),
      avg_improvement_pct: Number((sumImprPct / valid.length).toFixed(1)),
      trades_improved: improved,
      trades_worsened: worsened,
    };
  });

  return {
    total_trades: analyses.length,
    trades_with_kline: analyses.filter((a) =>
      a.hypothetical.some((h) => h.kline_price !== null),
    ).length,
    avg_actual_pnl: avgActual !== null ? Number(avgActual.toFixed(2)) : null,
    by_lookback: byLookback,
  };
}

// ─── 控制台输出 ──────────────────────────────────────────────────

function printResults(analyses: TimingAnalysis[], summary: SummaryStats): void {
  console.log(SEPARATOR);
  console.log('  Entry Timing Analysis — Momentum Peak Hypothesis');
  console.log(SEPARATOR);
  console.log(`  Data range: ${DATA_START_DATE} ~ now`);
  console.log(`  Total trades: ${summary.total_trades}`);
  console.log(`  Trades with K-line data: ${summary.trades_with_kline}`);
  console.log(`  Avg actual PnL: ${summary.avg_actual_pnl !== null ? '$' + summary.avg_actual_pnl : 'N/A'}`);
  console.log('');

  // Per-trade detail
  for (const a of analyses) {
    console.log(SUB_SEPARATOR);
    console.log(`  [Signal #${a.buy_signal_id}] ${a.symbol}`);
    console.log(`    Entry signal: ${a.entry_signal_time}`);
    console.log(`    Buy order:    ${a.buy_order_time}`);
    console.log(`    Exit signal:  ${a.exit_signal_time ?? 'N/A'}`);
    console.log(`    Exit reason:  ${a.exit_reason ?? 'N/A'}`);
    console.log(`    Entry score:  ${a.entry_score ?? 'N/A'}`);
    console.log(`    Buy price:    ${a.buy_price !== null ? '$' + a.buy_price : 'N/A'}`);
    console.log(`    Sell price:   ${a.sell_price !== null ? '$' + a.sell_price : 'N/A'}`);
    console.log(`    Actual PnL:   ${a.actual_pnl !== null ? '$' + a.actual_pnl : 'N/A'}`);

    // Score trail
    console.log('    Score snapshots:');
    for (const s of a.score_snapshots) {
      const scoreStr = s.final_score !== null ? String(s.final_score) : '---';
      const dirStr = s.direction ?? '---';
      console.log(`      -${s.minutes_before}min: score=${scoreStr.padStart(6)}  dir=${dirStr}`);
    }

    // Hypothetical
    console.log('    Hypothetical earlier entry:');
    for (const h of a.hypothetical) {
      const priceStr = h.kline_price !== null ? '$' + h.kline_price.toFixed(2) : 'no data';
      const pnlStr = h.hypothetical_pnl !== null ? '$' + h.hypothetical_pnl.toFixed(2) : 'N/A';
      const imprStr = h.pnl_improvement !== null
        ? (h.pnl_improvement >= 0 ? '+' : '') + '$' + h.pnl_improvement.toFixed(2)
        : 'N/A';
      const pctStr = h.pnl_improvement_pct !== null
        ? (Number(h.pnl_improvement_pct) >= 0 ? '+' : '') + h.pnl_improvement_pct + '%'
        : '';
      console.log(`      -${h.minutes_before}min: price=${priceStr.padEnd(12)} hypo_pnl=${pnlStr.padEnd(10)} delta=${imprStr} ${pctStr}`);
    }
  }

  // Summary table
  console.log('');
  console.log(SEPARATOR);
  console.log('  SUMMARY: Hypothetical improvement by earlier entry');
  console.log(SEPARATOR);
  console.log(
    '  Lookback  | Avg Hypo PnL | Avg Improvement | Avg Impr % | Improved | Worsened',
  );
  console.log(SUB_SEPARATOR);

  for (const b of summary.by_lookback) {
    const hypo = b.avg_hypothetical_pnl !== null ? '$' + b.avg_hypothetical_pnl.toFixed(2) : 'N/A';
    const impr = b.avg_improvement !== null ? '$' + b.avg_improvement.toFixed(2) : 'N/A';
    const pct = b.avg_improvement_pct !== null ? b.avg_improvement_pct.toFixed(1) + '%' : 'N/A';
    console.log(
      `  -${String(b.minutes_before).padEnd(2)} min  | ${hypo.padStart(12)} | ${impr.padStart(15)} | ${pct.padStart(10)} | ${String(b.trades_improved).padStart(8)} | ${String(b.trades_worsened).padStart(8)}`,
    );
  }

  console.log(SEPARATOR);
}

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Connecting to database...');

  try {
    // Step 1: Fetch trades
    console.log('Step 1: Fetching EXECUTED BUY signals with matched SELL + PnL...');
    const trades = await fetchTrades();
    console.log(`  Found ${trades.length} trades since ${DATA_START_DATE}`);

    if (trades.length === 0) {
      console.log('No trades found. Exiting.');
      return;
    }

    // Step 2 + 3: Analyze each trade
    console.log('Step 2-3: Analyzing score trail + K-line hypothetical for each trade...');
    const analyses: TimingAnalysis[] = [];
    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      process.stdout.write(`  [${i + 1}/${trades.length}] ${trade.symbol}...`);
      const analysis = await analyzeTrade(trade);
      analyses.push(analysis);
      console.log(' done');
    }

    // Compute summary
    const summary = computeSummary(analyses);

    // Print results to console
    printResults(analyses, summary);

    // Write JSON output
    const resultsDir = path.resolve(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    const outputPath = path.join(resultsDir, 'entry-timing-analysis.json');
    const output = {
      generated_at: new Date().toISOString(),
      data_range_start: DATA_START_DATE,
      summary,
      trades: analyses,
    };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
  } finally {
    await pool.end();
  }
}

// ─── Entry point ─────────────────────────────────────────────────

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
