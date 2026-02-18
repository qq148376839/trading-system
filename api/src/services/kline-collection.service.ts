/**
 * K线数据采集服务
 * 定时从 Moomoo API 采集 SPX、USD Index、BTC 的 1m K线数据并存入 PostgreSQL
 */

import pool from '../config/database';
import marketDataService from './market-data.service';
import configService from './config.service';
import { isTradingHours } from '../utils/trading-hours';
import { logger } from '../utils/logger';

interface KlineSource {
  name: string;
  stockId: string;
  marketId: string;
  marketCode: string;
  instrumentType: string;
  subInstrumentType: string;
}

interface CollectionResult {
  source: string;
  fetched: number;
  inserted: number;
  skipped: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

class KlineCollectionService {
  private readonly SOURCES: KlineSource[] = [
    { name: 'SPX',       stockId: '200003',  marketId: '2',  marketCode: '24',  instrumentType: '6',  subInstrumentType: '6001'  },
    { name: 'USD_INDEX', stockId: '72000025', marketId: '11', marketCode: '121', instrumentType: '10', subInstrumentType: '10001' },
    { name: 'BTC',       stockId: '12000015', marketId: '17', marketCode: '360', instrumentType: '11', subInstrumentType: '11002' },
  ];

  private readonly BATCH_SIZE = 100;
  private readonly INTER_SOURCE_DELAY_MS = 800;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private collecting = false;
  private enabled = true;
  private tradingIntervalMin = 60;
  private offHoursIntervalMin = 240;
  private retentionDays = 365;
  private initialized = false;

  /**
   * 初始化服务：加载配置并启动定时采集
   */
  async init(): Promise<void> {
    try {
      await this.loadConfig();
      this.initialized = true;

      if (!this.enabled) {
        logger.info('[K线采集] 采集已禁用（kline_collection_enabled=false）');
        return;
      }

      // 首次采集
      logger.info(
        `[K线采集] 服务启动 — 交易时段 ${this.tradingIntervalMin}min / 非交易时段 ${this.offHoursIntervalMin}min / 保留 ${this.retentionDays}天`
      );
      this.scheduleNext(0); // 立即执行首次采集
      this.scheduleCleanup();
    } catch (error: any) {
      logger.error(`[K线采集] 初始化失败: ${error.message}`);
    }
  }

  /**
   * 停止服务
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.initialized = false;
    logger.info('[K线采集] 服务已停止');
  }

  /**
   * 是否正在采集中
   */
  isCollecting(): boolean {
    return this.collecting;
  }

  /**
   * 从 system_config 加载配置
   */
  private async loadConfig(): Promise<void> {
    const enabledStr = await configService.getConfig('kline_collection_enabled');
    this.enabled = enabledStr !== 'false';

    const tradingInterval = await configService.getConfig('kline_collection_trading_interval_min');
    if (tradingInterval) this.tradingIntervalMin = parseInt(tradingInterval, 10) || 60;

    const offHoursInterval = await configService.getConfig('kline_collection_off_hours_interval_min');
    if (offHoursInterval) this.offHoursIntervalMin = parseInt(offHoursInterval, 10) || 240;

    const retention = await configService.getConfig('kline_data_retention_days');
    if (retention) this.retentionDays = parseInt(retention, 10) || 365;
  }

  /**
   * 采集所有数据源（串行，间隔 800ms）
   */
  async collectAll(): Promise<CollectionResult[]> {
    if (this.collecting) {
      logger.warn('[K线采集] 采集正在进行中，跳过');
      return [];
    }

    this.collecting = true;
    const results: CollectionResult[] = [];

    try {
      for (let i = 0; i < this.SOURCES.length; i++) {
        const source = this.SOURCES[i];
        if (i > 0) {
          await new Promise(r => setTimeout(r, this.INTER_SOURCE_DELAY_MS));
        }
        const result = await this.collectSingle(source);
        results.push(result);
      }

      // 汇总日志
      const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
      const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0);
      const allSuccess = results.every(r => r.success);
      const sourceSummary = results.map(r =>
        `${r.source}:${r.inserted}/${r.fetched}`
      ).join(' ');

      if (totalInserted > 0 || !allSuccess) {
        logger.info(`[K线采集] 完成 — ${sourceSummary}${allSuccess ? '' : ' (部分失败)'}`);
      } else {
        logger.debug(`[K线采集] 完成 — 无新数据（${sourceSummary}）`);
      }
    } finally {
      this.collecting = false;
    }

