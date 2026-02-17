/**
 * 日志服务
 * 提供非阻塞的日志写入功能，支持结构化日志、TraceID、动态队列调整
 * 配置从system_config表读取，可通过系统设置界面调整
 *
 * 新增节流机制：同一 module + 消息模板 在 N 秒窗口内只写一条到库，
 * 窗口结束时补写汇总条目（含重复次数）。ERROR 级别始终绕过节流。
 */

import logWorkerService from './log-worker.service';
import TraceContext from '../utils/trace-context';
import configService from './config.service';
import { getModuleFromPath } from '../utils/log-module-mapper';
import { infraLogger } from '../utils/infra-logger';

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

interface ThrottleEntry {
  firstSeen: number;
  count: number;
  module: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
  lastMessage: string;
  lastExtraData?: Record<string, any>;
}

class LogService {
  private queue: LogEntry[] = [];
  private queueSize: number = 10000; // 初始队列大小
  private minQueueSize: number = 5000; // 最小队列大小
  private maxQueueSize: number = 50000; // 最大队列大小
  private adjustmentCheckInterval: number = 10000; // 10秒检查一次
  private adjustmentIntervalId: NodeJS.Timeout | null = null;
  private configCheckInterval: NodeJS.Timeout | null = null;
  private readonly ADJUSTMENT_THRESHOLD_HIGH = 80; // 使用率 > 80% 时扩容
  private readonly ADJUSTMENT_THRESHOLD_LOW = 30; // 使用率 < 30% 时缩容

  // 节流相关
  private throttleMap: Map<string, ThrottleEntry> = new Map();
  private throttleEnabled: boolean = true;
  private throttleWindowSeconds: number = 30;
  private throttleCleanupIntervalId: NodeJS.Timeout | null = null;

  // DEBUG 入库应急开关
  private debugToDb: boolean = false;

  constructor() {
    // 启动动态队列调整监控
    this.startQueueAdjustment();
    // 定期检查配置更新（每5分钟）
    this.startConfigCheck();
    // 启动节流清理定时器
    this.startThrottleCleanup();
    // 异步加载配置（不阻塞构造函数）
    this.loadConfig().catch((error) => {
      infraLogger.warn('[LogService] 初始化配置加载失败，使用默认值:', error.message);
    });
  }

  /**
   * 从system_config加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const queueSizeStr = await configService.getConfig('log_queue_size');
      this.queueSize = queueSizeStr ? parseInt(queueSizeStr, 10) : 10000;

      const minSizeStr = await configService.getConfig('log_queue_min_size');
      this.minQueueSize = minSizeStr ? parseInt(minSizeStr, 10) : 5000;

      const maxSizeStr = await configService.getConfig('log_queue_max_size');
      this.maxQueueSize = maxSizeStr ? parseInt(maxSizeStr, 10) : 50000;

      // 节流配置
      const throttleEnabledStr = await configService.getConfig('log_throttle_enabled');
      if (throttleEnabledStr !== null) {
        this.throttleEnabled = throttleEnabledStr === 'true';
      }

      const throttleWindowStr = await configService.getConfig('log_throttle_window_seconds');
      if (throttleWindowStr !== null) {
        const parsed = parseInt(throttleWindowStr, 10);
        if (parsed > 0) {
          this.throttleWindowSeconds = parsed;
        }
      }

      // DEBUG 入库开关
      const debugToDbStr = await configService.getConfig('log_debug_to_db');
      if (debugToDbStr !== null) {
        this.debugToDb = debugToDbStr === 'true';
      }
    } catch (error: any) {
      // 在测试环境中，如果连接池已关闭，静默处理
      if (process.env.NODE_ENV === 'test' && error.message?.includes('pool after calling end')) {
        return; // 静默返回，不输出警告
      }
      // 使用默认值
      infraLogger.warn('[LogService] 加载配置失败，使用默认值:', error.message);
    }
  }

  /**
   * 启动配置检查
   */
  private startConfigCheck(): void {
    this.configCheckInterval = setInterval(async () => {
      await this.loadConfig();
    }, 5 * 60 * 1000); // 5分钟检查一次
  }

  /**
   * 获取队列（供工作线程使用）
   */
  getQueue(): LogEntry[] {
    return this.queue;
  }

  /**
   * 启动动态队列调整监控
   */
  private startQueueAdjustment(): void {
    this.adjustmentIntervalId = setInterval(() => {
      this.adjustQueueSize();
    }, this.adjustmentCheckInterval);
  }

  /**
   * 停止所有定时器
   */
  stop(): void {
    if (this.adjustmentIntervalId) {
      clearInterval(this.adjustmentIntervalId);
      this.adjustmentIntervalId = null;
    }

    if (this.configCheckInterval) {
      clearInterval(this.configCheckInterval);
      this.configCheckInterval = null;
    }

    if (this.throttleCleanupIntervalId) {
      clearInterval(this.throttleCleanupIntervalId);
      this.throttleCleanupIntervalId = null;
    }

    // flush 残留节流汇总
    this.flushAllThrottled();
  }

