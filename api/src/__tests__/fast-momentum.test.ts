/**
 * Fast Momentum Gate 单元测试
 * 测试环形缓冲区、线性回归精度、方向检查、减速检测、降级逻辑
 */

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  },
}));

import {
  FastMomentumService,
  RingBuffer,
  linearRegression,
  BUFFER_CAPACITY,
  MIN_DATA_POINTS,
  DECEL_THRESHOLD,
  DECEL_UPPER_BOUND,
} from '../services/fast-momentum.service';

// ============================================
// RingBuffer 测试
// ============================================
describe('RingBuffer', () => {
  it('push 和 getAll — 未满时按序返回', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.getAll()).toEqual([1, 2, 3]);
    expect(buf.size()).toBe(3);
  });

  it('push 溢出时覆盖最旧元素', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // 覆盖 1
    expect(buf.getAll()).toEqual([2, 3, 4]);
    expect(buf.size()).toBe(3);
  });

  it('多次溢出后仍保持正确顺序（oldest-first）', () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 1; i <= 7; i++) {
      buf.push(i);
    }
    // 容量3, 最后3个: 5, 6, 7
    expect(buf.getAll()).toEqual([5, 6, 7]);
  });

  it('clear 后重置', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });

  it('空 buffer 返回空数组', () => {
    const buf = new RingBuffer<number>(5);
    expect(buf.size()).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });
});

