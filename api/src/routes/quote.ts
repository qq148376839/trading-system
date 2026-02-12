import { Router, Request, Response, NextFunction } from 'express';
import { getQuoteContext } from '../config/longport';
import { rateLimiter } from '../middleware/rateLimiter';
import { Market, SecurityListCategory } from 'longport';
import {
  getFutunnOptionQuotes,
  getFutunnOptionQuote
} from '../services/futunn-option-quote.service';
import longportOptionQuoteService from '../services/longport-option-quote.service';
import { getOptionDetail, getStockIdBySymbol } from '../services/futunn-option-chain.service';
import { ErrorFactory, normalizeError } from '../utils/errors';
import { logger } from '../utils/logger';
import { moomooProxy, getProxyMode } from '../utils/moomoo-proxy';
import { getFutunnConfig } from '../config/futunn';
import { generateQuoteToken } from '../utils/moomoo-quote-token';

export const quoteRouter = Router();

// 注意：富途牛牛/Moomoo配置已硬编码在 config/futunn.ts 中，使用游客cookies，无需环境变量

// 美股标的列表缓存
interface SecurityCache {
  list: Array<{
    symbol: string;
    name_cn: string;
    name_hk: string;
    name_en: string;
  }>;
  lastUpdate: number;
}

let securityListCache: SecurityCache | null = null;
const CACHE_DURATION = 60 * 60 * 1000; // 缓存1小时（3600000毫秒）

/**
 * 获取美股标的列表（带缓存）
 */
async function getSecurityList(): Promise<Array<{ symbol: string; name_cn: string; name_hk: string; name_en: string }>> {
  const now = Date.now();
  
  // 如果缓存存在且未过期，直接返回
  if (securityListCache && (now - securityListCache.lastUpdate) < CACHE_DURATION) {
    return securityListCache.list;
  }
  
  // 缓存过期或不存在，从API获取
  try {
    const quoteCtx = await getQuoteContext();
    const securities = await quoteCtx.securityList(Market.US, SecurityListCategory.Overnight);
    
    const list = securities.map((sec: any) => ({
      symbol: sec.symbol,
      name_cn: sec.nameCn || '',
      name_hk: sec.nameHk || '',
      name_en: sec.nameEn || '',
    }));
    
    // 更新缓存
    securityListCache = {
      list,
      lastUpdate: now,
    };
    
    logger.info(`已更新美股标的列表缓存，共 ${list.length} 个标的`, { dbWrite: false });
    return list;
  } catch (error: any) {
    logger.error('获取美股标的列表失败:', error);
    // 如果API失败但缓存存在，返回缓存数据
    if (securityListCache) {
      logger.warn('使用过期的缓存数据');
      return securityListCache.list;
    }
    throw error;
  }
}

/**
 * @openapi
 * /quote/security-list:
 *   get:
 *     tags:
 *       - 市场行情
 *     summary: 获取美股标的列表
 *     description: 获取支持的美股列表，用于自动补全或搜索 (包含缓存机制)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: 搜索关键字 (股票代码或名称)
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
 *                     securities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           name_cn:
 *                             type: string
 *                           name_en:
 *                             type: string
 *                     total:
 *                       type: number
 */
