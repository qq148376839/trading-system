/**
 * 交易日判断工具
 * 判断指定日期是否为交易日（排除周末和节假日）
 * 
 * 注意：此文件提供同步版本的函数，用于快速判断。
 * 如果需要准确的交易日数据（包括节假日），请使用 trading-days.service.ts 中的异步方法。
 */

/**
 * 判断指定日期是否为交易日（同步版本，仅判断周末）
 * @param date 日期
 * @param market 市场类型（'US' | 'HK' | 'SH' | 'SZ'）
 * @returns 是否为交易日（仅排除周末，不包括节假日）
 * 
 * ⚠️ 注意：此函数仅判断周末，不包括节假日判断。
 * 如需准确的交易日判断（包括节假日），请使用 tradingDaysService.isTradingDay()
 */
export function isTradingDay(date: Date, market: 'US' | 'HK' | 'SH' | 'SZ' = 'US'): boolean {
  const dayOfWeek = date.getDay();
  
  // 周末不是交易日
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // ⚠️ 注意：此函数仅判断周末，不包括节假日判断
  // 如需准确的交易日判断（包括节假日），请使用 tradingDaysService.isTradingDay()
  // 参考: https://open.longbridge.com/zh-CN/docs/quote/pull/trade-day
  return true;
}

/**
 * 获取指定日期范围内的交易日列表（同步版本，仅排除周末）
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param market 市场类型
 * @returns 交易日列表（仅排除周末，不包括节假日）
 * 
 * ⚠️ 注意：此函数仅排除周末，不包括节假日判断。
 * 如需准确的交易日列表（包括节假日），请使用 tradingDaysService.getTradingDaysList()
 */
export function getTradingDays(
  startDate: Date,
  endDate: Date,
  market: 'US' | 'HK' | 'SH' | 'SZ' = 'US'
): Date[] {
  const tradingDays: Date[] = [];
  const current = new Date(startDate);
  
  while (current <= endDate) {
    if (isTradingDay(current, market)) {
      tradingDays.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }
  
  return tradingDays;
}

/**
 * 从symbol中提取市场类型
 * @param symbol Longbridge格式的symbol（如"700.HK", "AAPL.US"）
 * @returns 市场类型
 */
export function getMarketFromSymbol(symbol: string): 'US' | 'HK' | 'SH' | 'SZ' {
  const parts = symbol.split('.');
  if (parts.length !== 2) {
    return 'US';  // 默认美股
  }
  
  const market = parts[1].toUpperCase();
  if (market === 'HK') {
    return 'HK';
  } else if (market === 'SH') {
    return 'SH';
  } else if (market === 'SZ') {
    return 'SZ';
  }
  
  return 'US';  // 默认美股
}

/**
 * 检查日期是否为未来日期
 * @param date 日期
 * @returns 是否为未来日期
 */
export function isFutureDate(date: Date): boolean {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return date > today;
}

/**
 * 调整日期范围，确保只包含有效的交易日
 * - 排除周末
 * - 排除未来日期
 * - 调整到最近的交易日
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param market 市场类型
 * @returns 调整后的日期范围 { startDate, endDate }
 */
export function adjustDateRangeToTradingDays(
  startDate: Date,
  endDate: Date,
  market: 'US' | 'HK' | 'SH' | 'SZ' = 'US'
): { startDate: Date; endDate: Date } {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  // 如果结束日期是未来日期，调整为今天
  let adjustedEndDate = new Date(endDate);
  if (isFutureDate(adjustedEndDate)) {
    adjustedEndDate = new Date(today);
  }
  
  // 如果开始日期是未来日期，调整为今天
  let adjustedStartDate = new Date(startDate);
  if (isFutureDate(adjustedStartDate)) {
    adjustedStartDate = new Date(today);
  }
  
  // 确保开始日期不晚于结束日期
  if (adjustedStartDate > adjustedEndDate) {
    adjustedStartDate = new Date(adjustedEndDate);
  }
  
  // 调整开始日期到最近的交易日（向前查找）
  while (!isTradingDay(adjustedStartDate, market) && adjustedStartDate <= adjustedEndDate) {
    adjustedStartDate.setDate(adjustedStartDate.getDate() + 1);
  }
  
  // 调整结束日期到最近的交易日（向后查找）
  while (!isTradingDay(adjustedEndDate, market) && adjustedEndDate >= adjustedStartDate) {
    adjustedEndDate.setDate(adjustedEndDate.getDate() - 1);
  }
  
  // 如果调整后没有有效的交易日，返回空范围
  if (adjustedStartDate > adjustedEndDate || !isTradingDay(adjustedStartDate, market) || !isTradingDay(adjustedEndDate, market)) {
    // 如果无法找到有效的交易日范围，返回原始日期（让调用者处理）
    return { startDate: new Date(startDate), endDate: new Date(endDate) };
  }
  
  return {
    startDate: adjustedStartDate,
    endDate: adjustedEndDate
  };
}

/**
 * 验证日期范围是否有效
 * @param startDate 开始日期
 * @param endDate 结束日期
 * @param market 市场类型
 * @returns 验证结果 { valid: boolean, error?: string }
 */
export function validateDateRange(
  startDate: Date,
  endDate: Date,
  market: 'US' | 'HK' | 'SH' | 'SZ' = 'US'
): { valid: boolean; error?: string; adjustedRange?: { startDate: Date; endDate: Date } } {
  // 检查日期是否有效
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { valid: false, error: '日期格式无效' };
  }
  
  // 检查日期顺序
  if (startDate > endDate) {
    return { valid: false, error: '开始日期不能晚于结束日期' };
  }
  
  // 检查未来日期
  if (isFutureDate(startDate) && isFutureDate(endDate)) {
    return { valid: false, error: '日期范围不能全部是未来日期' };
  }
  
  // 调整日期范围
  const adjustedRange = adjustDateRangeToTradingDays(startDate, endDate, market);
  
  // 检查调整后的日期范围是否有效
  if (adjustedRange.startDate > adjustedRange.endDate) {
    return { valid: false, error: '调整后的日期范围内没有有效的交易日' };
  }
  
  // 检查是否有足够的交易日
  const tradingDays = getTradingDays(adjustedRange.startDate, adjustedRange.endDate, market);
  if (tradingDays.length === 0) {
    return { valid: false, error: '日期范围内没有交易日' };
  }
  
  return { valid: true, adjustedRange };
}

