// Mock trading-session service before importing the module under test
jest.mock('../trading-session.service', () => ({
  __esModule: true,
  default: {
    getMarketTradingSessions: jest.fn(),
  },
  TradeSessionType: {
    REGULAR: 0,
    PRE_MARKET: 1,
    AFTER_HOURS: 2,
    NIGHT: 3,
  },
}));

import tradingSessionService from '../trading-session.service';
import { getMarketCloseWindow } from '../market-session.service';

describe('market-session.service', () => {
  const mockGetSessions = (tradingSessionService as any).getMarketTradingSessions as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSessions.mockReset();
  });

  it('computes US close window for regular day (16:00 ET)', async () => {
    mockGetSessions.mockResolvedValueOnce([
      { begTime: 930, endTime: 1600, tradeSession: 0 },
    ]);

    // 2026-01-15 is winter time in NY (EST, UTC-5)
    const now = new Date('2026-01-15T15:00:00.000Z'); // 10:00 ET
    const window = await getMarketCloseWindow({
      market: 'US',
      now,
      noNewEntryBeforeCloseMinutes: 60,
      forceCloseBeforeCloseMinutes: 30,
    });

    expect(window).not.toBeNull();
    expect(window!.closeLocalHHMM).toBe(1600);
    expect(window!.closeTimeUtc.toISOString()).toBe('2026-01-15T21:00:00.000Z');
    expect(window!.noNewEntryTimeUtc.toISOString()).toBe('2026-01-15T20:00:00.000Z');
    expect(window!.forceCloseTimeUtc.toISOString()).toBe('2026-01-15T20:30:00.000Z');
  });

  it('computes US close window for half day (13:00 ET)', async () => {
    mockGetSessions.mockResolvedValueOnce([
      { begTime: 930, endTime: 1300, tradeSession: 0 },
    ]);

    const now = new Date('2026-01-15T15:00:00.000Z');
    const window = await getMarketCloseWindow({
      market: 'US',
      now,
      noNewEntryBeforeCloseMinutes: 60,
      forceCloseBeforeCloseMinutes: 30,
    });

    expect(window).not.toBeNull();
    expect(window!.closeLocalHHMM).toBe(1300);
    expect(window!.closeTimeUtc.toISOString()).toBe('2026-01-15T18:00:00.000Z');
    expect(window!.noNewEntryTimeUtc.toISOString()).toBe('2026-01-15T17:00:00.000Z');
    expect(window!.forceCloseTimeUtc.toISOString()).toBe('2026-01-15T17:30:00.000Z');
  });
});

