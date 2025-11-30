import { Router, Request, Response } from 'express';
import { getQuoteContext } from '../config/longport';
import { rateLimiter } from '../middleware/rateLimiter';
import { Market, SecurityListCategory } from 'longport';
import { 
  getFutunnOptionQuotes
} from '../services/futunn-option-quote.service';

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
    
    console.log(`已更新美股标的列表缓存，共 ${list.length} 个标的`);
    return list;
  } catch (error: any) {
    console.error('获取美股标的列表失败:', error);
    // 如果API失败但缓存存在，返回缓存数据
    if (securityListCache) {
      console.warn('使用过期的缓存数据');
      return securityListCache.list;
    }
    throw error;
  }
}

/**
 * GET /api/quote/security-list
 * 获取美股标的列表（用于自动完成）
 */
quoteRouter.get('/security-list', async (req: Request, res: Response) => {
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
    console.error('获取标的列表失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '获取标的列表失败',
      },
    });
  }
});

// 启动时立即加载一次，然后每30分钟更新一次
getSecurityList().catch(err => {
  console.error('启动时加载美股标的列表失败:', err);
});

setInterval(() => {
  getSecurityList().catch(err => {
    console.error('定时更新美股标的列表失败:', err);
  });
}, 30 * 60 * 1000); // 每30分钟更新一次

/**
 * GET /api/quote
 * 获取标的实时行情
 * 
 * 严格按照长桥官方文档实现：
 * https://open.longportapp.com/zh-CN/docs/quote/pull/quote
 * 
 * 请求参数：
 * - symbol: string[] (必需) 标的代码列表，使用 ticker.region 格式，例如：700.HK
 * - 限制：每次请求最多500个标的
 * 
 * 响应：
 * - secu_quote: 标的实时行情数据列表
 */
quoteRouter.get('/', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol } = req.query;

    // 参数验证
    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: symbol',
        },
      });
    }

    // 处理symbol参数（支持单个或多个，支持逗号分隔）
    let symbols: string[];
    if (typeof symbol === 'string') {
      // 如果字符串包含逗号，按逗号分割
      symbols = symbol.split(',').map(s => s.trim()).filter(s => s);
    } else if (Array.isArray(symbol)) {
      symbols = symbol as string[];
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'symbol参数格式错误',
        },
      });
    }

    // 检查数量限制（每次最多500个）
    if (symbols.length > 500) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: '请求的标的数量超过限制，最多支持500个',
        },
      });
    }

    // 验证symbol格式（支持 ticker.region 和 .ticker.region 格式）
    // 支持格式：AAPL.US, 700.HK, .SPX.US (标普500指数带前导点)
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    const invalidSymbols = symbols.filter(s => !symbolPattern.test(s));
    if (invalidSymbols.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SYMBOL_FORMAT',
          message: `无效的标的代码格式: ${invalidSymbols.join(', ')}。请使用 ticker.region 格式，例如：700.HK 或 .SPX.US`,
        },
      });
    }

    // 权限检查：如果只有美股Basic行情权限，检查是否包含非美股代码
    // 注意：这里只做提示，实际权限检查由长桥API返回
    // 注意：.SPX.US 这种带前导点的代码也应该被识别为美股代码
    const nonUSSymbols = symbols.filter(s => {
      const normalized = s.startsWith('.') ? s.substring(1) : s;
      return !normalized.endsWith('.US');
    });
    if (nonUSSymbols.length > 0) {
      console.warn(`警告: 检测到非美股代码: ${nonUSSymbols.join(', ')}。如果账户只有美股Basic行情权限，这些代码可能无法获取实时行情。`);
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
        console.warn(`以下股票未能获取到数据: ${missingSymbols.join(', ')}`);
        failedSymbols.push(...missingSymbols);
      }
    } catch (error: any) {
      // 如果整个请求失败，尝试逐个获取
      console.warn('批量获取行情失败，尝试逐个获取:', error.message);
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
          console.warn(`获取 ${symbol} 行情失败:`, singleError.message);
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
    console.error('获取行情失败:', error);

    // 处理长桥API错误
    if (error.code === '301600') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: '无效的请求参数',
        },
      });
    }

    if (error.code === '301606') {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: '请求频率过高，请稍后重试',
        },
      });
    }

    if (error.code === '301607') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: '请求的标的数量超限，请减少单次请求标的数量',
        },
      });
    }

    // 处理权限错误（可能因为只有美股Basic行情权限，无法获取港股等）
    if (error.message && error.message.includes('permission') || error.message.includes('权限')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: '当前账户没有该市场的行情权限。您只有美股Basic行情权限，请使用美股代码（如AAPL.US）或开通其他市场的行情权限',
        },
      });
    }

    // 处理Token过期错误（401003）
    if (error.message && (error.message.includes('401003') || error.message?.includes('token expired'))) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: '访问令牌已过期，请更新.env文件中的LONGPORT_ACCESS_TOKEN。访问 https://open.longportapp.com/ 获取新的token',
        },
      });
    }

    // 处理Token无效错误（401004）
    if (error.message && error.message.includes('401004')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_INVALID',
          message: '访问令牌无效（401004）。可能原因：Token与App Key不匹配、Token已过期、或没有行情权限。请访问 https://open.longportapp.com/ 重新生成Token并更新.env文件',
        },
      });
    }

    // 其他错误
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
 * GET /api/quote/option
 * 获取期权实时行情
 *
 * 参考文档：
 * https://open.longbridge.com/zh-CN/docs/quote/pull/option-quote
 *
 * 请求参数：
 * - symbol: string[] (必需) 期权代码列表，格式：TSLA251128P395000.US
 * - 限制：每次请求最多500个
 *
 * 响应：
 * - secu_quote: 期权实时行情数据列表
 */
