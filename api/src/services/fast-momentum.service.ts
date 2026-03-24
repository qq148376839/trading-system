/**
 * Fast Momentum Gate — 快动量防追高
 *
 * 在慢动量（1m K线 EMA/CHOP/得分）基础上，通过实时报价采样（~5s间隔）
 * 构建 60 秒窗口的线性回归，检测方向一致性和减速信号，防止追高入场。
 *
 * 数据流：strategy-scheduler 批量 quote → feedQuotes → 环形缓冲区
 * 调用方：schwartz-option-strategy 在得分阈值后调用 checkGate
 */

import { logger } from '../utils/logger';

// ============================================
// 数据结构
// ============================================

interface PriceSample {
  price: number;
  timestamp: number;
}

export interface FastMomentumResult {
  pass: boolean;
  reason: string;
  slope: number | null;
  rSquared: number | null;
  deceleration: number | null;
  dataPoints: number;
  longSlope: number | null;   // 5分钟 slope（null = 数据不足）
}

interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

// ============================================
// RingBuffer — 固定容量环形缓冲区
// ============================================

class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** 返回所有元素，oldest-first */
  getAll(): T[] {
    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      result.push(this.buffer[idx] as T);
    }
    return result;
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

// ============================================
// 线性回归 — 最小二乘法
// ============================================

function linearRegression(values: number[]): LinearRegressionResult {
  const n = values.length;
  if (n < 2) {
    return { slope: 0, intercept: values[0] || 0, rSquared: 0 };
  }

  // x = [0, 1, ..., n-1]（等间距假设）
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, rSquared: 0 };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // R² 计算
  const meanY = sumY / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - meanY) ** 2;
  }

  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
}

// ============================================
// FastMomentumService
// ============================================

const BUFFER_CAPACITY = 12; // 12 点 × ~5s = ~60s 窗口
const MIN_DATA_POINTS = 6;  // 至少 6 个点才做判断
const DECEL_THRESHOLD = 0.5; // 减速超过 50% 则拒绝
const DECEL_UPPER_BOUND = 5.0; // 加速超过 5 倍 = 冲量尾端爆发，不可持续
const NEAR_ZERO_SLOPE = 0.0001; // 斜率接近零的阈值
const LONG_BUFFER_CAPACITY = 60;   // 60 点 × ~5s = ~5min 窗口
const LONG_MIN_DATA_POINTS = 20;   // 至少 20 个点（~100s 数据）

class FastMomentumService {
  private buffers = new Map<string, RingBuffer<PriceSample>>();
  private longBuffers = new Map<string, RingBuffer<PriceSample>>();

  /**
   * 批量喂入实时报价
   * 由 strategy-scheduler 每个周期调用一次
   */
  feedQuotes(quotes: Map<string, number>): void {
    for (const [symbol, price] of quotes) {
      // 短 buffer（60s）
      let buf = this.buffers.get(symbol);
      if (!buf) {
        buf = new RingBuffer<PriceSample>(BUFFER_CAPACITY);
        this.buffers.set(symbol, buf);
      }
      buf.push({ price, timestamp: Date.now() });
      // 长 buffer（5min）
      let longBuf = this.longBuffers.get(symbol);
      if (!longBuf) {
        longBuf = new RingBuffer<PriceSample>(LONG_BUFFER_CAPACITY);
        this.longBuffers.set(symbol, longBuf);
      }
      longBuf.push({ price, timestamp: Date.now() });
    }
  }

