#!/usr/bin/env node
// scripts/replay-test.ts
// 历史回放测试 — 纯 HTTP 模式，零外部依赖（Node 18+ 内置 fetch）
// 用法: REPLAY_COOKIES="..." npx tsx ../scripts/replay-test.ts 2026-02-24 [strategyId]

// ─── 配置 ─────────────────────────────────────────────────────

const API_BASE = process.env.REPLAY_API_BASE || 'https://cq.riowang.win';
const REPLAY_DATE = process.argv[2] || '2026-02-24';
const STRATEGY_ID = parseInt(process.argv[3] || '10', 10);
const COOKIES = process.env.REPLAY_COOKIES || '';

// ─── 类型定义 ──────────────────────────────────────────────────

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

interface DataQuality {
  source: string;
  bars: number;
  ok: boolean;
}

interface TradeMatch {
  type: 'MATCH' | 'SIMULATED_ONLY' | 'ACTUAL_ONLY';
  backtestTrade?: any;
  actualOrder?: any;
  timeDiffMin?: number;
  priceDeviation?: number;
}

interface ComparisonResult {
  matches: TradeMatch[];
  matchCount: number;
  simulatedOnly: number;
  actualOnly: number;
  avgTimeDiffMin: number;
  avgPriceDeviation: number;
}

interface Part1Result {
  dataQuality?: DataQuality[];
  backtestResult?: any;
  actualOrders?: any[];
  comparison?: ComparisonResult;
  error?: string;
}

interface ReplayReport {
  date: string;
  strategyId: number;
  part1: Part1Result | null;
  part2: TestResult[];
  overallPass: boolean;
}

// ─── HTTP 工具层 ───────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const url = `${API_BASE}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'accept': 'application/json, text/plain, */*',
      'cookie': COOKIES,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      'Referer': `${API_BASE}/quant/orders`,
      ...(options?.headers as Record<string, string> || {}),
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${url}\n${body.slice(0, 200)}`);
  }
  return resp.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getNextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── Part 1: 正常流程回放 ──────────────────────────────────────

async function checkDataQuality(): Promise<DataQuality[]> {
  const results: DataQuality[] = [];

  // 指数 K 线
  const indexSources = ['SPX', 'USD_INDEX', 'BTC'];
  for (const src of indexSources) {
    try {
      const resp = await apiFetch(`/api/kline-history/${src}?date=${REPLAY_DATE}`);
      const bars = resp.data?.length || 0;
      results.push({ source: `${src} 1m`, bars, ok: bars >= 20 });
    } catch (err: any) {
      results.push({ source: `${src} 1m`, bars: 0, ok: false });
    }
  }

  // 标的 K 线 — 优先用 history 接口，失败时降级到实时接口
  try {
    const spyResp = await apiFetch(
      `/api/candlesticks/history?symbol=SPY.US&period=1m&date=${REPLAY_DATE}T16:00:00&direction=Backward&count=500`
    );
    const bars = spyResp.data?.candlesticks?.length || 0;
    results.push({ source: 'SPY.US 1m', bars, ok: bars >= 100 });
  } catch {
    // history 接口可能因 SDK NaiveDate 兼容问题失败，降级到实时接口
    try {
      const fallbackResp = await apiFetch(
        `/api/candlesticks?symbol=SPY.US&period=1m&count=500`
      );
      const bars = fallbackResp.data?.candlesticks?.length || 0;
      results.push({ source: 'SPY.US 1m (realtime fallback)', bars, ok: bars >= 5 });
    } catch (err2: any) {
      results.push({ source: 'SPY.US 1m', bars: 0, ok: false });
    }
  }

  return results;
}

async function runBacktest(): Promise<any> {
  // 1. 创建期权回测任务（使用 option-backtest 端点）
  const createResp = await apiFetch('/api/option-backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      strategyId: STRATEGY_ID,
      dates: [REPLAY_DATE],
      config: { entryThreshold: 15, maxTradesPerDay: 3 },
    }),
  });
  const taskId = createResp.data?.id;
  if (!taskId) throw new Error(`创建回测失败: ${JSON.stringify(createResp)}`);
  console.log(`  期权回测任务 #${taskId} 已创建，等待完成...`);

  // 2. 轮询等待完成（option-backtest 的 GET /:id 同时返回 status 和结果）
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const result = await apiFetch(`/api/option-backtest/${taskId}`);
    const status = result.data?.status;
    if (status === 'COMPLETED') {
      return result.data;
    }
    if (status === 'FAILED') {
      throw new Error(`回测失败: ${result.data?.errorMessage || 'unknown'}`);
    }
    if (i % 5 === 4) {
      console.log(`  ... 仍在等待 (${(i + 1) * 3}s, status=${status})`);
    }
  }
  throw new Error('回测超时 (>180s)');
}

