/**
 * 富途API测试接口
 * 用于诊断富途API的错误和问题
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { getFutunnHeaders, getFutunnConfig } from '../config/futunn';
import { generateQuoteToken } from '../utils/moomoo-quote-token';
import { logger } from '../utils/logger';

export const futunnTestRouter = Router();

/**
 * GET /api/futunn-test/verify-token
 * 验证token生成逻辑（根据浏览器请求数据）
 */
futunnTestRouter.get('/verify-token', async (_req: Request, res: Response) => {
  try {
    // 从浏览器请求中提取的参数
    const browserParams = {
      stockId: '12000015',
      marketType: '17',
      type: '2',
      marketCode: '360',
      instrumentType: '11',
      subInstrumentType: '11002',
      _: '1764056604287',
    };
    
    const expectedToken = 'd6247980d5';
    
    // 生成token
    const generatedToken = generateQuoteToken(browserParams);
    
    // 详细步骤（不排序，直接使用JSON.stringify）
    const dataStr = JSON.stringify(browserParams);
    
    const hmac = crypto.createHmac('sha512', 'quote_web');
    hmac.update(dataStr);
    const hmacResult = hmac.digest('hex');
    const firstSlice = hmacResult.substring(0, 10);
    
    const sha256 = crypto.createHash('sha256');
    sha256.update(firstSlice);
    const sha256Result = sha256.digest('hex');
    const finalToken = sha256Result.substring(0, 10);
    
    const result = {
      success: generatedToken === expectedToken,
      expectedToken,
      generatedToken,
      match: generatedToken === expectedToken,
      steps: {
        inputParams: browserParams,
        jsonString: dataStr,
        hmacResult: hmacResult.substring(0, 20) + '...',
        firstSlice,
        sha256Result: sha256Result.substring(0, 20) + '...',
        finalToken,
      },
    };
    
    res.json(result);
  } catch (err: any) {
    logger.error('Token验证失败:', err);
    res.status(500).json({
      success: false,
      error: {
        message: err.message,
        stack: err.stack,
      },
    });
  }
});

/**
 * GET /api/futunn-test/test-kline
 * 测试K线数据接口
 */
futunnTestRouter.get('/test-kline', async (req: Request, res: Response) => {
  try {
    const { stockId, marketType, marketCode, type, instrumentType, subInstrumentType } = req.query;
    
    // 默认参数（SPX）
    const defaultParams = {
      stockId: stockId?.toString() || '200003',
      marketType: marketType?.toString() || '2',
      marketCode: marketCode?.toString() || '24',
      type: type?.toString() || '2', // 1=分时, 2=日K
      instrumentType: instrumentType?.toString() || '6',
      subInstrumentType: subInstrumentType?.toString() || '6001',
    };
    
    const timestamp = Date.now();
    
    // 生成token的参数（使用字符串格式）
    const tokenParams = {
      stockId: defaultParams.stockId,
      marketType: defaultParams.marketType,
      type: defaultParams.type,
      marketCode: defaultParams.marketCode,
      instrumentType: defaultParams.instrumentType,
      subInstrumentType: defaultParams.subInstrumentType,
      _: timestamp.toString(),
    };
    
    const quoteToken = generateQuoteToken(tokenParams);
    
    // 实际请求参数（数字格式）
    const requestParams: any = {
      stockId: Number(defaultParams.stockId),
      marketType: Number(defaultParams.marketType),
      type: Number(defaultParams.type),
      marketCode: Number(defaultParams.marketCode),
      instrumentType: Number(defaultParams.instrumentType),
      subInstrumentType: Number(defaultParams.subInstrumentType),
      _: timestamp,
    };
    
    const url = 'https://www.moomoo.com/quote-api/quote-v2/get-kline';
    const headers = getFutunnHeaders('https://www.moomoo.com/currency/USDINDEX-FX');
    headers['quote-token'] = quoteToken;
    
    logger.debug('\n========== 富途API测试 - K线数据 ==========');
    logger.debug('URL:', url);
    logger.debug('请求参数:', JSON.stringify(requestParams, null, 2));
    logger.debug('Token参数:', JSON.stringify(tokenParams, null, 2));
    logger.debug('生成的Token:', quoteToken);
    logger.debug('==========================================\n');
    
    const startTime = Date.now();
    let response;
    let error: any = null;
    
    try {
      response = await axios.get(url, {
        params: requestParams,
        headers,
        timeout: 15000,
      });
    } catch (err: any) {
      error = err;
    }
    
    const duration = Date.now() - startTime;
    
    const result: any = {
      success: !error && response?.data?.code === 0,
      duration: `${duration}ms`,
      request: {
        url,
        params: requestParams,
        tokenParams,
        quoteToken,
      },
      response: error ? {
        error: true,
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      } : {
        status: response?.status,
        statusText: response?.statusText,
        data: response?.data,
      },
    };
    
    res.json(result);
  } catch (err: any) {
    logger.error('富途API测试失败:', err);
    res.status(500).json({
      success: false,
      error: {
        message: err.message,
        stack: err.stack,
      },
    });
  }
});