quoteRouter.get('/option', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol } = req.query;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: symbol',
        },
      });
    }

    let symbols: string[];
    if (typeof symbol === 'string') {
      symbols = symbol.split(',').map(s => s.trim()).filter(s => s);
    } else if (Array.isArray(symbol)) {
      symbols = symbol as string[];
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'symbol参数格式错误',
        },
      });
    }

    // 检查数量限制（每次最多500个）
    if (symbols.length > 500) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: '请求的标的数量超过限制，最多支持500个',
        },
      });
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
      console.error('获取期权行情失败（长桥API）:', error);
      
      // 处理权限错误（301604 - no quote access）
      const isPermissionError = error.message && (
        error.message.includes('301604') || 
        error.message.includes('no quote access')
      );
      
      if (isPermissionError) {
        // 尝试使用富途牛牛API作为fallback
        console.log('尝试使用富途牛牛API获取期权行情...');
        
        try {
          const futunnQuotes = await getFutunnOptionQuotes(symbols);
          
          if (futunnQuotes.length > 0) {
            console.log(`✅ 使用富途牛牛API成功获取 ${futunnQuotes.length} 个期权行情`);
            
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
            console.warn('富途牛牛API未能获取到任何期权行情');
          }
        } catch (futunnError: any) {
          console.error('富途牛牛API获取期权行情失败:', futunnError.message);
        }
        
        // 如果富途牛牛API也失败，返回权限错误
        return res.status(403).json({
          success: false,
          error: {
            code: 'NO_OPTION_QUOTE_ACCESS',
            message: '当前账户没有期权行情权限（错误码：301604）。已尝试使用富途牛牛API作为fallback，但仍无法获取数据。请检查富途牛牛配置或访问 Longbridge 手机客户端购买期权行情权限。',
            details: {
              error_code: '301604',
              symbols: symbols,
              futunn_fallback_attempted: true,
            },
          },
        });
      }
      
      // 处理其他错误
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message || '服务器内部错误',
        },
      });
    }
  } catch (error: any) {
    console.error('获取期权行情失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '服务器内部错误',
      },
    });
  }
});

