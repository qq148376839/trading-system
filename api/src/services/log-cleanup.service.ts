/**
 * 日志清理服务
 * 提供自动清理和手动清理功能
 * 配置从system_config表读取，可通过系统设置界面调整
 */

import pool from '../config/database';
import { infraLogger } from '../utils/infra-logger';
import configService from './config.service';

interface CleanupResult {
  deletedCount: number;
  dryRun: boolean;
  beforeDate: Date;
  executedAt: Date;
}

class LogCleanupService {
  private cronJob: any = null;
  private retentionDays: number = -1; // -1表示不清理
  private autoCleanupEnabled: boolean = false;
  private cleanupSchedule: string = '0 2 * * *'; // 每天凌晨2点
  private configCheckInterval: NodeJS.Timeout | null = null;

  /**
   * 初始化清理服务
   */
  async init(): Promise<void> {
    // 从system_config读取配置
    await this.loadConfig();

    // 如果启用自动清理，启动定时任务
    if (this.autoCleanupEnabled && this.retentionDays > 0) {
      this.startAutoCleanup();
      infraLogger.info(`[LogCleanup] 自动清理服务已启动`, { retentionDays: this.retentionDays, schedule: this.cleanupSchedule });
    } else {
      infraLogger.info(`[LogCleanup] 自动清理服务未启用`, { retentionDays: this.retentionDays, autoCleanupEnabled: this.autoCleanupEnabled });
    }

    // 定期检查配置更新（每5分钟）
    this.configCheckInterval = setInterval(async () => {
      await this.loadConfig();
      // 如果配置变化，重启定时任务
      if (this.autoCleanupEnabled && this.retentionDays > 0) {
        if (!this.cronJob) {
          this.startAutoCleanup();
        }
      } else {
        if (this.cronJob) {
          this.stopAutoCleanup();
        }
      }
    }, 5 * 60 * 1000); // 5分钟
  }

  /**
   * 从system_config加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const retentionDaysStr = await configService.getConfig('log_retention_days');
      this.retentionDays = retentionDaysStr ? parseInt(retentionDaysStr, 10) : -1;

      const autoCleanupStr = await configService.getConfig('log_auto_cleanup_enabled');
      this.autoCleanupEnabled = autoCleanupStr === 'true';

      const schedule = await configService.getConfig('log_cleanup_schedule');
      this.cleanupSchedule = schedule || '0 2 * * *';
    } catch (error: any) {
      infraLogger.error(`[LogCleanup] 加载配置失败，使用默认值: ${error.message}`);
      // 使用默认值
      this.retentionDays = -1;
      this.autoCleanupEnabled = false;
      this.cleanupSchedule = '0 2 * * *';
    }
  }

  /**
   * 启动自动清理定时任务
   */
  private startAutoCleanup(): void {
    try {
      const cron = require('node-cron');
      
      if (this.cronJob) {
        this.stopAutoCleanup();
      }

      this.cronJob = cron.schedule(
        this.cleanupSchedule,
        async () => {
          try {
            const beforeDate = new Date();
            beforeDate.setDate(beforeDate.getDate() - this.retentionDays);

            infraLogger.info(`[LogCleanup] 执行自动清理`, { beforeDate: beforeDate.toISOString(), retentionDays: this.retentionDays });

            const result = await this.cleanup(beforeDate, false);

            infraLogger.info(`[LogCleanup] 自动清理完成, 删除 ${result.deletedCount} 条, beforeDate=${result.beforeDate.toISOString()}`);
          } catch (error: any) {
            infraLogger.error(`[LogCleanup] 自动清理失败: ${error.message}`);
          }
        },
        {
          timezone: process.env.TZ || 'UTC',
        }
      );
    } catch (error: any) {
      infraLogger.warn(`[LogCleanup] 无法启动自动清理定时任务（node-cron未安装）: ${error.message}`);
    }
  }

  /**
   * 停止自动清理定时任务
   */
  stopAutoCleanup(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      infraLogger.info('[LogCleanup] 自动清理服务已停止');
    }

    if (this.configCheckInterval) {
      clearInterval(this.configCheckInterval);
      this.configCheckInterval = null;
    }
  }

  /**
   * 清理日志
   * @param beforeDate 删除此日期之前的日志
   * @param dryRun 是否仅预览，不实际删除
   */
  async cleanup(beforeDate: Date, dryRun: boolean = false): Promise<CleanupResult> {
    try {
      // 查询需要删除的日志数量
      const countQuery = `
        SELECT COUNT(*) as count
        FROM system_logs
        WHERE timestamp < $1
      `;
      const countResult = await pool.query(countQuery, [beforeDate.toISOString()]);
      const count = parseInt(countResult.rows[0].count, 10);

      if (dryRun) {
        // 仅预览，不实际删除
        return {
          deletedCount: count,
          dryRun: true,
          beforeDate,
          executedAt: new Date(),
        };
      }

      // 实际删除
      const deleteQuery = `
        DELETE FROM system_logs
        WHERE timestamp < $1
      `;
      const deleteResult = await pool.query(deleteQuery, [beforeDate.toISOString()]);

      infraLogger.info(`[LogCleanup] 日志清理完成, 删除 ${deleteResult.rowCount || 0} 条, beforeDate=${beforeDate.toISOString()}`);

      return {
        deletedCount: deleteResult.rowCount || 0,
        dryRun: false,
        beforeDate,
        executedAt: new Date(),
      };
    } catch (error: any) {
      infraLogger.error(`[LogCleanup] 清理日志失败: ${error.message}, beforeDate=${beforeDate.toISOString()}`);
      throw error;
    }
  }

  /**
   * 获取清理配置
   */
  getConfig(): {
    retentionDays: number;
    autoCleanupEnabled: boolean;
    cleanupSchedule: string;
  } {
    return {
      retentionDays: this.retentionDays,
      autoCleanupEnabled: this.autoCleanupEnabled,
      cleanupSchedule: this.cleanupSchedule,
    };
  }
}

// 单例模式
const logCleanupService = new LogCleanupService();

export default logCleanupService;

