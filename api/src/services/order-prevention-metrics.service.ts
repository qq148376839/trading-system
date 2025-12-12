/**
 * 订单重复提交防护机制 - 监控指标服务
 * 跟踪关键指标，用于监控和告警
 */

import pool from '../config/database';
import { logger } from '../utils/logger';

interface Metrics {
  // 持仓验证指标
  positionValidationTotal: number;        // 持仓验证总次数
  positionValidationPassed: number;       // 持仓验证通过次数
  positionValidationFailed: number;       // 持仓验证失败次数
  
  // 订单去重指标
  duplicateOrderPrevented: number;        // 阻止重复订单提交次数
  duplicateOrderByCache: number;           // 通过缓存阻止的次数
  duplicateOrderByPending: number;        // 通过未成交订单检查阻止的次数
  
  // 卖空检测指标
  shortPositionDetected: number;          // 检测到卖空持仓次数
  shortPositionClosed: number;            // 自动平仓次数
  shortPositionCloseFailed: number;       // 平仓失败次数
  
  // 交易推送指标
  tradePushReceived: number;              // 收到交易推送次数
  tradePushError: number;                 // 交易推送错误次数
  
  // 订单拒绝指标
  orderRejectedByPosition: number;       // 因持仓不足拒绝的订单数
  orderRejectedByDuplicate: number;      // 因重复提交拒绝的订单数
}

class OrderPreventionMetricsService {
  private metrics: Metrics = {
    positionValidationTotal: 0,
    positionValidationPassed: 0,
    positionValidationFailed: 0,
    duplicateOrderPrevented: 0,
    duplicateOrderByCache: 0,
    duplicateOrderByPending: 0,
    shortPositionDetected: 0,
    shortPositionClosed: 0,
    shortPositionCloseFailed: 0,
    tradePushReceived: 0,
    tradePushError: 0,
    orderRejectedByPosition: 0,
    orderRejectedByDuplicate: 0,
  };

  /**
   * 记录持仓验证结果
   */
  recordPositionValidation(passed: boolean): void {
    this.metrics.positionValidationTotal++;
    if (passed) {
      this.metrics.positionValidationPassed++;
      logger.debug(`[监控指标] 持仓验证通过，通过率=${this.getPositionValidationPassRate().toFixed(2)}%`);
    } else {
      this.metrics.positionValidationFailed++;
      logger.warn(`[监控指标] 持仓验证失败，失败率=${this.getPositionValidationFailRate().toFixed(2)}%`);
    }
  }

  /**
   * 记录重复订单阻止
   */
  recordDuplicateOrderPrevented(reason: 'cache' | 'pending'): void {
    this.metrics.duplicateOrderPrevented++;
    if (reason === 'cache') {
      this.metrics.duplicateOrderByCache++;
    } else {
      this.metrics.duplicateOrderByPending++;
    }
    logger.log(`[监控指标] 阻止重复订单提交，原因=${reason}，总阻止次数=${this.metrics.duplicateOrderPrevented}`);
  }

  /**
   * 记录卖空检测
   */
  recordShortPositionDetected(count: number): void {
    this.metrics.shortPositionDetected += count;
    logger.warn(`[监控指标] 检测到卖空持仓，数量=${count}，累计检测次数=${this.metrics.shortPositionDetected}`);
  }

  /**
   * 记录卖空平仓结果
   */
  recordShortPositionClose(success: boolean): void {
    if (success) {
      this.metrics.shortPositionClosed++;
      logger.log(`[监控指标] 卖空持仓平仓成功，累计平仓次数=${this.metrics.shortPositionClosed}`);
    } else {
      this.metrics.shortPositionCloseFailed++;
      logger.error(`[监控指标] 卖空持仓平仓失败，累计失败次数=${this.metrics.shortPositionCloseFailed}`);
    }
  }

  /**
   * 记录交易推送
   */
  recordTradePush(received: boolean): void {
    if (received) {
      this.metrics.tradePushReceived++;
      logger.debug(`[监控指标] 收到交易推送，累计接收次数=${this.metrics.tradePushReceived}`);
    } else {
      this.metrics.tradePushError++;
      logger.error(`[监控指标] 交易推送错误，累计错误次数=${this.metrics.tradePushError}`);
    }
  }

  /**
   * 记录订单拒绝
   */
  recordOrderRejected(reason: 'position' | 'duplicate'): void {
    if (reason === 'position') {
      this.metrics.orderRejectedByPosition++;
      logger.warn(`[监控指标] 订单因持仓不足被拒绝，累计拒绝次数=${this.metrics.orderRejectedByPosition}`);
    } else {
      this.metrics.orderRejectedByDuplicate++;
      logger.warn(`[监控指标] 订单因重复提交被拒绝，累计拒绝次数=${this.metrics.orderRejectedByDuplicate}`);
    }
  }

