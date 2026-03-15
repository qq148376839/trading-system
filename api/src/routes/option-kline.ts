/**
 * 期权交易K线 API 路由
 * 提供期权K线数据查询、分析摘要、手动触发采集、采集状态监控
 */

import { Router, Request, Response, NextFunction } from 'express';
import optionKlineCollectionService from '../services/option-kline-collection.service';
import { normalizeError } from '../utils/errors';

export const optionKlineRouter = Router();

/**
 * @openapi
 * /quant/option-kline/analysis:
 *   get:
 *     tags:
 *       - 期权K线分析
 *     summary: 查询分析摘要
 *     description: 查询期权交易的分析摘要（原始 vs 反向盈亏对比）
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 开始日期 YYYY-MM-DD
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 结束日期 YYYY-MM-DD
 *       - in: query
 *         name: underlying
 *         schema:
 *           type: string
 *         description: 标的代码（如 QQQ）
 *       - in: query
 *         name: orderId
 *         schema:
 *           type: string
 *         description: 订单 ID
 *     responses:
 *       200:
 *         description: 分析摘要列表
 */
optionKlineRouter.get('/analysis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, underlying, orderId } = req.query;
    const data = await optionKlineCollectionService.getAnalysis({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      underlying: underlying as string | undefined,
      orderId: orderId as string | undefined,
    });
    res.json({ success: true, data, count: data.length });
  } catch (error: any) {
    next(normalizeError(error));
  }
});

/**
 * @openapi
 * /quant/option-kline/candles:
 *   get:
 *     tags:
 *       - 期权K线分析
 *     summary: 查询K线数据
 *     description: 查询指定订单的期权K线数据（正向或反向）
 *     parameters:
 *       - in: query
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: 订单 ID
 *       - in: query
 *         name: klineType
 *         schema:
 *           type: string
 *           enum: [ORIGINAL, REVERSE]
 *         description: K线类型（不传则返回所有）
 *     responses:
 *       200:
 *         description: K线数据列表
 *       400:
 *         description: 缺少 orderId 参数
 */
optionKlineRouter.get('/candles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, klineType } = req.query;
    if (!orderId) {
      res.status(400).json({ success: false, error: '缺少 orderId 参数' });
      return;
    }
    const data = await optionKlineCollectionService.getCandles(
      orderId as string,
      klineType as string | undefined
    );
    res.json({ success: true, data, count: data.length });
  } catch (error: any) {
    next(normalizeError(error));
  }
});

/**
 * @openapi
 * /quant/option-kline/collect:
 *   post:
 *     tags:
 *       - 期权K线分析
 *     summary: 手动触发采集
 *     description: 手动触发指定日期或日期范围的期权K线采集
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *                 format: date
 *                 description: 单日采集 YYYY-MM-DD
 *               dateRange:
 *                 type: object
 *                 properties:
 *                   start:
 *                     type: string
 *                     format: date
 *                   end:
 *                     type: string
 *                     format: date
 *                 description: 日期范围采集
 *     responses:
 *       200:
 *         description: 采集结果
 *       409:
 *         description: 采集正在进行中
 */
optionKlineRouter.post('/collect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (optionKlineCollectionService.isCollecting()) {
      res.status(409).json({ success: false, error: '期权K线采集正在进行中，请稍后再试' });
      return;
    }

    const { date, dateRange } = req.body;

    if (dateRange && dateRange.start && dateRange.end) {
      const results = await optionKlineCollectionService.collectForDateRange(dateRange.start, dateRange.end);
      res.json({ success: true, data: results });
    } else if (date) {
      const result = await optionKlineCollectionService.collectForDate(date);
      res.json({ success: true, data: result });
    } else {
      // 默认采集今天
      const today = new Date().toISOString().split('T')[0];
      const result = await optionKlineCollectionService.collectForDate(today);
      res.json({ success: true, data: result });
    }
  } catch (error: any) {
    next(normalizeError(error));
  }
});

/**
 * @openapi
 * /quant/option-kline/enrich:
 *   post:
 *     tags:
 *       - 期权K线分析
 *     summary: 补充分析数据
 *     description: 从 strategy_signals 补充 option_trade_analysis 中缺失的字段（strategy/score/pnl/exit）
 *     responses:
 *       200:
 *         description: 补充结果
 */
optionKlineRouter.post('/enrich', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await optionKlineCollectionService.enrichAnalysisFromSignals();
    res.json({ success: true, data: { enriched: count } });
  } catch (error: any) {
    next(normalizeError(error));
  }
});

/**
 * @openapi
 * /quant/option-kline/status:
 *   get:
 *     tags:
 *       - 期权K线分析
 *     summary: 采集状态概览
 *     description: 查看期权K线采集服务状态和统计信息
 *     responses:
 *       200:
 *         description: 采集状态
 */
optionKlineRouter.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await optionKlineCollectionService.getStatus();
    res.json({ success: true, data: status });
  } catch (error: any) {
    next(normalizeError(error));
  }
});
