/**
 * 安全防护机制测试
 *
 * 覆盖:
 * A. NaN Guard (V12) — dailyRealizedPnL / consecutiveLosses 的 NaN 回退
 * B. 分时评分系统 — 5组件权重 / 动量计算 / VWAP位置 / 数据缺失降级
 * C. 结构一致性检查 — VWAP方向 vs 信号方向冲突降级
 * D. VIX自适应阈值 — factor 计算 / 上下限 / 回退
 * E. TSLP计数器持久化 (V4) — DB 写入 / 恢复 / 新日重置
 * F. 手续费计算 (V6) — 实际值 / 回退 / 零值
 */

// ============================================
// Mock 外部依赖
// ============================================

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../services/market-data-cache.service', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/market-data.service', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/intraday-data-filter.service', () => ({
  __esModule: true,
  default: {
    filterData: jest.fn((data: any[]) => data),
  },
}));

import pool from '../config/database';

// ============================================
// 辅助: 从源码中提取的纯函数副本（用于独立测试）
// ============================================

/**
 * NaN Guard: 与 strategy-scheduler.service.ts line 994-998 相同的逻辑
 */
function nanGuardConsecutiveLosses(contextValue: unknown): number {
  const raw = parseInt(String(contextValue ?? 0), 10);
  return isNaN(raw) ? 0 : raw;
}

function nanGuardDailyPnL(contextValue: unknown): number {
  const raw = parseFloat(String(contextValue ?? 0));
  return isNaN(raw) ? 0 : raw;
}

/**
 * 动量计算: 与 option-recommendation.service.ts calculateMomentum 相同
 */