quoteRouter.get('/security-list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query } = req.query;
    
    const allSecurities = await getSecurityList();
    
    // 如果提供了查询参数，进行过滤
    if (query && typeof query === 'string' && query.trim()) {
      const queryLower = query.trim().toLowerCase();
      const filtered = allSecurities.filter(sec => {
        const symbolLower = sec.symbol.toLowerCase();
        const nameCnLower = sec.name_cn.toLowerCase();
        const nameEnLower = sec.name_en.toLowerCase();
        
        return symbolLower.includes(queryLower) || 
               nameCnLower.includes(queryLower) || 
               nameEnLower.includes(queryLower);
      }).slice(0, 50); // 最多返回50个结果
      
      return res.json({
        success: true,
        data: {
          securities: filtered,
          total: allSecurities.length,
        },
      });
    }
    
    // 没有查询参数，返回所有（或前100个）
    res.json({
      success: true,
      data: {
        securities: allSecurities.slice(0, 100),
        total: allSecurities.length,
      },
    });
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

// 启动时立即加载一次，然后每30分钟更新一次
getSecurityList().catch(err => {
  logger.error('启动时加载美股标的列表失败:', err);
});

setInterval(() => {
  getSecurityList().catch(err => {
    logger.error('定时更新美股标的列表失败:', err);
  });
}, 30 * 60 * 1000); // 每30分钟更新一次

/**
 * @openapi
 * /quote:
 *   get:
 *     tags:
 *       - 市场行情
 *     summary: 获取实时行情
 *     description: 获取指定股票的最新报价信息，支持批量查询 (最多500个)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: 股票代码列表 (逗号分隔)，例如 "700.HK,AAPL.US"
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
 *                     secu_quote:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           last_done:
 *                             type: string
 *                             description: 最新成交价
 *                           prev_close:
 *                             type: string
 *                             description: 昨日收盘价
 *                           open:
 *                             type: string
 *                             description: 开盘价
 *                           high:
 *                             type: string
 *                           low:
 *                             type: string
 *                           volume:
 *                             type: string
 *                             description: 成交量
 *                           turnover:
 *                             type: string
 *                             description: 成交额
 *       400:
 *         description: 参数错误
 */
quoteRouter.get('/', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.query;

    // 参数验证
    if (!symbol) {
      return next(ErrorFactory.missingParameter('symbol'));
    }

    // 处理symbol参数（支持单个或多个，支持逗号分隔）
    let symbols: string[];
    if (typeof symbol === 'string') {
      // 如果字符串包含逗号，按逗号分割
      symbols = symbol.split(',').map(s => s.trim()).filter(s => s);
    } else if (Array.isArray(symbol)) {
      symbols = symbol as string[];
    } else {
      return next(ErrorFactory.validationError('symbol参数格式错误'));
    }

    // 检查数量限制（每次最多500个）
    if (symbols.length > 500) {
      return next(ErrorFactory.quotaExceeded('请求的标的数量超过限制，最多支持500个'));
    }

    // 验证symbol格式（支持 ticker.region 和 .ticker.region 格式）
    // 支持格式：AAPL.US, 700.HK, .SPX.US (标普500指数带前导点)
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    const invalidSymbols = symbols.filter(s => !symbolPattern.test(s));
    if (invalidSymbols.length > 0) {
      return next(ErrorFactory.validationError(
        `无效的标的代码格式: ${invalidSymbols.join(', ')}。请使用 ticker.region 格式，例如：700.HK 或 .SPX.US`,
        { invalidSymbols }
      ));
    }

    // 权限检查：如果只有美股Basic行情权限，检查是否包含非美股代码
    // 注意：这里只做提示，实际权限检查由长桥API返回
    // 注意：.SPX.US 这种带前导点的代码也应该被识别为美股代码
    const nonUSSymbols = symbols.filter(s => {
      const normalized = s.startsWith('.') ? s.substring(1) : s;
      return !normalized.endsWith('.US');
    });
    if (nonUSSymbols.length > 0) {
      logger.warn(`警告: 检测到非美股代码: ${nonUSSymbols.join(', ')}。如果账户只有美股Basic行情权限，这些代码可能无法获取实时行情。`);
    }

    // 调用长桥API
    const quoteCtx = await getQuoteContext();
    let quotes: any[];
    const failedSymbols: string[] = [];
    
    try {
      quotes = await quoteCtx.quote(symbols);
      
      // 检查哪些股票没有返回数据
      const returnedSymbols = quotes.map(q => q.symbol);
      const missingSymbols = symbols.filter(s => !returnedSymbols.includes(s));
      if (missingSymbols.length > 0) {
        logger.warn(`以下股票未能获取到数据: ${missingSymbols.join(', ')}`);
        failedSymbols.push(...missingSymbols);
      }
    } catch (error: any) {
      // 如果整个请求失败，尝试逐个获取
      logger.warn('批量获取行情失败，尝试逐个获取:', error.message);
      quotes = [];
      
      // 逐个获取行情（部分成功策略）
      for (const symbol of symbols) {
        try {
          const singleQuote = await quoteCtx.quote([symbol]);
          if (singleQuote && singleQuote.length > 0) {
            quotes.push(...singleQuote);
          } else {
            failedSymbols.push(symbol);
          }
        } catch (singleError: any) {
          logger.warn(`获取 ${symbol} 行情失败:`, singleError.message);
          failedSymbols.push(symbol);
        }
      }
    }

    // 返回结果（包含成功的和失败的）
    res.json({
      success: true,
      data: {
        secu_quote: quotes.map(q => ({
          symbol: q.symbol,
          last_done: q.lastDone,
          prev_close: q.prevClose,
          open: q.open,
          high: q.high,
          low: q.low,
          timestamp: q.timestamp,
          volume: q.volume,
          turnover: q.turnover,
          trade_status: q.tradeStatus,
          // 美股盘前交易行情（如果存在）
          pre_market_quote: q.preMarketQuote ? {
            last_done: q.preMarketQuote.lastDone,
            timestamp: q.preMarketQuote.timestamp,
            volume: q.preMarketQuote.volume,
            turnover: q.preMarketQuote.turnover,
            high: q.preMarketQuote.high,
            low: q.preMarketQuote.low,
            prev_close: q.preMarketQuote.prevClose,
          } : undefined,
          // 美股盘后交易行情（如果存在）
          post_market_quote: q.postMarketQuote ? {
            last_done: q.postMarketQuote.lastDone,
            timestamp: q.postMarketQuote.timestamp,
            volume: q.postMarketQuote.volume,
            turnover: q.postMarketQuote.turnover,
            high: q.postMarketQuote.high,
            low: q.postMarketQuote.low,
            prev_close: q.postMarketQuote.prevClose,
          } : undefined,
          // 美股夜盘交易行情（如果存在且开启了enable_overnight）
          overnight_quote: q.overnightQuote ? {
            last_done: q.overnightQuote.lastDone,
            timestamp: q.overnightQuote.timestamp,
            volume: q.overnightQuote.volume,
            turnover: q.overnightQuote.turnover,
            high: q.overnightQuote.high,
            low: q.overnightQuote.low,
            prev_close: q.overnightQuote.prevClose,
          } : undefined,
        })),
        // 返回失败的股票列表
        failed_symbols: failedSymbols.length > 0 ? failedSymbols : undefined,
      },
    });
  } catch (error: any) {
    // 使用统一的错误处理（normalizeError会自动处理长桥API错误码）
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quote/option:
 *   get:
 *     tags:
 *       - 市场行情
 *     summary: 获取期权实时行情
 *     description: 获取期权合约的实时报价，支持 Greeks 数据 (如果权限允许)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: 期权代码列表，例如 "TSLA251128P395000.US"
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
 *                     secu_quote:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           last_done:
 *                             type: string
 *                           option_extend:
 *                             type: object
 *                             description: 期权扩展数据 (Greeks等)
 *                             properties:
 *                               implied_volatility:
 *                                 type: string
 *                                 description: 隐含波动率
 *                               strike_price:
 *                                 type: string
 *                                 description: 行权价
 *                               expiry_date:
 *                                 type: string
 *                                 description: 到期日
 */
quoteRouter.get('/option', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.query;

    if (!symbol) {
      return next(ErrorFactory.missingParameter('symbol'));
    }

    let symbols: string[];
    if (typeof symbol === 'string') {
      symbols = symbol.split(',').map(s => s.trim()).filter(s => s);
    } else if (Array.isArray(symbol)) {
      symbols = symbol as string[];
    } else {
      return next(ErrorFactory.validationError('symbol参数格式错误'));
    }

    // 检查数量限制（每次最多500个）
    if (symbols.length > 500) {
      return next(ErrorFactory.quotaExceeded('请求的标的数量超过限制，最多支持500个'));
    }

    const quoteCtx = await getQuoteContext();

    try {
      // 调用期权行情API
      const optionQuotes = await quoteCtx.optionQuote(symbols);

      res.json({
        success: true,
        data: {
          secu_quote: optionQuotes.map((q: any) => ({
            symbol: q.symbol,
            last_done: q.lastDone,
            prev_close: q.prevClose,
            open: q.open,
            high: q.high,
            low: q.low,
            timestamp: q.timestamp,
            volume: q.volume,
            turnover: q.turnover,
            trade_status: q.tradeStatus,
            option_extend: q.optionExtend ? {
              implied_volatility: q.optionExtend.impliedVolatility,
              open_interest: q.optionExtend.openInterest,
              expiry_date: q.optionExtend.expiryDate,
              strike_price: q.optionExtend.strikePrice,
              contract_multiplier: q.optionExtend.contractMultiplier,
              contract_type: q.optionExtend.contractType,
              contract_size: q.optionExtend.contractSize,
              direction: q.optionExtend.direction,
              historical_volatility: q.optionExtend.historicalVolatility,
              underlying_symbol: q.optionExtend.underlyingSymbol,
            } : undefined,
          })),
        },
      });
    } catch (error: any) {
      logger.error('获取期权行情失败（长桥API）:', error);
      
      // 处理权限错误（301604 - no quote access）
      const isPermissionError = error.message && (
        error.message.includes('301604') || 
        error.message.includes('no quote access')
      );
      
      if (isPermissionError) {
        // 尝试使用富途牛牛API作为fallback
        logger.debug('尝试使用富途牛牛API获取期权行情...');
        
        try {
          const futunnQuotes = await getFutunnOptionQuotes(symbols);
          
          if (futunnQuotes.length > 0) {
            logger.info(`使用富途牛牛API成功获取 ${futunnQuotes.length} 个期权行情`);
            
            return res.json({
              success: true,
              data: {
                secu_quote: futunnQuotes.map((q: any) => ({
                  symbol: q.symbol,
                  last_done: q.last_done,
                  prev_close: q.prev_close,
                  open: q.open,
                  high: q.high,
                  low: q.low,
                  timestamp: q.timestamp,
                  volume: q.volume,
                  turnover: q.turnover,
                  trade_status: q.trade_status || 'Normal',
                  // 富途牛牛API不提供 option_extend 数据
                  option_extend: undefined,
                })),
                source: 'futunn', // 标识数据来源
                fallback_reason: 'Longbridge API权限不足（301604）',
              },
            });
          } else {
            logger.warn('富途牛牛API未能获取到任何期权行情');
          }
        } catch (futunnError: any) {
          logger.error('富途牛牛API获取期权行情失败:', futunnError.message);
        }
        
        // 如果富途牛牛API也失败，返回权限错误
        return next(ErrorFactory.permissionDenied(
          '当前账户没有期权行情权限（错误码：301604）。已尝试使用富途牛牛API作为fallback，但仍无法获取数据。请检查富途牛牛配置或访问 Longbridge 手机客户端购买期权行情权限。'
        ));
      }
      
      // 处理其他错误（使用normalizeError会自动处理）
      const appError = normalizeError(error);
      return next(appError);
    }
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quote/market-temperature:
 *   get:
 *     tags:
 *       - 市场行情
 *     summary: 获取当前市场温度
 *     description: |
 *       获取当前市场温度数据，包括温度值、描述、估值、情绪等信息。
 *       根据LongPort API文档：https://open.longbridge.com/zh-CN/docs/quote/pull/market_temperature
 *       
 *       返回数据包括：
 *       - temperature: 市场温度值（0-100）
 *       - description: 温度描述
 *       - valuation: 市场估值
 *       - sentiment: 市场情绪
 *       - updated_at: 更新时间戳
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: market
 *         schema:
 *           type: string
 *           enum: [US, HK, SG, CN]
 *           default: US
 *         description: 市场代码，支持 US（美股）、HK（港股）、SG（新加坡）、CN（A股）
 *     responses:
 *       200:
 *         description: 获取成功
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
 *                     temperature:
 *                       type: integer
 *                       description: 市场温度值（0-100）
 *                       example: 50
 *                     description:
 *                       type: string
 *                       description: 温度描述
 *                       example: "温度适宜，保持平稳"
 *                     valuation:
 *                       type: integer
 *                       description: 市场估值
 *                       example: 23
 *                     sentiment:
 *                       type: integer
 *                       description: 市场情绪
 *                       example: 78
 *                     updated_at:
 *                       type: integer
 *                       description: 更新时间戳
 *                       example: 1744616612
 *       400:
 *         description: 参数错误
 *       500:
 *         description: 服务器错误或SDK方法不存在
 */
quoteRouter.get('/market-temperature', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { market = 'US' } = req.query;
    
    // 验证market参数
    const validMarkets = ['US', 'HK', 'SG', 'CN'];
    if (typeof market !== 'string' || !validMarkets.includes(market)) {
      return next(ErrorFactory.validationError(`无效的市场代码: ${market}。支持的市场: ${validMarkets.join(', ')}`));
    }
    
    try {
      const quoteCtx = await getQuoteContext();
      const longport = require('longport');
      const { Market } = longport;
      
      // 映射市场代码
      const marketMap: Record<string, any> = {
        'US': Market.US,
        'HK': Market.HK,
        'SG': Market.SG,
        'CN': Market.CN,
      };
      
      const marketEnum = marketMap[market];
      if (!marketEnum) {
        return next(ErrorFactory.validationError(`不支持的市场代码: ${market}`));
      }
      
      // 根据SDK文档，方法确实存在：https://longportapp.github.io/openapi/nodejs/classes/QuoteContext.html#markettemperature
      // 添加详细日志来诊断问题
      logger.debug('[市场温度调试] 开始检测marketTemperature方法...');
      logger.debug('[市场温度调试] quoteCtx类型:', typeof quoteCtx);
      logger.debug('[市场温度调试] quoteCtx构造函数:', quoteCtx.constructor?.name);
      
      // 检查实例上的所有属性（包括不可枚举的）
      const instanceOwnProps = Object.getOwnPropertyNames(quoteCtx);
      logger.debug('[市场温度调试] 实例自有属性数量:', instanceOwnProps.length);
      logger.debug('[市场温度调试] 实例自有属性（前20个）:', instanceOwnProps.slice(0, 20));
      
      // 检查原型链
      const prototype = Object.getPrototypeOf(quoteCtx);
      logger.debug('[市场温度调试] 原型类型:', typeof prototype);
      logger.debug('[市场温度调试] 原型构造函数:', prototype?.constructor?.name);
      
      const prototypeProps = Object.getOwnPropertyNames(prototype);
      logger.debug('[市场温度调试] 原型属性数量:', prototypeProps.length);
      logger.debug('[市场温度调试] 原型属性（前30个）:', prototypeProps.slice(0, 30));
      
      // 检查是否有marketTemperature相关的方法
      const allProps = [...instanceOwnProps, ...prototypeProps];
      const tempRelated = allProps.filter(name => name.toLowerCase().includes('temperature') || name.toLowerCase().includes('temp'));
      logger.debug('[市场温度调试] 包含temperature/temp的属性:', tempRelated);
      
      // 检查是否有market相关的方法
      const marketRelated = allProps.filter(name => name.toLowerCase().includes('market') && typeof quoteCtx[name] === 'function');
      logger.debug('[市场温度调试] 包含market的函数方法:', marketRelated);
      
      // 尝试多种方式检测和调用方法
      let tempData: any = null;
      let methodName: string | null = null;
      let errorDetails: any = null;
      
      // 方法1: 直接检查实例上的方法（可能不在原型链上）
      logger.debug('[市场温度调试] 检查 quoteCtx.marketTemperature:', typeof quoteCtx.marketTemperature);
      if (quoteCtx.marketTemperature && typeof quoteCtx.marketTemperature === 'function') {
        methodName = 'marketTemperature';
        logger.debug('[市场温度调试] 找到方法: quoteCtx.marketTemperature，开始调用...');
        try {
          tempData = await quoteCtx.marketTemperature(marketEnum);
          logger.debug('[市场温度调试] 调用成功，返回类型:', typeof tempData);
        } catch (err: any) {
          errorDetails = err;
          logger.error('[市场温度调试] 调用失败:', err.message);
        }
      }
      // 方法2: 检查原型链上的方法
      else if (prototype.marketTemperature && typeof prototype.marketTemperature === 'function') {
        methodName = 'marketTemperature (prototype)';
        logger.debug('[市场温度调试] 找到方法: prototype.marketTemperature，开始调用...');
        try {
          tempData = await prototype.marketTemperature.call(quoteCtx, marketEnum);
          logger.debug('[市场温度调试] 调用成功，返回类型:', typeof tempData);
        } catch (err: any) {
          errorDetails = err;
          logger.error('[市场温度调试] 调用失败:', err.message);
        }
      }
      // 方法3: 尝试下划线命名
      else if (quoteCtx.market_temperature && typeof quoteCtx.market_temperature === 'function') {
        methodName = 'market_temperature';
        logger.debug('[市场温度调试] 找到方法: quoteCtx.market_temperature，开始调用...');
        try {
          tempData = await quoteCtx.market_temperature(marketEnum);
          logger.debug('[市场温度调试] 调用成功，返回类型:', typeof tempData);
        } catch (err: any) {
          errorDetails = err;
          logger.error('[市场温度调试] 调用失败:', err.message);
        }
      }
      // 方法4: 尝试直接调用（即使检测不到，也可能存在）
      else {
        logger.debug('[市场温度调试] 尝试直接调用 quoteCtx.marketTemperature（即使检测不到）...');
        try {
          tempData = await quoteCtx.marketTemperature(marketEnum);
          methodName = 'marketTemperature (direct call)';
          logger.debug('[市场温度调试] 直接调用成功！返回类型:', typeof tempData);
        } catch (err: any) {
          logger.debug('[市场温度调试] 直接调用失败:', err.message);
          
          // 检查所有包含temperature的方法
          const instanceProps = instanceOwnProps
            .filter(name => typeof quoteCtx[name] === 'function' && name.toLowerCase().includes('temperature'));
          
          const prototypeMethods = prototypeProps
            .filter(name => typeof quoteCtx[name] === 'function' && name.toLowerCase().includes('temperature'));
          
          const allTempMethods = [...instanceProps, ...prototypeMethods];
          logger.debug('[市场温度调试] 包含temperature的方法:', allTempMethods);
          
          if (allTempMethods.length > 0) {
            methodName = allTempMethods[0];
            logger.debug('[市场温度调试] 尝试调用方法:', methodName);
            try {
              tempData = await quoteCtx[methodName](marketEnum);
              logger.debug('[市场温度调试] 调用成功，返回类型:', typeof tempData);
            } catch (err2: any) {
              errorDetails = err2;
              logger.error('[市场温度调试] 调用失败:', err2.message);
            }
          } else {
            // 列出所有可用方法用于调试
            const allInstanceMethods = instanceOwnProps
              .filter(name => typeof quoteCtx[name] === 'function' && !name.startsWith('_'));
            const allPrototypeMethods = prototypeProps
              .filter(name => typeof quoteCtx[name] === 'function' && !name.startsWith('_'));
            
            logger.error('[市场温度调试] 未找到marketTemperature方法');
            logger.error('[市场温度调试] 实例方法总数:', allInstanceMethods.length);
            logger.error('[市场温度调试] 原型方法总数:', allPrototypeMethods.length);
            logger.error('[市场温度调试] 所有原型方法:', allPrototypeMethods);
            
            // 检查SDK版本
            let sdkVersion = 'unknown';
            try {
              const longportPackage = require('longport/package.json');
              sdkVersion = longportPackage.version;
              logger.error('[市场温度调试] LongPort SDK版本:', sdkVersion);
            } catch (e) {
              logger.error('[市场温度调试] 无法读取SDK版本');
            }
            
            return res.status(500).json({
              success: false,
              error: {
                code: 'SDK_METHOD_NOT_FOUND',
                message: `LongPort SDK的marketTemperature方法不存在。当前SDK版本: ${sdkVersion}`,
                details: {
                  currentVersion: sdkVersion,
                  instanceMethods: allInstanceMethods.slice(0, 30),
                  prototypeMethods: allPrototypeMethods.slice(0, 30),
                  allPrototypeMethods: allPrototypeMethods, // 返回所有方法用于调试
                  temperatureRelated: tempRelated,
                  marketRelated: marketRelated,
                  suggestion: `当前SDK版本(${sdkVersion})不支持marketTemperature方法。请更新SDK到最新版本: npm install longport@latest`,
                  updateCommand: 'npm install longport@latest',
                  sdkDocs: 'https://longportapp.github.io/openapi/nodejs/classes/QuoteContext.html#markettemperature'
                }
              }
            });
          }
        }
      }
      
      // 如果调用失败，返回错误信息
      if (errorDetails) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'SDK_CALL_ERROR',
            message: `调用${methodName}方法失败`,
            details: {
              method: methodName,
              error: errorDetails.message,
              stack: errorDetails.stack
            }
          }
        });
      }
      
      // 解析返回数据
      // 根据LongPort API文档和SDK文档，返回的是MarketTemperature对象
      // 需要调用toString()或直接访问属性
      let result: any = null;
      
      if (tempData && typeof tempData === 'object') {
        // 方式1: 直接访问temperature属性（SDK对象通常有这些属性）
        if ('temperature' in tempData) {
          result = {
            temperature: tempData.temperature,
            description: tempData.description || null,
            valuation: tempData.valuation || null,
            sentiment: tempData.sentiment || null,
            updated_at: tempData.updated_at || tempData.updatedAt || null,
          };
        }
        // 方式2: 如果返回格式是 { code: 0, data: { temperature: ... } }
        else if ('data' in tempData && tempData.data) {
          result = {
            temperature: tempData.data.temperature,
            description: tempData.data.description || null,
            valuation: tempData.data.valuation || null,
            sentiment: tempData.data.sentiment || null,
            updated_at: tempData.data.updated_at || null,
          };
        }
        // 方式3: 尝试调用toString()然后解析（SDK对象通常有toString方法）
        else if (typeof tempData.toString === 'function') {
          const str = tempData.toString();
          logger.debug(`MarketTemperature toString():`, str);
          
          // 尝试从字符串中提取各个字段
          const tempMatch = str.match(/temperature[:\s]+(\d+(?:\.\d+)?)/i);
          const descMatch = str.match(/description[:\s]+([^\n,]+)/i);
          const valMatch = str.match(/valuation[:\s]+(\d+)/i);
          const sentMatch = str.match(/sentiment[:\s]+(\d+)/i);
          const timeMatch = str.match(/updated_at[:\s]+(\d+)/i);
          
          result = {
            temperature: tempMatch ? parseFloat(tempMatch[1]) : null,
            description: descMatch ? descMatch[1].trim() : null,
            valuation: valMatch ? parseInt(valMatch[1], 10) : null,
            sentiment: sentMatch ? parseInt(sentMatch[1], 10) : null,
            updated_at: timeMatch ? parseInt(timeMatch[1], 10) : null,
            _debug_string: str, // 调试信息
          };
        }
        // 方式4: 尝试提取所有可能的字段
        else {
          result = {
            temperature: tempData.temperature || tempData.value || null,
            description: tempData.description || null,
            valuation: tempData.valuation || null,
            sentiment: tempData.sentiment || null,
            updated_at: tempData.updated_at || tempData.updatedAt || null,
            _debug_keys: Object.keys(tempData), // 调试信息：显示所有键
            _debug_raw: tempData // 包含原始数据以便调试
          };
        }
      } else {
        return res.status(500).json({
          success: false,
          error: {
            code: 'INVALID_RESPONSE',
            message: '市场温度API返回了无效的数据格式',
            details: {
              method: methodName,
              responseType: typeof tempData,
              response: tempData,
              suggestion: 'MarketTemperature对象应该有toString()方法，请检查返回的数据结构'
            }
          }
        });
      }
      
      // 验证temperature字段
      if (result.temperature === null || result.temperature === undefined) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'MISSING_TEMPERATURE',
            message: '返回数据中缺少temperature字段',
            details: {
              method: methodName,
              response: result,
              rawData: tempData,
              suggestion: '请检查MarketTemperature对象的结构，可能需要调用toString()方法或访问特定属性'
            }
          }
        });
      }
      
      return res.json({
        success: true,
        data: {
          temperature: result.temperature,
          description: result.description || null,
          valuation: result.valuation || null,
          sentiment: result.sentiment || null,
          updated_at: result.updated_at || null,
          method_used: methodName, // 调试信息：显示使用的方法名
          ...(result._debug_string ? { _debug_string: result._debug_string } : {}), // 调试信息：toString()结果
          ...(result._debug_keys ? { _debug_keys: result._debug_keys } : {}), // 调试信息：对象键
        }
      });
    } catch (error: any) {
      const appError = normalizeError(error);
      return next(appError);
    }
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * @openapi
 * /quote/market-data-test:
 *   get:
 *     tags:
 *       - 市场行情
 *     summary: 市场数据获取诊断（逐步测试）
 *     description: |
 *       逐步测试市场数据获取的每个环节，用于排查策略运行时获取市场数据报错的问题。
 *
 *       测试模式（通过 mode 参数选择）：
 *       - **option-price**（默认）：测试期权价格获取的完整 fallback 链
 *         - Level 2: LongPort optionQuote()
 *         - Level 3: LongPort depth()
 *         - Level 4: 富途 getOptionDetail()（需 optionId + underlyingStockId）
 *         - Level 5: LongPort quote()
 *         - Level 6: 富途三步流程 getFutunnOptionQuote()（仅需 symbol）
 *         - 综合: getOptionPrice() 完整 fallback 链
 *       - **market-kline**：测试 SPX/USD/BTC/VIX K线数据获取
 *       - **moomoo-proxy**：直接测试 Moomoo 边缘函数代理（原始 API 调用）
 *       - **all**：同时测试以上所有
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *           default: TSLA260213C400000.US
 *         description: 期权代码（用于 option-price 模式）
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           enum: [option-price, market-kline, moomoo-proxy, all]
 *           default: option-price
 *         description: 测试模式
 *     responses:
 *       200:
 *         description: 诊断结果
 */