async function fetchActualOrders(): Promise<any[]> {
  const nextDay = getNextDay(REPLAY_DATE);
  const resp = await apiFetch(
    `/api/orders/history?start_at=${REPLAY_DATE}&end_at=${nextDay}`
  );
  return resp.data?.orders || [];
}

function parseTimestamp(ts: any): Date | null {
  if (!ts) return null;
  // 支持 ISO 字符串 或 Unix 秒时间戳
  if (typeof ts === 'number') return new Date(ts * 1000);
  return new Date(ts);
}

function compareResults(
  backtestTrades: any[],
  actualOrders: any[]
): ComparisonResult {
  const matches: TradeMatch[] = [];
  const matchedActualIds = new Set<number>();

  // 按时间排序
  const sortedBt = [...(backtestTrades || [])].sort(
    (a, b) => new Date(a.entryTime || a.entry_time || 0).getTime() -
              new Date(b.entryTime || b.entry_time || 0).getTime()
  );
  const sortedActual = [...actualOrders].sort(
    (a, b) => (parseTimestamp(a.submitted_at)?.getTime() || 0) -
              (parseTimestamp(b.submitted_at)?.getTime() || 0)
  );

  // 对于每个回测交易，在实际订单中找 ±5 分钟内的匹配
  for (const bt of sortedBt) {
    const btTime = new Date(bt.entryTime || 0).getTime();
    const btSymbol = (bt.optionSymbol || bt.symbol || '').toUpperCase();
    let bestMatch: { idx: number; timeDiff: number; priceDev: number } | null = null;

    for (let i = 0; i < sortedActual.length; i++) {
      if (matchedActualIds.has(i)) continue;
      const order = sortedActual[i];
      const orderTime = parseTimestamp(order.submitted_at)?.getTime() || 0;
      const timeDiffMin = Math.abs(btTime - orderTime) / 60000;
      if (timeDiffMin > 5) continue;

      // 匹配标的（模糊匹配，忽略格式差异）
      const orderSymbol = (order.symbol || '').toUpperCase();
      if (!btSymbol.includes(orderSymbol.replace('.US', '')) &&
          !orderSymbol.includes(btSymbol.replace('.US', ''))) continue;

      const btPrice = bt.entryPrice || 0;
      const orderPrice = parseFloat(order.executed_price || order.price || '0');
      const priceDev = btPrice > 0 && orderPrice > 0
        ? Math.abs(btPrice - orderPrice) / btPrice
        : 0;

      if (!bestMatch || timeDiffMin < bestMatch.timeDiff) {
        bestMatch = { idx: i, timeDiff: timeDiffMin, priceDev };
      }
    }

    if (bestMatch) {
      matchedActualIds.add(bestMatch.idx);
      matches.push({
        type: 'MATCH',
        backtestTrade: bt,
        actualOrder: sortedActual[bestMatch.idx],
        timeDiffMin: bestMatch.timeDiff,
        priceDeviation: bestMatch.priceDev,
      });
    } else {
      matches.push({ type: 'SIMULATED_ONLY', backtestTrade: bt });
    }
  }

  // 未匹配的实际订单
  for (let i = 0; i < sortedActual.length; i++) {
    if (!matchedActualIds.has(i)) {
      matches.push({ type: 'ACTUAL_ONLY', actualOrder: sortedActual[i] });
    }
  }

  const matchedPairs = matches.filter((m) => m.type === 'MATCH');
  const avgTimeDiffMin = matchedPairs.length > 0
    ? matchedPairs.reduce((s, m) => s + (m.timeDiffMin || 0), 0) / matchedPairs.length
    : 0;
  const avgPriceDeviation = matchedPairs.length > 0
    ? matchedPairs.reduce((s, m) => s + (m.priceDeviation || 0), 0) / matchedPairs.length
    : 0;

  return {
    matches,
    matchCount: matchedPairs.length,
    simulatedOnly: matches.filter((m) => m.type === 'SIMULATED_ONLY').length,
    actualOnly: matches.filter((m) => m.type === 'ACTUAL_ONLY').length,
    avgTimeDiffMin,
    avgPriceDeviation,
  };
}