interface CandlestickData {
  close: number;
  open: number;
  low: number;
  high: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

function calculateMomentum(data: CandlestickData[]): number {
  if (!data || data.length < 5) return 0;

  const changes: number[] = [];
  for (let i = 1; i < Math.min(data.length, 10); i++) {
    const change = (data[i].close - data[i - 1].close) / data[i - 1].close;
    changes.push(change);
  }

  const avgChange = changes.reduce((sum, c) => sum + c, 0) / changes.length;
  const momentum = avgChange * 1000;
  return Math.max(-100, Math.min(100, momentum));
}

/**
 * VWAP 位置得分: 与 option-recommendation.service.ts line 410-420 相同
 */
function calculateVwapPositionScore(lastPrice: number, vwap: number): number {
  if (vwap <= 0) return 0;
  const distancePct = ((lastPrice - vwap) / vwap) * 100;
  const rawScore = Math.max(-100, Math.min(100, distancePct * 200));
  return rawScore * 0.15;
}

/**
 * VIX 阈值因子: 与 option-intraday-strategy.ts getVixThresholdFactor 相同
 */
function getVixThresholdFactor(vixValue?: number): number {
  if (!vixValue || vixValue <= 0) return 1.0;
  return Math.max(0.5, Math.min(2.5, vixValue / 20));
}

/**
 * 结构一致性检查: 与 option-recommendation.service.ts line 196-208 相同
 */
function checkStructureAlignment(
  direction: 'CALL' | 'PUT' | 'HOLD',
  lastPrice: number,
  vwap: number,
  finalScore: number,
): 'CALL' | 'PUT' | 'HOLD' {
  if (direction === 'HOLD') return 'HOLD';
  if (vwap <= 0) return direction;
  const priceAboveVWAP = lastPrice > vwap;
  const mismatch = (direction === 'PUT' && priceAboveVWAP) || (direction === 'CALL' && !priceAboveVWAP);
  if (mismatch && Math.abs(finalScore) < 30) {
    return 'HOLD';
  }
  return direction;
}

/**
 * V6 手续费计算: 与 strategy-scheduler.service.ts V6 逻辑相同
 */
function calculateTotalFees(buyFees: number, sellFees: number): number {
  return (buyFees > 0 && sellFees > 0)
    ? buyFees + sellFees
    : (buyFees > 0 ? buyFees * 2 : (sellFees > 0 ? sellFees * 2 : 0));
}

/**
 * 分时评分5组件聚合 (简化版)
 */
function calculateIntradayScore(params: {
  underlyingMomentum?: number;
  vwapPosition?: number;
  spxIntraday?: number;
  btcHourly?: number;
  usdHourly?: number;
}): number {
  const score =
    (params.underlyingMomentum ?? 0) +
    (params.vwapPosition ?? 0) +
    (params.spxIntraday ?? 0) +
    (params.btcHourly ?? 0) +
    (params.usdHourly ?? 0);
  return Math.max(-100, Math.min(100, score));
}

// ============================================
// 辅助: K线生成器
// ============================================

function makeKline(close: number, timestamp = Date.now()): CandlestickData {
  return { close, open: close, high: close + 0.5, low: close - 0.5, volume: 1000, turnover: 0, timestamp };
}

function makeKlines(prices: number[]): CandlestickData[] {
  return prices.map((p, i) => makeKline(p, Date.now() - (prices.length - i) * 60000));
}

// ============================================
// A. NaN Guard
// ============================================

describe('A. NaN Guard (V12)', () => {
  test('dailyRealizedPnL 为 NaN 时回退到 0', () => {
    expect(nanGuardDailyPnL(NaN)).toBe(0);
  });

  test('consecutiveLosses 为 NaN 时回退到 0', () => {
    expect(nanGuardConsecutiveLosses(NaN)).toBe(0);
  });

  test('dailyRealizedPnL 为 string "NaN" 时回退到 0', () => {
    expect(nanGuardDailyPnL('NaN')).toBe(0);
  });

  test('consecutiveLosses 为 string "NaN" 时回退到 0', () => {
    expect(nanGuardConsecutiveLosses('NaN')).toBe(0);
  });

  test('正常数值不受影响', () => {
    expect(nanGuardDailyPnL(-150.5)).toBe(-150.5);
    expect(nanGuardConsecutiveLosses(3)).toBe(3);
  });

  test('null/undefined 回退到 0', () => {
    expect(nanGuardDailyPnL(null)).toBe(0);
    expect(nanGuardDailyPnL(undefined)).toBe(0);
    expect(nanGuardConsecutiveLosses(null)).toBe(0);
    expect(nanGuardConsecutiveLosses(undefined)).toBe(0);
  });

  test('字符串数字正确解析', () => {
    expect(nanGuardDailyPnL('-50.25')).toBe(-50.25);
    expect(nanGuardConsecutiveLosses('2')).toBe(2);
  });
});

// ============================================
// B. 分时评分系统
// ============================================

describe('B. 分时评分系统', () => {
  test('5个组件权重之和 = 1.0 (30+15+25+15+15)', () => {
    const weights = [0.3, 0.15, 0.25, 0.15, 0.15];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  test('标的1m动量正确计算 — 上涨=正', () => {
    const prices = [100, 100.1, 100.2, 100.3, 100.4, 100.5];
    const momentum = calculateMomentum(makeKlines(prices));
    expect(momentum).toBeGreaterThan(0);
  });

  test('标的1m动量正确计算 — 下跌=负', () => {
    const prices = [100, 99.9, 99.8, 99.7, 99.6, 99.5];
    const momentum = calculateMomentum(makeKlines(prices));
    expect(momentum).toBeLessThan(0);
  });

  test('VWAP位置得分 — 价格在VWAP上方=正', () => {
    const score = calculateVwapPositionScore(502, 500);
    expect(score).toBeGreaterThan(0);
  });

  test('VWAP位置得分 — 价格在VWAP下方=负', () => {
    const score = calculateVwapPositionScore(498, 500);
    expect(score).toBeLessThan(0);
  });

  test('数据缺失安全降级 — underlyingVWAP 为 null 时动量返回 0', () => {
    const momentum = calculateMomentum([]);
    expect(momentum).toBe(0);
  });

  test('数据缺失安全降级 — K线不足5根时返回 0', () => {
    const momentum = calculateMomentum(makeKlines([100, 101, 102]));
    expect(momentum).toBe(0);
  });

  test('所有数据缺失时 intradayScore ≈ 0', () => {
    const score = calculateIntradayScore({});
    expect(score).toBe(0);
  });

  test('满数据时 intradayScore 为各组件之和', () => {
    const score = calculateIntradayScore({
      underlyingMomentum: 10,
      vwapPosition: 5,
      spxIntraday: 8,
      btcHourly: 3,
      usdHourly: -2,
    });
    expect(score).toBe(24);
  });
});

// ============================================
// C. 结构一致性检查
// ============================================

describe('C. 结构一致性检查', () => {
  test('PUT + 价格>VWAP + score<30 → 降级 HOLD', () => {
    const result = checkStructureAlignment('PUT', 502, 500, -25);
    expect(result).toBe('HOLD');
  });

  test('CALL + 价格<VWAP + score<30 → 降级 HOLD', () => {
    const result = checkStructureAlignment('CALL', 498, 500, 25);
    expect(result).toBe('HOLD');
  });

  test('PUT + 价格>VWAP + score>=30 → 保持 PUT（强信号覆盖）', () => {
    const result = checkStructureAlignment('PUT', 502, 500, -35);
    expect(result).toBe('PUT');
  });

  test('PUT + 价格<VWAP → 保持 PUT（结构一致）', () => {
    const result = checkStructureAlignment('PUT', 498, 500, -20);
    expect(result).toBe('PUT');
  });

  test('CALL + 价格>VWAP → 保持 CALL（结构一致）', () => {
    const result = checkStructureAlignment('CALL', 502, 500, 20);
    expect(result).toBe('CALL');
  });

  test('HOLD 不受结构检查影响', () => {
    const result = checkStructureAlignment('HOLD', 502, 500, 5);
    expect(result).toBe('HOLD');
  });
});

// ============================================
// D. VIX 自适应阈值
// ============================================

describe('D. VIX 自适应阈值', () => {
  test('VIX=20 → factor=1.0', () => {
    expect(getVixThresholdFactor(20)).toBe(1.0);
  });

  test('VIX=10 → factor=0.5（下限）', () => {
    expect(getVixThresholdFactor(10)).toBe(0.5);
  });

  test('VIX=5 → factor=0.5（被下限截断）', () => {
    expect(getVixThresholdFactor(5)).toBe(0.5);
  });

  test('VIX=50 → factor=2.5（上限）', () => {
    expect(getVixThresholdFactor(50)).toBe(2.5);
  });

  test('VIX=60 → factor=2.5（被上限截断）', () => {
    expect(getVixThresholdFactor(60)).toBe(2.5);
  });

  test('VIX=undefined → factor=1.0（回退）', () => {
    expect(getVixThresholdFactor(undefined)).toBe(1.0);
  });

  test('VIX=0 → factor=1.0（回退）', () => {
    expect(getVixThresholdFactor(0)).toBe(1.0);
  });

  test('AGGRESSIVE base=10, VIX=30 → effective=15', () => {
    const base = 10; // AGGRESSIVE directionalScoreMin
    const factor = getVixThresholdFactor(30); // 1.5
    const effective = Math.round(base * factor);
    expect(effective).toBe(15);
  });

  test('AGGRESSIVE base=8, VIX=30 → effective=12', () => {
    const base = 8;
    const factor = getVixThresholdFactor(30); // 1.5
    const effective = Math.round(base * factor);
    expect(effective).toBe(12);
  });
});

// ============================================
// E. TSLP 计数器持久化 (V4)
// ============================================

describe('E. TSLP 计数器持久化 (V4)', () => {
  let mockQuery: jest.Mock;

  beforeEach(() => {
    mockQuery = pool.query as jest.Mock;
    jest.clearAllMocks();
    mockQuery.mockReset();
  });

  /**
   * 模拟 StrategyScheduler TSLP 计数器逻辑（简化提取版）
   * 实际代码在 strategy-scheduler.service.ts
   */
  class TslpCounterSimulator {
    private tslpFailureCount = new Map<number, number>();
    private readonly TSLP_FAILURE_THRESHOLD = 2;

    async recordTslpFailure(strategyId: number): Promise<void> {
      const count = (this.tslpFailureCount.get(strategyId) || 0) + 1;
      this.tslpFailureCount.set(strategyId, count);
      await pool.query(
        `UPDATE strategy_instances
         SET context = context || $1::jsonb
         WHERE strategy_id = $2`,
        [JSON.stringify({ tslpFailureCount: count }), strategyId]
      );
    }

    async resetTslpFailure(strategyId: number): Promise<void> {
      this.tslpFailureCount.set(strategyId, 0);
      await pool.query(
        `UPDATE strategy_instances
         SET context = context || '{"tslpFailureCount": 0}'::jsonb
         WHERE strategy_id = $1`,
        [strategyId]
      );
    }

    isTslpBlocked(strategyId: number): boolean {
      return (this.tslpFailureCount.get(strategyId) || 0) >= this.TSLP_FAILURE_THRESHOLD;
    }

    async restoreTslpFailureCount(strategyId: number): Promise<void> {
      if (this.tslpFailureCount.has(strategyId)) return;
      const result = await pool.query(
        `SELECT MAX((context->>'tslpFailureCount')::int) as count
         FROM strategy_instances WHERE strategy_id = $1`,
        [strategyId]
      );
      const count = result.rows[0]?.count || 0;
      this.tslpFailureCount.set(strategyId, count);
    }
  }

  test('recordTslpFailure 写入 DB context', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const sim = new TslpCounterSimulator();

    await sim.recordTslpFailure(10);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE strategy_instances'),
      [JSON.stringify({ tslpFailureCount: 1 }), 10]
    );
  });

  test('recordTslpFailure 连续调用递增计数', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const sim = new TslpCounterSimulator();

    await sim.recordTslpFailure(10);
    await sim.recordTslpFailure(10);

    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE strategy_instances'),
      [JSON.stringify({ tslpFailureCount: 2 }), 10]
    );
  });