    return results;
  }

  /**
   * 采集单个数据源
   */
  private async collectSingle(source: KlineSource): Promise<CollectionResult> {
    const startTime = Date.now();
    const result: CollectionResult = {
      source: source.name,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      durationMs: 0,
      success: true,
    };

    try {
      // 调用 Moomoo API 获取分时数据（type=1, count=500）
      const candles = await marketDataService.getCandlesticksIntraday(
        source.stockId,
        source.marketId,
        source.marketCode,
        source.instrumentType,
        source.subInstrumentType,
        1, // 分时数据
        500,
        20000 // 20s timeout
      );

      // 过滤无效数据：timestamp 必须大于 0、在分钟边界上（排除 Date.now 降级值）、close > 0
      const validCandles = candles.filter(c =>
        c.timestamp > 0 && c.timestamp % 60000 === 0 && c.close > 0
      );
      result.fetched = validCandles.length;

      if (validCandles.length === 0) {
        result.durationMs = Date.now() - startTime;
        await this.recordStatus(result);
        return result;
      }

      // 批量写入
      const insertResult = await this.batchUpsert(source.name, '1m', validCandles);
      result.inserted = insertResult.inserted;
      result.skipped = insertResult.skipped;
    } catch (error: any) {
      result.success = false;
      result.errorMessage = error.message;
      logger.warn(`[K线采集] ${source.name} 失败: ${error.message}`);
    }

    result.durationMs = Date.now() - startTime;
    await this.recordStatus(result);
    return result;
  }

  /**
   * 批量写入 K 线数据（ON CONFLICT DO NOTHING）
   */
  private async batchUpsert(
    sourceName: string,
    period: string,
    candles: Array<{ open: number; high: number; low: number; close: number; volume: number; turnover: number; timestamp: number }>
  ): Promise<{ inserted: number; skipped: number }> {
    let totalInserted = 0;
    let totalSkipped = 0;

    // 分批处理
    for (let i = 0; i < candles.length; i += this.BATCH_SIZE) {
      const batch = candles.slice(i, i + this.BATCH_SIZE);

      const values: (string | number)[] = [];
      const placeholders: string[] = [];

      batch.forEach((c, idx) => {
        const offset = idx * 8;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
        );
        values.push(
          sourceName,
          period,
          c.timestamp,
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume
        );
      });

      const sql = `
        INSERT INTO market_kline_history (source, period, timestamp, open, high, low, close, volume)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (source, period, timestamp) DO NOTHING
      `;

      const client = await pool.connect();
      try {
        const res = await client.query(sql, values);
        const inserted = res.rowCount || 0;
        totalInserted += inserted;
        totalSkipped += batch.length - inserted;
      } finally {
        client.release();
      }
    }