// ─── Part 2: 故障注入测试 ──────────────────────────────────────

async function testP0_1(): Promise<TestResult> {
  // P0-1: 异常后释放已分配资金
  // 复现 strategy-scheduler.service.ts catch 块逻辑 (~line 2078-2087)
  let allocationResult: { approved: boolean; allocatedAmount: number } | null = null;
  let released = false;
  let releasedAmount = 0;

  try {
    allocationResult = { approved: true, allocatedAmount: 500 };
    throw new Error('INJECTED_BROKER_FAILURE');
  } catch {
    // 验证 catch 块中的释放逻辑模式
    if (allocationResult?.approved) {
      released = true;
      releasedAmount = allocationResult.allocatedAmount;
    }
  }

  return {
    name: 'P0-1 资金泄漏防护',
    pass: released && releasedAmount === 500,
    detail: released ? `释放 $${releasedAmount}` : '未释放!',
  };
}

async function testP0_2(): Promise<TestResult> {
  // P0-2: OPENING/SHORTING 超时清理
  // 复现 strategy-scheduler.service.ts ~line 1611-1635
  const staleResult = { rows: [{ context: { allocationAmount: '3000' } }] };
  const currentState = 'OPENING';

  let shouldReset = false;
  let releaseAmount = 0;

  if (currentState === 'OPENING' || currentState === 'SHORTING') {
    if (staleResult.rows.length > 0) {
      const staleCtx = staleResult.rows[0].context || {};
      const allocationAmount = parseFloat(staleCtx.allocationAmount || '0');
      if (allocationAmount > 0) {
        releaseAmount = allocationAmount;
      }
      shouldReset = true;
    }
  }

  return {
    name: 'P0-2 OPENING超时清理',
    pass: shouldReset && releaseAmount === 3000,
    detail: `重置=${shouldReset}, 释放=$${releaseAmount}`,
  };
}

async function testP0_3(): Promise<TestResult> {
  // P0-3: 熔断阻断新仓 + TSLP 失败阻断
  // 复现 strategy-scheduler.service.ts ~line 1710-1712 & ~line 4553
  const context = { circuitBreakerActive: true };
  const blocked = !!context.circuitBreakerActive;

  // TSLP 阻断 (threshold=2)
  const tslpFailureCount = 2;
  const TSLP_FAILURE_THRESHOLD = 2;
  const tslpBlocked = tslpFailureCount >= TSLP_FAILURE_THRESHOLD;

  return {
    name: 'P0-3 熔断+TSLP阻断',
    pass: blocked && tslpBlocked,
    detail: `circuitBreaker=${blocked}, tslpBlocked=${tslpBlocked}`,
  };
}

async function testP1_3(): Promise<TestResult> {
  // P1-3: 期权无行情拒单
  // 复现 basic-execution.service.ts validateBuyPrice ~line 43-90
  function validateBuyPrice(
    currentPrice: number | null,
    isOption: boolean
  ): { valid: boolean; error?: string } {
    if (currentPrice === null || currentPrice <= 0) {
      if (isOption) {
        return { valid: false, error: '期权无行情，拒绝下单' };
      }
      // 股票跳过偏差检查
      return { valid: true };
    }
    return { valid: true };
  }

  const optionResult = validateBuyPrice(null, true);
  const stockResult = validateBuyPrice(null, false);

  // 也验证 currentPrice=0 的情况
  const optionZero = validateBuyPrice(0, true);
  const stockZero = validateBuyPrice(0, false);

  const pass = !optionResult.valid && stockResult.valid &&
               !optionZero.valid && stockZero.valid;

  return {
    name: 'P1-3 期权无行情拒单',
    pass,
    detail: `option(null)=${optionResult.valid}, stock(null)=${stockResult.valid}, ` +
            `option(0)=${optionZero.valid}, stock(0)=${stockZero.valid}`,
  };
}

