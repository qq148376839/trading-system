/**
 * 公共技术指标工具函数
 *
 * 提供可复用的技术分析计算（ATR 等），供多个策略服务调用。
 */

export interface CandlestickInput {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * 计算 ATR（Average True Range，平均真实波幅）
 *
 * @param candles  K 线数据（至少需要 period+1 根）
 * @param period   计算周期，默认 14
 * @returns ATR 值；数据不足时使用简单 high-low 均值，无数据返回 0
 */
export function calculateATR(candles: CandlestickInput[], period: number = 14): number {
  if (!candles || candles.length === 0) return 0;

  if (candles.length < period + 1) {
    // 数据不足，使用简单的 high-low 均值估算
    const ranges = candles.map(c => c.high - c.low);
    return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
  }

  // 计算 True Range
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;

    const tr = Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - prevClose),
      Math.abs(currentLow - prevClose),
    );
    trueRanges.push(tr);
  }

  // 取最近 period 个 TR 的简单平均
  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((sum, r) => sum + r, 0) / recentTRs.length;
}