    return { inserted: totalInserted, skipped: totalSkipped };
  }

  /**
   * 记录采集状态到 kline_collection_status
   */
  private async recordStatus(result: CollectionResult): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO kline_collection_status
          (source, period, data_points_fetched, data_points_inserted, data_points_skipped, success, error_message, duration_ms)
         VALUES ($1, '1m', $2, $3, $4, $5, $6, $7)`,
        [
          result.source,
          result.fetched,
          result.inserted,
          result.skipped,
          result.success,
          result.errorMessage || null,
          result.durationMs,
        ]
      );
    } catch (error: any) {
      logger.warn(`[K线采集] 记录采集状态失败: ${error.message}`);
    }
  }

  /**
   * 自适应调度下一次采集
   */
  private scheduleNext(delayMs?: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    const interval = delayMs !== undefined
      ? delayMs
      : (isTradingHours() ? this.tradingIntervalMin : this.offHoursIntervalMin) * 60 * 1000;

    this.timer = setTimeout(async () => {
      try {
        // 重新加载配置（允许运行时调整间隔）
        await this.loadConfig();
        if (!this.enabled) {
          logger.info('[K线采集] 采集已被运行时禁用，跳过本轮');
          this.scheduleNext();
          return;
        }
        await this.collectAll();
      } catch (error: any) {
        logger.error(`[K线采集] 采集异常: ${error.message}`);
      }
      this.scheduleNext();
    }, interval);
  }

  /**
   * 定时清理过期数据（每日执行一次）
   */
  private scheduleCleanup(): void {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    this.cleanupTimer = setTimeout(async () => {
      await this.cleanupOldData();
      this.scheduleCleanup();
    }, ONE_DAY_MS);
  }

  /**
   * 清理过期 K 线数据
   */
  async cleanupOldData(): Promise<void> {
    try {
      const cutoffMs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      const res = await pool.query(
        'DELETE FROM market_kline_history WHERE timestamp < $1',
        [cutoffMs]
      );
      const deleted = res.rowCount || 0;
      if (deleted > 0) {
        logger.info(`[K线采集] 清理过期数据: 删除 ${deleted} 行（保留 ${this.retentionDays} 天）`);
      }

      // 同时清理旧的采集状态记录（保留30天）
      const statusCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await pool.query(
        'DELETE FROM kline_collection_status WHERE collection_time < $1',
        [statusCutoff]
      );
    } catch (error: any) {
      logger.warn(`[K线采集] 清理过期数据失败: ${error.message}`);
    }
  }

  /**
   * 获取采集健康状态
   */
  async getHealthStatus(): Promise<{
    enabled: boolean;
    sources: Record<string, {
      lastCollectionTime: string | null;
      lastCollectionAgeMinutes: number;
      dataPointsInLast24h: number;
      latestDataTimestamp: string | null;
      consecutiveFailures: number;
      status: 'healthy' | 'degraded' | 'unhealthy';
    }>;
    nextScheduledCollection: string | null;
    overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  }> {
    const sources: Record<string, any> = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    for (const src of this.SOURCES) {
      // 最近一次采集
      const lastCollection = await pool.query(
        `SELECT collection_time, success, data_points_inserted
         FROM kline_collection_status
         WHERE source = $1
         ORDER BY collection_time DESC LIMIT 1`,
        [src.name]
      );

      // 最近24小时的数据量
      const countRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM market_kline_history
         WHERE source = $1 AND timestamp > $2`,
        [src.name, Date.now() - 24 * 60 * 60 * 1000]
      );

      // 最新数据时间戳
      const latestRes = await pool.query(
        `SELECT MAX(timestamp) as latest FROM market_kline_history WHERE source = $1`,
        [src.name]
      );

      // 连续失败次数
      const failRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM (
           SELECT success FROM kline_collection_status
           WHERE source = $1
           ORDER BY collection_time DESC LIMIT 10
         ) sub WHERE success = false`,
        [src.name]
      );

      const lastTime = lastCollection.rows[0]?.collection_time || null;
      const ageMin = lastTime ? Math.floor((Date.now() - new Date(lastTime).getTime()) / 60000) : 9999;
      const consecutiveFailures = parseInt(failRes.rows[0]?.cnt || '0', 10);
      const dataPoints24h = parseInt(countRes.rows[0]?.cnt || '0', 10);
      const latestTs = latestRes.rows[0]?.latest || null;

      // 状态判定
      const expectedIntervalMin = isTradingHours() ? this.tradingIntervalMin : this.offHoursIntervalMin;
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (ageMin > expectedIntervalMin * 3 || consecutiveFailures >= 5) {
        status = 'unhealthy';
      } else if (ageMin > expectedIntervalMin * 2 || consecutiveFailures >= 2) {
        status = 'degraded';
      }

      if (status === 'unhealthy') overallStatus = 'unhealthy';
      else if (status === 'degraded' && overallStatus !== 'unhealthy') overallStatus = 'degraded';

      sources[src.name] = {
        lastCollectionTime: lastTime ? new Date(lastTime).toISOString() : null,
        lastCollectionAgeMinutes: ageMin,
        dataPointsInLast24h: dataPoints24h,
        latestDataTimestamp: latestTs ? new Date(parseInt(latestTs, 10)).toISOString() : null,
        consecutiveFailures,
        status,
      };
    }

    return {
      enabled: this.enabled,
      sources,
      nextScheduledCollection: null, // setTimeout 不方便获取精确时间
      overallStatus,
    };
  }

  /**
   * 获取最近 N 次采集状态
   */
  async getRecentStatus(limit: number = 20): Promise<any[]> {
    const res = await pool.query(
      `SELECT * FROM kline_collection_status ORDER BY collection_time DESC LIMIT $1`,
      [limit]
    );
    return res.rows;
  }
}

export default new KlineCollectionService();
