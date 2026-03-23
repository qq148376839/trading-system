/**
 * Market session helpers for strategy constraints:
 * - no new entries before close (N minutes)
 * - force close before close (M minutes)
 *
 * We rely on `trading-session.service.ts` which fetches market-local trading
 * sessions from Longbridge and already handles DST via IANA time zones.
 *
 * Timezone functions delegated to unified module `utils/market-time.ts` (规则 #17).
 */
import tradingSessionService, { TradeSessionType } from './trading-session.service';
import { getMarketTimeZone, getMarketLocalDate, zonedTimeToUtc } from '../utils/market-time';

export interface MarketCloseWindow {
  market: 'US' | 'HK' | 'SH' | 'SZ';
  closeLocalHHMM: number; // e.g. 1600 or 1300 (half day)
  closeTimeUtc: Date;
  noNewEntryTimeUtc: Date;
  forceCloseTimeUtc: Date;
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
  const { year, month, day } = getMarketLocalDate(now, market);
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
