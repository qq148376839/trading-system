/**
 * 交易推荐API路由
 * 为持仓和关注列表中的US股票生成交易推荐
 */

import { Router, Request, Response } from 'express';
import tradingRecommendationService from '../services/trading-recommendation.service';
import { rateLimiter } from '../middleware/rateLimiter';

export const tradingRecommendationRouter = Router();

/**
 * GET /api/trading-recommendation
 * 获取交易推荐
 *
 * 查询参数：
 * - symbols: string (可选) 股票代码列表，逗号分隔（如果不提供则返回空数组）
 *
 * 响应：
 * - recommendations: 交易推荐列表
 */
tradingRecommendationRouter.get('/', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbols } = req.query;

    // 处理symbols参数
    let symbolList: string[];
    if (!symbols) {
      // 如果没有提供symbols，返回空数组
      return res.json({
        success: true,
        data: {
          recommendations: [],
        },
      });
    }

    if (typeof symbols === 'string') {
      symbolList = symbols.split(',').map(s => s.trim()).filter(s => s);
    } else if (Array.isArray(symbols)) {
      symbolList = symbols as string[];
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'symbols参数格式错误',
        },
      });
    }

    // 只保留US股票
    symbolList = symbolList.filter(s => s.endsWith('.US'));

    if (symbolList.length === 0) {
      return res.json({
        success: true,
        data: {
          recommendations: [],
        },
      });
    }

    console.log(`开始计算 ${symbolList.length} 个股票的交易推荐...`);

    // 批量计算推荐
    const recommendations = await tradingRecommendationService.calculateBatchRecommendations(
      symbolList
    );

    console.log(`完成交易推荐计算，成功 ${recommendations.size} 个`);

    res.json({
      success: true,
      data: {
        recommendations: Array.from(recommendations.values()),
      },
    });
  } catch (error: any) {
    console.error('获取交易推荐失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '服务器内部错误',
      },
    });
  }
});

/**
 * GET /api/trading-recommendation/:symbol
 * 获取单个股票的交易推荐
 *
 * 路径参数：
 * - symbol: string (必需) 股票代码（例如：AAPL.US）
 *
 * 响应：
 * - recommendation: 交易推荐对象
 */
tradingRecommendationRouter.get('/:symbol', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    // 验证symbol格式
    if (!symbol.endsWith('.US')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SYMBOL',
          message: '只支持US股票，symbol格式应为：AAPL.US',
        },
      });
    }

    console.log(`开始计算 ${symbol} 的交易推荐...`);

    // 计算单个股票的推荐
    const recommendation = await tradingRecommendationService.calculateRecommendation(symbol);

    console.log(`完成 ${symbol} 的交易推荐计算`);

    res.json({
      success: true,
      data: {
        recommendation,
      },
    });
  } catch (error: any) {
    console.error(`获取 ${req.params.symbol} 交易推荐失败:`, error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '服务器内部错误',
      },
    });
  }
});
