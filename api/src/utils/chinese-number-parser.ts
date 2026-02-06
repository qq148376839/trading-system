/**
 * 中文数字解析工具
 * 用于将moomoo API返回的中文格式数字转换为数字
 *
 * 示例：
 * - "15.29亿" -> 1529000000
 * - "+51.22万" -> 512200
 * - "-23.37万" -> -233700
 */

import { logger } from './logger';

/**
 * 解析中文格式的数字
 * @param str 中文格式的数字字符串，如 "15.29亿"、"+51.22万"、"-23.37万"
 * @returns 转换后的数字，如果解析失败返回0
 */
export function parseChineseNumber(str: string): number {
  if (!str || typeof str !== 'string') {
    return 0;
  }

  // 移除空格
  const trimmed = str.trim();
  if (!trimmed) {
    return 0;
  }

  // 匹配格式：([+-]?)(\d+\.?\d*)([万亿千万]+)
  // 示例：+15.29亿 -> sign: +, num: 15.29, unit: 亿
  const match = trimmed.match(/^([+-]?)(\d+\.?\d*)([万亿千万]+)$/);
  
  if (!match) {
    // 尝试匹配纯数字（可能已经是数字格式）
    const numMatch = trimmed.match(/^([+-]?)(\d+\.?\d*)$/);
    if (numMatch) {
      return parseFloat(trimmed) || 0;
    }
    
    logger.warn(`[中文数字解析] 无法解析格式: ${str}`);
    return 0;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const num = parseFloat(match[2]);
  const unit = match[3];

  if (isNaN(num)) {
    logger.warn(`[中文数字解析] 数字部分无效: ${str}`);
    return 0;
  }

  // 计算倍数
  let multiplier = 1;
  if (unit.includes('亿')) {
    multiplier = 100000000;
  } else if (unit.includes('千万')) {
    multiplier = 10000000;
  } else if (unit.includes('万')) {
    multiplier = 10000;
  } else if (unit.includes('千')) {
    multiplier = 1000;
  }

  const result = sign * num * multiplier;
  
  // 调试日志（可选，生产环境可关闭）
  if (process.env.NODE_ENV === 'development') {
    logger.debug(`[中文数字解析] ${str} -> ${result}`);
  }

  return result;
}

/**
 * 批量解析中文格式的数字
 * @param strs 中文格式的数字字符串数组
 * @returns 转换后的数字数组
 */
export function parseChineseNumbers(strs: string[]): number[] {
  return strs.map(parseChineseNumber);
}

/**
 * 格式化数字为中文（可选，用于显示）
 * @param num 数字
 * @returns 中文格式字符串，如 "15.29亿"
 */
export function formatToChineseNumber(num: number): string {
  if (num === 0) return '0';
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  if (absNum >= 100000000) {
    return `${sign}${(absNum / 100000000).toFixed(2)}亿`;
  } else if (absNum >= 10000000) {
    return `${sign}${(absNum / 10000000).toFixed(2)}千万`;
  } else if (absNum >= 10000) {
    return `${sign}${(absNum / 10000).toFixed(2)}万`;
  } else {
    return `${sign}${absNum.toFixed(2)}`;
  }
}

