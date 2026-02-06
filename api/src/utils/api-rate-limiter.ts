/**
 * API频次限制处理工具
 * Longbridge API限制：每30秒内最多请求60次历史K线接口
 */

import { logger } from './logger';

class APIRateLimiter {
  private requests: number[] = [];  // 记录请求时间戳（毫秒）
  private readonly maxRequests = 60;  // 最大请求数
  private readonly timeWindow = 30000;  // 时间窗口（30秒，毫秒）

  /**
   * 等待直到可以发送请求
   * 如果当前请求数已达到限制，会等待直到有可用的请求配额
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    
    // 清理30秒前的请求记录
    this.requests = this.requests.filter(t => now - t < this.timeWindow);
    
    // 如果请求数已达到限制，需要等待
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.timeWindow - (now - oldestRequest) + 100;  // 多等100ms确保安全
      
      if (waitTime > 0) {
        logger.info(`[API频次限制] 等待 ${Math.ceil(waitTime / 1000)} 秒后继续...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // 等待后再次清理
        const newNow = Date.now();
        this.requests = this.requests.filter(t => newNow - t < this.timeWindow);
      }
    }
    
    // 记录本次请求
    this.requests.push(Date.now());
  }

  /**
   * 获取当前请求数
   */
  getCurrentRequestCount(): number {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.timeWindow);
    return this.requests.length;
  }

  /**
   * 获取剩余请求配额
   */
  getRemainingQuota(): number {
    return Math.max(0, this.maxRequests - this.getCurrentRequestCount());
  }

  /**
   * 重置请求记录（用于测试）
   */
  reset(): void {
    this.requests = [];
  }
}

// 单例模式
export const apiRateLimiter = new APIRateLimiter();

