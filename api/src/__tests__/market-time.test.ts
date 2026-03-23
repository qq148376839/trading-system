/**
 * market-time.ts 单元测试
 *
 * 覆盖:
 * 1. getMarketTimeZone — 各市场映射 + 未知市场回退
 * 2. getMarketLocalDate / getMarketLocalTime — 跨时区日期/时间提取
 * 3. getMarketLocalDayOfWeek — 跨时区星期几
 * 4. isWeekend — 跨时区周末判定（关键 bug 修复验证）
 * 5. formatAsYYYYMMDD — 跨日边界格式化
 * 6. zonedTimeToUtc — DST 正确性（EDT vs EST）
 * 7. toNaiveDateParts — 与 getMarketLocalDate 一致性
 */

import {
  getMarketTimeZone,
  getMarketLocalDate,
  getMarketLocalTime,
  getMarketLocalDayOfWeek,
  isWeekend,
  formatAsYYYYMMDD,
  zonedTimeToUtc,
  toNaiveDateParts,
  MarketType,
} from '../utils/market-time';

// ---------------------------------------------------------------------------
// 1. getMarketTimeZone
// ---------------------------------------------------------------------------

describe('getMarketTimeZone', () => {
  it('应该返回 US 市场对应 America/New_York', () => {
    expect(getMarketTimeZone('US')).toBe('America/New_York');
  });

  it('应该返回 HK 市场对应 Asia/Hong_Kong', () => {
    expect(getMarketTimeZone('HK')).toBe('Asia/Hong_Kong');
  });

  it('应该返回 SH 市场对应 Asia/Shanghai', () => {
    expect(getMarketTimeZone('SH')).toBe('Asia/Shanghai');
  });

  it('应该返回 SZ 市场对应 Asia/Shanghai', () => {
    expect(getMarketTimeZone('SZ')).toBe('Asia/Shanghai');
  });

  it('应该返回 CN 市场对应 Asia/Shanghai', () => {
    expect(getMarketTimeZone('CN')).toBe('Asia/Shanghai');
  });

  it('应该对未知市场回退到 UTC', () => {
    // 强制传入未定义的市场类型来测试 fallback
    expect(getMarketTimeZone('XX' as MarketType)).toBe('UTC');
  });
});

// ---------------------------------------------------------------------------
// 2. getMarketLocalDate — 跨时区日期提取
// ---------------------------------------------------------------------------

describe('getMarketLocalDate', () => {
  it('应该在 UTC 周五 23:00 时返回上海的次日日期 (周六)', () => {
    // UTC 2026-03-20 23:00 => Shanghai 2026-03-21 07:00 (UTC+8)
    const date = new Date('2026-03-20T23:00:00Z');
    const result = getMarketLocalDate(date, 'SH');
    expect(result).toEqual({ year: 2026, month: 3, day: 21 });
  });

  it('应该在 UTC 周五 23:00 时返回纽约当天日期 (周五)', () => {
    // UTC 2026-03-20 23:00 => New York 2026-03-20 19:00 EDT (UTC-4, March DST active)
    const date = new Date('2026-03-20T23:00:00Z');
    const result = getMarketLocalDate(date, 'US');
    expect(result).toEqual({ year: 2026, month: 3, day: 20 });
  });

  it('应该正确处理年末跨年边界', () => {
    // UTC 2025-12-31 23:30 => Shanghai 2026-01-01 07:30
    const date = new Date('2025-12-31T23:30:00Z');
    const result = getMarketLocalDate(date, 'SH');
    expect(result).toEqual({ year: 2026, month: 1, day: 1 });
  });
});

// ---------------------------------------------------------------------------
// 3. getMarketLocalTime — 跨时区时间提取
// ---------------------------------------------------------------------------

describe('getMarketLocalTime', () => {
  it('应该正确提取上海本地时间', () => {
    // UTC 2026-03-20 01:30:45 => Shanghai 09:30:45
    const date = new Date('2026-03-20T01:30:45Z');
    const result = getMarketLocalTime(date, 'SH');
    expect(result).toEqual({ hour: 9, minute: 30, second: 45 });
  });

  it('应该在 EDT 期间正确提取纽约本地时间', () => {
    // UTC 2026-03-20 13:30:00 => New York 09:30:00 EDT (UTC-4)
    const date = new Date('2026-03-20T13:30:00Z');
    const result = getMarketLocalTime(date, 'US');
    expect(result).toEqual({ hour: 9, minute: 30, second: 0 });
  });

  it('应该在 EST 期间正确提取纽约本地时间', () => {
    // UTC 2026-01-15 14:30:00 => New York 09:30:00 EST (UTC-5)
    const date = new Date('2026-01-15T14:30:00Z');
    const result = getMarketLocalTime(date, 'US');
    expect(result).toEqual({ hour: 9, minute: 30, second: 0 });
  });

  it('应该正确提取香港本地时间', () => {
    // UTC 2026-03-20 01:30:00 => Hong Kong 09:30:00 (UTC+8)
    const date = new Date('2026-03-20T01:30:00Z');
    const result = getMarketLocalTime(date, 'HK');
    expect(result).toEqual({ hour: 9, minute: 30, second: 0 });
  });
});

