/**
 * K线数据格式转换工具
 * 统一处理Longbridge和Moomoo API返回的数据格式
 * 
 * 根据实际API返回数据确认：
 * - Longbridge API返回timestamp是秒级时间戳（number类型）
 * - Longbridge API返回open/high/low/close是字符串类型
 * - Longbridge API返回turnover是字符串类型
 * - Longbridge API返回volume是number类型
 */

export interface StandardCandlestickData {
  timestamp: number;  // 毫秒时间戳
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export interface BacktestCandlestickData {
  timestamp: Date;    // Date对象（回测服务使用）
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;  // 可选
}

/**
 * 转换Longbridge API返回的K线数据为标准格式（毫秒时间戳）
 * @param c Longbridge API返回的K线数据
 * @returns 标准格式的K线数据（timestamp为毫秒时间戳）
 */
export function formatLongbridgeCandlestick(c: any): StandardCandlestickData {
  // timestamp处理：Longbridge返回的是秒级时间戳（如1650384000）
  let timestamp: number;
  if (c.timestamp instanceof Date) {
    timestamp = c.timestamp.getTime();
  } else if (typeof c.timestamp === 'number') {
    // 判断是秒级还是毫秒级（如果小于1e10则是秒级）
    timestamp = c.timestamp < 1e10 ? c.timestamp * 1000 : c.timestamp;
  } else {
    timestamp = new Date(c.timestamp).getTime();
  }
  
  return {
    timestamp,
    open: typeof c.open === 'number' ? c.open : parseFloat(String(c.open || 0)),
    high: typeof c.high === 'number' ? c.high : parseFloat(String(c.high || 0)),
    low: typeof c.low === 'number' ? c.low : parseFloat(String(c.low || 0)),
    close: typeof c.close === 'number' ? c.close : parseFloat(String(c.close || 0)),
    volume: typeof c.volume === 'number' ? c.volume : parseFloat(String(c.volume || 0)),
    turnover: typeof c.turnover === 'number' ? c.turnover : parseFloat(String(c.turnover || 0)),
  };
}

/**
 * 转换Longbridge API返回的K线数据为回测格式（Date对象）
 * @param c Longbridge API返回的K线数据
 * @returns 回测格式的K线数据（timestamp为Date对象）
 */
export function formatLongbridgeCandlestickForBacktest(c: any): BacktestCandlestickData {
  const standard = formatLongbridgeCandlestick(c);
  return {
    timestamp: new Date(standard.timestamp),
    open: standard.open,
    high: standard.high,
    low: standard.low,
    close: standard.close,
    volume: standard.volume,
    turnover: standard.turnover,
  };
}

/**
 * 时间戳转换工具：将时间戳转换为毫秒时间戳
 * @param timestamp 时间戳（可能是秒级或毫秒级）
 * @returns 毫秒时间戳
 */
export function toMilliseconds(timestamp: number | Date): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  
  // 判断是秒级还是毫秒级（如果小于1e10则是秒级）
  return timestamp < 1e10 ? timestamp * 1000 : timestamp;
}

/**
 * 时间戳转换工具：将时间戳转换为Date对象
 * @param timestamp 时间戳（可能是秒级或毫秒级）
 * @returns Date对象
 */
export function toDate(timestamp: number | Date): Date {
  if (timestamp instanceof Date) {
    return timestamp;
  }
  
  return new Date(toMilliseconds(timestamp));
}

/**
 * 转换Moomoo API返回的K线数据为回测格式（Date对象）
 * @param c Moomoo API返回的K线数据（CandlestickData格式，timestamp为毫秒时间戳）
 * @returns 回测格式的K线数据（timestamp为Date对象）
 */
export function formatMoomooCandlestickForBacktest(c: any): BacktestCandlestickData {
  // Moomoo数据已经是标准格式（timestamp为毫秒时间戳）
  return {
    timestamp: new Date(c.timestamp),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    turnover: c.turnover || 0,  // Moomoo不提供turnover，设为0
  };
}