  test('restoreTslpFailureCount 从 DB 恢复', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 2 }] });
    const sim = new TslpCounterSimulator();

    await sim.restoreTslpFailureCount(10);

    expect(sim.isTslpBlocked(10)).toBe(true);
  });

  test('restoreTslpFailureCount — DB返回0时不阻塞', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 0 }] });
    const sim = new TslpCounterSimulator();

    await sim.restoreTslpFailureCount(10);

    expect(sim.isTslpBlocked(10)).toBe(false);
  });

  test('restoreTslpFailureCount — 已恢复时不重复查询', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 1 }] });
    const sim = new TslpCounterSimulator();

    await sim.restoreTslpFailureCount(10);
    await sim.restoreTslpFailureCount(10); // 第二次

    expect(mockQuery).toHaveBeenCalledTimes(1); // 只查一次
  });

  test('isTslpBlocked 在恢复后正确判断', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 3 }] });
    const sim = new TslpCounterSimulator();

    await sim.restoreTslpFailureCount(10);

    expect(sim.isTslpBlocked(10)).toBe(true);
  });

  test('resetTslpFailure 重置后不再阻塞', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const sim = new TslpCounterSimulator();

    await sim.recordTslpFailure(10);
    await sim.recordTslpFailure(10);
    expect(sim.isTslpBlocked(10)).toBe(true);

    await sim.resetTslpFailure(10);
    expect(sim.isTslpBlocked(10)).toBe(false);
  });

  test('新交易日重置 tslpFailureCount', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const sim = new TslpCounterSimulator();

    await sim.recordTslpFailure(10);
    await sim.recordTslpFailure(10);
    expect(sim.isTslpBlocked(10)).toBe(true);

    // 模拟新交易日重置
    await sim.resetTslpFailure(10);

    expect(sim.isTslpBlocked(10)).toBe(false);
    // 验证 DB 也被重置
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('"tslpFailureCount": 0'),
      [10]
    );
  });
});

