/**
 * 回测API路由
 */

import express, { Request, Response } from 'express';
import backtestService from '../services/backtest.service';
import pool from '../config/database';
import { logger } from '../utils/logger';

const backtestRouter = express.Router();

/**
 * 创建回测任务（异步）
 * POST /api/quant/backtest
 */
backtestRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { strategyId, symbols, startDate, endDate, config } = req.body;

    if (!strategyId || !symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: strategyId, symbols (数组)',
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: startDate, endDate',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: '日期格式错误',
      });
    }

    if (start >= end) {
      return res.status(400).json({
        success: false,
        error: '开始日期必须早于结束日期',
      });
    }

    logger.log(`创建回测任务: 策略ID=${strategyId}, 标的=${symbols.join(',')}`);

    // 创建回测任务
    const taskId = await backtestService.createBacktestTask(
      strategyId,
      symbols,
      start,
      end,
      config
    );

    // 异步执行回测（不等待完成）
    backtestService.executeBacktestAsync(taskId, strategyId, symbols, start, end, config)
      .catch((error: any) => {
        logger.error(`回测任务 ${taskId} 执行失败:`, error);
      });

    // 立即返回任务ID和状态
    res.json({
      success: true,
      data: {
        id: taskId,
        status: 'PENDING',
        message: '回测任务已创建，正在后台执行',
      },
    });
  } catch (error: any) {
    logger.error('创建回测任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '创建回测任务失败',
    });
  }
});

/**
 * 获取回测结果
 * GET /api/quant/backtest/:id
 */
backtestRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: '无效的回测ID',
      });
    }

    const result = await backtestService.getBacktestResult(id, true);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: '回测结果不存在',
      });
    }

    // 限制返回的数据量，避免响应过大
    const responseData: any = { ...result };

    // 如果交易数据过多，只返回前2000条
    if (responseData.trades && Array.isArray(responseData.trades) && responseData.trades.length > 2000) {
      logger.warn(`回测结果交易数量过多 (${responseData.trades.length})，返回时限制为前2000条`);
      responseData.trades = responseData.trades.slice(0, 2000);
    }

    // 如果每日收益数据过多，进行采样
    if (responseData.dailyReturns && Array.isArray(responseData.dailyReturns) && responseData.dailyReturns.length > 2000) {
      logger.warn(`回测结果每日收益数据过多 (${responseData.dailyReturns.length})，返回时进行采样`);
      const step = Math.ceil(responseData.dailyReturns.length / 2000);
      responseData.dailyReturns = responseData.dailyReturns.filter((_: any, i: number) => i % step === 0);
    }

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error: any) {
    logger.error('获取回测结果失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取回测结果失败',
    });
  }
});

/**
 * 获取回测状态
 * GET /api/quant/backtest/:id/status
 */
backtestRouter.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: '无效的回测ID',
      });
    }

    const status = await backtestService.getBacktestStatus(id);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: '回测任务不存在',
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    logger.error('获取回测状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取回测状态失败',
    });
  }
});

/**
 * 重试失败的回测任务
 * POST /api/quant/backtest/:id/retry
 */
backtestRouter.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: '无效的回测ID',
      });
    }

    // 获取回测任务信息
    const query = await pool.query(
      `SELECT strategy_id, start_date, end_date, config, status 
       FROM backtest_results WHERE id = $1`,
      [id]
    );

    if (query.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '回测任务不存在',
      });
    }

    const row = query.rows[0];
    if (row.status !== 'FAILED') {
      return res.status(400).json({
        success: false,
        error: '只能重试失败的回测任务',
      });
    }

    const config = typeof row.config === 'string' ? JSON.parse(row.config) : (row.config || {});
    const startDate = new Date(row.start_date);
    const endDate = new Date(row.end_date);

    // 从请求中获取标的代码
    const { symbols } = req.body;
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: symbols (数组)',
      });
    }

    // 重置状态为PENDING
    await backtestService.updateBacktestStatus(id, 'PENDING');

    // 异步执行回测
    backtestService.executeBacktestAsync(
      id,
      row.strategy_id,
      symbols,
      startDate,
      endDate,
      config
    ).catch((error: any) => {
      logger.error(`重试回测任务 ${id} 失败:`, error);
    });

    res.json({
      success: true,
      data: {
        id,
        status: 'PENDING',
        message: '回测任务已重新开始执行',
      },
    });
  } catch (error: any) {
    logger.error('重试回测任务失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重试回测任务失败',
    });
  }
});

/**
 * 获取策略的所有回测结果
 * GET /api/quant/backtest/strategy/:strategyId
 */
