/**
 * 市场环境模拟工具
 * 使用日K数据的OHLC来模拟分时价格序列
 * 
 * 方案：线性插值
 * - 在开盘价和收盘价之间线性插值
 * - 确保价格在最高价和最低价范围内
 */

import { logger } from './logger';

export interface DailyCandlestick {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SimulatedIntradayPrice {
  timestamp: Date;
  price: number;
  volume: number;
}

/**
 * 使用线性插值模拟分时价格序列
 * @param dailyCandle 日K数据
 * @param intervalsPerDay 每天生成的分时数据点数（默认390，美股交易分钟数）
 * @returns 模拟的分时价格序列
 */
export function simulateIntradayPrices(
  dailyCandle: DailyCandlestick,
  intervalsPerDay: number = 390
): SimulatedIntradayPrice[] {
  const { open, high, low, close, volume } = dailyCandle;
  
  // 验证数据有效性
  if (high < low || open <= 0 || close <= 0) {
    logger.warn(`[市场模拟] 数据异常，跳过模拟: open=${open}, high=${high}, low=${low}, close=${close}`);
    return [];
  }

  const simulatedPrices: SimulatedIntradayPrice[] = [];
  const date = new Date(dailyCandle.timestamp);
  
  // 计算每分钟的成交量（平均分配）
  const volumePerInterval = volume / intervalsPerDay;

  // 线性插值：从开盘价到收盘价
  for (let i = 0; i < intervalsPerDay; i++) {
    const progress = i / (intervalsPerDay - 1);  // 0到1的进度
    
    // 线性插值：open + (close - open) * progress
    let price = open + (close - open) * progress;
    
    // 确保价格在最高价和最低价范围内
    price = Math.max(low, Math.min(high, price));
    
    // 计算时间戳（假设交易时间从9:30开始，到16:00结束）
    const minutesFromStart = Math.floor(i * (390 / intervalsPerDay));
    const hours = 9 + Math.floor(minutesFromStart / 60);
    const minutes = minutesFromStart % 60;
    const timestamp = new Date(date);
    timestamp.setHours(hours, minutes, 0, 0);
    
    simulatedPrices.push({
      timestamp,
      price,
      volume: volumePerInterval,
    });
  }

  return simulatedPrices;
}

/**
 * 批量模拟多天的分时价格序列
 * @param dailyCandles 多天的日K数据
 * @param intervalsPerDay 每天生成的分时数据点数
 * @returns 模拟的分时价格序列（按时间排序）
 */
export function simulateMultipleDaysIntradayPrices(
  dailyCandles: DailyCandlestick[],
  intervalsPerDay: number = 390
): SimulatedIntradayPrice[] {
  const allPrices: SimulatedIntradayPrice[] = [];

  for (const candle of dailyCandles) {
    const intradayPrices = simulateIntradayPrices(candle, intervalsPerDay);
    allPrices.push(...intradayPrices);
  }

  // 按时间排序
  allPrices.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return allPrices;
}

/**
 * 使用日K数据模拟市场环境（简化版）
 * 返回当日的关键价格点：开盘、最高、最低、收盘
 * @param dailyCandle 日K数据
 * @returns 关键价格点
 */
export function simulateMarketEnvironment(dailyCandle: DailyCandlestick): {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: Date;
} {
  return {
    open: dailyCandle.open,
    high: dailyCandle.high,
    low: dailyCandle.low,
    close: dailyCandle.close,
    timestamp: dailyCandle.timestamp,
  };
}

/**
 * 验证模拟数据的合理性
 * @param simulatedPrices 模拟的分时价格序列
 * @param dailyCandle 原始日K数据
 * @returns 验证结果
 */
export function validateSimulatedPrices(
  simulatedPrices: SimulatedIntradayPrice[],
  dailyCandle: DailyCandlestick
): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (simulatedPrices.length === 0) {
    errors.push('模拟数据为空');
    return { isValid: false, errors };
  }

  // 检查价格范围
  const prices = simulatedPrices.map(p => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  if (minPrice < dailyCandle.low) {
    errors.push(`模拟最低价 ${minPrice} 低于日K最低价 ${dailyCandle.low}`);
  }

  if (maxPrice > dailyCandle.high) {
    errors.push(`模拟最高价 ${maxPrice} 高于日K最高价 ${dailyCandle.high}`);
  }

  // 检查开盘价和收盘价
  const firstPrice = simulatedPrices[0].price;
  const lastPrice = simulatedPrices[simulatedPrices.length - 1].price;

  if (Math.abs(firstPrice - dailyCandle.open) > 0.01) {
    errors.push(`模拟开盘价 ${firstPrice} 与日K开盘价 ${dailyCandle.open} 不一致`);
  }

  if (Math.abs(lastPrice - dailyCandle.close) > 0.01) {
    errors.push(`模拟收盘价 ${lastPrice} 与日K收盘价 ${dailyCandle.close} 不一致`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