/**
 * GET /api/futunn-test/test-quote-minute
 * 测试分时行情接口
 */
futunnTestRouter.get('/test-quote-minute', async (req: Request, res: Response) => {
  try {
    const { stockId, marketType, marketCode } = req.query;
    
    // 默认参数（USD Index）
    const defaultParams = {
      stockId: stockId?.toString() || '72000025',
      marketType: marketType?.toString() || '11',
      marketCode: marketCode?.toString() || '121',
    };
    
    const timestamp = Date.now();
    
    // 生成token的参数
    const tokenParams = {
      stockId: defaultParams.stockId,
      marketType: defaultParams.marketType,
      type: '1', // 分时数据固定为1
      marketCode: defaultParams.marketCode,
      instrumentType: '10',
      subInstrumentType: '10001',
      _: timestamp.toString(),
    };
    
    const quoteToken = generateQuoteToken(tokenParams);
    
    // 实际请求参数
    const requestParams: any = {
      stockId: Number(defaultParams.stockId),
      marketType: Number(defaultParams.marketType),
      type: 1,
      marketCode: Number(defaultParams.marketCode),
      instrumentType: 10,
      subInstrumentType: 10001,
      _: timestamp,
    };
    
    const url = 'https://www.moomoo.com/quote-api/quote-v2/get-quote-minute';
    const headers = getFutunnHeaders('https://www.moomoo.com/currency/USDINDEX-FX');
    headers['quote-token'] = quoteToken;
    
    logger.debug('\n========== 富途API测试 - 分时行情 ==========');
    logger.debug('URL:', url);
    logger.debug('请求参数:', JSON.stringify(requestParams, null, 2));
    logger.debug('Token参数:', JSON.stringify(tokenParams, null, 2));
    logger.debug('生成的Token:', quoteToken);
    logger.debug('==========================================\n');
    
    const startTime = Date.now();
    let response;
    let error: any = null;
    
    try {
      response = await axios.get(url, {
        params: requestParams,
        headers,
        timeout: 15000,
      });
    } catch (err: any) {
      error = err;
    }
    
    const duration = Date.now() - startTime;
    
    const result: any = {
      success: !error && response?.data?.code === 0,
      duration: `${duration}ms`,
      request: {
        url,
        params: requestParams,
        tokenParams,
        quoteToken,
      },
      response: error ? {
        error: true,
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      } : {
        status: response?.status,
        statusText: response?.statusText,
        data: response?.data,
      },
    };
    
    res.json(result);
  } catch (err: any) {
    logger.error('富途API测试失败:', err);
    res.status(500).json({
      success: false,
      error: {
        message: err.message,
        stack: err.stack,
      },
    });
  }
});

/**
 * GET /api/futunn-test/test-stock-quote
 * 测试股票报价接口
 */
futunnTestRouter.get('/test-stock-quote', async (req: Request, res: Response) => {
  try {
    const { stockId, marketType, marketCode } = req.query;
    
    // 默认参数（USD Index）
    const defaultParams = {
      stockId: stockId?.toString() || '72000025',
      marketType: marketType?.toString() || '11',
      marketCode: marketCode?.toString() || '121',
    };
    
    const timestamp = Date.now();
    
    // 生成token的参数
    const tokenParams = {
      stockId: defaultParams.stockId,
      marketType: defaultParams.marketType,
      marketCode: defaultParams.marketCode,
      lotSize: '0',
      spreadCode: '33',
      underlyingStockId: '0',
      instrumentType: '10',
      subInstrumentType: '10001',
      _: timestamp.toString(),
    };
    
    const quoteToken = generateQuoteToken(tokenParams);
    
    // 实际请求参数
    const requestParams: any = {
      stockId: Number(defaultParams.stockId),
      marketType: Number(defaultParams.marketType),
      marketCode: Number(defaultParams.marketCode),
      lotSize: 0,
      spreadCode: 33,
      underlyingStockId: 0,
      instrumentType: 10,
      subInstrumentType: 10001,
      _: timestamp,
    };
    
    const url = 'https://www.moomoo.com/quote-api/quote-v2/get-stock-quote';
    const headers = getFutunnHeaders('https://www.moomoo.com/currency/USDINDEX-FX');
    headers['quote-token'] = quoteToken;
    
    logger.debug('\n========== 富途API测试 - 股票报价 ==========');
    logger.debug('URL:', url);
    logger.debug('请求参数:', JSON.stringify(requestParams, null, 2));
    logger.debug('Token参数:', JSON.stringify(tokenParams, null, 2));
    logger.debug('生成的Token:', quoteToken);
    logger.debug('==========================================\n');
    
    const startTime = Date.now();
    let response;
    let error: any = null;
    
    try {
      response = await axios.get(url, {
        params: requestParams,
        headers,
        timeout: 15000,
      });
    } catch (err: any) {
      error = err;
    }
    
    const duration = Date.now() - startTime;
    
    const result: any = {
      success: !error && response?.data?.code === 0,
      duration: `${duration}ms`,
      request: {
        url,
        params: requestParams,
        tokenParams,
        quoteToken,
      },
      response: error ? {
        error: true,
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      } : {
        status: response?.status,
        statusText: response?.statusText,
        data: response?.data,
      },
    };
    
    res.json(result);
  } catch (err: any) {
    logger.error('富途API测试失败:', err);
    res.status(500).json({
      success: false,
      error: {
        message: err.message,
        stack: err.stack,
      },
    });
  }
});

