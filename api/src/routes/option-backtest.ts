/**
 * 期权回测 API 路由
 * POST /api/option-backtest — 创建回测任务（异步执行）
 * GET  /api/option-backtest/:id — 获取回测结果
 */

import express, { Request, Response, NextFunction } from 'express';
import optionBacktestService from '../services/option-backtest.service';
import { logger } from '../utils/logger';
import { ErrorFactory, normalizeError } from '../utils/errors';

const optionBacktestRouter = express.Router();

/**
 * @openapi
 * /option-backtest:
 *   post:
 *     tags:
 *       - 期权回测
 *     summary: 创建期权策略回测任务
 *     description: 回放 OPTION_INTRADAY_V1 策略在指定日期的表现（异步执行）
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dates
 *               - symbols
 *             properties:
 *               dates:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: date
 *                 description: 回测日期列表 (YYYY-MM-DD)
 *                 example: ["2026-02-18", "2026-02-19"]
 *               symbols:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: 底层标的列表
 *                 example: ["QQQ.US"]
 *               config:
 *                 type: object
 *                 description: 覆盖回测配置（可选）
 *                 properties:
 *                   entryThreshold:
 *                     type: number
 *                     description: 入场信号阈值（默认15）
 *                   riskPreference:
 *                     type: string
 *                     enum: [AGGRESSIVE, CONSERVATIVE]
 *                   positionContracts:
 *                     type: integer
 *                     description: 每笔合约数（默认1）
 *                   tradeWindowStartET:
 *                     type: integer
 *                     description: 交易窗口开始（ET分钟数，默认570=9:30）
 *                   tradeWindowEndET:
 *                     type: integer
 *                     description: 交易窗口结束（ET分钟数，默认630=10:30）
 *                   maxTradesPerDay:
 *                     type: integer
 *                     description: 每日最大交易数（默认3）
 *     responses:
 *       200:
 *         description: 任务创建成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: 回测任务ID
 *                     status:
 *                       type: string
 *                       example: PENDING
 */
optionBacktestRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dates, symbols, config } = req.body;

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      return next(ErrorFactory.missingParameter('dates (数组, 格式 YYYY-MM-DD)'));
    }

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return next(ErrorFactory.missingParameter('symbols (数组, 如 ["QQQ.US"])'));
    }

    // 验证日期格式
    for (const d of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return next(ErrorFactory.validationError(`日期格式错误: ${d}，需要 YYYY-MM-DD`));
      }
    }

    logger.info(`[期权回测] 创建任务: dates=${dates.join(',')}, symbols=${symbols.join(',')}`);

    const taskId = await optionBacktestService.createTask(dates, symbols, config);

    // 异步执行
    optionBacktestService.executeAsync(taskId, dates, symbols, config)
      .catch((error: unknown) => {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[期权回测] 任务 ${taskId} 执行异常: ${errMsg}`);
      });

    res.json({
      success: true,
      data: {
        id: taskId,
        status: 'PENDING',
        message: '期权回测任务已创建，正在后台执行',
      },
    });
  } catch (error: unknown) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /option-backtest/{id}:
 *   get:
 *     tags:
 *       - 期权回测
 *     summary: 获取期权回测结果
 *     description: 获取指定回测任务的详细结果
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 回测任务ID
 *     responses:
 *       200:
 *         description: 查询成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     trades:
 *                       type: array
 *                       items:
 *                         type: object
 *                     summary:
 *                       type: object
 */
optionBacktestRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return next(ErrorFactory.validationError('无效的回测ID'));
    }

    const result = await optionBacktestService.getResult(id);

    if (!result) {
      return next(ErrorFactory.notFound('期权回测结果'));
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

export default optionBacktestRouter;