  // ======================== 节流机制 ========================

  /**
   * 生成节流 Key（O(1)）
   * 将消息中的数字、股票代码、UUID 替换为占位符，实现模板化匹配
   */
  private generateThrottleKey(module: string, message: string): string {
    const normalized = message.substring(0, 80)
      .replace(/\d+\.?\d*/g, '_NUM_')
      .replace(/[A-Z]{1,5}\.US/g, '_SYM_')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}/gi, '_UUID_');
    return `${module}::${normalized}`;
  }

  /**
   * 判断是否应该入队列（节流门控）
   * @returns true = 允许入队, false = 被节流
   */
  private shouldEnqueue(
    level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG',
    module: string,
    message: string,
    extraData?: Record<string, any>
  ): boolean {
    // ERROR 始终不节流
    if (level === 'ERROR') return true;

    // 节流未启用
    if (!this.throttleEnabled) return true;

    const key = this.generateThrottleKey(module, message);
    const now = Date.now();
    const entry = this.throttleMap.get(key);

    if (!entry) {
      // 首次出现：允许入队，记录 entry
      this.throttleMap.set(key, {
        firstSeen: now,
        count: 1,
        module,
        level,
        lastMessage: message,
        lastExtraData: extraData,
      });
      return true;
    }

    const elapsedMs = now - entry.firstSeen;

    if (elapsedMs >= this.throttleWindowSeconds * 1000) {
      // 窗口过期：写汇总条目，重置
      if (entry.count > 1) {
        this.enqueue({
          timestamp: new Date(),
          level: entry.level,
          module: entry.module,
          message: `[节流] ${entry.lastMessage.substring(0, 120)}... (重复 ${entry.count} 次 / ${this.throttleWindowSeconds}s)`,
          extraData: {
            throttled: true,
            repeatCount: entry.count,
            windowSeconds: this.throttleWindowSeconds,
          },
        });
      }
      // 重置为新窗口的第一条
      this.throttleMap.set(key, {
        firstSeen: now,
        count: 1,
        module,
        level,
        lastMessage: message,
        lastExtraData: extraData,
      });
      return true;
    }

    // 窗口内重复：仅计数，跳过入队
    entry.count++;
    entry.lastMessage = message;
    entry.lastExtraData = extraData;
    return false;
  }

  /**
   * flush 所有残留的节流条目（关闭时调用）
   */
  private flushAllThrottled(): void {
    for (const [, entry] of this.throttleMap) {
      if (entry.count > 1) {
        this.enqueue({
          timestamp: new Date(),
          level: entry.level,
          module: entry.module,
          message: `[节流] ${entry.lastMessage.substring(0, 120)}... (重复 ${entry.count} 次 / ${this.throttleWindowSeconds}s)`,
          extraData: {
            throttled: true,
            repeatCount: entry.count,
            windowSeconds: this.throttleWindowSeconds,
          },
        });
      }
    }
    this.throttleMap.clear();
  }

  /**
   * 启动节流清理定时器（每60秒清理过期条目）
   */
  private startThrottleCleanup(): void {
    this.throttleCleanupIntervalId = setInterval(() => {
      const now = Date.now();
      const windowMs = this.throttleWindowSeconds * 1000;

      for (const [key, entry] of this.throttleMap) {
        if (now - entry.firstSeen >= windowMs) {
          // 过期：如果有重复，写汇总
          if (entry.count > 1) {
            this.enqueue({
              timestamp: new Date(),
              level: entry.level,
              module: entry.module,
              message: `[节流] ${entry.lastMessage.substring(0, 120)}... (重复 ${entry.count} 次 / ${this.throttleWindowSeconds}s)`,
              extraData: {
                throttled: true,
                repeatCount: entry.count,
                windowSeconds: this.throttleWindowSeconds,
              },
            });
          }
          this.throttleMap.delete(key);
        }
      }
    }, 60_000);
  }

  // ======================== 核心日志方法 ========================

  /**
   * 直接入队（绕过节流，用于内部汇总条目）
   */
  private enqueue(entry: Partial<LogEntry> & { timestamp: Date; level: LogEntry['level']; module: string; message: string }): void {
    const fullEntry: LogEntry = {
      timestamp: entry.timestamp,
      level: entry.level,
      module: entry.module,
      message: entry.message,
      traceId: entry.traceId || TraceContext.getTraceId() || TraceContext.generateTraceId(),
      extraData: entry.extraData,
      filePath: entry.filePath,
      lineNo: entry.lineNo,
    };

    if (this.queue.length >= this.queueSize) {
      this.queue.shift();
      infraLogger.error(`[LogService] 队列已满，丢弃最旧的日志。队列大小: ${this.queueSize}`);
    }

    this.queue.push(fullEntry);
  }

  /**
   * 记录日志
   */
  private log(
    level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG',
    module: string,
    message: string,
    extraData?: Record<string, any>,
    traceId?: string
  ): void {
    // DEBUG 级别门控：默认不入库
    if (level === 'DEBUG' && !this.debugToDb) {
      return;
    }

    // 获取调用栈信息
    const stack = new Error().stack;
    const fileInfo = this.extractFileInfo(stack);

    // 如果传入的模块名称为空或默认值，使用文件路径映射
    let finalModule = module;
    if (!module || module === 'Unknown' || module === 'CompatibilityLayer') {
      if (fileInfo.filePath) {
        finalModule = getModuleFromPath(fileInfo.filePath);
      } else {
        finalModule = 'Unknown';
      }
    }

    // 节流门控
    if (!this.shouldEnqueue(level, finalModule, message, extraData)) {
      return;
    }

    // 获取TraceID（优先使用传入的，其次从上下文获取，最后自动生成）
    const finalTraceId = traceId || TraceContext.getTraceId() || TraceContext.generateTraceId();

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      module: finalModule,
      message,
      traceId: finalTraceId,
      extraData,
      filePath: fileInfo.filePath,
      lineNo: fileInfo.lineNo,
    };

    // 检查队列是否满
    if (this.queue.length >= this.queueSize) {
      // 队列满时，丢弃最旧的日志
      this.queue.shift();
      infraLogger.error(`[LogService] 队列已满，丢弃最旧的日志。队列大小: ${this.queueSize}`);
    }

    // 添加到队列
    this.queue.push(entry);
  }

  /**
   * 提取文件信息（文件路径和行号）
   */
  private extractFileInfo(stack?: string): { filePath?: string; lineNo?: number } {
    if (!stack) {
      return {};
    }

    const stackLines = stack.split('\n');
    // 跳过前3行（Error、LogService.log、LogService.info/warn/error/debug）
    // 查找第一个非LogService的调用
    for (let i = 3; i < stackLines.length; i++) {
      const line = stackLines[i];
      // 匹配格式：at functionName (file:line:column)
      const match = line.match(/at\s+.+\s+\((.+):(\d+):(\d+)\)/);
      if (match) {
        const filePath = match[1];
        const lineNo = parseInt(match[2], 10);
        // 排除node_modules和log.service.ts本身
        if (!filePath.includes('node_modules') && !filePath.includes('log.service.ts')) {
          return { filePath, lineNo };
        }
      }
    }

    return {};
  }

  /**
   * 记录INFO级别日志
   */
  info(
    module: string,
    message: string,
    extraData?: Record<string, any>,
    traceId?: string
  ): void {
    this.log('INFO', module, message, extraData, traceId);
  }

  /**
   * 记录WARNING级别日志
   */
  warn(
    module: string,
    message: string,
    extraData?: Record<string, any>,
    traceId?: string
  ): void {
    this.log('WARNING', module, message, extraData, traceId);
  }

  /**
   * 记录ERROR级别日志
   */
  error(
    module: string,
    message: string,
    extraData?: Record<string, any>,
    traceId?: string
  ): void {
    this.log('ERROR', module, message, extraData, traceId);
  }

  /**
   * 记录DEBUG级别日志
   */
  debug(
    module: string,
    message: string,
    extraData?: Record<string, any>,
    traceId?: string
  ): void {
    this.log('DEBUG', module, message, extraData, traceId);
  }

  /**
   * 获取队列大小
   */
  getQueueSize(): number {
    return this.queueSize;
  }

  /**
   * 获取队列使用率（0-100）
   */
  getQueueUsage(): number {
    return (this.queue.length / this.queueSize) * 100;
  }

  /**
   * 根据使用率调整队列大小
   */
  private adjustQueueSize(): void {
    const usage = this.getQueueUsage();

    if (usage > this.ADJUSTMENT_THRESHOLD_HIGH) {
      // 扩容：增加50%，最大不超过maxQueueSize
      const newSize = Math.min(
        Math.floor(this.queueSize * 1.5),
        this.maxQueueSize
      );
      if (newSize > this.queueSize) {
        this.queueSize = newSize;
        infraLogger.info(`[LogService] 队列扩容: ${this.queue.length}/${this.queueSize} (使用率: ${usage.toFixed(1)}%)`);
      }
    } else if (usage < this.ADJUSTMENT_THRESHOLD_LOW && this.queueSize > this.minQueueSize) {
      // 缩容：减少25%，最小不低于minQueueSize
      const newSize = Math.max(
        Math.floor(this.queueSize * 0.75),
        this.minQueueSize
      );
      if (newSize < this.queueSize) {
        this.queueSize = newSize;
        infraLogger.debug(`[LogService] 队列缩容: ${this.queue.length}/${this.queueSize} (使用率: ${usage.toFixed(1)}%)`);
      }
    }
  }
}

// 单例模式
const logService = new LogService();

export default logService;
