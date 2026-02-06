/**
 * Helpers for option symbol parsing/normalization.
 */

/**
 * Normalize Moomoo option code (e.g. TSLA260130C460000-US) to the internal Longbridge-like
 * symbol format used across this codebase (e.g. TSLA260130C460000.US).
 */
export function normalizeMoomooOptionCodeToSymbol(code: string): string {
  const trimmed = String(code || '').trim();
  if (!trimmed) return trimmed;

  // Common Moomoo suffix format: XXX-US -> XXX.US
  if (trimmed.endsWith('-US')) return `${trimmed.slice(0, -3)}.US`;
  if (trimmed.endsWith('-HK')) return `${trimmed.slice(0, -3)}.HK`;

  // Already normalized with .US/.HK suffix
  if (trimmed.endsWith('.US') || trimmed.endsWith('.HK')) return trimmed;

  // No suffix - check if it looks like an option symbol and add .US (default for US options)
  // Format: TICKER + YYMMDD + C/P + STRIKE (e.g., QQQ260129P631000)
  const optionPattern = /^[A-Z]+[0-9]{6}[CP][0-9]+$/;
  if (optionPattern.test(trimmed)) {
    return `${trimmed}.US`; // 默认添加.US后缀
  }

  // Unknown format, return as-is
  return trimmed;
}

/**
 * Get an underlying root from a Longbridge-style symbol.
 * - AAPL.US => AAPL
 * - .SPX.US => SPX
 */
export function getUnderlyingRoot(symbol: string): string {
  const s = String(symbol || '').trim().toUpperCase();
  const noRegion = s.replace(/\.(US|HK|SH|SZ)$/i, '');
  return noRegion.replace(/^\./, '');
}

/**
 * Common option roots for index underlyings where the option chain symbol root differs.
 * This is used for conservative matching of positions/orders to an underlying.
 */
const INDEX_OPTION_ROOT_ALIASES: Record<string, string[]> = {
  SPX: ['SPX', 'SPXW'],
  XSP: ['XSP'],
  NDX: ['NDX', 'NDXP'],
  NDXP: ['NDX', 'NDXP'],
  SPXW: ['SPX', 'SPXW'],
};

/**
 * Return plausible option symbol prefixes for an underlying symbol/root.
 */
export function getOptionPrefixesForUnderlying(underlyingSymbol: string): string[] {
  const root = getUnderlyingRoot(underlyingSymbol);
  const aliases = INDEX_OPTION_ROOT_ALIASES[root];
  if (aliases && aliases.length > 0) return aliases;
  return [root];
}

/**
 * Basic option symbol heuristic used for matching held positions.
 * Examples that should match:
 * - TSLA260130C460000.US
 * - SPXW260126P05000000.US
 */
export function isLikelyOptionSymbol(symbol: string): boolean {
  const s = String(symbol || '').trim().toUpperCase();
  // Strip region
  const core = s.replace(/\.(US|HK)$/i, '');
  // Prefix letters + YYMMDD + C/P + strike digits
  return /^[A-Z]+[0-9]{6}[CP][0-9]+$/.test(core);
}

/**
 * 解析期权symbol获取详细信息
 * 例如：QQQ260205P598000.US
 * - underlying: QQQ
 * - expirationDate: 2026-02-05
 * - optionType: PUT
 * - strikePrice: 598.00
 */
export interface ParsedOptionSymbol {
  underlying: string;
  expirationDate: string;      // YYYY-MM-DD 格式
  optionType: 'CALL' | 'PUT';
  strikePrice: number;
  market: string;              // US 或 HK
  rawSymbol: string;           // 原始symbol（不含市场后缀）
}

export function parseOptionSymbol(symbol: string): ParsedOptionSymbol | null {
  const s = String(symbol || '').trim().toUpperCase();

  // 提取市场后缀
  let market = 'US';
  let core = s;
  if (s.endsWith('.US')) {
    market = 'US';
    core = s.slice(0, -3);
  } else if (s.endsWith('.HK')) {
    market = 'HK';
    core = s.slice(0, -3);
  }

  // 匹配格式：TICKER + YYMMDD + C/P + STRIKE
  // 例如：QQQ260205P598000
  const match = core.match(/^([A-Z]+)([0-9]{6})([CP])([0-9]+)$/);
  if (!match) return null;

  const [, underlying, dateStr, typeChar, strikeStr] = match;

  // 解析日期：YYMMDD -> YYYY-MM-DD
  const year = parseInt(dateStr.slice(0, 2), 10) + 2000;
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  const expirationDate = `${year}-${month}-${day}`;

  // 解析期权类型
  const optionType = typeChar === 'C' ? 'CALL' : 'PUT';

  // 解析行权价：通常是实际价格 * 1000
  // 例如：598000 -> $598.00
  const strikePrice = parseInt(strikeStr, 10) / 1000;

  return {
    underlying,
    expirationDate,
    optionType,
    strikePrice,
    market,
    rawSymbol: core,
  };
}

