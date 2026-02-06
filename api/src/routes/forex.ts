import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { rateLimiter } from '../middleware/rateLimiter';
import { getFutunnHeaders } from '../config/futunn';
import { ErrorFactory, normalizeError } from '../utils/errors';
import { logger } from '../utils/logger';

export const forexRouter = Router();

// 外汇产品映射
const FOREX_PRODUCTS: Record<string, { name: string; stockId: string; marketType: string; marketCode: string }> = {
  'USDINDEX': {
    name: '美元指数',
    stockId: '72000025',
    marketType: '11',
    marketCode: '121',
  },
  'EURINDEX': {
    name: '欧元指数',
    stockId: '72000026',
    marketType: '11',
    marketCode: '121',
  },
  'XAUUSD': {
    name: '黄金/美元',
    stockId: '72000031',
    marketType: '11',
    marketCode: '121',
  },
  'SPX': {
    name: '标普500指数',
    stockId: '200003',
    marketType: '2',
    marketCode: '2',
  },
  'BTC': {
    name: '比特币',
    stockId: '12000015',
    marketType: '17',
    marketCode: '17',
  },
};

// K线类型映射
const QUOTE_TYPE_MAP: Record<string, string> = {
  'minute': '1',      // 分时
  '5day': '2',        // 5日
  'day': '2',         // 日K
  'week': '3',        // 周K
  'month': '4',       // 月K
  'quarter': '11',    // 季K
  'year': '5',        // 年K
};

/**
 * 生成quote-token
 * 参考market-data.service.ts的实现（HMAC-SHA512 + SHA256）
 * 注意：不需要对参数排序，直接使用JSON.stringify
 */
function generateQuoteToken(params: Record<string, string>): string {
  // 使用JSON.stringify生成token（不是urlencode）
  // 注意：JavaScript对象的键顺序在JSON.stringify时保持插入顺序
  const dataStr = JSON.stringify(params);
  
  // HMAC-SHA512加密
  const hmac = crypto.createHmac('sha512', 'quote_web');
  hmac.update(dataStr);
  const hmacResult = hmac.digest('hex');
  
  // 取前10位
  const firstSlice = hmacResult.substring(0, 10);
  
  // SHA256哈希
  const sha256 = crypto.createHash('sha256');
  sha256.update(firstSlice);
  const sha256Result = sha256.digest('hex');
  
  // 取前10位作为token
  return sha256Result.substring(0, 10);
}

/**
 * @openapi
 * /forex/products:
 *   get:
 *     tags:
 *       - 市场分析
 *     summary: 获取外汇产品列表
 *     description: 获取支持的外汇/数字货币/指数产品列表
 *     security:
 *       - bearerAuth: []
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
 *                     products:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           code:
 *                             type: string
 *                             description: 产品代码 (e.g. BTC)
 *                           name:
 *                             type: string
 *                             description: 产品名称 (e.g. 比特币)
 */
