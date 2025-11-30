import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { rateLimiter } from '../middleware/rateLimiter';
import { getFutunnHeaders } from '../config/futunn';

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
 * GET /api/forex/products
 * 获取支持的外汇产品列表
 */
forexRouter.get('/products', async (_req: Request, res: Response) => {
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
    console.error('获取外汇产品列表失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '获取外汇产品列表失败',
      },
    });
  }
});

/**
 * GET /api/forex/quote
 * 获取外汇实时报价
 * 
 * 请求参数：
 * - product: string (必需) 产品代码，例如：USDINDEX, EURINDEX, XAUUSD, SPX, BTC
 */
forexRouter.get('/quote', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { product } = req.query;
    
    if (!product || typeof product !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: product。支持的值: USDINDEX, EURINDEX, XAUUSD, SPX, BTC',
        },
      });
    }
    
    const productInfo = FOREX_PRODUCTS[product.toUpperCase()];
    if (!productInfo) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PRODUCT',
          message: `无效的外汇产品: ${product}。支持的值: ${Object.keys(FOREX_PRODUCTS).join(', ')}`,
        },
      });
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
      return res.status(500).json({
        success: false,
        error: {
          code: 'API_ERROR',
          message: response.data?.message || '获取外汇报价失败',
        },
      });
    }
  } catch (error: any) {
    console.error('获取外汇报价失败:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '获取外汇报价失败',
      },
    });
  }
});

/**
 * GET /api/forex/candlestick
 * 获取外汇K线数据
 * 
 * 请求参数：
 * - product: string (必需) 产品代码，例如：USDINDEX, EURINDEX, XAUUSD, SPX, BTC
 * - type: string (必需) K线类型，支持：minute(分时), 5day(5日), day(日K), week(周K), month(月K), quarter(季K), year(年K)
 */
forexRouter.get('/candlestick', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { product, type } = req.query;
    
    if (!product || typeof product !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: product',
        },
      });
    }
    
    if (!type || typeof type !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: type。支持的值: minute, 5day, day, week, month, quarter, year',
        },
      });
    }
    
    const productInfo = FOREX_PRODUCTS[product.toUpperCase()];
    if (!productInfo) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PRODUCT',
          message: `无效的外汇产品: ${product}`,
        },
      });
    }
    
    const quoteType = QUOTE_TYPE_MAP[type.toLowerCase()];
    if (!quoteType) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TYPE',
          message: `无效的K线类型: ${type}。支持的值: ${Object.keys(QUOTE_TYPE_MAP).join(', ')}`,
        },
      });
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
      return res.status(500).json({
        success: false,
        error: {
          code: 'API_ERROR',
          message: response.data?.message || '获取外汇K线数据失败',
        },
      });
    }
  } catch (error: any) {
    console.error('获取外汇K线数据失败:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '获取外汇K线数据失败',
      },
    });
  }
});

/**
 * GET /api/forex/test-btc
 * 测试BTC API请求（用于调试）
 */
forexRouter.get('/test-btc', async (_req: Request, res: Response) => {
  try {
    const { testBTCRequest } = await import('../services/market-data.service');
    
    console.log('\n========== BTC API测试开始 ==========');
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
    console.error('BTC测试失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BTC_TEST_FAILED',
        message: error.message || 'BTC请求测试失败',
        details: error.stack,
      },
    });
  }
});