  /**
   * 检查快动量 Gate
   * @param symbol 标的代码
   * @param direction CALL（看涨）或 PUT（看跌）
   */
  checkGate(symbol: string, direction: 'CALL' | 'PUT'): FastMomentumResult {
    const buf = this.buffers.get(symbol);

    // 数据不足 → 优雅降级，放行
    if (!buf || buf.size() < MIN_DATA_POINTS) {
      return {
        pass: true,
        reason: `数据不足(${buf?.size() ?? 0}/${MIN_DATA_POINTS})，跳过`,
        slope: null,
        rSquared: null,
        deceleration: null,
        dataPoints: buf?.size() ?? 0,
        longSlope: null,
      };
    }

    const samples = buf.getAll();
    const prices = samples.map(s => s.price);
    const n = prices.length;

    // 1. 全段线性回归
    const fullReg = linearRegression(prices);

    // 2. 方向检查
    if (direction === 'CALL' && fullReg.slope <= 0) {
      return {
        pass: false,
        reason: `方向不一致: CALL要求上涨但slope=${fullReg.slope.toFixed(6)}`,
        slope: fullReg.slope,
        rSquared: fullReg.rSquared,
        deceleration: null,
        dataPoints: n,
        longSlope: null,
      };
    }
    if (direction === 'PUT' && fullReg.slope >= 0) {
      return {
        pass: false,
        reason: `方向不一致: PUT要求下跌但slope=${fullReg.slope.toFixed(6)}`,
        slope: fullReg.slope,
        rSquared: fullReg.rSquared,
        deceleration: null,
        dataPoints: n,
        longSlope: null,
      };
    }

    // 2.5 长周期趋势方向检查（5分钟）
    const longBuf = this.longBuffers.get(symbol);
    let longSlope: number | null = null;
    if (longBuf && longBuf.size() >= LONG_MIN_DATA_POINTS) {
      const longPrices = longBuf.getAll().map(s => s.price);
      const longReg = linearRegression(longPrices);
      longSlope = longReg.slope;
      // 5 分钟趋势与入场方向相反 → 记录日志但不拒绝（降级为观察指标）
      if (
        (direction === 'CALL' && longReg.slope < -NEAR_ZERO_SLOPE) ||
        (direction === 'PUT' && longReg.slope > NEAR_ZERO_SLOPE)
      ) {
        logger.info(
          `[${symbol}] FastMo: 5分钟趋势反向(仅日志) longSlope=${longReg.slope.toFixed(6)}, 60s slope=${fullReg.slope.toFixed(6)}`,
          { module: 'FastMomentum.LongSlope' }
        );
      }
    }

    // 3. 减速检查：前半段 vs 后半段
    const mid = Math.floor(n / 2);
    const firstHalf = prices.slice(0, mid);
    const secondHalf = prices.slice(mid);

    const firstReg = linearRegression(firstHalf);
    const secondReg = linearRegression(secondHalf);

    // 前半段斜率接近零 → 跳过减速检查（避免除零和噪声放大）
    if (Math.abs(firstReg.slope) < NEAR_ZERO_SLOPE) {
      return {
        pass: true,
        reason: '前半段斜率接近零，跳过减速检查',
        slope: fullReg.slope,
        rSquared: fullReg.rSquared,
        deceleration: null,
        dataPoints: n,
        longSlope,
      };
    }

    const decelRatio = Math.abs(secondReg.slope) / Math.abs(firstReg.slope);

    if (decelRatio < DECEL_THRESHOLD) {
      return {
        pass: false,
        reason: `减速过大: decel=${decelRatio.toFixed(3)}(阈值${DECEL_THRESHOLD})`,
        slope: fullReg.slope,
        rSquared: fullReg.rSquared,
        deceleration: decelRatio,
        dataPoints: n,
        longSlope,
      };
    }

    // 3.5 异常加速检查：decel >> 1 意味着后半段比前半段快数倍
    // 这通常是开盘冲量尾端的爆发信号，不可持续，入场即追顶
    if (decelRatio > DECEL_UPPER_BOUND) {
      return {
        pass: false,
        reason: `异常加速: decel=${decelRatio.toFixed(1)}>${DECEL_UPPER_BOUND}（冲量尾端爆发）`,
        slope: fullReg.slope,
        rSquared: fullReg.rSquared,
        deceleration: decelRatio,
        dataPoints: n,
        longSlope,
      };
    }

    // 4. 全部通过
    return {
      pass: true,
      reason: '快动量确认',
      slope: fullReg.slope,
      rSquared: fullReg.rSquared,
      deceleration: decelRatio,
      dataPoints: n,
      longSlope,
    };
  }

  /** 停止跟踪某个标的 */
  removeSymbol(symbol: string): void {
    this.buffers.delete(symbol);
    this.longBuffers.delete(symbol);
  }

  /** 日重置 / 策略停止时清空所有数据 */
  reset(): void {
    this.buffers.clear();
    this.longBuffers.clear();
  }
}

export default new FastMomentumService();

// 导出类和辅助函数供测试使用
export { FastMomentumService, RingBuffer, linearRegression, BUFFER_CAPACITY, MIN_DATA_POINTS, DECEL_THRESHOLD, DECEL_UPPER_BOUND, NEAR_ZERO_SLOPE, LONG_BUFFER_CAPACITY, LONG_MIN_DATA_POINTS };
