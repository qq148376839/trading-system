/**
 * 订单重复提交防护机制 - 监控指标 API
 */

import { Router, Request, Response } from 'express';
import orderPreventionMetrics from '../services/order-prevention-metrics.service';
import { logger } from '../utils/logger';

export const orderPreventionMetricsRouter = Router();

/**
 * GET /api/order-prevention-metrics
 * 获取当前监控指标
 */
orderPreventionMetricsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const metrics = orderPreventionMetrics.getMetrics();
    const report = orderPreventionMetrics.generateReport();
    
    res.json({
      success: true,
      data: {
        metrics,
        report,
        rates: {
          positionValidationPassRate: orderPreventionMetrics.getPositionValidationPassRate(),
          positionValidationFailRate: orderPreventionMetrics.getPositionValidationFailRate(),
          shortPositionCloseSuccessRate: orderPreventionMetrics.getShortPositionCloseSuccessRate(),
          tradePushSuccessRate: orderPreventionMetrics.getTradePushSuccessRate(),
        }
      }
    });
  } catch (error: any) {
    logger.error('获取监控指标失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取监控指标失败'
    });
  }
});

/**
 * POST /api/order-prevention-metrics/reset
 * 重置所有监控指标
 */
orderPreventionMetricsRouter.post('/reset', async (req: Request, res: Response) => {
  try {
    orderPreventionMetrics.resetMetrics();
    res.json({
      success: true,
      message: '监控指标已重置'
    });
  } catch (error: any) {
    logger.error('重置监控指标失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重置监控指标失败'
    });
  }
});

/**
 * POST /api/order-prevention-metrics/save
 * 保存监控指标到数据库
 */
orderPreventionMetricsRouter.post('/save', async (req: Request, res: Response) => {
  try {
    await orderPreventionMetrics.saveMetricsToDatabase();
    res.json({
      success: true,
      message: '监控指标已保存到数据库'
    });
  } catch (error: any) {
    logger.error('保存监控指标失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '保存监控指标失败'
    });
  }
});