forexRouter.get('/products', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const products = Object.entries(FOREX_PRODUCTS).map(([code, info]) => ({
      code,
      name: info.name,
      stockId: info.stockId,
    }));
    
    res.json({
      success: true,
      data: {
        products,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /forex/quote:
 *   get:
 *     tags:
 *       - 市场分析
 *     summary: 获取外汇实时报价
 *     description: 获取指定外汇产品的最新报价 (通过富途牛牛接口)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: product
 *         required: true
 *         schema:
 *           type: string
 *           enum: [USDINDEX, EURINDEX, XAUUSD, SPX, BTC]
 *         description: 产品代码
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
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     product:
 *                       type: string
 *                     productName:
 *                       type: string
 *                     quote:
 *                       type: object
 *                       description: 报价详情 (透传富途数据)
 */
forexRouter.get('/quote', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { product } = req.query;
    
    if (!product || typeof product !== 'string') {
      return next(ErrorFactory.missingParameter('product'));
    }
    
    const productInfo = FOREX_PRODUCTS[product.toUpperCase()];
    if (!productInfo) {
      return next(ErrorFactory.validationError(`无效的外汇产品: ${product}。支持的值: ${Object.keys(FOREX_PRODUCTS).join(', ')}`));
    }
    
    const timestamp = Date.now();
    // 注意：参数顺序必须与Python代码保持一致
    const params = {
      stockId: productInfo.stockId,
      marketType: productInfo.marketType,
      marketCode: productInfo.marketCode,
      lotSize: '0',
      spreadCode: '33',
      underlyingStockId: '0',
      instrumentType: '10',
      subInstrumentType: '10001',
      _: timestamp.toString(),
    };
    
    const quoteToken = generateQuoteToken(params);
    
    // 使用统一的富途牛牛配置获取headers
    const headers = getFutunnHeaders('https://www.moomoo.com/currency/USDINDEX-FX');
    headers['quote-token'] = quoteToken;
    
    const url = 'https://www.moomoo.com/quote-api/quote-v2/get-stock-quote';
    
    // 请求参数需要转换为数字格式（除了_保持时间戳）
    const requestParams: any = {
      stockId: Number(productInfo.stockId),
      marketType: Number(productInfo.marketType),
      marketCode: Number(productInfo.marketCode),
      lotSize: 0,
      spreadCode: 33,
      underlyingStockId: 0,
      instrumentType: 10,
      subInstrumentType: 10001,
      _: timestamp,
    };
    
    const response = await axios.get(url, {
      params: requestParams,
      headers,
      timeout: 10000,
    });
    
    if (response.data && response.data.code === 0) {
      return res.json({
        success: true,
        data: {
          product: product.toUpperCase(),
          productName: productInfo.name,
          quote: response.data.data,
        },
      });
    } else {
      return next(ErrorFactory.externalApiError('富途API', response.data?.message || '获取外汇报价失败'));
    }
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /forex/candlestick:
 *   get:
 *     tags:
 *       - 市场分析
 *     summary: 获取外汇 K 线
 *     description: 获取指定外汇产品的 K 线数据
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: product
 *         required: true
 *         schema:
 *           type: string
 *         description: 产品代码
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [minute, 5day, day, week, month, quarter, year]
 *         description: K线类型
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
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     candlestick:
 *                       type: object
 *                       description: K线数据列表 (透传富途数据)
 */
forexRouter.get('/candlestick', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { product, type } = req.query;
    
    if (!product || typeof product !== 'string') {
      return next(ErrorFactory.missingParameter('product'));
    }
    
    if (!type || typeof type !== 'string') {
      return next(ErrorFactory.missingParameter('type'));
    }
    
    const productInfo = FOREX_PRODUCTS[product.toUpperCase()];
    if (!productInfo) {
      return next(ErrorFactory.validationError(`无效的外汇产品: ${product}`));
    }
    
    const quoteType = QUOTE_TYPE_MAP[type.toLowerCase()];
    if (!quoteType) {
      return next(ErrorFactory.validationError(`无效的K线类型: ${type}。支持的值: ${Object.keys(QUOTE_TYPE_MAP).join(', ')}`));
    }
    
    const timestamp = Date.now();
    // 注意：参数顺序必须与Python代码保持一致
    const params = {
      stockId: productInfo.stockId,
      marketType: productInfo.marketType,
      type: quoteType,
      marketCode: productInfo.marketCode,
      instrumentType: '10',
      subInstrumentType: '10001',
      _: timestamp.toString(),
    };
    
    const quoteToken = generateQuoteToken(params);
    
    // 使用统一的富途牛牛配置获取headers
    const headers = getFutunnHeaders('https://www.moomoo.com/currency/USDINDEX-FX');
    headers['quote-token'] = quoteToken;
    
    // 根据type选择接口：type=1使用get-quote-minute，其他使用get-kline
    const isIntraday = quoteType === '1';
    const url = isIntraday
      ? 'https://www.moomoo.com/quote-api/quote-v2/get-quote-minute'
      : 'https://www.moomoo.com/quote-api/quote-v2/get-kline';
    
    // 请求参数需要转换为数字格式（除了_保持时间戳）
    const requestParams: any = {
      stockId: Number(productInfo.stockId),
      marketType: Number(productInfo.marketType),
      type: Number(quoteType),
      marketCode: Number(productInfo.marketCode),
      instrumentType: 10,
      subInstrumentType: 10001,
      _: timestamp,
    };
    
    const response = await axios.get(url, {
      params: requestParams,
      headers,
      timeout: 10000,
    });
    
    if (response.data && response.data.code === 0) {
      return res.json({
        success: true,
        data: {
          product: product.toUpperCase(),
          productName: productInfo.name,
          type: type.toLowerCase(),
          candlestick: response.data.data,
        },
      });
    } else {
      return next(ErrorFactory.externalApiError('富途API', response.data?.message || '获取外汇K线数据失败'));
    }
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * GET /api/forex/test-btc
 * 测试BTC API请求（用于调试）
 */
forexRouter.get('/test-btc', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { testBTCRequest } = await import('../services/market-data.service');
    
    logger.debug('\n========== BTC API测试开始 ==========');
    const result = await testBTCRequest();
    
    res.json({
      success: true,
      data: {
        message: 'BTC请求测试完成',
        recordCount: result.length,
        sampleData: result.length > 0 ? result[0] : null,
        allData: result.slice(0, 5), // 返回前5条数据
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

