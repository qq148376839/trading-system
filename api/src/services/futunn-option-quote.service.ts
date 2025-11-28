import axios from 'axios';
import crypto from 'crypto';
import { getFutunnConfig, getFutunnHeaders } from '../config/futunn';

/**
 * 富途牛牛期权行情服务
 * 
 * 由于长桥API的期权行情权限限制（错误码301604），使用富途牛牛API作为替代方案
 * 
 * 参考文档：OPTION_QUOTE_API.md
 */

/**
 * 设置富途牛牛配置（用于测试或动态更新）
 * 注意：实际使用时应从环境变量读取，通过 config/futunn.ts 统一管理
 */
export function setFutunnConfig(config: { csrfToken: string; cookies: string }) {
  // 直接使用 config/futunn.ts 的配置
  // 这个函数保留用于向后兼容
  const { setFutunnConfig: setConfig } = require('../config/futunn');
  setConfig(config);
}

/**
 * 生成quote-token
 * 与 forex.ts 中的实现一致，但使用字符串类型参数
 */
function generateQuoteToken(params: Record<string, string>): string {
  // 重要：参数值必须是字符串类型（已验证匹配浏览器行为）
  const dataStr = JSON.stringify(params);
  
  if (dataStr.length <= 0) {
    return 'quote';
  }
  
  // HMAC-SHA512加密
  const hmacResult = crypto
    .createHmac('sha512', 'quote_web')
    .update(dataStr)
    .digest('hex');
  
  const firstSlice = hmacResult.substring(0, 10);
  
  // SHA256哈希
  const sha256Result = crypto
    .createHash('sha256')
    .update(firstSlice)
    .digest('hex');
  
  const token = sha256Result.substring(0, 10);
  
  return token;
}

/**
 * 解析期权代码
 * 例如：TSLA251121P395000.US -> { symbol: 'TSLA', date: '251121', type: 'P', strike: '395000' }
 */
function parseOptionCode(optionSymbol: string): {
  symbol: string;
  date: string;
  type: 'C' | 'P';
  strike: string;
  strikeDateTimestamp: number;
} | null {
  // 移除 .US 后缀
  const code = optionSymbol.replace(/\.US$/, '').toUpperCase();
  
  // 匹配格式：SYMBOL + YYMMDD + C/P + STRIKE
  // 例如：TSLA251121P395000
  const match = code.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
  if (!match) {
    return null;
  }
  
  const [, symbol, dateStr, type, strikeStr] = match;
  
  // 转换日期：251121 -> 2025-11-21 -> 时间戳
  const year = 2000 + parseInt(dateStr.substring(0, 2));
  const month = parseInt(dateStr.substring(2, 4));
  const day = parseInt(dateStr.substring(4, 6));
  
  // 期权到期日使用美东时间（EST）的 00:00:00，对应 UTC 05:00:00（冬令时）
  // 11月是冬令时，使用 EST (UTC-5)
  const strikeDate = new Date(Date.UTC(year, month - 1, day, 5, 0, 0));
  const strikeDateTimestamp = Math.floor(strikeDate.getTime() / 1000);
  
  return {
    symbol,
    date: dateStr,
    type: type as 'C' | 'P',
    strike: strikeStr,
    strikeDateTimestamp,
  };
}

/**
 * 步骤1：搜索正股信息
 */
