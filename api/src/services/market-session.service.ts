/**
 * Market session helpers for strategy constraints:
 * - no new entries before close (N minutes)
 * - force close before close (M minutes)
 *
 * We rely on `trading-session.service.ts` which fetches market-local trading
 * sessions from Longbridge and already handles DST via IANA time zones.
 */
import tradingSessionService, { TradeSessionType } from './trading-session.service';

export interface MarketCloseWindow {
  market: 'US' | 'HK' | 'SH' | 'SZ';
  closeLocalHHMM: number; // e.g. 1600 or 1300 (half day)
  closeTimeUtc: Date;
  noNewEntryTimeUtc: Date;
  forceCloseTimeUtc: Date;
}

function getMarketTimeZone(market: 'US' | 'HK' | 'SH' | 'SZ'): string {
  if (market === 'US') return 'America/New_York';
  if (market === 'HK') return 'Asia/Hong_Kong';
  return 'Asia/Shanghai';
}

/**
 * Convert a market-local datetime (Y-M-D H:M in that market timezone) to UTC Date.
 * Uses Intl.DateTimeFormat().formatToParts() with iterative correction.
 *
 * NOTE:
 * Avoid parsing `toLocaleString()` back into Date; that depends on host locale/timezone.
 */
function zonedTimeToUtc(params: {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
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

  const getParts = (d: Date): { year: number; month: number; day: number; hour: number; minute: number } => {
    const parts = dtf.formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
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
    const actualAsUtcMs = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const diffMs = desiredAsUtcMs - actualAsUtcMs;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }

  return guess;
}

function getLocalYMD(dateUtc: Date, timeZone: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = dtf.formatToParts(dateUtc);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
  };
}

export async function getMarketCloseWindow(params: {
  market: 'US' | 'HK' | 'SH' | 'SZ';
  now?: Date;
  noNewEntryBeforeCloseMinutes: number;
  forceCloseBeforeCloseMinutes: number;
}): Promise<MarketCloseWindow | null> {
  const now = params.now ?? new Date();
  const market = params.market;

  const sessions = await tradingSessionService.getMarketTradingSessions(market);
  if (!sessions || sessions.length === 0) return null;

  // Prefer regular (RTH) session end time; if sessionType is absent, treat as regular.
  const regular = sessions.find((s) => s.tradeSession === undefined || s.tradeSession === TradeSessionType.REGULAR)
    || sessions[0];

  const closeLocalHHMM = regular.endTime;
  const closeHour = Math.floor(closeLocalHHMM / 100);
  const closeMinute = closeLocalHHMM % 100;

  const timeZone = getMarketTimeZone(market);
  const { year, month, day } = getLocalYMD(now, timeZone);
  const closeTimeUtc = zonedTimeToUtc({ year, month, day, hour: closeHour, minute: closeMinute, timeZone });

  const noNewEntryTimeUtc = new Date(closeTimeUtc.getTime() - params.noNewEntryBeforeCloseMinutes * 60_000);
  const forceCloseTimeUtc = new Date(closeTimeUtc.getTime() - params.forceCloseBeforeCloseMinutes * 60_000);

  return {
    market,
    closeLocalHHMM,
    closeTimeUtc,
    noNewEntryTimeUtc,
    forceCloseTimeUtc,
  };
}