// ============================================
// 线性回归测试
// ============================================
describe('linearRegression', () => {
  it('完美线性 y=2x+1 → slope=2, R²≈1.0', () => {
    const values = [1, 3, 5, 7, 9]; // y = 2x + 1, x=0..4
    const result = linearRegression(values);
    expect(result.slope).toBeCloseTo(2, 10);
    expect(result.intercept).toBeCloseTo(1, 10);
    expect(result.rSquared).toBeCloseTo(1.0, 10);
  });

  it('完美线性负斜率 y=-3x+10', () => {
    const values = [10, 7, 4, 1]; // y = -3x + 10
    const result = linearRegression(values);
    expect(result.slope).toBeCloseTo(-3, 10);
    expect(result.intercept).toBeCloseTo(10, 10);
    expect(result.rSquared).toBeCloseTo(1.0, 10);
  });

  it('常数序列 → slope=0, R²=0', () => {
    const values = [5, 5, 5, 5];
    const result = linearRegression(values);
    expect(result.slope).toBeCloseTo(0, 10);
    expect(result.rSquared).toBeCloseTo(0, 5);
  });

  it('单个值 → slope=0', () => {
    const result = linearRegression([42]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(42);
  });

  it('两个值', () => {
    const result = linearRegression([10, 20]);
    expect(result.slope).toBeCloseTo(10, 10);
    expect(result.intercept).toBeCloseTo(10, 10);
    expect(result.rSquared).toBeCloseTo(1.0, 10);
  });

  it('带噪声的数据 R²<1', () => {
    const values = [1, 3, 2, 5, 4, 7]; // 大致上升但有噪声
    const result = linearRegression(values);
    expect(result.slope).toBeGreaterThan(0);
    expect(result.rSquared).toBeGreaterThan(0);
    expect(result.rSquared).toBeLessThan(1);
  });
});

// ============================================
// FastMomentumService 测试
// ============================================
describe('FastMomentumService', () => {
  let service: FastMomentumService;

  beforeEach(() => {
    service = new FastMomentumService();
  });

  // --- 数据不足降级 ---
  describe('数据不足降级', () => {
    it('0 个数据点 → pass: true', () => {
      const result = service.checkGate('AAPL', 'CALL');
      expect(result.pass).toBe(true);
      expect(result.reason).toContain('数据不足');
      expect(result.dataPoints).toBe(0);
    });

    it('3 个数据点 → pass: true', () => {
      const quotes = new Map([['AAPL', 150]]);
      service.feedQuotes(quotes);
      service.feedQuotes(new Map([['AAPL', 151]]));
      service.feedQuotes(new Map([['AAPL', 152]]));

      const result = service.checkGate('AAPL', 'CALL');
      expect(result.pass).toBe(true);
      expect(result.reason).toContain('数据不足');
      expect(result.dataPoints).toBe(3);
    });

    it('5 个数据点（刚好不够） → pass: true', () => {
      for (let i = 0; i < 5; i++) {
        service.feedQuotes(new Map([['AAPL', 150 + i]]));
      }
      const result = service.checkGate('AAPL', 'CALL');
      expect(result.pass).toBe(true);
      expect(result.dataPoints).toBe(5);
    });
  });

  // --- 方向检查 ---
  describe('方向检查', () => {
    it('CALL + 正斜率（持续上涨）→ pass: true', () => {
      // 喂入 8 个递增价格
      for (let i = 0; i < 8; i++) {
        service.feedQuotes(new Map([['AAPL', 150 + i * 0.5]]));
      }
      const result = service.checkGate('AAPL', 'CALL');
      expect(result.pass).toBe(true);
      expect(result.slope).toBeGreaterThan(0);
    });

    it('CALL + 负斜率（持续下跌）→ pass: false', () => {
      for (let i = 0; i < 8; i++) {
        service.feedQuotes(new Map([['AAPL', 150 - i * 0.5]]));
      }
      const result = service.checkGate('AAPL', 'CALL');
      expect(result.pass).toBe(false);
      expect(result.reason).toContain('方向不一致');
      expect(result.reason).toContain('CALL');
    });

    it('PUT + 负斜率（持续下跌）→ pass: true', () => {
      for (let i = 0; i < 8; i++) {
        service.feedQuotes(new Map([['TSLA', 200 - i * 0.5]]));
      }
      const result = service.checkGate('TSLA', 'PUT');
      expect(result.pass).toBe(true);
      expect(result.slope).toBeLessThan(0);
    });

    it('PUT + 正斜率（持续上涨）→ pass: false', () => {
      for (let i = 0; i < 8; i++) {
        service.feedQuotes(new Map([['TSLA', 200 + i * 0.5]]));
      }
      const result = service.checkGate('TSLA', 'PUT');
      expect(result.pass).toBe(false);
      expect(result.reason).toContain('方向不一致');
      expect(result.reason).toContain('PUT');
    });
  });

  // --- 减速检查 ---
  describe('减速检查', () => {
    it('强减速（>50%）→ pass: false', () => {
      // 前半段强上涨，后半段几乎平坦
      const prices = [100, 102, 104, 106, 108, 110, 110.1, 110.2, 110.3, 110.4, 110.5, 110.6];
      for (const p of prices) {
        service.feedQuotes(new Map([['NVDA', p]]));
      }
      const result = service.checkGate('NVDA', 'CALL');
      expect(result.pass).toBe(false);
      expect(result.reason).toContain('减速');
      expect(result.deceleration).toBeLessThan(DECEL_THRESHOLD);
    });

    it('轻微减速（<50%）→ pass: true', () => {
      // 前半段上涨2，后半段上涨1.5 → decel = 1.5/2 = 0.75 > 0.5
      const prices = [100, 102, 104, 106, 108, 110, 111.5, 113, 114.5, 116, 117.5, 119];
      for (const p of prices) {
        service.feedQuotes(new Map([['NVDA', p]]));
      }
      const result = service.checkGate('NVDA', 'CALL');
      expect(result.pass).toBe(true);
      expect(result.deceleration).toBeGreaterThanOrEqual(DECEL_THRESHOLD);
    });

    it('异常加速（>5x）→ pass: false（冲量尾端爆发）', () => {
      // 前半段几乎不动，后半段突然暴涨 → decel >> 5
      // 模拟开盘冲量场景：前30秒缓慢 + 后30秒爆发
      const prices = [100, 100.01, 100.02, 100.03, 100.04, 100.05,
                       100.1, 100.5, 101, 102, 103.5, 105];
      for (const p of prices) {
        service.feedQuotes(new Map([['BLOW', p]]));
      }
      const result = service.checkGate('BLOW', 'CALL');
      expect(result.pass).toBe(false);
      expect(result.reason).toContain('异常加速');
      expect(result.deceleration).toBeGreaterThan(DECEL_UPPER_BOUND);
    });

    it('斜率接近零 → 跳过减速检查，不除零', () => {
      // 前半段几乎平坦，后半段微弱上涨
      const prices = [100, 100.00001, 100.00002, 100.00003, 100.00004, 100.00005,
                       100.001, 100.002, 100.003, 100.004, 100.005, 100.006];
      for (const p of prices) {
        service.feedQuotes(new Map([['FLAT', p]]));
      }
      const result = service.checkGate('FLAT', 'CALL');
      // 不应抛异常，也不应因除零而 fail
      expect(result.pass).toBe(true);
      expect(result.reason).toContain('接近零');
    });
  });

  // --- feedQuotes + checkGate 集成 ---
  describe('feedQuotes + checkGate 集成', () => {
    it('喂入 12 个报价后验证完整 gate', () => {
      // 稳定上涨序列
      for (let i = 0; i < BUFFER_CAPACITY; i++) {
        service.feedQuotes(new Map([['AAPL', 150 + i * 0.3]]));
      }
      const result = service.checkGate('AAPL', 'CALL');
      expect(result.pass).toBe(true);
      expect(result.dataPoints).toBe(BUFFER_CAPACITY);
      expect(result.slope).not.toBeNull();
      expect(result.rSquared).not.toBeNull();
      expect(result.deceleration).not.toBeNull();
    });

    it('多个 symbol 独立缓冲区', () => {
      // AAPL 上涨，TSLA 下跌
      for (let i = 0; i < 8; i++) {
        service.feedQuotes(new Map([
          ['AAPL', 150 + i],
          ['TSLA', 200 - i],
        ]));
      }

      const aaplResult = service.checkGate('AAPL', 'CALL');
      expect(aaplResult.pass).toBe(true);

      const tslaResult = service.checkGate('TSLA', 'PUT');
      expect(tslaResult.pass).toBe(true);

      // 反向不通过
      expect(service.checkGate('AAPL', 'PUT').pass).toBe(false);
      expect(service.checkGate('TSLA', 'CALL').pass).toBe(false);
    });

    it('超过 buffer 容量后只保留最新数据', () => {
      // 先喂 12 个下跌，再喂 12 个上涨 → 短 buffer 应该只看到上涨
      // 注意：长 buffer (60点) 会同时包含下跌和上涨数据，longSlope 可能为负
      for (let i = 0; i < BUFFER_CAPACITY; i++) {
        service.feedQuotes(new Map([['TEST', 100 - i]]));
      }
      for (let i = 0; i < BUFFER_CAPACITY; i++) {
        service.feedQuotes(new Map([['TEST', 80 + i * 0.5]]));
      }
      const result = service.checkGate('TEST', 'CALL');
      // 短 buffer slope > 0（上涨），但长 buffer 包含先跌后涨 → longSlope 为负 → 拒绝 CALL
      expect(result.pass).toBe(false);
      expect(result.slope).toBeGreaterThan(0);
      expect(result.reason).toContain('5分钟趋势反向');
    });
  });

  // --- removeSymbol / reset ---
  describe('removeSymbol / reset', () => {
    it('removeSymbol 后数据清除', () => {
      for (let i = 0; i < 8; i++) {
        service.feedQuotes(new Map([['AAPL', 150 + i]]));
      }
      service.removeSymbol('AAPL');
      const result = service.checkGate('AAPL', 'CALL');
      expect(result.pass).toBe(true);
      expect(result.reason).toContain('数据不足');
      expect(result.dataPoints).toBe(0);
    });

    it('reset 后所有 symbol 清除', () => {
      for (let i = 0; i < 8; i++) {
        service.feedQuotes(new Map([
          ['AAPL', 150 + i],
          ['TSLA', 200 + i],
        ]));
      }
      service.reset();
      expect(service.checkGate('AAPL', 'CALL').dataPoints).toBe(0);
      expect(service.checkGate('TSLA', 'CALL').dataPoints).toBe(0);
    });

    it('removeSymbol 不影响其他 symbol', () => {
      for (let i = 0; i < 8; i++) {
        service.feedQuotes(new Map([
          ['AAPL', 150 + i],
          ['TSLA', 200 + i],
        ]));
      }
      service.removeSymbol('AAPL');
      expect(service.checkGate('AAPL', 'CALL').dataPoints).toBe(0);
      expect(service.checkGate('TSLA', 'CALL').dataPoints).toBe(8);
    });
  });
});