async function searchStock(keyword: string): Promise<{
  stockId: string;
  marketType: number;
} | null> {
  const url = 'https://www.moomoo.com/api/headfoot-search';
  const params = {
    keyword: keyword.toLowerCase(),
    lang: 'zh-cn',
    site: 'sg',  // 使用sg而不是cn
  };
  
  try {
    const headers = getFutunnHeaders('https://www.moomoo.com/');
    const response = await axios.get(url, { params, headers, timeout: 10000 });
    
    // headfoot-search接口可能返回不同的数据结构，需要检查
    // 可能的格式：{ data: { stock: [...] } } 或 { stock: [...] }
    let stockList: any[] = [];
    
    if (response.data?.data?.stock) {
      stockList = response.data.data.stock;
    } else if (response.data?.stock) {
      stockList = response.data.stock;
    } else if (Array.isArray(response.data)) {
      stockList = response.data;
    }
    
    // 查找正股（非ETF）
    for (const stock of stockList) {
      if (stock.symbol === keyword.toUpperCase() + '.US' || 
          stock.stockSymbol === keyword.toUpperCase()) {
        return {
          stockId: String(stock.stockId),
          marketType: stock.marketType,
        };
      }
    }
    
    console.warn(`未找到正股: ${keyword}`);
    return null;
  } catch (error: any) {
    console.error('搜索正股失败:', error.message);
    if (error.response) {
      console.error('API响应状态:', error.response.status, error.response.data);
    }
    return null;
  }
}

/**
 * 步骤2：获取期权链，查找目标期权
 * expiration参数根据期权是否过期动态判断：
 * - 如果期权还没有过期（到期日期 > 当前日期），则 expiration = 1
 * - 如果期权已经过期（到期日期 <= 当前日期），则 expiration = 0
 */
async function getOptionFromChain(
  stockId: string,
  strikeDateTimestamp: number,
  optionType: 'C' | 'P',
  strikePrice: string
): Promise<{
  optionId: string;
  optionCode: string;
} | null> {
  const futunnConfig = getFutunnConfig();
  if (!futunnConfig) {
    throw new Error('富途牛牛配置未设置，请在 .env 文件中设置 FUTUNN_CSRF_TOKEN 和 FUTUNN_COOKIES');
  }
  
  const url = 'https://www.moomoo.com/quote-api/quote-v2/get-option-chain';
  const timestamp = Date.now();
  
  // 判断期权是否过期
  const currentTimestampSeconds = Math.floor(Date.now() / 1000);
  const isExpired = currentTimestampSeconds >= strikeDateTimestamp;
  const expiration = isExpired ? 0 : 1;
  
  // Token生成使用字符串类型参数
  const paramsForToken = {
    stockId: stockId,
    strikeDate: String(strikeDateTimestamp),
    expiration: String(expiration),  // 根据是否过期动态设置
    _: String(timestamp),
  };
  
  const quoteToken = generateQuoteToken(paramsForToken);
  
  // 使用统一的富途牛牛配置获取headers
  const headers = getFutunnHeaders('https://www.moomoo.com/');
  headers['quote-token'] = quoteToken;
  
  // URL参数使用数字类型
  const params = {
    stockId: parseInt(stockId),
    strikeDate: strikeDateTimestamp,
    expiration: expiration,  // 根据是否过期动态设置
    _: timestamp,
  };
  
  try {
    const response = await axios.get(url, { params, headers, timeout: 10000 });
    
    if (response.data?.code === 0) {
      const optionList = response.data.data || [];
      
      // 查找目标期权
      for (const optionPair of optionList) {
        const option = optionType === 'P' ? optionPair.putOption : optionPair.callOption;
        if (option && option.strikePrice === strikePrice) {
          return {
            optionId: String(option.optionId),
            optionCode: option.code,
          };
        }
      }
    }
    
    return null;
  } catch (error: any) {
    console.error('获取期权链失败:', error.message);
    return null;
  }
}

/**
 * 步骤3：获取期权行情（日K数据）
 */
