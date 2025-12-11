import { Router, Request, Response, NextFunction } from 'express';
import { rateLimiter } from '../middleware/rateLimiter';
import {
  getOptionStrikeDates,
  getOptionChain,
  getOptionDetail,
  getStockIdBySymbol,
  getUnderlyingStockQuote,
  getOptionKline,
  getOptionMinute,
} from '../services/futunn-option-chain.service';
import { ErrorFactory, normalizeError } from '../utils/errors';

export const optionsRouter = Router();

/**
 * GET /api/options/strike-dates
 * 获取期权到期日期列表
 * 
 * 请求参数：
 * - stockId: string (必需) - 正股ID，例如：201335（TSLA）
 * - symbol: string (可选) - 股票代码，例如：TSLA.US（如果提供symbol，会自动查找stockId）
 * 
 * 响应：
 * - strikeDates: 到期日期列表
 * - vol: 成交量统计
 */
optionsRouter.get('/strike-dates', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stockId, symbol } = req.query;

    let finalStockId: string | null = null;

    // 优先使用stockId，如果没有则通过symbol查找
    if (stockId && typeof stockId === 'string') {
      finalStockId = stockId;
    } else if (symbol && typeof symbol === 'string') {
      // 通过symbol查找stockId
      finalStockId = await getStockIdBySymbol(symbol);
      if (!finalStockId) {
        return next(ErrorFactory.notFound(`股票: ${symbol}`));
      }
    } else {
      return next(ErrorFactory.missingParameter('stockId 或 symbol'));
    }

    const result = await getOptionStrikeDates(finalStockId);

    if (!result) {
      return next(ErrorFactory.externalApiError('获取期权到期日期列表失败'));
    }

    res.json({
      success: true,
      data: {
        ...result,
        stockId: finalStockId, // 返回stockId供前端使用
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/options/chain
 * 获取期权链数据
 * 
 * 请求参数：
 * - stockId: string (必需) - 正股ID
 * - strikeDate: number (必需) - 到期日期时间戳（秒级）
 * - symbol: string (可选) - 股票代码（如果提供symbol，会自动查找stockId）
 * 
 * 响应：
 * - chain: 期权链数据数组，每个元素包含callOption和putOption
 */
optionsRouter.get('/chain', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stockId, strikeDate, symbol } = req.query;

    let finalStockId: string | null = null;

    // 优先使用stockId，如果没有则通过symbol查找
    if (stockId && typeof stockId === 'string') {
      finalStockId = stockId;
    } else if (symbol && typeof symbol === 'string') {
      finalStockId = await getStockIdBySymbol(symbol);
      if (!finalStockId) {
        return next(ErrorFactory.notFound(`股票: ${symbol}`));
      }
    } else {
      return next(ErrorFactory.missingParameter('stockId 或 symbol'));
    }

    // 验证strikeDate参数
    if (!strikeDate) {
      return next(ErrorFactory.missingParameter('strikeDate'));
    }

    const strikeDateNum = parseInt(String(strikeDate));
    if (isNaN(strikeDateNum)) {
      return next(ErrorFactory.validationError('strikeDate必须是有效的时间戳（秒级）'));
    }

    const result = await getOptionChain(finalStockId, strikeDateNum);

    if (!result) {
      return next(ErrorFactory.externalApiError('富途API', '获取期权链失败'));
    }

    res.json({
      success: true,
      data: {
        chain: result,
        stockId: finalStockId, // 返回stockId供前端使用
        strikeDate: strikeDateNum,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/options/detail
 * 获取期权详情
 * 
 * 请求参数：
 * - optionId: string (必需) - 期权ID
 * - underlyingStockId: string (必需) - 正股ID
 * - marketType: number (可选) - 市场类型，默认2（美股）
 * 
 * 响应：
 * - detail: 期权详情数据
 */
optionsRouter.get('/detail', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { optionId, underlyingStockId, marketType } = req.query;

    if (!optionId || typeof optionId !== 'string') {
      return next(ErrorFactory.missingParameter('optionId'));
    }

    if (!underlyingStockId || typeof underlyingStockId !== 'string') {
      return next(ErrorFactory.missingParameter('underlyingStockId'));
    }

    const marketTypeNum = marketType ? parseInt(String(marketType)) : 2;

    const result = await getOptionDetail(optionId, underlyingStockId, marketTypeNum);

    if (!result) {
      return next(ErrorFactory.externalApiError('富途API', '获取期权详情失败'));
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/options/underlying-quote
 * 获取正股行情
 * 
 * 请求参数：
 * - stockId: string (可选) - 正股ID
 * - symbol: string (可选) - 股票代码（如 TSLA.US）
 * 
 * 响应：
 * - 正股行情数据
 */
optionsRouter.get('/underlying-quote', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stockId, symbol } = req.query;

    let finalStockId: string | null = null;

    if (stockId && typeof stockId === 'string') {
      finalStockId = stockId;
    } else if (symbol && typeof symbol === 'string') {
      finalStockId = await getStockIdBySymbol(symbol);
      if (!finalStockId) {
        return next(ErrorFactory.notFound(`股票: ${symbol}`));
      }
    } else {
      return next(ErrorFactory.missingParameter('stockId 或 symbol'));
    }

    const result = await getUnderlyingStockQuote(finalStockId);

    if (!result) {
      return next(ErrorFactory.externalApiError('富途API', '获取正股行情失败'));
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/options/kline
 * 获取期权K线数据（日K）
 * 
 * 请求参数：
 * - optionId: string (必需) - 期权ID
 * - marketType: number (可选) - 市场类型，默认2（美股）
 * - count: number (可选) - 数据条数，默认100
 * 
 * 响应：
 * - klineData: K线数据数组
 */
optionsRouter.get('/kline', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { optionId, marketType, count } = req.query;

    if (!optionId || typeof optionId !== 'string') {
      return next(ErrorFactory.missingParameter('optionId'));
    }

    const marketTypeNum = marketType ? parseInt(String(marketType)) : 2;
    const countNum = count ? parseInt(String(count)) : 100;

    const result = await getOptionKline(optionId, marketTypeNum, countNum);

    res.json({
      success: true,
      data: {
        klineData: result,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/options/minute
 * 获取期权分时数据
 * 
 * 请求参数：
 * - optionId: string (必需) - 期权ID
 * - marketType: number (可选) - 市场类型，默认2（美股）
 * 
 * 响应：
 * - minuteData: 分时数据数组
 */
optionsRouter.get('/minute', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { optionId, marketType } = req.query;

    if (!optionId || typeof optionId !== 'string') {
      return next(ErrorFactory.missingParameter('optionId'));
    }

    const marketTypeNum = marketType ? parseInt(String(marketType)) : 2;

    const result = await getOptionMinute(optionId, marketTypeNum);

    res.json({
      success: true,
      data: {
        minuteData: result,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