/**
 * GET /api/futunn-test/test-all
 * 测试所有富途API接口
 */
futunnTestRouter.get('/test-all', async (_req: Request, res: Response) => {
  try {
    const results: any = {
      timestamp: new Date().toISOString(),
      config: {
        csrfToken: getFutunnConfig().csrfToken.substring(0, 10) + '...',
        cookiesLength: getFutunnConfig().cookies.length,
      },
      tests: [],
    };
    
    // 测试配置
    const testConfigs = [
      {
        name: 'SPX - K线数据',
        stockId: '200003',
        marketType: '2',
        marketCode: '24',
        type: '2',
        instrumentType: '6',
        subInstrumentType: '6001',
        endpoint: 'test-kline',
      },
      {
        name: 'USD Index - K线数据',
        stockId: '72000025',
        marketType: '11',
        marketCode: '121',
        type: '2',
        instrumentType: '10',
        subInstrumentType: '10001',
        endpoint: 'test-kline',
      },
      {
        name: 'BTC - K线数据',
        stockId: '12000015',
        marketType: '17',
        marketCode: '360',
        type: '2',
        instrumentType: '11',
        subInstrumentType: '11002',
        endpoint: 'test-kline',
      },
      {
        name: 'SPX - 分时数据',
        stockId: '200003',
        marketType: '2',
        marketCode: '24',
        type: '1',
        instrumentType: '6',
        subInstrumentType: '6001',
        endpoint: 'test-quote-minute',
      },
      {
        name: 'USD Index - 分时数据',
        stockId: '72000025',
        marketType: '11',
        marketCode: '121',
        type: '1',
        instrumentType: '10',
        subInstrumentType: '10001',
        endpoint: 'test-quote-minute',
      },
      {
        name: 'BTC - 分时数据',
        stockId: '12000015',
        marketType: '17',
        marketCode: '360',
        type: '1',
        instrumentType: '11',
        subInstrumentType: '11002',
        endpoint: 'test-quote-minute',
      },
    ];
    
    // 逐个测试
    for (const config of testConfigs) {
      const testResult: any = {
        name: config.name,
        config,
        result: null,
        error: null,
      };
      
      try {
        const timestamp = Date.now();
        const tokenParams: Record<string, string> = {
          stockId: config.stockId,
          marketType: config.marketType,
          type: config.type,
          marketCode: config.marketCode,
          instrumentType: config.instrumentType,
          subInstrumentType: config.subInstrumentType,
          _: timestamp.toString(),
        };
        
        const quoteToken = generateQuoteToken(tokenParams);
        
        const requestParams: any = {
          stockId: Number(config.stockId),
          marketType: Number(config.marketType),
          type: Number(config.type),
          marketCode: Number(config.marketCode),
          instrumentType: Number(config.instrumentType),
          subInstrumentType: Number(config.subInstrumentType),
          _: timestamp,
        };
        
        let url: string;
        if (config.endpoint === 'test-kline') {
          url = 'https://www.moomoo.com/quote-api/quote-v2/get-kline';
        } else {
          url = 'https://www.moomoo.com/quote-api/quote-v2/get-quote-minute';
        }
        
        const headers = getFutunnHeaders('https://www.moomoo.com/currency/USDINDEX-FX');
        headers['quote-token'] = quoteToken;
        
        const startTime = Date.now();
        let response;
        let error: any = null;
        
        try {
          response = await axios.get(url, {
            params: requestParams,
            headers,
            timeout: 15000,
          });
        } catch (err: any) {
          error = err;
        }
        
        const duration = Date.now() - startTime;
        
        testResult.result = {
          success: !error && response?.data?.code === 0,
          duration: `${duration}ms`,
          response: error ? {
            error: true,
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
          } : {
            status: response?.status,
            code: response?.data?.code,
            message: response?.data?.message,
            dataLength: Array.isArray(response?.data?.data) 
              ? response?.data?.data.length 
              : response?.data?.data?.list?.length || 0,
          },
        };
      } catch (err: any) {
        testResult.error = {
          message: err.message,
          stack: err.stack,
        };
      }
      
      results.tests.push(testResult);
      
      // 添加延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 统计结果
    const successCount = results.tests.filter((t: any) => t.result?.success).length;
    const failCount = results.tests.length - successCount;
    
    results.summary = {
      total: results.tests.length,
      success: successCount,
      failed: failCount,
      successRate: `${((successCount / results.tests.length) * 100).toFixed(1)}%`,
    };
    
    res.json(results);
  } catch (err: any) {
    logger.error('富途API批量测试失败:', err);
    res.status(500).json({
      success: false,
      error: {
        message: err.message,
        stack: err.stack,
      },
    });
  }
});