async function getOptionQuote(optionId: string, marketType: number): Promise<any | null> {
  const futunnConfig = getFutunnConfig();
  if (!futunnConfig) {
    throw new Error('富途牛牛配置未设置，请在 .env 文件中设置 FUTUNN_CSRF_TOKEN 和 FUTUNN_COOKIES');
  }
  
  const url = 'https://www.moomoo.com/quote-api/quote-v2/get-kline';
  const timestamp = Date.now();
  
  // Token生成使用字符串类型参数
  const paramsForToken = {
    stockId: optionId,
    marketType: String(marketType),
    type: '2', // 日K
    marketCode: '41', // 美股期权
    instrumentType: '8', // 期权
    subInstrumentType: '8002', // 期权子类型
    _: String(timestamp),
  };
  
  const quoteToken = generateQuoteToken(paramsForToken);
  
  // 使用统一的富途牛牛配置获取headers
  const headers = getFutunnHeaders('https://www.moomoo.com/');
  headers['quote-token'] = quoteToken;
  
  // URL参数使用数字类型
  const params: any = {
    stockId: Number(optionId),
    marketType: marketType,
    type: 2, // 日K
    marketCode: 41,
    instrumentType: 8,
    subInstrumentType: 8002,
    _: timestamp,
  };
  
  try {
    const response = await axios.get(url, { params, headers, timeout: 10000 });
    
    if (response.data?.code === 0) {
      const klineData = response.data.data;
      const klineList = klineData?.list || [];
      
      if (klineList.length > 0) {
        // 返回最新的K线数据作为当前价格
        const latestKline = klineList[klineList.length - 1];
        
        return {
          last_done: parseFloat(latestKline.c) || 0,
          prev_close: parseFloat(latestKline.lc) || 0,
          open: parseFloat(latestKline.o) || 0,
          high: parseFloat(latestKline.h) || 0,
          low: parseFloat(latestKline.l) || 0,
          volume: parseInt(latestKline.v) || 0,
          turnover: parseInt(latestKline.t) || 0,
          timestamp: latestKline.k * 1000, // 转换为毫秒
        };
      }
    }
    
    return null;
  } catch (error: any) {
    console.error('获取期权行情失败:', error.message);
    return null;
  }
}

/**
 * 获取期权行情（主函数）
 * 
 * @param optionSymbol 期权代码，例如：TSLA251121P395000.US
 * @returns 期权行情数据，格式与长桥API一致
 */
export async function getFutunnOptionQuote(optionSymbol: string): Promise<{
  symbol: string;
  last_done: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  timestamp: number;
  trade_status?: string;
} | null> {
  // 解析期权代码
  const optionInfo = parseOptionCode(optionSymbol);
  if (!optionInfo) {
    console.error(`无法解析期权代码: ${optionSymbol}`);
    return null;
  }
  
  // 步骤1：搜索正股
  const stockInfo = await searchStock(optionInfo.symbol);
  if (!stockInfo) {
    console.error(`无法找到正股: ${optionInfo.symbol}`);
    return null;
  }
  
  // 步骤2：获取期权链
  const optionChainInfo = await getOptionFromChain(
    stockInfo.stockId,
    optionInfo.strikeDateTimestamp,
    optionInfo.type,
    (parseInt(optionInfo.strike) / 1000).toFixed(2) // 转换为行权价格式，如 395.00
  );
  
  if (!optionChainInfo) {
    console.error(`无法找到期权: ${optionSymbol}`);
    return null;
  }
  
  // 步骤3：获取期权行情
  const quoteData = await getOptionQuote(optionChainInfo.optionId, stockInfo.marketType);
  if (!quoteData) {
    console.error(`无法获取期权行情: ${optionSymbol}`);
    return null;
  }
  
  return {
    symbol: optionSymbol,
    ...quoteData,
    trade_status: 'Normal', // 默认状态
  };
}

/**
 * 批量获取期权行情
 */
export async function getFutunnOptionQuotes(optionSymbols: string[]): Promise<Array<{
  symbol: string;
  last_done: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  timestamp: number;
  trade_status?: string;
}>> {
  const results = [];
  
  // 逐个获取（避免并发过多）
  for (const symbol of optionSymbols) {
    try {
      const quote = await getFutunnOptionQuote(symbol);
      if (quote) {
        results.push(quote);
      }
      // 添加小延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error: any) {
      console.error(`获取 ${symbol} 行情失败:`, error.message);
    }
  }
  
  return results;
}