backtestRouter.get('/strategy/:strategyId', async (req: Request, res: Response) => {
  try {
    const strategyId = parseInt(req.params.strategyId);

    if (isNaN(strategyId)) {
      return res.status(400).json({
        success: false,
        error: '无效的策略ID',
      });
    }

    const results = await backtestService.getBacktestResultsByStrategy(strategyId);

    res.json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error('获取回测结果列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取回测结果列表失败',
    });
  }
});

/**
 * 导出回测结果为JSON文件
 * GET /api/quant/backtest/:id/export
 */
backtestRouter.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: '无效的回测ID',
      });
    }

    // 获取完整的回测结果（不限制数据量）
    const result = await backtestService.getBacktestResult(id, true);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: '回测结果不存在',
      });
    }

    // 获取策略信息
    let strategyName = `策略 #${result.strategyId}`;
    try {
      const strategyResult = await pool.query(
        'SELECT name FROM strategies WHERE id = $1',
        [result.strategyId]
      );
      if (strategyResult.rows.length > 0) {
        strategyName = strategyResult.rows[0].name;
      }
    } catch (error) {
      // 忽略策略查询错误
    }

    // 构建导出数据（包含完整的回测结果和元数据）
    const exportData = {
      // 元数据
      metadata: {
        exportTime: new Date().toISOString(),
        exportVersion: '1.0',
        description: '回测结果导出数据，用于大模型分析',
      },
      // 基本信息
      basicInfo: {
        id: result.id,
        strategyId: result.strategyId,
        strategyName: strategyName,
        startDate: result.startDate,
        endDate: result.endDate,
        status: result.status,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        errorMessage: result.errorMessage,
      },
      // 性能指标
      performance: {
        totalReturn: result.totalReturn,
        totalTrades: result.totalTrades,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        winRate: result.winRate,
        avgReturn: result.avgReturn,
        maxDrawdown: result.maxDrawdown,
        sharpeRatio: result.sharpeRatio,
        avgHoldingTime: result.avgHoldingTime,
      },
      // 交易明细
      trades: result.trades || [],
      // 每日收益曲线
      dailyReturns: result.dailyReturns || [],
      // 分析建议（供大模型参考）
      analysisHints: {
        keyMetrics: [
          'totalReturn: 总收益率，正值表示盈利，负值表示亏损',
          'winRate: 胜率，表示盈利交易占总交易的比例',
          'maxDrawdown: 最大回撤，表示从峰值到谷底的最大跌幅',
          'sharpeRatio: 夏普比率，衡量风险调整后的收益',
        ],
        tradeAnalysis: [
          'trades数组包含所有交易的详细信息',
          '每笔交易包含：买入价、卖出价、盈亏、持仓时间等',
          '可以通过分析entryReason和exitReason了解交易逻辑',
        ],
        equityCurve: [
          'dailyReturns数组包含每日的权益变化',
          '可以用于绘制收益曲线和计算回撤',
          'equity字段表示当日总权益（现金+持仓市值）',
        ],
      },
    };

    // 设置响应头，返回JSON文件
    const filename = `backtest_${result.strategyId}_${result.startDate}_${result.endDate}_${result.id}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.json(exportData);
  } catch (error: any) {
    logger.error('导出回测结果失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '导出回测结果失败',
    });
  }
});

/**
 * 批量删除回测结果
 * DELETE /api/quant/backtest/batch
 */
backtestRouter.delete('/batch', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: ids (数组)',
      });
    }

    // 验证所有ID都是数字
    const validIds = ids.filter(id => !isNaN(parseInt(String(id)))).map(id => parseInt(String(id)));
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: '无效的回测ID列表',
      });
    }

    // 批量删除
    const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');
    const query = `DELETE FROM backtest_results WHERE id IN (${placeholders}) RETURNING id`;
    const result = await pool.query(query, validIds);

    res.json({
      success: true,
      message: `成功删除 ${result.rows.length} 条回测结果`,
      deletedCount: result.rows.length,
    });
  } catch (error: any) {
    logger.error('批量删除回测结果失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '批量删除回测结果失败',
    });
  }
});

/**
 * 删除回测结果
 * DELETE /api/quant/backtest/:id
 */
backtestRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: '无效的回测ID',
      });
    }

    const query = await pool.query('DELETE FROM backtest_results WHERE id = $1 RETURNING id', [id]);

    if (query.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '回测结果不存在',
      });
    }

    res.json({
      success: true,
      message: '回测结果已删除',
    });
  } catch (error: any) {
    logger.error('删除回测结果失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除回测结果失败',
    });
  }
});

export default backtestRouter;