// ---------------------------------------------------------------------------
// 4. getMarketLocalDayOfWeek — 跨时区星期几
// ---------------------------------------------------------------------------

describe('getMarketLocalDayOfWeek', () => {
  it('应该在 UTC 周五 23:00 返回上海的周六 (6)', () => {
    // UTC Friday 23:00 => Shanghai Saturday 07:00
    const date = new Date('2026-03-20T23:00:00Z');
    expect(getMarketLocalDayOfWeek(date, 'SH')).toBe(6); // Saturday
  });

  it('应该在 UTC 周六 01:00 返回纽约的周五 (5)', () => {
    // UTC Saturday 01:00 => New York Friday 20:00 EDT
    const date = new Date('2026-03-21T01:00:00Z');
    expect(getMarketLocalDayOfWeek(date, 'US')).toBe(5); // Friday
  });

  it('应该在 UTC 周六 05:00 返回纽约的周六 (6)', () => {
    // UTC Saturday 05:00 => New York Saturday 00:00 EDT (crossed midnight)
    // Actually 05:00 UTC - 4 = 01:00 Saturday EDT
    const date = new Date('2026-03-21T05:00:00Z');
    expect(getMarketLocalDayOfWeek(date, 'US')).toBe(6); // Saturday
  });

  it('应该在 UTC 周日 16:00 返回纽约的周日 (0)', () => {
    const date = new Date('2026-03-22T16:00:00Z');
    expect(getMarketLocalDayOfWeek(date, 'US')).toBe(0); // Sunday
  });

  it('应该正确返回周中工作日', () => {
    // 2026-03-18 is a Wednesday
    const date = new Date('2026-03-18T12:00:00Z');
    expect(getMarketLocalDayOfWeek(date, 'US')).toBe(3); // Wednesday
  });
});

// ---------------------------------------------------------------------------
// 5. isWeekend — 跨时区周末判定（关键 bug 修复验证）
// ---------------------------------------------------------------------------

