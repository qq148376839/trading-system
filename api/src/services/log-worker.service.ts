/**
 * 日志工作线程服务
 * 负责批量读取内存队列中的日志，批量写入PostgreSQL数据库
 * 配置从system_config表读取，可通过系统设置界面调整
 */

import pool from '../config/database';
import { infraLogger } from '../utils/infra-logger';
import configService from './config.service';

interface LogEntry {
  timestamp: Date;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
  module: string;
  message: string;
  traceId?: string;
  extraData?: Record<string, any>;
  filePath?: string;
  lineNo?: number;
}

class LogWorkerService {
  private isRunning: boolean = false;
  private batchSize: number = 100;
  private batchInterval: number = 1000; // 1秒
  private forceFlushInterval: number = 5000; // 5秒强制刷新一次（确保少量日志也能写入）
  private intervalId: NodeJS.Timeout | null = null;
  private forceFlushIntervalId: NodeJS.Timeout | null = null;
  private configCheckInterval: NodeJS.Timeout | null = null;
  private getLogQueueCallback: (() => LogEntry[]) | null = null;

  /**
   * 从system_config加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const batchSizeStr = await configService.getConfig('log_batch_size');
      this.batchSize = batchSizeStr ? parseInt(batchSizeStr, 10) : 100;

      const intervalStr = await configService.getConfig('log_batch_interval');
      this.batchInterval = intervalStr ? parseInt(intervalStr, 10) : 1000;
    } catch (error: any) {
      // 使用默认值
      infraLogger.warn('[LogWorker] 加载配置失败，使用默认值:', error.message);
    }
  }

  /**
   * 设置获取日志队列的回调函数
   */
  setLogQueueGetter(callback: () => LogEntry[]): void {
    this.getLogQueueCallback = callback;
  }

  /**
   * 启动日志工作线程
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      infraLogger.warn('[LogWorker] 日志工作线程已在运行');
      return;
    }

    // 加载配置
    await this.loadConfig();

    this.isRunning = true;
    infraLogger.info(`[LogWorker] 日志工作线程已启动`, {
      batchSize: this.batchSize,
      batchInterval: this.batchInterval,
    });

    // 立即执行一次批量写入
    this.processBatch();

    // 定时执行批量写入（达到批量大小时写入）
    this.startBatchProcessing();

    // 定期强制刷新（确保少量日志也能写入数据库）
    this.startForceFlush();

    // 定期检查配置更新（每5分钟）
    this.configCheckInterval = setInterval(async () => {
      await this.loadConfig();
      // 如果配置变化，重启批量处理
      if (this.isRunning) {
        this.stopBatchProcessing();
        this.startBatchProcessing();
      }
    }, 5 * 60 * 1000); // 5分钟
  }

  /**
   * 启动批量处理
   */
  private startBatchProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.intervalId = setInterval(() => {
      this.processBatch();
    }, this.batchInterval);
  }

  /**
   * 停止批量处理
   */
  private stopBatchProcessing(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 启动强制刷新（定期写入少量日志）
   */
  private startForceFlush(): void {
    if (this.forceFlushIntervalId) {
      clearInterval(this.forceFlushIntervalId);
    }
    this.forceFlushIntervalId = setInterval(() => {
      // 强制刷新：即使队列大小 < batchSize，也写入数据库
      this.processBatch(true);
    }, this.forceFlushInterval);
  }

  /**
   * 停止强制刷新
   */
  private stopForceFlush(): void {
    if (this.forceFlushIntervalId) {
      clearInterval(this.forceFlushIntervalId);
      this.forceFlushIntervalId = null;
    }
  }

  /**
   * 停止日志工作线程
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    this.stopBatchProcessing();
    this.stopForceFlush();

    if (this.configCheckInterval) {
      clearInterval(this.configCheckInterval);
      this.configCheckInterval = null;
    }

    // 处理剩余的日志
    this.processBatch(true);

    infraLogger.info('[LogWorker] 日志工作线程已停止');
  }

  /**
   * 获取队列大小
   */
  getQueueSize(): number {
    if (this.getLogQueueCallback) {
      return this.getLogQueueCallback().length;
    }
    return 0;
  }

  /**
   * 批量处理日志
   */
  private async processBatch(force: boolean = false): Promise<void> {
    // 获取日志队列（优先使用回调函数）
    if (!this.getLogQueueCallback) {
      return;
    }

    const queue = this.getLogQueueCallback();
    
    if (queue.length === 0) {
      return;
    }

    // 如果队列大小小于批量大小且不是强制处理，则等待
    if (!force && queue.length < this.batchSize) {
      return;
    }

    // 取出批量日志（从队列开头取出）
    // 强制刷新时，取出所有日志；否则只取批量大小
    const batchSize = force ? queue.length : Math.min(queue.length, this.batchSize);
    const batch = queue.splice(0, batchSize);

    try {
      await this.insertBatch(batch);
    } catch (error: any) {
      infraLogger.error(`[LogWorker] 批量写入日志失败: ${error.message}, batchSize=${batch.length}`);
      // 写入失败时，将日志重新放回队列开头（避免丢失）
      queue.unshift(...batch);
    }
  }

  /**
   * 批量插入日志到数据库
   */
  private async insertBatch(batch: LogEntry[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const entry of batch) {
      const valuePlaceholders: string[] = [];
      valuePlaceholders.push(`$${paramIndex++}`); // timestamp
      valuePlaceholders.push(`$${paramIndex++}`); // level
      valuePlaceholders.push(`$${paramIndex++}`); // module
      valuePlaceholders.push(`$${paramIndex++}`); // message
      valuePlaceholders.push(`$${paramIndex++}`); // trace_id
      valuePlaceholders.push(`$${paramIndex++}`); // extra_data
      valuePlaceholders.push(`$${paramIndex++}`); // file_path
      valuePlaceholders.push(`$${paramIndex++}`); // line_no

      placeholders.push(`(${valuePlaceholders.join(', ')})`);

      // 确保字段长度符合数据库限制（安全措施）
      // module: VARCHAR(200)
      const moduleName = entry.module.length > 200 
        ? entry.module.substring(0, 197) + '...'
        : entry.module;
      
      // file_path: VARCHAR(500)
      const filePath = entry.filePath && entry.filePath.length > 500
        ? '...' + entry.filePath.substring(entry.filePath.length - 497)
        : entry.filePath;

      values.push(
        entry.timestamp,
        entry.level,
        moduleName,
        entry.message,
        entry.traceId || null,
        entry.extraData ? JSON.stringify(entry.extraData) : null,
        filePath || null,
        entry.lineNo || null
      );
    }

    const query = `
      INSERT INTO system_logs (
        timestamp, level, module, message, trace_id, extra_data, file_path, line_no
      ) VALUES ${placeholders.join(', ')}
    `;

    await pool.query(query, values);
  }
}

// 单例模式
const logWorkerService = new LogWorkerService();

export default logWorkerService;

