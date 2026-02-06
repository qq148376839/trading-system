/**
 * API调用率控制服务
 * 防止API被过度调用，避免限流
 * 实现调用队列、频率限制、错误重试机制
 */

import { logger } from '../utils/logger';

interface CallStats {
  total: number;
  success: number;
  failed: number;
  lastHour: number[];
}

interface RateLimitConfig {
  maxConcurrent: number;      // 最大并发数
  minInterval: number;         // 最小调用间隔（毫秒）
  maxCallsPerHour: number;    // 每小时最大调用次数
  retryDelay: number;          // 重试延迟（毫秒）
  maxRetries: number;          // 最大重试次数
}

class ApiRateLimiterService {
  private queue: Array<() => Promise<any>> = [];
  private running: number = 0;
  private config: RateLimitConfig;
  private lastCallTime: number = 0;
  private callStats: CallStats = {
    total: 0,
    success: 0,
    failed: 0,
    lastHour: [],
  };

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      maxConcurrent: 3,           // 最多3个并发请求
      minInterval: 6000,          // 最小间隔6秒（每分钟最多10次）
      maxCallsPerHour: 300,       // 每小时最多300次
      retryDelay: 1000,           // 初始重试延迟1秒
      maxRetries: 3,              // 最多重试3次
      ...config,
    };
  }

  /**
   * 执行API调用（带速率限制）
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        let retries = 0;
        let lastError: any = null;

        while (retries <= this.config.maxRetries) {
          try {
            await this.waitForRateLimit();
            const result = await fn();
            this.recordSuccess();
            resolve(result);
            return;
          } catch (error: any) {
            lastError = error;
            this.recordFailure();

            // 如果是限流错误（429），增加等待时间
            if (error?.response?.status === 429 || error?.status === 429) {
              const waitTime = this.config.retryDelay * Math.pow(2, retries);
              logger.warn(`API限流，等待 ${waitTime}ms 后重试 (${retries + 1}/${this.config.maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              retries++;
            } else if (retries < this.config.maxRetries) {
              // 其他错误，短暂等待后重试
              const waitTime = this.config.retryDelay * (retries + 1);
              logger.warn(`API调用失败，${waitTime}ms 后重试 (${retries + 1}/${this.config.maxRetries}):`, error.message);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              retries++;
            } else {
              // 达到最大重试次数
              break;
            }
          }
        }

        // 所有重试都失败
        reject(lastError || new Error('API调用失败'));
      });

      this.processQueue();
    });
  }

  /**
   * 等待速率限制
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;

    // 检查是否超过最小间隔
    if (timeSinceLastCall < this.config.minInterval) {
      const waitTime = this.config.minInterval - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // 检查每小时调用次数
    this.updateHourlyStats();
    const callsInLastHour = this.callStats.lastHour.length;
    
    if (callsInLastHour >= this.config.maxCallsPerHour) {
      // 计算需要等待的时间（直到最早的调用超过1小时）
      const oldestCall = this.callStats.lastHour[0];
      const waitTime = (oldestCall + 60 * 60 * 1000) - Date.now();
      
      if (waitTime > 0) {
        logger.warn(`达到每小时调用限制，等待 ${Math.ceil(waitTime / 1000)}秒`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.lastCallTime = Date.now();
  }

  /**
   * 处理队列
   */
  private processQueue(): void {
    while (this.running < this.config.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.running++;
        task()
          .catch((error) => {
            // 错误已在execute中处理，这里只记录
            logger.error('API调用队列任务失败:', error.message);
          })
          .finally(() => {
            this.running--;
            this.processQueue();
          });
      }
    }
  }

  /**
   * 记录成功调用
   */
  private recordSuccess(): void {
    this.callStats.total++;
    this.callStats.success++;
    this.updateHourlyStats();
  }

  /**
   * 记录失败调用
   */
  private recordFailure(): void {
    this.callStats.total++;
    this.callStats.failed++;
    this.updateHourlyStats();
  }

  /**
   * 更新每小时统计
   */
  private updateHourlyStats(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    // 移除1小时前的调用记录
    this.callStats.lastHour = this.callStats.lastHour.filter(
      time => time > oneHourAgo
    );
    
    // 添加当前调用时间
    this.callStats.lastHour.push(now);

    // 如果接近限制，动态调整最小间隔
    const callsInLastHour = this.callStats.lastHour.length;
    if (callsInLastHour > this.config.maxCallsPerHour * 0.8) {
      // 接近限制时，增加最小间隔
      this.config.minInterval = Math.min(
        this.config.minInterval * 1.2,
        30000 // 最大30秒
      );
    } else if (callsInLastHour < this.config.maxCallsPerHour * 0.5) {
      // 远离限制时，恢复原始间隔
      this.config.minInterval = 6000;
    }
  }

  /**
   * 获取调用统计
   */
  getStats(): CallStats & { 
    successRate: number; 
    callsInLastHour: number;
    avgInterval: number;
  } {
    const callsInLastHour = this.callStats.lastHour.length;
    const successRate = this.callStats.total > 0 
      ? (this.callStats.success / this.callStats.total) * 100 
      : 0;
    
    // 计算平均调用间隔
    let avgInterval = 0;
    if (this.callStats.lastHour.length > 1) {
      const intervals: number[] = [];
      for (let i = 1; i < this.callStats.lastHour.length; i++) {
        intervals.push(this.callStats.lastHour[i] - this.callStats.lastHour[i - 1]);
      }
      avgInterval = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
    }

    return {
      ...this.callStats,
      successRate: parseFloat(successRate.toFixed(2)),
      callsInLastHour,
      avgInterval: Math.round(avgInterval),
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.callStats = {
      total: 0,
      success: 0,
      failed: 0,
      lastHour: [],
    };
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): {
    queueLength: number;
    running: number;
    maxConcurrent: number;
  } {
    return {
      queueLength: this.queue.length,
      running: this.running,
      maxConcurrent: this.config.maxConcurrent,
    };
  }
}

export default new ApiRateLimiterService();