describe('isWeekend', () => {
  describe('跨时区周末判定（核心 bug 修复）', () => {
    it('UTC 周五 23:00 对上海市场应该是周末（上海已经是周六 07:00）', () => {
      const date = new Date('2026-03-20T23:00:00Z');
      expect(isWeekend(date, 'SH')).toBe(true);
    });

    it('UTC 周六 01:00 对美国市场应该不是周末（纽约仍是周五 20:00 EDT）', () => {
      const date = new Date('2026-03-21T01:00:00Z');
      expect(isWeekend(date, 'US')).toBe(false);
    });

    it('UTC 周六 05:00 对美国市场应该是周末（纽约已是周六 01:00 EDT）', () => {
      const date = new Date('2026-03-21T05:00:00Z');
      expect(isWeekend(date, 'US')).toBe(true);
    });

    it('UTC 周日 16:00 对美国市场应该是周末（纽约是周日 12:00 EDT）', () => {
      const date = new Date('2026-03-22T16:00:00Z');
      expect(isWeekend(date, 'US')).toBe(true);
    });
  });

  describe('非周末场景', () => {
    it('UTC 周三正午对所有市场都不应该是周末', () => {
      const date = new Date('2026-03-18T12:00:00Z'); // Wednesday
      expect(isWeekend(date, 'US')).toBe(false);
      expect(isWeekend(date, 'HK')).toBe(false);
      expect(isWeekend(date, 'SH')).toBe(false);
    });

    it('UTC 周一凌晨对上海市场不应该是周末', () => {
      const date = new Date('2026-03-16T00:30:00Z'); // Monday UTC => Monday 08:30 Shanghai
      expect(isWeekend(date, 'SH')).toBe(false);
    });
  });

  describe('周日到周一边界', () => {
    it('UTC 周日 23:30 对上海市场不应该是周末（上海已是周一 07:30）', () => {
      const date = new Date('2026-03-22T23:30:00Z');
      expect(isWeekend(date, 'SH')).toBe(false);
    });

    it('UTC 周日 23:30 对美国市场应该是周末（纽约仍是周日 19:30 EDT）', () => {
      const date = new Date('2026-03-22T23:30:00Z');
      expect(isWeekend(date, 'US')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. formatAsYYYYMMDD — 跨日边界格式化
// ---------------------------------------------------------------------------

describe('formatAsYYYYMMDD', () => {
  it('UTC 23:30 对上海市场应该返回次日日期', () => {
    // UTC 2026-03-20 23:30 => Shanghai 2026-03-21 07:30
    const date = new Date('2026-03-20T23:30:00Z');
    expect(formatAsYYYYMMDD(date, 'SH')).toBe('20260321');
  });

  it('UTC 23:30 对美国市场应该返回当天日期', () => {
    // UTC 2026-03-20 23:30 => New York 2026-03-20 19:30 EDT
    const date = new Date('2026-03-20T23:30:00Z');
    expect(formatAsYYYYMMDD(date, 'US')).toBe('20260320');
  });

  it('应该正确补零处理单位数月/日', () => {
    // UTC 2026-01-05 01:00 => Shanghai 2026-01-05 09:00
    const date = new Date('2026-01-05T01:00:00Z');
    expect(formatAsYYYYMMDD(date, 'SH')).toBe('20260105');
  });

  it('应该正确处理跨年边界', () => {
    // UTC 2025-12-31 23:30 => Shanghai 2026-01-01 07:30
    const date = new Date('2025-12-31T23:30:00Z');
    expect(formatAsYYYYMMDD(date, 'SH')).toBe('20260101');
  });

  it('应该正确处理跨月边界', () => {
    // UTC 2026-02-28 23:30 => Shanghai 2026-03-01 07:30
    const date = new Date('2026-02-28T23:30:00Z');
    expect(formatAsYYYYMMDD(date, 'SH')).toBe('20260301');
  });

  it('应该对香港市场正确格式化', () => {
    const date = new Date('2026-03-20T23:30:00Z');
    // HK is also UTC+8 => 2026-03-21 07:30
    expect(formatAsYYYYMMDD(date, 'HK')).toBe('20260321');
  });
});

// ---------------------------------------------------------------------------
// 7. zonedTimeToUtc — DST 正确性
// ---------------------------------------------------------------------------

describe('zonedTimeToUtc', () => {
  describe('美东夏令时 (EDT, UTC-4)', () => {
    it('EDT 09:30 应该转换为 UTC 13:30', () => {
      // 2026-03-20 is during EDT (DST starts 2nd Sunday of March)
      const result = zonedTimeToUtc({
        year: 2026,
        month: 3,
        day: 20,
        hour: 9,
        minute: 30,
        timeZone: 'America/New_York',
      });
      expect(result.getUTCHours()).toBe(13);
      expect(result.getUTCMinutes()).toBe(30);
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(2); // 0-indexed: March = 2
      expect(result.getUTCDate()).toBe(20);
    });
  });

  describe('美东标准时 (EST, UTC-5)', () => {
    it('EST 09:30 应该转换为 UTC 14:30', () => {
      // 2026-01-15 is during EST
      const result = zonedTimeToUtc({
        year: 2026,
        month: 1,
        day: 15,
        hour: 9,
        minute: 30,
        timeZone: 'America/New_York',
      });
      expect(result.getUTCHours()).toBe(14);
      expect(result.getUTCMinutes()).toBe(30);
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(0); // January = 0
      expect(result.getUTCDate()).toBe(15);
    });
  });

  describe('上海时间 (UTC+8, 无 DST)', () => {
    it('上海 09:30 应该转换为 UTC 01:30', () => {
      const result = zonedTimeToUtc({
        year: 2026,
        month: 3,
        day: 20,
        hour: 9,
        minute: 30,
        timeZone: 'Asia/Shanghai',
      });
      expect(result.getUTCHours()).toBe(1);
      expect(result.getUTCMinutes()).toBe(30);
      expect(result.getUTCDate()).toBe(20);
    });
  });

  describe('香港时间 (UTC+8, 无 DST)', () => {
    it('香港 09:30 应该转换为 UTC 01:30', () => {
      const result = zonedTimeToUtc({
        year: 2026,
        month: 3,
        day: 20,
        hour: 9,
        minute: 30,
        timeZone: 'Asia/Hong_Kong',
      });
      expect(result.getUTCHours()).toBe(1);
      expect(result.getUTCMinutes()).toBe(30);
    });
  });

  describe('跨日转换', () => {
    it('上海 00:30 应该转换为前一天 UTC 16:30', () => {
      const result = zonedTimeToUtc({
        year: 2026,
        month: 3,
        day: 20,
        hour: 0,
        minute: 30,
        timeZone: 'Asia/Shanghai',
      });
      expect(result.getUTCHours()).toBe(16);
      expect(result.getUTCMinutes()).toBe(30);
      expect(result.getUTCDate()).toBe(19); // Previous day in UTC
    });
  });

  describe('午夜边界', () => {
    it('纽约 00:00 EDT 应该转换为 UTC 04:00', () => {
      const result = zonedTimeToUtc({
        year: 2026,
        month: 3,
        day: 20,
        hour: 0,
        minute: 0,
        timeZone: 'America/New_York',
      });
      expect(result.getUTCHours()).toBe(4);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCDate()).toBe(20);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. toNaiveDateParts — 与 getMarketLocalDate 一致性
// ---------------------------------------------------------------------------

describe('toNaiveDateParts', () => {
  const testCases: Array<{ utcIso: string; market: MarketType; label: string }> = [
    { utcIso: '2026-03-20T23:00:00Z', market: 'SH', label: 'UTC 周五晚 + 上海' },
    { utcIso: '2026-03-20T23:00:00Z', market: 'US', label: 'UTC 周五晚 + 美国' },
    { utcIso: '2026-03-21T01:00:00Z', market: 'HK', label: 'UTC 周六凌晨 + 香港' },
    { utcIso: '2026-01-15T14:30:00Z', market: 'US', label: 'EST 冬令时 + 美国' },
    { utcIso: '2025-12-31T23:30:00Z', market: 'SH', label: '跨年边界 + 上海' },
    { utcIso: '2026-06-15T04:00:00Z', market: 'US', label: 'EDT 夏令时 + 美国' },
  ];

  testCases.forEach(({ utcIso, market, label }) => {
    it(`应该与 getMarketLocalDate 返回相同结果: ${label}`, () => {
      const date = new Date(utcIso);
      const fromNaive = toNaiveDateParts(date, market);
      const fromLocal = getMarketLocalDate(date, market);
      expect(fromNaive).toEqual(fromLocal);
    });
  });

  it('应该返回正确的 year/month/day 结构', () => {
    const date = new Date('2026-03-20T01:30:00Z');
    const result = toNaiveDateParts(date, 'SH');
    expect(result).toHaveProperty('year');
    expect(result).toHaveProperty('month');
    expect(result).toHaveProperty('day');
    expect(typeof result.year).toBe('number');
    expect(typeof result.month).toBe('number');
    expect(typeof result.day).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 9. zonedTimeToUtc 与 getMarketLocalTime 往返一致性
// ---------------------------------------------------------------------------

describe('zonedTimeToUtc + getMarketLocalTime 往返一致性', () => {
  it('上海 09:30 => UTC => 反向提取应该仍是 09:30', () => {
    const utcDate = zonedTimeToUtc({
      year: 2026,
      month: 3,
      day: 20,
      hour: 9,
      minute: 30,
      timeZone: 'Asia/Shanghai',
    });
    const localTime = getMarketLocalTime(utcDate, 'SH');
    expect(localTime.hour).toBe(9);
    expect(localTime.minute).toBe(30);
  });

  it('纽约 EDT 09:30 => UTC => 反向提取应该仍是 09:30', () => {
    const utcDate = zonedTimeToUtc({
      year: 2026,
      month: 3,
      day: 20,
      hour: 9,
      minute: 30,
      timeZone: 'America/New_York',
    });
    const localTime = getMarketLocalTime(utcDate, 'US');
    expect(localTime.hour).toBe(9);
    expect(localTime.minute).toBe(30);
  });

  it('纽约 EST 09:30 => UTC => 反向提取应该仍是 09:30', () => {
    const utcDate = zonedTimeToUtc({
      year: 2026,
      month: 1,
      day: 15,
      hour: 9,
      minute: 30,
      timeZone: 'America/New_York',
    });
    const localTime = getMarketLocalTime(utcDate, 'US');
    expect(localTime.hour).toBe(9);
    expect(localTime.minute).toBe(30);
  });

  it('zonedTimeToUtc 日期部分也应该往返一致', () => {
    const utcDate = zonedTimeToUtc({
      year: 2026,
      month: 3,
      day: 20,
      hour: 9,
      minute: 30,
      timeZone: 'Asia/Shanghai',
    });
    const localDate = getMarketLocalDate(utcDate, 'SH');
    expect(localDate).toEqual({ year: 2026, month: 3, day: 20 });
  });
});
