/**
 * K线历史数据查询服务
 * 从 PostgreSQL 读取 SPX/USD_INDEX/BTC 的分钟级K线数据
 */

import pool from '../config/database';
import { logger } from '../utils/logger';

interface CandlestickData {
  close: number;
  open: number;
  low: number;
  high: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

class KlineHistoryService {
  /**
   * 查询历史分时数据（按毫秒时间戳范围）
   */
  async getIntradayData(
    source: string,
    startTs: number,
    endTs: number,
    period: string = '1m'
  ): Promise<CandlestickData[]> {
    const res = await pool.query(
      `SELECT open, high, low, close, volume, turnover, timestamp
       FROM market_kline_history
       WHERE source = $1 AND period = $2 AND timestamp BETWEEN $3 AND $4
       ORDER BY timestamp`,
      [source, period, startTs, endTs]
    );

    return res.rows.map(row => ({
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: parseFloat(row.volume),
      turnover: parseFloat(row.turnover),
      timestamp: parseInt(row.timestamp, 10),
    }));
  }

  /**
   * 按日期查询分时数据（美东时间范围）
   */
  async getIntradayByDate(
    source: string,
    date: string, // YYYY-MM-DD
    startTimeET: string = '04:00',
    endTimeET: string = '20:00'
  ): Promise<CandlestickData[]> {
    // 将美东时间转为 UTC 毫秒时间戳
    const startTs = this.etToMs(`${date}T${startTimeET}:00`);
    const endTs = this.etToMs(`${date}T${endTimeET}:00`);

    return this.getIntradayData(source, startTs, endTs);
  }

  /**
   * 检查数据可用性（按日统计）
   */
  async checkAvailability(
    source: string,
    startDate: string,
    endDate: string
  ): Promise<{
    source: string;
    dates: Array<{
      date: string;
      count: number;
      earliest: string;
      latest: string;
    }>;
    totalBars: number;
    daysWithData: number;
  }> {
    // 转换日期为毫秒时间戳范围（完整天）
    const startTs = this.etToMs(`${startDate}T00:00:00`);
    const endTs = this.etToMs(`${endDate}T23:59:59`);

    const res = await pool.query(
      `SELECT
         TO_CHAR(TO_TIMESTAMP(timestamp / 1000) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') as date,
         COUNT(*) as cnt,
         MIN(timestamp) as earliest,
         MAX(timestamp) as latest
       FROM market_kline_history
       WHERE source = $1 AND period = '1m' AND timestamp BETWEEN $2 AND $3
       GROUP BY date
       ORDER BY date`,
      [source, startTs, endTs]
    );

    const dates = res.rows.map(row => ({
      date: row.date,
      count: parseInt(row.cnt, 10),
      earliest: new Date(parseInt(row.earliest, 10)).toISOString(),
      latest: new Date(parseInt(row.latest, 10)).toISOString(),
    }));

    return {
      source,
      dates,
      totalBars: dates.reduce((sum, d) => sum + d.count, 0),
      daysWithData: dates.length,
    };
  }

  /**
   * 获取指定日期数据完整性
   */
  async getCompleteness(
    source: string,
    date: string
  ): Promise<{
    source: string;
    date: string;
    actualBars: number;
    expectedBars: number;
    coveragePct: number;
    earliestTime: string | null;
    latestTime: string | null;
  }> {
    const data = await this.getIntradayByDate(source, date);

    // 预期 bar 数量（根据数据源不同）
    // SPX 期货: ~23h/天 × 60 = ~1380 (周日-周五)
    // USD/BTC: ~24h × 60 = ~1440
    const expectedBars = source === 'SPX' ? 1380 : 1440;

    const earliestTs = data.length > 0 ? data[0].timestamp : null;
    const latestTs = data.length > 0 ? data[data.length - 1].timestamp : null;

    return {
      source,
      date,
      actualBars: data.length,
      expectedBars,
      coveragePct: Math.round((data.length / expectedBars) * 10000) / 100,
      earliestTime: earliestTs ? new Date(earliestTs).toISOString() : null,
      latestTime: latestTs ? new Date(latestTs).toISOString() : null,
    };
  }

  /**
   * 美东时间字符串转毫秒时间戳
   * @param etDatetime 格式: "YYYY-MM-DDThh:mm:ss"（美东时间）
   */
  private etToMs(etDatetime: string): number {
    // 构造带时区的 Date
    // 使用 Intl 反向解析：先创建 UTC，再调整偏移
    const date = new Date(etDatetime);
    // 获取美东时区偏移（自动处理夏令时）
    const etFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    // 使用更可靠的方式：直接构造 ET 时间字符串加时区
    // Node.js 支持 IANA 时区标识
    const etDate = new Date(
      new Date(etDatetime + '-05:00').getTime()
    );

    // 更简单的方式：利用 toLocaleString 反算
    // 先假设输入是 ET，转换为 UTC
    const parts = etDatetime.split(/[-T:]/);
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const hour = parseInt(parts[3] || '0', 10);
    const minute = parseInt(parts[4] || '0', 10);
    const second = parseInt(parts[5] || '0', 10);

    // 创建一个 UTC 时间作为参考点，然后计算 ET 偏移
    const refDate = new Date(Date.UTC(year, month, day, hour, minute, second));
    const utcStr = refDate.toLocaleString('en-US', { timeZone: 'UTC' });
    const etStr = refDate.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const utcMs = new Date(utcStr).getTime();
    const etMs = new Date(etStr).getTime();
    const offsetMs = utcMs - etMs; // ET 比 UTC 慢，偏移为正

    // 输入是 ET 时间，转为 UTC：UTC = ET + offset
    return refDate.getTime() + offsetMs;
  }
}

export default new KlineHistoryService();
