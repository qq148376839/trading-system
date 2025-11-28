/**
 * 美股交易时间工具函数
 * 用于判断当前是否在美股交易时间，以及计算智能缓存时长
 * 
 * 美股交易时间（美东时间）：
 * - 常规交易时间：9:30 AM - 4:00 PM
 * - 盘前交易时间：4:00 AM - 9:30 AM
 * - 盘后交易时间：4:00 PM - 8:00 PM
 * 
 * 对应北京时间（冬令时，UTC-5）：
 * - 常规交易时间：22:30 - 次日5:00
 * - 盘前交易时间：17:00 - 22:30
 * - 盘后交易时间：5:00 - 9:00
 * 
 * 对应北京时间（夏令时，UTC-4）：
 * - 常规交易时间：21:30 - 次日4:00
 * - 盘前交易时间：16:00 - 21:30
 * - 盘后交易时间：4:00 - 8:00
 */

/**
 * 判断当前是否在美股常规交易时间
 * @param date 可选，指定日期（默认当前时间）
 * @returns true表示在交易时间，false表示不在
 */
export function isTradingHours(date?: Date): boolean {
  const now = date || new Date();
  const { hour, minute } = getETTime(now);
  const timeInMinutes = hour * 60 + minute;
  
  // 常规交易时间：9:30 AM - 4:00 PM (美东时间)
  const marketOpen = 9 * 60 + 30; // 9:30 AM
  const marketClose = 16 * 60; // 4:00 PM
  
  // 检查是否在交易时间内
  return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
}

/**
 * 判断当前是否在美股盘前交易时间
 * @param date 可选，指定日期（默认当前时间）
 * @returns true表示在盘前交易时间
 */
export function isPreMarketHours(date?: Date): boolean {
  const now = date || new Date();
  const { hour, minute } = getETTime(now);
  const timeInMinutes = hour * 60 + minute;
  
  // 盘前交易时间：4:00 AM - 9:30 AM (美东时间)
  const preMarketOpen = 4 * 60; // 4:00 AM
  const marketOpen = 9 * 60 + 30; // 9:30 AM
  
  return timeInMinutes >= preMarketOpen && timeInMinutes < marketOpen;
}

/**
 * 判断当前是否在美股盘后交易时间
 * @param date 可选，指定日期（默认当前时间）
 * @returns true表示在盘后交易时间
 */
export function isAfterHours(date?: Date): boolean {
  const now = date || new Date();
  const { hour, minute } = getETTime(now);
  const timeInMinutes = hour * 60 + minute;
  
  // 盘后交易时间：4:00 PM - 8:00 PM (美东时间)
  const marketClose = 16 * 60; // 4:00 PM
  const afterHoursClose = 20 * 60; // 8:00 PM
  
  return timeInMinutes >= marketClose && timeInMinutes < afterHoursClose;
}

/**
 * 判断当前是否在交易日的开盘前30分钟内
 * @param date 可选，指定日期（默认当前时间）
 * @returns true表示在开盘前30分钟内
 */
export function isBeforeMarketOpen30Min(date?: Date): boolean {
  const now = date || new Date();
  const { hour, minute } = getETTime(now);
  const timeInMinutes = hour * 60 + minute;
  
  // 开盘前30分钟：9:00 AM - 9:30 AM (美东时间)
  const marketOpen30MinBefore = 9 * 60; // 9:00 AM
  const marketOpen = 9 * 60 + 30; // 9:30 AM
  
  return timeInMinutes >= marketOpen30MinBefore && timeInMinutes < marketOpen;
}

/**
 * 判断当前是否在交易日的收盘后
 * @param date 可选，指定日期（默认当前时间）
 * @returns true表示在收盘后（包括盘后交易时间）
 */
export function isAfterMarketClose(date?: Date): boolean {
  const now = date || new Date();
  const { hour, minute } = getETTime(now);
  const timeInMinutes = hour * 60 + minute;
  
  // 收盘后：4:00 PM 之后 (美东时间)
  const marketClose = 16 * 60; // 4:00 PM
  
  return timeInMinutes >= marketClose;
}

/**
 * 判断当前是否在非交易时间（既不在常规交易时间，也不在盘前/盘后）
 * @param date 可选，指定日期（默认当前时间）
 * @returns true表示在非交易时间
 */
export function isNonTradingHours(date?: Date): boolean {
  return !isTradingHours(date) && !isPreMarketHours(date) && !isAfterHours(date);
}

/**
 * 获取美东时间的小时和分钟
 * 使用Intl API自动处理夏令时
 * @param date 要转换的日期
 * @returns 包含小时和分钟的对象
 */
function getETTime(date: Date): { hour: number; minute: number } {
  // 使用Intl API获取美东时间
  const etHour = parseInt(date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }));
  
  const etMinute = parseInt(date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    minute: 'numeric',
  }));
  
  return { hour: etHour, minute: etMinute };
}

/**
 * 获取当前应该使用的缓存时长（秒）
 * 根据交易时间动态调整
 * @param date 可选，指定日期（默认当前时间）
 * @returns 缓存时长（秒）
 */
export function getCacheDuration(date?: Date): number {
  const now = date || new Date();
  
  // 开盘前30分钟：30秒（更频繁更新）
  if (isBeforeMarketOpen30Min(now)) {
    return 30;
  }
  
  // 交易时间：60秒（平衡性能和实时性）
  if (isTradingHours(now)) {
    return 60;
  }
  
  // 收盘后：300秒（5分钟，数据更新频率低）
  if (isAfterMarketClose(now)) {
    return 300;
  }
  
  // 非交易时间：600秒（10分钟）
  return 600;
}

