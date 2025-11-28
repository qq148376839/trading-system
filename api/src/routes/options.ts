import { Router, Request, Response } from 'express';
import { rateLimiter } from '../middleware/rateLimiter';
import {
  getOptionStrikeDates,
  getOptionChain,
  getOptionDetail,
  getStockIdBySymbol,
  getUnderlyingStockQuote,
} from '../services/futunn-option-chain.service';

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
optionsRouter.get('/strike-dates', rateLimiter, async (req: Request, res: Response) => {
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
        return res.status(404).json({
          success: false,
          error: {
            code: 'STOCK_NOT_FOUND',
            message: `未找到股票: ${symbol}`,
          },
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: stockId 或 symbol',
        },
      });
    }

    const result = await getOptionStrikeDates(finalStockId);

    if (!result) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'API_ERROR',
          message: '获取期权到期日期列表失败',
        },
      });
    }

    res.json({
      success: true,
      data: {
        ...result,
        stockId: finalStockId, // 返回stockId供前端使用
      },
    });
  } catch (error: any) {
    console.error('获取期权到期日期列表失败:', error);
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
optionsRouter.get('/chain', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { stockId, strikeDate, symbol } = req.query;

    let finalStockId: string | null = null;

    // 优先使用stockId，如果没有则通过symbol查找
    if (stockId && typeof stockId === 'string') {
      finalStockId = stockId;
    } else if (symbol && typeof symbol === 'string') {
      finalStockId = await getStockIdBySymbol(symbol);
      if (!finalStockId) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'STOCK_NOT_FOUND',
            message: `未找到股票: ${symbol}`,
          },
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: stockId 或 symbol',
        },
      });
    }

    // 验证strikeDate参数
    if (!strikeDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: strikeDate',
        },
      });
    }

    const strikeDateNum = parseInt(String(strikeDate));
    if (isNaN(strikeDateNum)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'strikeDate必须是有效的时间戳（秒级）',
        },
      });
    }

    const result = await getOptionChain(finalStockId, strikeDateNum);

    if (!result) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'API_ERROR',
          message: '获取期权链失败',
        },
      });
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
    console.error('获取期权链失败:', error);
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
optionsRouter.get('/detail', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { optionId, underlyingStockId, marketType } = req.query;

    if (!optionId || typeof optionId !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: optionId',
        },
      });
    }

    if (!underlyingStockId || typeof underlyingStockId !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: underlyingStockId',
        },
      });
    }

    const marketTypeNum = marketType ? parseInt(String(marketType)) : 2;

    const result = await getOptionDetail(optionId, underlyingStockId, marketTypeNum);

    if (!result) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'API_ERROR',
          message: '获取期权详情失败',
        },
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('获取期权详情失败:', error);
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
optionsRouter.get('/underlying-quote', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { stockId, symbol } = req.query;

    let finalStockId: string | null = null;

    if (stockId && typeof stockId === 'string') {
      finalStockId = stockId;
    } else if (symbol && typeof symbol === 'string') {
      finalStockId = await getStockIdBySymbol(symbol);
      if (!finalStockId) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'STOCK_NOT_FOUND',
            message: `未找到股票: ${symbol}`,
          },
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: stockId 或 symbol',
        },
      });
    }

    const result = await getUnderlyingStockQuote(finalStockId);

    if (!result) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'API_ERROR',
          message: '获取正股行情失败',
        },
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('获取正股行情失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '服务器内部错误',
      },
    });
  }
});