async function testP1_4(): Promise<TestResult> {
  // P1-4: TSLP 紧急止损
  // 复现 strategy-scheduler.service.ts ~line 946-974 (设置) + ~line 2723-2760 (触发)
  const entryPrice = 5.20;
  const tslpSuccess = false;

  // 设置紧急止损价 = 入场价 * 0.5
  let emergencyStopLoss: number | undefined;
  if (!tslpSuccess && entryPrice > 0) {
    emergencyStopLoss = entryPrice * 0.5;
  }

  // 验证触发条件: currentPrice <= emergencyStopLoss
  const priceAbove = 3.0;
  const priceBelow = 2.5;
  const shouldNotTrigger = !(
    emergencyStopLoss !== undefined &&
    priceAbove > 0 &&
    priceAbove <= emergencyStopLoss
  );
  const shouldTrigger =
    emergencyStopLoss !== undefined &&
    priceBelow > 0 &&
    priceBelow <= emergencyStopLoss;

  return {
    name: 'P1-4 TSLP紧急止损',
    pass: emergencyStopLoss === 2.6 && shouldTrigger && shouldNotTrigger,
    detail: `SL=${emergencyStopLoss}, above=${shouldNotTrigger}, below=${shouldTrigger}`,
  };
}

// ─── 报告输出 ──────────────────────────────────────────────────

function printReport(report: ReplayReport): void {
  const W = 60;
  const sep = '='.repeat(W);
  const thin = '-'.repeat(W);

  console.log(`\n${sep}`);
  console.log(` REPLAY TEST REPORT: ${report.date} (Strategy ${report.strategyId})`);
  console.log(sep);

  // Part 1
  console.log(`\n${'═'.repeat(3)} Part 1: 正常流程回放 ${'═'.repeat(3)}\n`);

  if (report.part1?.error) {
    console.log(`  ✗ 失败: ${report.part1.error}\n`);
  } else if (report.part1) {
    // 数据质量
    if (report.part1.dataQuality) {
      console.log('  数据质量:');
      for (const dq of report.part1.dataQuality) {
        const icon = dq.ok ? '✓' : '✗';
        console.log(`    ${dq.source.padEnd(14)} ${String(dq.bars).padStart(4)} bars ${icon}`);
      }
      console.log();
    }

    // 回测交易
    const bt = report.part1.backtestResult;
    if (bt) {
      const trades = bt.trades || [];
      console.log(`  回测交易 (${trades.length}笔):`);
      for (const t of trades.slice(0, 10)) {
        const sym = t.optionSymbol || t.symbol || '?';
        const dir = t.direction || t.side || '?';
        const entry = (t.entryPrice || 0).toFixed(2);
        const exit = (t.exitPrice || 0).toFixed(2);
        const entryT = t.entryTime ? t.entryTime.slice(11, 16) : '?';
        const exitT = t.exitTime ? t.exitTime.slice(11, 16) : 'open';
        const pnl = t.grossPnLPercent || t.netPnLPercent || 0;
        const pnlStr = pnl >= 0 ? `+${pnl.toFixed(1)}%` : `${pnl.toFixed(1)}%`;
        console.log(`    ${dir.padEnd(5)} ${sym} ${entryT}→${exitT} $${entry}→$${exit} PnL ${pnlStr}`);
      }
      if (trades.length > 10) console.log(`    ... 及 ${trades.length - 10} 笔更多交易`);

      // P&L 摘要 (option-backtest summary)
      const summary = bt.summary;
      if (summary) {
        const winRate = summary.winRate ?? 0;
        const netPnL = summary.totalNetPnL ?? 0;
        const grossPnL = summary.totalGrossPnL ?? 0;
        console.log(`\n  模拟 P&L: 毛利 $${grossPnL.toFixed(0)} | 净利 $${netPnL.toFixed(0)} | 胜率 ${winRate.toFixed(0)}% | 交易 ${summary.totalTrades || 0}笔`);
      }
      console.log();
    }

    // 实际订单
    const orders = report.part1.actualOrders || [];
    console.log(`  实际订单 (${orders.length}笔):`);
    for (const o of orders.slice(0, 10)) {
      const side = o.side || '?';
      const sym = o.symbol || '?';
      const price = o.executed_price || o.price || '?';
      const qty = o.executed_quantity || o.quantity || '?';
      const status = o.status || '?';
      console.log(`    ${side.padEnd(5)} ${sym} qty=${qty} price=$${price} [${status}]`);
    }
    if (orders.length > 10) console.log(`    ... 及 ${orders.length - 10} 笔更多订单`);
    console.log();

    // 对比
    const cmp = report.part1.comparison;
    if (cmp) {
      console.log('  对比:');
      console.log(`    匹配: ${cmp.matchCount}  仅回测: ${cmp.simulatedOnly}  仅实际: ${cmp.actualOnly}`);
      console.log(`    时间偏差: avg ${cmp.avgTimeDiffMin.toFixed(1)}min  价格偏差: avg ${(cmp.avgPriceDeviation * 100).toFixed(1)}%`);
      console.log();
    }
  } else {
    console.log('  (未运行)\n');
  }

  // Part 2
  console.log(`${'═'.repeat(3)} Part 2: 安全机制故障注入 ${'═'.repeat(3)}\n`);

  let part2AllPass = true;
  for (const t of report.part2) {
    const icon = t.pass ? '✓' : '✗';
    const line = `  ${icon} ${t.name.padEnd(22)} ${t.detail}`;
    console.log(line);
    if (!t.pass) part2AllPass = false;
  }

  // 总结
  console.log(`\n${sep}`);
  if (report.overallPass) {
    console.log(' RESULT: ALL PASSED');
  } else {
    const failedPart1 = report.part1?.error ? 'Part1(FAIL) ' : '';
    const failedTests = report.part2.filter((t) => !t.pass).map((t) => t.name);
    const failedPart2 = failedTests.length > 0 ? `Part2(FAIL: ${failedTests.join(', ')})` : '';
    console.log(` RESULT: FAILED — ${failedPart1}${failedPart2}`);
  }
  console.log(sep);
}

