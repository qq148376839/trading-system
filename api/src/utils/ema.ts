/**
 * EMA (Exponential Moving Average) 计算工具
 * 用于 Schwartz 策略的趋势过滤
 */

/**
 * 计算 EMA 序列
 * @param closes 收盘价数组（按时间升序）
 * @param period EMA 周期
 * @returns 与 closes 等长的 EMA 数组，前 period-1 个为 NaN
 */
export function calculateEMA(closes: number[], period: number): number[] {
  if (!closes.length || period < 1) return [];
  if (period > closes.length) {
    return closes.map(() => NaN);
  }

  const k = 2 / (period + 1);
  const result: number[] = new Array(closes.length).fill(NaN);

  // 前 period 个值的 SMA 作为初始 EMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  result[period - 1] = sum / period;

  // 后续使用 EMA 公式
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }

  return result;
}

/**
 * 获取最新的有效 EMA 值
 * @param closes 收盘价数组（按时间升序）
 * @param period EMA 周期
 * @returns 最后一个有效 EMA 值，数据不足返回 null
 */
export function getLatestEMA(closes: number[], period: number): number | null {
  if (!closes.length || period < 1 || closes.length < period) return null;

  const emaArr = calculateEMA(closes, period);
  const last = emaArr[emaArr.length - 1];
  return isNaN(last) ? null : last;
}

/**
 * 计算简单移动平均线 (SMA)
 * @param closes 收盘价数组（按时间升序）
 * @param period 周期
 * @returns 最后一个 SMA 值，数据不足返回 null
 */
export function getLatestSMA(closes: number[], period: number): number | null {
  if (!closes.length || period < 1 || closes.length < period) return null;

  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += closes[i];
  }
  return sum / period;
}