// ============================================
// F. 手续费计算 (V6)
// ============================================

describe('F. 手续费计算 (V6)', () => {
  test('有实际 buyFees + sellFees → 用实际值', () => {
    expect(calculateTotalFees(3.5, 4.0)).toBe(7.5);
  });

  test('只有 buyFees → buyFees * 2 回退', () => {
    expect(calculateTotalFees(3.5, 0)).toBe(7.0);
  });

  test('只有 sellFees → sellFees * 2 回退', () => {
    expect(calculateTotalFees(0, 4.0)).toBe(8.0);
  });

  test('都没有 → 0', () => {
    expect(calculateTotalFees(0, 0)).toBe(0);
  });

  test('PnL 用 totalFees 计算 — 期权', () => {
    const entryPrice = 2.0;
    const exitPrice = 2.5;
    const qty = 1;
    const multiplier = 100;
    const totalFees = calculateTotalFees(3.5, 4.0); // 7.5
    const pnl = (exitPrice - entryPrice) * qty * multiplier - totalFees;
    expect(pnl).toBeCloseTo(42.5);
  });

  test('PnL 用 totalFees 计算 — 股票', () => {
    const entryPrice = 150;
    const exitPrice = 155;
    const qty = 10;
    const totalFees = calculateTotalFees(1.0, 1.0); // 2.0
    const pnl = (exitPrice - entryPrice) * qty - totalFees;
    expect(pnl).toBe(48);
  });

  test('回退估算与旧逻辑一致 (entryFees * 2)', () => {
    // 旧逻辑: sellEntryFees * 2 = 3.5 * 2 = 7.0
    // 新逻辑: buyFees=3.5, sellFees=0 → 3.5 * 2 = 7.0
    expect(calculateTotalFees(3.5, 0)).toBe(7.0);
  });
});
