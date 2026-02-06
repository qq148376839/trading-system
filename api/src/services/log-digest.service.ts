/**
 * 日志摘要聚合服务
 * 高频操作（如价格获取、合约筛选）注册为指标数据点，
 * 每 N 分钟写一条聚合日志（count/min/max/avg/labels）到数据库。
 *
 * 不需要修改 system_logs 表结构，摘要作为普通 INFO 日志写入，
 * 通过 extra_data.digest=true 标识。
 */

import logService from './log.service';
import configService from './config.service';
import { infraLogger } from '../utils/infra-logger';

interface DigestDataPoint {
  value: number;
  labels?: Record<string, string>;
  timestamp: number;
}

interface DigestMetric {
  name: string;
  dataPoints: DigestDataPoint[];
  labelCounts: Map<string, Map<string, number>>;
}

class LogDigestService {
  private metrics: Map<string, DigestMetric> = new Map();
  private flushIntervalMinutes: number = 5;
  private enabled: boolean = true;
  private flushIntervalId: NodeJS.Timeout | null = null;
  private configCheckIntervalId: NodeJS.Timeout | null = null;

  /**
   * 启动 digest 服务
   */
  async start(): Promise<void> {
    await this.loadConfig();

    if (!this.enabled) {
      infraLogger.info('LogDigest 服务已禁用');
      return;
    }

    this.flushIntervalId = setInterval(() => {
      this.flush();
    }, this.flushIntervalMinutes * 60 * 1000);

    // 定期检查配置更新（每5分钟）
    this.configCheckIntervalId = setInterval(async () => {
      await this.loadConfig();
    }, 5 * 60 * 1000);

    infraLogger.info(`LogDigest 服务已启动（间隔: ${this.flushIntervalMinutes}分钟）`);
  }

  /**
   * 停止 digest 服务，flush 残留数据
   */
  stop(): void {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }
    if (this.configCheckIntervalId) {
      clearInterval(this.configCheckIntervalId);
      this.configCheckIntervalId = null;
    }
    // flush 残留
    this.flush();
    infraLogger.info('LogDigest 服务已停止');
  }

  /**
   * 从 system_config 加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const enabledStr = await configService.getConfig('log_digest_enabled');
      if (enabledStr !== null) {
        this.enabled = enabledStr === 'true';
      }

      const intervalStr = await configService.getConfig('log_digest_interval_minutes');
      if (intervalStr !== null) {
        const parsed = parseInt(intervalStr, 10);
        if (parsed > 0) {
          this.flushIntervalMinutes = parsed;
        }
      }
    } catch (error: any) {
      if (process.env.NODE_ENV === 'test' && error.message?.includes('pool after calling end')) {
        return;
      }
      infraLogger.warn('LogDigest 加载配置失败，使用默认值:', error.message);
    }
  }

  /**
   * 注册一个数据点
   * @param name 指标名称，如 'price_fetch', 'contract_filter'
   * @param value 数值
   * @param labels 可选标签，如 { symbol: 'AAPL.US', source: 'longport' }
   */
  record(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.enabled) return;

    let metric = this.metrics.get(name);
    if (!metric) {
      metric = {
        name,
        dataPoints: [],
        labelCounts: new Map(),
      };
      this.metrics.set(name, metric);
    }

    metric.dataPoints.push({
      value,
      labels,
      timestamp: Date.now(),
    });

    // 累计 label 计数
    if (labels) {
      for (const [key, val] of Object.entries(labels)) {
        let labelMap = metric.labelCounts.get(key);
        if (!labelMap) {
          labelMap = new Map();
          metric.labelCounts.set(key, labelMap);
        }
        labelMap.set(val, (labelMap.get(val) || 0) + 1);
      }
    }
  }

  /**
   * 定期 flush：将聚合数据写入一条 INFO 日志到 DB
   */
  private flush(): void {
    if (this.metrics.size === 0) return;

    for (const [name, metric] of this.metrics.entries()) {
      const count = metric.dataPoints.length;
      if (count === 0) continue;

      const values = metric.dataPoints.map(dp => dp.value);
      const sum = values.reduce((a, b) => a + b, 0);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const avg = sum / count;

      // 构建 label 摘要（取 top 5）
      const labelSummary: Record<string, Record<string, number>> = {};
      for (const [labelKey, labelMap] of metric.labelCounts.entries()) {
        const sorted = [...labelMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        labelSummary[labelKey] = Object.fromEntries(sorted);
      }

      const extraData = {
        digest: true,
        metricName: name,
        count,
        sum: Number(sum.toFixed(4)),
        min: Number(min.toFixed(4)),
        max: Number(max.toFixed(4)),
        avg: Number(avg.toFixed(4)),
        periodMinutes: this.flushIntervalMinutes,
        labels: Object.keys(labelSummary).length > 0 ? labelSummary : undefined,
      };

      const message = `[摘要] ${name}: count=${count}, avg=${avg.toFixed(2)}, min=${min.toFixed(2)}, max=${max.toFixed(2)} (${this.flushIntervalMinutes}min)`;

      logService.info('Log.Digest', message, extraData);
    }

    // 清空所有指标
    this.metrics.clear();
  }
}

// 单例模式
const logDigestService = new LogDigestService();

export default logDigestService;
