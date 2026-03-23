/**
 * Unified timezone module for the trading system.
 *
 * All market-local conversions use `Intl.DateTimeFormat.formatToParts()` — the
 * gold-standard approach that correctly handles DST transitions without
 * parsing `toLocaleString()` strings.
 *
 * Re-exports a canonical `MarketType` so callers no longer need to define their
 * own ad-hoc market string unions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketType = 'US' | 'HK' | 'SH' | 'SZ' | 'CN';

// ---------------------------------------------------------------------------
// Timezone mapping
// ---------------------------------------------------------------------------

/**
 * Returns the IANA timezone identifier for a given market.
 *
 * - US  → America/New_York
 * - HK  → Asia/Hong_Kong
 * - SH / SZ / CN → Asia/Shanghai
 * - fallback → UTC
 */
export function getMarketTimeZone(market: MarketType): string {
  switch (market) {
    case 'US':
      return 'America/New_York';
    case 'HK':
      return 'Asia/Hong_Kong';
    case 'SH':
    case 'SZ':
    case 'CN':
      return 'Asia/Shanghai';
    default:
      return 'UTC';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a parts map from Intl.DateTimeFormat.formatToParts(). */
function buildPartsMap(
  parts: Intl.DateTimeFormatPart[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

/**
 * Extracts year / month / day in the market's local timezone.
 */
export function getMarketLocalDate(
  date: Date,
  market: MarketType,
): { year: number; month: number; day: number } {
  const timeZone = getMarketTimeZone(market);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const map = buildPartsMap(dtf.formatToParts(date));
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
  };
}

// ---------------------------------------------------------------------------
// Time extraction
// ---------------------------------------------------------------------------

/**
 * Extracts hour / minute / second in the market's local timezone.
 */
export function getMarketLocalTime(
  date: Date,
  market: MarketType,
): { hour: number; minute: number; second: number } {
  const timeZone = getMarketTimeZone(market);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = buildPartsMap(dtf.formatToParts(date));
  return {
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
  };
}

// ---------------------------------------------------------------------------
// Day of week
// ---------------------------------------------------------------------------

/**
 * Returns the day of the week (0 = Sunday, 6 = Saturday) in the market's
 * local timezone.
 *
 * Uses Intl.DateTimeFormat with `weekday: 'short'` and maps the English
 * abbreviation to a numeric value.
 */
export function getMarketLocalDayOfWeek(
  date: Date,
  market: MarketType,
): number {
  const timeZone = getMarketTimeZone(market);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  });
  const weekday = dtf.format(date);

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return dayMap[weekday] ?? 0;
}

// ---------------------------------------------------------------------------
// Weekend check
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the given date falls on a Saturday or Sunday in the
 * market's local timezone.
 */
export function isWeekend(date: Date, market: MarketType): boolean {
  const dow = getMarketLocalDayOfWeek(date, market);
  return dow === 0 || dow === 6;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Formats a Date as `YYYYMMDD` in the market's local timezone.
 *
 * Example: `'20260323'`
 */
export function formatAsYYYYMMDD(date: Date, market: MarketType): string {
  const { year, month, day } = getMarketLocalDate(date, market);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}${mm}${dd}`;
}

// ---------------------------------------------------------------------------
// Zoned → UTC conversion (iterative convergence)
// ---------------------------------------------------------------------------

/**
 * Converts a market-local datetime (year-month-day hour:minute in a given IANA
 * timezone) to a UTC `Date`.
 *
 * Implementation uses iterative convergence via `Intl.DateTimeFormat.formatToParts()`
 * to reliably handle DST transitions.  Copied from the gold-standard implementation
 * in `market-session.service.ts`.
 */
export function zonedTimeToUtc(params: {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;
  minute: number;
  timeZone: string;
}): Date {
  const { year, month, day, hour, minute, timeZone } = params;

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const desiredAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = new Date(desiredAsUtcMs);

  const getParts = (
    d: Date,
  ): { year: number; month: number; day: number; hour: number; minute: number } => {
    const map = buildPartsMap(dtf.formatToParts(d));
    return {
      year: parseInt(map.year, 10),
      month: parseInt(map.month, 10),
      day: parseInt(map.day, 10),
      hour: parseInt(map.hour, 10),
      minute: parseInt(map.minute, 10),
    };
  };

  // Iterate to converge (handles DST offsets reliably)
  for (let i = 0; i < 3; i++) {
    const actual = getParts(guess);
    const actualAsUtcMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0,
      0,
    );
    const diffMs = desiredAsUtcMs - actualAsUtcMs;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }

  return guess;
}

// ---------------------------------------------------------------------------
// Alias for Longbridge NaiveDate construction
// ---------------------------------------------------------------------------

/**
 * Alias for `getMarketLocalDate` — specifically intended for constructing
 * Longbridge `NaiveDate` objects from a UTC `Date`.
 *
 * Usage:
 * ```ts
 * const { year, month, day } = toNaiveDateParts(new Date(), 'US');
 * const naiveDate = new NaiveDate(year, month, day);
 * ```
 */
export function toNaiveDateParts(
  date: Date,
  market: MarketType,
): { year: number; month: number; day: number } {
  return getMarketLocalDate(date, market);
}