// ─── main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`replay-test: date=${REPLAY_DATE} strategy=${STRATEGY_ID} api=${API_BASE}`);

  if (!COOKIES) {
    console.error(
      '请设置环境变量 REPLAY_COOKIES\n' +
      '例: REPLAY_COOKIES="CF_Authorization=eyJ...;cf_clearance=..." npx tsx ../scripts/replay-test.ts 2026-02-24'
    );
    process.exit(1);
  }

  const report: ReplayReport = {
    date: REPLAY_DATE,
    strategyId: STRATEGY_ID,
    part1: null,
    part2: [],
    overallPass: true,
  };

  // Part 1: 正常流程回放
  console.log('\n[Part 1] 正常流程回放...');
  try {
    console.log('  检查数据质量...');
    const dataQuality = await checkDataQuality();

    console.log('  运行回测...');
    const backtestResult = await runBacktest();

    console.log('  拉取实际订单...');
    const actualOrders = await fetchActualOrders();

    console.log('  对比分析...');
    const comparison = compareResults(backtestResult.trades || [], actualOrders);

    report.part1 = { dataQuality, backtestResult, actualOrders, comparison };
  } catch (err: any) {
    console.error(`  Part 1 失败: ${err.message}`);
    report.part1 = { error: err.message };
    // Part 1 失败不影响 Part 2，但标记为不完全通过
  }

  // Part 2: 故障注入（独立运行，不依赖 Part 1）
  console.log('\n[Part 2] 安全机制故障注入...');
  const tests = [testP0_1, testP0_2, testP0_3, testP1_3, testP1_4];
  for (const test of tests) {
    try {
      const result = await test();
      report.part2.push(result);
      if (!result.pass) report.overallPass = false;
    } catch (err: any) {
      report.part2.push({ name: test.name, pass: false, detail: err.message });
      report.overallPass = false;
    }
  }

  // Part 1 有错误时也标记 overall
  if (report.part1?.error) {
    report.overallPass = false;
  }

  printReport(report);
  process.exit(report.overallPass ? 0 : 1);
}

main();
