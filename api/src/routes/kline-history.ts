/**
 * K线历史数据 API 路由
 * 提供 SPX/USD_INDEX/BTC 分时历史数据查询、采集状态监控、手动触发采集
 */

import { Router, Request, Response, NextFunction } from 'express';
import klineHistoryService from '../services/kline-history.service';
import klineCollectionService from '../services/kline-collection.service';
import { ErrorFactory, normalizeError } from '../utils/errors';

export const klineHistoryRouter = Router();

/**
 * @openapi
 * /kline-history/health:
 *   get:
 *     tags:
 *       - K线历史数据
 *     summary: 采集健康检查
 *     description: 各数据源最后采集时间、数据延迟、连续失败次数
 *     responses:
 *       200:
 *         description: 健康状态
 */
klineHistoryRouter.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await klineCollectionService.getHealthStatus();
    res.json({ success: true, data: health });
  } catch (error: any) {
    next(normalizeError(error));
  }
});

/**
 * @openapi
 * /kline-history/status:
 *   get:
 *     tags:
 *       - K线历史数据
 *     summary: 采集状态概览
 *     description: 最近N次采集记录
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: 返回记录数
 *     responses:
 *       200:
 *         description: 采集状态列表
 */
klineHistoryRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const records = await klineCollectionService.getRecentStatus(limit);
    res.json({ success: true, data: records });
  } catch (error: any) {
    next(normalizeError(error));
  }
});

/**
 * @openapi
 * /kline-history/collect:
 *   post:
 *     tags:
 *       - K线历史数据
 *     summary: 手动触发采集
 *     description: 立即执行一轮3源采集（管理用）
 *     responses:
 *       200:
 *         description: 采集结果
 *       409:
 *         description: 采集正在进行中
 */
klineHistoryRouter.post('/collect', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (klineCollectionService.isCollecting()) {
      res.status(409).json({ success: false, error: '采集正在进行中，请稍后再试' });
      return;
    }
    const results = await klineCollectionService.collectAll();
    res.json({ success: true, data: results });
  } catch (error: any) {
    next(normalizeError(error));
  }
});

/**
 * @openapi
 * /kline-history/completeness/{source}/{date}:
 *   get:
 *     tags:
 *       - K线历史数据
 *     summary: 数据完整性检查
 *     description: 指定日期数据完整性（期望/实际/覆盖率%）
 *     parameters:
 *       - in: path
 *         name: source
 *         required: true
 *         schema:
 *           type: string
 *           enum: [SPX, USD_INDEX, BTC]
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: YYYY-MM-DD
 *     responses:
 *       200:
 *         description: 数据完整性信息
 */
klineHistoryRouter.get('/completeness/:source/:date', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { source, date } = req.params;
    if (!isValidSource(source)) {
      return next(ErrorFactory.validationError(`无效数据源: ${source}，有效值: SPX, USD_INDEX, BTC`));
    }
    if (!isValidDate(date)) {
      return next(ErrorFactory.validationError(`无效日期格式: ${date}，需要 YYYY-MM-DD`));
    }
    const completeness = await klineHistoryService.getCompleteness(source, date);
    res.json({ success: true, data: completeness });
  } catch (error: any) {
    next(normalizeError(error));
  }
});

/**
 * @openapi
 * /kline-history/{source}:
 *   get:
 *     tags:
 *       - K线历史数据
 *     summary: 查询历史分时数据
 *     description: 查询指定数据源的历史K线数据
 *     parameters:
 *       - in: path
 *         name: source
 *         required: true
 *         schema:
 *           type: string
 *           enum: [SPX, USD_INDEX, BTC]
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: 查询日期 YYYY-MM-DD（与 start/end 二选一）
 *       - in: query
 *         name: start
 *         schema:
 *           type: number
 *         description: 开始时间戳（毫秒）
 *       - in: query
 *         name: end
 *         schema:
 *           type: number
 *         description: 结束时间戳（毫秒）
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           default: 1m
 *     responses:
 *       200:
 *         description: K线数据数组
 */
klineHistoryRouter.get('/:source', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { source } = req.params;
    if (!isValidSource(source)) {
      return next(ErrorFactory.validationError(`无效数据源: ${source}，有效值: SPX, USD_INDEX, BTC`));
    }

    const { date, start, end, period } = req.query;

    let data;
    if (date) {
      if (!isValidDate(date as string)) {
        return next(ErrorFactory.validationError(`无效日期格式: ${date}，需要 YYYY-MM-DD`));
      }
      data = await klineHistoryService.getIntradayByDate(source, date as string);
    } else if (start && end) {
      const startTs = parseInt(start as string, 10);
      const endTs = parseInt(end as string, 10);
      if (isNaN(startTs) || isNaN(endTs)) {
        return next(ErrorFactory.validationError('start 和 end 必须是有效的毫秒时间戳'));
      }
      data = await klineHistoryService.getIntradayData(
        source,
        startTs,
        endTs,
        (period as string) || '1m'
      );
    } else {
      return next(ErrorFactory.validationError('需要提供 date 或 start+end 参数'));
    }

    res.json({ success: true, data, count: data.length });
  } catch (error: any) {
    next(normalizeError(error));
  }
});

// --- 辅助函数 ---

function isValidSource(source: string): boolean {
  return ['SPX', 'USD_INDEX', 'BTC'].includes(source);
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}
