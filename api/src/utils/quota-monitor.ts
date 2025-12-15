/**
 * Longbridge API配额监控工具
 * 监控每月查询的标的数量（去重）
 */

import pool from '../config/database';

interface QuotaUsage {
  symbol: string;
  queryDate: Date;
}

class QuotaMonitor {
  private monthlyQueries: Set<string> = new Set();  // 内存缓存（当月查询的标的，去重）
  private lastResetDate: Date = new Date();  // 上次重置日期

  /**
   * 记录查询的标的代码（去重）
   * @param symbol 标的代码
   */
  async recordQuery(symbol: string): Promise<void> {
    // 检查是否需要重置（新月份）
    this.checkAndResetIfNeeded();

    // 记录到内存缓存
    this.monthlyQueries.add(symbol);

    // 异步记录到数据库（可选，用于持久化）
    try {
      await this.saveToDatabase(symbol);
    } catch (error: any) {
      console.error(`[配额监控] 保存到数据库失败:`, error.message);
      // 不影响主流程，只记录错误
    }
  }

  /**
   * 检查配额使用情况
   * @param quotaLimit 配额上限（默认1000）
   * @returns 是否超过配额
   */
  async checkQuota(quotaLimit: number = 1000): Promise<{
    isOverQuota: boolean;
    currentUsage: number;
    usageRate: number;
    remaining: number;
  }> {
    this.checkAndResetIfNeeded();

    const currentUsage = this.monthlyQueries.size;
    const usageRate = (currentUsage / quotaLimit) * 100;
    const remaining = Math.max(0, quotaLimit - currentUsage);

    return {
      isOverQuota: currentUsage >= quotaLimit,
      currentUsage,
      usageRate,
      remaining,
    };
  }

  /**
   * 获取配额使用率
   * @param quotaLimit 配额上限（默认1000）
   * @returns 使用率（0-100）
   */
  async getUsageRate(quotaLimit: number = 1000): Promise<number> {
    const quota = await this.checkQuota(quotaLimit);
    return quota.usageRate;
  }

  /**
   * 检查是否需要重置（新月份）
   */
  private checkAndResetIfNeeded(): void {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonth = this.lastResetDate.getMonth();
    const lastYear = this.lastResetDate.getFullYear();

    // 如果是新月份，重置计数器
    if (currentMonth !== lastMonth || currentYear !== lastYear) {
      console.log(`[配额监控] 新月份，重置配额计数器 (${lastYear}-${lastMonth + 1} -> ${currentYear}-${currentMonth + 1})`);
      this.monthlyQueries.clear();
      this.lastResetDate = now;
    }
  }

  /**
   * 保存到数据库（可选，用于持久化）
   */
  private async saveToDatabase(symbol: string): Promise<void> {
    // TODO: 如果需要持久化，可以创建数据库表
    // CREATE TABLE IF NOT EXISTS quota_usage (
    //   id SERIAL PRIMARY KEY,
    //   symbol VARCHAR(50) NOT NULL,
    //   query_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    //   UNIQUE(symbol, DATE(query_date))
    // );
    
    // 当前只使用内存缓存，不持久化
  }

  /**
   * 从数据库加载历史数据（可选）
   */
  async loadFromDatabase(): Promise<void> {
    // TODO: 如果需要从数据库加载历史数据
  }

  /**
   * 重置计数器（用于测试）
   */
  reset(): void {
    this.monthlyQueries.clear();
    this.lastResetDate = new Date();
  }
}

// 单例模式
export const quotaMonitor = new QuotaMonitor();

