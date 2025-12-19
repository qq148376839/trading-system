/**
 * 交易推荐API路由
 * 为持仓和关注列表中的US股票生成交易推荐
 */

import { Router, Request, Response, NextFunction } from 'express';
import tradingRecommendationService from '../services/trading-recommendation.service';
import { rateLimiter } from '../middleware/rateLimiter';
import { ErrorFactory, normalizeError } from '../utils/errors';

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
tradingRecommendationRouter.get('/', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
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
      return next(ErrorFactory.validationError('symbols参数格式错误'));
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
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/trading-recommendation/market-regime
 * 获取市场状态矩阵（全局市场环境指标）
 * 
 * 注意：此路由必须在 /:symbol 路由之前定义，避免路径冲突
 *
 * 响应：
 * - market_regime: 市场状态矩阵对象
 */
tradingRecommendationRouter.get('/market-regime', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 获取全局市场状态矩阵（不依赖具体股票）
    const marketRegime = await tradingRecommendationService.getMarketRegime();

    res.json({
      success: true,
      data: {
        market_regime: marketRegime,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
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
tradingRecommendationRouter.get('/:symbol', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params;

    // 验证symbol格式
    if (!symbol.endsWith('.US')) {
      return next(ErrorFactory.validationError('只支持US股票，symbol格式应为：AAPL.US'));
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
    const appError = normalizeError(error);
    return next(appError);
  }
});