  /**
   * 获取所有指标
   */
  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  /**
   * 获取持仓验证通过率
   */
  getPositionValidationPassRate(): number {
    if (this.metrics.positionValidationTotal === 0) return 0;
    return (this.metrics.positionValidationPassed / this.metrics.positionValidationTotal) * 100;
  }

  /**
   * 获取持仓验证失败率
   */
  getPositionValidationFailRate(): number {
    if (this.metrics.positionValidationTotal === 0) return 0;
    return (this.metrics.positionValidationFailed / this.metrics.positionValidationTotal) * 100;
  }

  /**
   * 获取卖空平仓成功率
   */
  getShortPositionCloseSuccessRate(): number {
    const total = this.metrics.shortPositionClosed + this.metrics.shortPositionCloseFailed;
    if (total === 0) return 0;
    return (this.metrics.shortPositionClosed / total) * 100;
  }

  /**
   * 获取交易推送成功率
   */
  getTradePushSuccessRate(): number {
    const total = this.metrics.tradePushReceived + this.metrics.tradePushError;
    if (total === 0) return 0;
    return (this.metrics.tradePushReceived / total) * 100;
  }

  /**
   * 重置所有指标
   */
  resetMetrics(): void {
    this.metrics = {
      positionValidationTotal: 0,
      positionValidationPassed: 0,
      positionValidationFailed: 0,
      duplicateOrderPrevented: 0,
      duplicateOrderByCache: 0,
      duplicateOrderByPending: 0,
      shortPositionDetected: 0,
      shortPositionClosed: 0,
      shortPositionCloseFailed: 0,
      tradePushReceived: 0,
      tradePushError: 0,
      orderRejectedByPosition: 0,
      orderRejectedByDuplicate: 0,
    };
    logger.log('[监控指标] 所有指标已重置');
  }

  /**
   * 保存指标到数据库（用于历史记录）
   */
  async saveMetricsToDatabase(): Promise<void> {
    try {
      const metrics = this.getMetrics();
      const timestamp = new Date();
      
      await pool.query(
        `INSERT INTO order_prevention_metrics 
         (timestamp, position_validation_total, position_validation_passed, position_validation_failed,
          duplicate_order_prevented, duplicate_order_by_cache, duplicate_order_by_pending,
          short_position_detected, short_position_closed, short_position_close_failed,
          trade_push_received, trade_push_error,
          order_rejected_by_position, order_rejected_by_duplicate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          timestamp,
          metrics.positionValidationTotal,
          metrics.positionValidationPassed,
          metrics.positionValidationFailed,
          metrics.duplicateOrderPrevented,
          metrics.duplicateOrderByCache,
          metrics.duplicateOrderByPending,
          metrics.shortPositionDetected,
          metrics.shortPositionClosed,
          metrics.shortPositionCloseFailed,
          metrics.tradePushReceived,
          metrics.tradePushError,
          metrics.orderRejectedByPosition,
          metrics.orderRejectedByDuplicate,
        ]
      );
      
      logger.debug('[监控指标] 指标已保存到数据库');
    } catch (error: any) {
      logger.error('[监控指标] 保存指标到数据库失败:', error);
      // 不抛出错误，避免影响主流程
    }
  }

  /**
   * 生成监控报告
   */
  generateReport(): string {
    const metrics = this.getMetrics();
    const report = `
订单重复提交防护机制 - 监控报告
=====================================
生成时间: ${new Date().toISOString()}

持仓验证指标:
  - 总验证次数: ${metrics.positionValidationTotal}
  - 通过次数: ${metrics.positionValidationPassed}
  - 失败次数: ${metrics.positionValidationFailed}
  - 通过率: ${this.getPositionValidationPassRate().toFixed(2)}%
  - 失败率: ${this.getPositionValidationFailRate().toFixed(2)}%

订单去重指标:
  - 阻止重复订单总数: ${metrics.duplicateOrderPrevented}
  - 通过缓存阻止: ${metrics.duplicateOrderByCache}
  - 通过未成交订单检查阻止: ${metrics.duplicateOrderByPending}

卖空检测指标:
  - 检测到卖空持仓次数: ${metrics.shortPositionDetected}
  - 自动平仓成功次数: ${metrics.shortPositionClosed}
  - 自动平仓失败次数: ${metrics.shortPositionCloseFailed}
  - 平仓成功率: ${this.getShortPositionCloseSuccessRate().toFixed(2)}%

交易推送指标:
  - 收到推送次数: ${metrics.tradePushReceived}
  - 推送错误次数: ${metrics.tradePushError}
  - 推送成功率: ${this.getTradePushSuccessRate().toFixed(2)}%

订单拒绝指标:
  - 因持仓不足拒绝: ${metrics.orderRejectedByPosition}
  - 因重复提交拒绝: ${metrics.orderRejectedByDuplicate}
=====================================
`;
    return report;
  }
}

// 导出单例
export default new OrderPreventionMetricsService();