quoteRouter.get('/market-data-test', async (req: Request, res: Response) => {
  const { symbol = 'TSLA260213C400000.US', mode = 'option-price' } = req.query;
  const sym = String(symbol);
  const testMode = String(mode);

  interface StepResult {
    step: string;
    status: 'success' | 'fail' | 'skip';
    duration_ms: number;
    data?: Record<string, unknown>;
    error?: string;
  }

  const steps: StepResult[] = [];

  async function runStep(
    name: string,
    fn: () => Promise<Record<string, unknown> | null>
  ): Promise<Record<string, unknown> | null> {
    const start = Date.now();
    try {
      const result = await fn();
      steps.push({
        step: name,
        status: result ? 'success' : 'fail',
        duration_ms: Date.now() - start,
        data: result || undefined,
        error: result ? undefined : '返回 null',
      });
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push({
        step: name,
        status: 'fail',
        duration_ms: Date.now() - start,
        error: msg,
      });
      return null;
    }
  }

  // ── option-price 模式 ──
  if (testMode === 'option-price' || testMode === 'all') {
    // Level 2: LongPort optionQuote
    await runStep('Level 2: LongPort optionQuote()', async () => {
      const quoteCtx = await getQuoteContext();
      const quotes = await quoteCtx.optionQuote([sym]);
      if (!quotes || quotes.length === 0) return null;
      const q = quotes[0];
      return {
        symbol: q.symbol,
        lastDone: q.lastDone,
        impliedVolatility: q.impliedVolatility,
        openInterest: q.openInterest,
        strikePrice: q.strikePrice,
      };
    });

    // Level 3: LongPort depth
    await runStep('Level 3: LongPort depth()', async () => {
      const result = await longportOptionQuoteService.getOptionDepth(sym);
      if (!result) return null;
      return { bestBid: result.bestBid, bestAsk: result.bestAsk, midPrice: result.midPrice };
    });

    // Level 4: 富途 getOptionDetail (需要 optionId + underlyingStockId)
    const stockIdResult = await runStep('Level 4a: 富途 searchStock (获取 underlyingStockId)', async () => {
      const underlying = sym.replace(/\.US$/, '').replace(/\d{6}[CP]\d+$/, '');
      const id = await getStockIdBySymbol(underlying + '.US');
      if (!id) return null;
      return { underlyingSymbol: underlying, underlyingStockId: id };
    });

    if (stockIdResult && stockIdResult.underlyingStockId) {
      steps.push({
        step: 'Level 4b: 富途 getOptionDetail() (需完整 optionMeta)',
        status: 'skip',
        duration_ms: 0,
        error: '此步骤需要 optionId（从期权链获取），在策略中由 selectOptionContract 提供。如果 optionMeta 缺失则此步骤被跳过——这是常见失败原因',
      });
    }

    // Level 5: LongPort quote
    await runStep('Level 5: LongPort quote()', async () => {
      const quoteCtx = await getQuoteContext();
      const quotes = await quoteCtx.quote([sym]);
      if (!quotes || quotes.length === 0) return null;
      const q = quotes[0];
      return {
        symbol: q.symbol,
        lastDone: q.lastDone,
        volume: q.volume,
      };
    });

    // Level 6: 富途三步流程 (终极兜底)
    await runStep('Level 6: 富途三步流程 getFutunnOptionQuote(symbol)', async () => {
      const result = await getFutunnOptionQuote(sym);
      if (!result) return null;
      return {
        symbol: result.symbol,
        last_done: result.last_done,
        prev_close: result.prev_close,
        open: result.open,
        high: result.high,
        low: result.low,
        volume: result.volume,
      };
    });

    // 综合结果
    await runStep('综合: getOptionPrice() 完整 fallback 链', async () => {
      const result = await longportOptionQuoteService.getOptionPrice(sym);
      if (!result) return null;
      return {
        price: result.price,
        bid: result.bid,
        ask: result.ask,
        iv: result.iv,
        source: result.source,
      };
    });
  }

  // ── market-kline 模式 ──
  if (testMode === 'market-kline' || testMode === 'all') {
    const MarketDataService = (await import('../services/market-data.service')).default;

    await runStep('SPX 日K (Moomoo Proxy)', async () => {
      const data = await MarketDataService.getSPXCandlesticks(5);
      if (!data || data.length === 0) return null;
      const last = data[data.length - 1];
      return { count: data.length, latest: { close: last.close, timestamp: last.timestamp } };
    });

    await runStep('USD Index 日K (Moomoo Proxy)', async () => {
      const data = await MarketDataService.getUSDIndexCandlesticks(5);
      if (!data || data.length === 0) return null;
      const last = data[data.length - 1];
      return { count: data.length, latest: { close: last.close, timestamp: last.timestamp } };
    });

    await runStep('BTC 日K (Moomoo Proxy)', async () => {
      const data = await MarketDataService.getBTCCandlesticks(5);
      if (!data || data.length === 0) return null;
      const last = data[data.length - 1];
      return { count: data.length, latest: { close: last.close, timestamp: last.timestamp } };
    });

    await runStep('VIX (LongPort)', async () => {
      const data = await MarketDataService.getVIXCandlesticks(5);
      if (!data || data.length === 0) return null;
      const last = data[data.length - 1];
      return { count: data.length, latest: { close: last.close, timestamp: last.timestamp } };
    });
  }

  // ── moomoo-proxy 模式：直接测试边缘函数代理（原始 API 调用） ──
  if (testMode === 'moomoo-proxy' || testMode === 'all') {
    // 获取代理模式信息
    const proxyMode = await getProxyMode();

    // 获取当前 cookie 配置信息
    const futunnConfig = getFutunnConfig();
    const configSummary = {
      proxyMode,
      csrfToken: futunnConfig.csrfToken ? `${futunnConfig.csrfToken.substring(0, 8)}...` : 'N/A',
    };

    steps.push({
      step: 'Moomoo Proxy 配置信息',
      status: 'success',
      duration_ms: 0,
      data: configSummary as Record<string, unknown>,
    });

    // 测试用 K-line 配置（与 market-data.service.ts 保持一致）
    const testTargets = [
      {
        name: 'SPX 日K',
        stockId: '200003',
        marketId: '2',
        marketCode: '24',
        instrumentType: '6',
        subInstrumentType: '6001',
        referer: 'https://www.moomoo.com/ja/index/.SPX-US',
        apiPath: '/quote-api/quote-v2/get-kline',
        type: 2,
      },
      {
        name: 'USD Index 日K',
        stockId: '72000025',
        marketId: '11',
        marketCode: '121',
        instrumentType: '10',
        subInstrumentType: '10001',
        referer: 'https://www.moomoo.com/currency/USDINDEX-FX',
        apiPath: '/quote-api/quote-v2/get-kline',
        type: 2,
      },
      {
        name: 'BTC 日K',
        stockId: '12000015',
        marketId: '17',
        marketCode: '360',
        instrumentType: '11',
        subInstrumentType: '11002',
        referer: 'https://www.moomoo.com/currency/BTC-FX',
        apiPath: '/quote-api/quote-v2/get-kline',
        type: 2,
      },
      {
        name: 'SPX 分时',
        stockId: '200003',
        marketId: '2',
        marketCode: '24',
        instrumentType: '6',
        subInstrumentType: '6001',
        referer: 'https://www.moomoo.com/ja/index/.SPX-US',
        apiPath: '/quote-api/quote-v2/get-quote-minute',
        type: 1,
      },
    ];

    for (const target of testTargets) {
      await runStep(`Moomoo Proxy: ${target.name}`, async () => {
        const timestamp = Date.now();

        // 构建 token 参数（字符串格式，与 market-data.service.ts 一致）
        const tokenParams: Record<string, string> = {
          stockId: target.stockId,
          marketType: target.marketId,
          type: target.type.toString(),
          marketCode: target.marketCode,
          instrumentType: target.instrumentType,
          subInstrumentType: target.subInstrumentType,
          _: timestamp.toString(),
        };

        const quoteToken = generateQuoteToken(tokenParams);

        // 构建请求参数（数字格式）
        const requestParams: Record<string, number> = {
          stockId: Number(target.stockId),
          marketType: Number(target.marketId),
          type: target.type,
          marketCode: Number(target.marketCode),
          instrumentType: Number(target.instrumentType),
          subInstrumentType: Number(target.subInstrumentType),
          _: timestamp,
        };

        const responseData = await moomooProxy({
          path: target.apiPath,
          params: requestParams,
          cookies: futunnConfig.cookies,
          csrfToken: futunnConfig.csrfToken,
          quoteToken,
          referer: target.referer,
          timeout: 15000,
        });

        if (!responseData) return null;

        // 解析响应结构
        const result: Record<string, unknown> = {
          responseType: typeof responseData,
          hasCode: responseData?.code !== undefined,
          code: responseData?.code,
        };

        // 提取 K-line 数据摘要
        if (responseData?.data) {
          const data = responseData.data;
          if (data.list && Array.isArray(data.list)) {
            result.dataPoints = data.list.length;
            if (data.list.length > 0) {
              const last = data.list[data.list.length - 1];
              result.latestPoint = {
                close: last.close || last.price,
                timestamp: last.timestamp || last.time,
              };
            }
          } else if (data.priceList && Array.isArray(data.priceList)) {
            // get-quote-minute 返回 priceList
            result.dataPoints = data.priceList.length;
            if (data.priceList.length > 0) {
              const last = data.priceList[data.priceList.length - 1];
              result.latestPoint = {
                price: last.price,
                timestamp: last.timestamp || last.time,
              };
            }
          } else {
            result.dataKeys = Object.keys(data);
          }
        }

        return result;
      });
    }
  }

  const successCount = steps.filter(s => s.status === 'success').length;
  const failCount = steps.filter(s => s.status === 'fail').length;
  const totalDuration = steps.reduce((sum, s) => sum + s.duration_ms, 0);

  res.json({
    success: true,
    data: {
      mode: testMode,
      symbol: sym,
      summary: {
        total_steps: steps.length,
        success: successCount,
        fail: failCount,
        total_duration_ms: totalDuration,
      },
      steps,
    },
  });
});
