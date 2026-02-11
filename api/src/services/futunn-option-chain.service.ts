import { getFutunnConfig, getFutunnHeaders, getFutunnSearchHeaders } from '../config/futunn';
import { moomooProxy } from '../utils/moomoo-proxy';
import { generateQuoteToken } from '../utils/moomoo-quote-token';
import { logger } from '../utils/logger';

/**
 * 富途牛牛期权链服务
 * 
 * 提供期权链相关功能：
 * 1. 获取期权到期日期列表
 * 2. 获取指定到期日期的期权链数据
 * 3. 获取单个期权详情
 * 
 * 参考文档：OPTION_CHAIN_FEASIBILITY_ANALYSIS.md
 */

/**
 * 解析成交量字符串（支持"万"等单位）
 */
function parseVolume(volumeStr: string): number {
  if (!volumeStr || volumeStr === '--') {
    return 0;
  }
  
  if (typeof volumeStr === 'number') {
    return volumeStr;
  }
  
  const str = String(volumeStr).trim();
  if (str.includes('万')) {
    return parseFloat(str.replace('万', '')) * 10000;
  }
  if (str.includes('亿')) {
    return parseFloat(str.replace('亿', '')) * 100000000;
  }
  
  return parseFloat(str) || 0;
}

/**
 * 解析百分比字符串
 */
function parsePercentage(percentStr: string): number {
  if (!percentStr || percentStr === '--') {
    return 0;
  }
  
  const str = String(percentStr).replace('%', '').trim();
  return parseFloat(str) || 0;
}

/**
 * 解析价格字符串
 */
function parsePrice(priceStr: string): number {
  if (!priceStr || priceStr === '--') {
    return 0;
  }
  
  return parseFloat(String(priceStr)) || 0;
}

/**
 * 获取期权到期日期列表
 *
 * @param stockId 正股ID（例如：201335 对应 TSLA）
 * @returns 期权到期日期列表和成交量统计
 */
export async function getOptionStrikeDates(stockId: string): Promise<{
  strikeDates: Array<{
    strikeDate: number;
    expiration: number;
    suffix: string;
    leftDay: number;
  }>;
  vol: {
    callNum: string;
    putNum: string;
    callRatio: number;
    putRatio: number;
    total: number;
  };
} | null> {
  const timestamp = Date.now();

  // Token生成使用字符串类型参数
  const paramsForToken = {
    stockId: stockId,
    _: String(timestamp),
  };

  const quoteToken = generateQuoteToken(paramsForToken);

  // 使用统一的富途牛牛配置获取headers
  const headers = getFutunnHeaders('https://www.moomoo.com/hans/stock/TSLA-US/options-chain');

  // URL参数
  const params = {
    stockId: Number(stockId),
    _: timestamp,
  };

  try {
    // ✅ 改为统一走 moomooProxy（边缘函数代理，解决大陆网络超时问题）
    const responseData = await moomooProxy({
      path: '/quote-api/quote-v2/get-option-strike-dates',
      params,
      cookies: headers['Cookie'],
      csrfToken: headers['futu-x-csrf-token'],
      quoteToken,
      referer: 'https://www.moomoo.com/hans/stock/TSLA-US/options-chain',
      timeout: 15000,
    });

    if (responseData?.code === 0 && responseData?.data) {
      return {
        strikeDates: responseData.data.strikeDates || [],
        vol: responseData.data.vol || {
          callNum: '0',
          putNum: '0',
          callRatio: 0,
          putRatio: 0,
          total: 0,
        },
      };
    }

    logger.error('获取期权到期日期列表失败:', responseData);
    return null;
  } catch (error: any) {
    logger.error('获取期权到期日期列表失败:', error.message);
    if (error.response) {
      logger.error('API响应状态:', error.response.status, error.response.data);
    }
    return null;
  }
}

/**
 * 获取期权链数据
 * 
 * @param stockId 正股ID
 * @param strikeDate 到期日期时间戳（秒级）
 * @returns 期权链数据（包含看涨和看跌期权）
 */
export async function getOptionChain(
  stockId: string,
  strikeDate: number
): Promise<Array<{
  callOption?: {
    optionId: string;
    optionType: number;
    code: string;
    strikePrice: string;
    strikeDate: number;
    openInterest: string;
    priceAccuracy?: number;
    optionExerciseMethod?: number;
    standardType?: number;
    indexOptionType?: number;
    spreadTableCode?: number;
  };
  putOption?: {
    optionId: string;
    optionType: number;
    code: string;
    strikePrice: string;
    strikeDate: number;
    openInterest: string;
    priceAccuracy?: number;
    optionExerciseMethod?: number;
    standardType?: number;
    indexOptionType?: number;
    spreadTableCode?: number;
  };
}> | null> {
  const futunnConfig = getFutunnConfig();
  if (!futunnConfig) {
    throw new Error('富途牛牛配置未设置');
  }

  const timestamp = Date.now();

  // 判断期权是否过期
  const currentTimestampSeconds = Math.floor(Date.now() / 1000);
  const expirationDayEnd = strikeDate + 86400; // 到期日+1天
  const isExpired = currentTimestampSeconds >= expirationDayEnd;
  const expiration = isExpired ? 0 : 1;

  // Token生成使用字符串类型参数
  const paramsForToken = {
    stockId: stockId,
    strikeDate: String(strikeDate),
    expiration: String(expiration),
    _: String(timestamp),
  };

  const quoteToken = generateQuoteToken(paramsForToken);

  // 使用统一的富途牛牛配置获取headers
  const headers = getFutunnHeaders('https://www.moomoo.com/hans/stock/TSLA-US/options-chain');

  // URL参数使用数字类型
  const params = {
    stockId: parseInt(stockId),
    strikeDate: strikeDate,
    expiration: expiration,
    _: timestamp,
  };

  try {
    // ✅ 改为统一走 moomooProxy（边缘函数代理，解决大陆网络超时问题）
    let responseData = await moomooProxy({
      path: '/quote-api/quote-v2/get-option-chain',
      params,
      cookies: headers['Cookie'],
      csrfToken: headers['futu-x-csrf-token'],
      quoteToken,
      referer: 'https://www.moomoo.com/hans/stock/TSLA-US/options-chain',
      timeout: 15000,
    });

    if (responseData?.code === 0) {
      const chainData = responseData.data || [];
      // 如果获取到数据，直接返回
      if (chainData.length > 0) {
        return chainData;
      }

      // 如果expiration=1没有数据，且当前判断为未过期，尝试使用expiration=0
      if (expiration === 1 && chainData.length === 0) {
        logger.debug(`expiration=1未获取到数据，尝试使用expiration=0获取strikeDate=${strikeDate}的期权链`);

        // 重新生成token和参数，使用expiration=0
        const paramsForTokenExpired = {
          stockId: stockId,
          strikeDate: String(strikeDate),
          expiration: '0',
          _: String(timestamp),
        };
        const quoteTokenExpired = generateQuoteToken(paramsForTokenExpired);

        const paramsExpired = {
          stockId: parseInt(stockId),
          strikeDate: strikeDate,
          expiration: 0,
          _: timestamp,
        };

        responseData = await moomooProxy({
          path: '/quote-api/quote-v2/get-option-chain',
          params: paramsExpired,
          cookies: headers['Cookie'],
          csrfToken: headers['futu-x-csrf-token'],
          quoteToken: quoteTokenExpired,
          referer: 'https://www.moomoo.com/hans/stock/TSLA-US/options-chain',
          timeout: 15000,
        });

        if (responseData?.code === 0) {
          const expiredChainData = responseData.data || [];
          if (expiredChainData.length > 0) {
            logger.info(`使用expiration=0成功获取到${expiredChainData.length}条期权链数据`);
            return expiredChainData;
          }
        }
      }

      // 如果都没有数据，返回空数组（而不是null）
      return [];
    }

    logger.error('获取期权链失败:', responseData);
    return null;
  } catch (error: any) {
    logger.error('获取期权链失败:', error.message);
    if (error.response) {
      logger.error('API响应状态:', error.response.status, error.response.data);
    }
    return null;
  }
}

/**
 * 获取期权详情
 * 
 * @param optionId 期权ID
 * @param underlyingStockId 正股ID
 * @param marketType 市场类型（美股为2）
 * @returns 期权详情数据
 */
export async function getOptionDetail(
  optionId: string,
  underlyingStockId: string,
  marketType: number = 2
): Promise<{
  // 价格信息
  price: number;
  change: number;
  changeRatio: number;
  priceOpen: number;
  priceLastClose: number;
  priceHighest: number;
  priceLowest: number;
  
  // 成交量信息
  volume: number;
  turnover: number;
  priceBid: number;
  priceAsk: number;
  volumeBid: number;
  volumeAsk: number;
  
  // 期权特定信息
  option: {
    strikePrice: number;
    contractSize: number;
    openInterest: number;
    premium: number;
    impliedVolatility: number;
    greeks: {
      delta: number;
      gamma: number;
      vega: number;
      theta: number;
      rho: number;
      hpDelta: number;
      hpGamma: number;
      hpVega: number;
      hpTheta: number;
      hpRho: number;
    };
    leverage: number;
    effectiveLeverage: number;
    intrinsicValue: number;
    timeValue: number;
    daysToExpiration: number;
    optionType: 'Call' | 'Put';
    multiplier: number;
  };
  
  // 正股信息
  underlyingStock: {
    code: string;
    name: string;
    price: number;
    change: number;
    changeRatio: number;
  };

  // 便捷字段（顶层访问，避免嵌套）
  underlyingPrice: number;
  underlyingChange: number;
  underlyingChangeRatio: string;
  underlyingPriceDirect: string;

  // 其他信息
  marketStatus: number;
  marketStatusText: string;
  delayTime: number;
} | null> {
  const futunnConfig = getFutunnConfig();
  if (!futunnConfig) {
    throw new Error('富途牛牛配置未设置');
  }
  
  const timestamp = Date.now();
  
  // Token生成使用字符串类型参数
  const paramsForToken = {
    stockId: optionId,
    marketType: String(marketType),
    marketCode: '41', // 美股期权
    spreadCode: '81', // 期权价差代码
    underlyingStockId: underlyingStockId,
    instrumentType: '8', // 期权
    subInstrumentType: '8002', // 期权子类型
    _: String(timestamp),
  };
  
  const quoteToken = generateQuoteToken(paramsForToken);
  
  // 使用统一的富途牛牛配置获取headers
  const headers = getFutunnHeaders('https://www.moomoo.com/hans/options/');
  headers['quote-token'] = quoteToken;
  
  // URL参数使用数字类型
  const params: any = {
    stockId: Number(optionId),
    marketType: marketType,
    marketCode: 41,
    spreadCode: 81,
    underlyingStockId: underlyingStockId,
    instrumentType: 8,
    subInstrumentType: 8002,
    _: timestamp,
  };
  
  try {
    // ✅ 改为统一走 moomooProxy（边缘函数会自动计算 quote-token，更适配大陆网络环境）
    const responseData = await moomooProxy({
      path: '/quote-api/quote-v2/get-stock-quote',
      params,
      cookies: headers['Cookie'],
      csrfToken: headers['futu-x-csrf-token'],
      quoteToken,
      referer: 'https://www.moomoo.com/hans/options/',
      timeout: 10000,
    });
    
    if (responseData?.code === 0 && responseData?.data) {
      const data = responseData.data;
      const optionData = data.option || {};
      const greekData = optionData.greek || {};
      
      return {
        // 价格信息
        price: parsePrice(data.price || data.priceNominal || '0'),
        change: parsePrice(data.change || '0'),
        changeRatio: parsePercentage(data.changeRatio || '0'),
        priceOpen: parsePrice(data.priceOpen || '0'),
        priceLastClose: parsePrice(data.priceLastClose || '0'),
        priceHighest: parsePrice(data.priceHighest || '0'),
        priceLowest: parsePrice(data.priceLowest || '0'),
        
        // 成交量信息
        volume: parseVolume(data.volume || '0'),
        turnover: parsePrice(data.turnover || '0'),
        priceBid: parsePrice(data.priceBid || '0'),
        priceAsk: parsePrice(data.priceAsk || '0'),
        volumeBid: parseInt(String(data.volumeBid || '0')) || 0,
        volumeAsk: parseInt(String(data.volumeAsk || '0')) || 0,
        
        // 期权特定信息
        option: {
          strikePrice: parsePrice(optionData.priceStrike || '0'),
          contractSize: parseInt(String(optionData.contractSize || '100')) || 100,
          openInterest: parseInt(String(optionData.openInterest || '0')) || 0,
          premium: parsePercentage(optionData.premium || '0'),
          impliedVolatility: parsePercentage(optionData.impliedVolatility || '0'),
          greeks: {
            delta: parsePrice(greekData.delta || greekData.hpDelta || '0'),
            gamma: parsePrice(greekData.gamma || greekData.hpGamma || '0'),
            vega: parsePrice(greekData.vega || greekData.hpVega || '0'),
            theta: parsePrice(greekData.theta || greekData.hpTheta || '0'),
            rho: parsePrice(greekData.rho || greekData.hpRho || '0'),
            hpDelta: parsePrice(greekData.hpDelta || '0'),
            hpGamma: parsePrice(greekData.hpGamma || '0'),
            hpVega: parsePrice(greekData.hpVega || '0'),
            hpTheta: parsePrice(greekData.hpTheta || '0'),
            hpRho: parsePrice(greekData.hpRho || '0'),
          },
          leverage: parsePrice(optionData.leverage || '0'),
          effectiveLeverage: parsePrice(optionData.effectiveLeverage || '0'),
          intrinsicValue: parsePrice(optionData.intrinsicValue || '0'),
          timeValue: parsePrice(optionData.timeValue || '0'),
          daysToExpiration: parseInt(String(optionData.distanceDueDate || '0')) || 0,
          optionType: (optionData.optionType === 1 || optionData.optionType === '1') ? 'Call' : 'Put',
          multiplier: parseInt(String(optionData.multiplier || '100')) || 100,
        },
        
        // 正股信息
        underlyingStock: {
          code: data.underlyingStockInfo?.stockCode || '',
          name: data.underlyingStockInfo?.name || '',
          price: parsePrice(data.underlyingStockInfo?.price || '0'),
          change: parsePrice(data.underlyingStockInfo?.change || '0'),
          changeRatio: parsePercentage(data.underlyingStockInfo?.changeRatio || '0'),
        },

        // 便捷字段（顶层访问，避免嵌套）
        underlyingPrice: parsePrice(data.underlyingStockInfo?.price || '0'),
        underlyingChange: parsePrice(data.underlyingStockInfo?.change || '0'),
        underlyingChangeRatio: data.underlyingStockInfo?.changeRatio || '0.00%',
        underlyingPriceDirect: data.underlyingStockInfo?.priceDirect || 'flat',

        // 其他信息
        marketStatus: data.market_status || 0,
        marketStatusText: data.market_status_text || '',
        delayTime: parseInt(String(data.delayTime || '0')) || 0,
      };
    }
    
    logger.error('获取期权详情失败:', responseData);
    return null;
  } catch (error: any) {
    logger.error('获取期权详情失败:', error.message);
    if (error.response) {
      logger.error('API响应状态:', error.response.status, error.response.data);
    }
    return null;
  }
}

/**
 * 搜索正股信息（复用现有实现）
 * 从 futunn-option-quote.service.ts 复制
 */
async function searchStock(keyword: string): Promise<{
  stockId: string;
  marketType: number;
} | null> {
  const params = {
    keyword: keyword.toLowerCase(),
    lang: 'zh-cn',
    site: 'sg',
  };
  
  try {
    // 使用搜索接口专用的headers函数（单独获取cookies）
    const headers = await getFutunnSearchHeaders('https://www.moomoo.com/');
    
    // 使用边缘函数代理
    const responseData = await moomooProxy({
      path: '/api/headfoot-search',
      params,
      cookies: headers['Cookie'],
      csrfToken: headers['futu-x-csrf-token'],
      referer: 'https://www.moomoo.com/',
      timeout: 10000,
    });
    
    let stockList: any[] = [];
    
    if (responseData?.data?.stock) {
      stockList = responseData.data.stock;
    } else if (responseData?.stock) {
      stockList = responseData.stock;
    } else if (Array.isArray(responseData)) {
      stockList = responseData;
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
    
    logger.warn(`未找到正股: ${keyword}`);
    return null;
  } catch (error: any) {
    logger.error('搜索正股失败:', error.message);
    if (error.response) {
      logger.error('API响应状态:', error.response.status, error.response.data);
    }
    return null;
  }
}

/**
 * 通过股票代码获取stockId（辅助函数）
 */
export async function getStockIdBySymbol(symbol: string): Promise<string | null> {
  // 移除 .US 后缀
  const keyword = symbol.replace(/\.US$/i, '').toUpperCase();
  const stockInfo = await searchStock(keyword);
  return stockInfo?.stockId || null;
}

/**
 * 获取正股行情
 * 
 * @param stockId 正股ID
 * @param marketType 市场类型（美股为2）
 * @returns 正股行情数据
 */
export async function getUnderlyingStockQuote(
  stockId: string,
  marketType: number = 2
): Promise<{
  price: number;
  change: number;
  changeRatio: number;
  priceOpen: number;
  priceHighest: number;
  priceLowest: number;
  volume: number;
  turnover: number;
  priceBid: number;
  priceAsk: number;
  volumeBid: number;
  volumeAsk: number;
  marketStatus: number;
  marketStatusText: string;
} | null> {
  const futunnConfig = getFutunnConfig();
  if (!futunnConfig) {
    throw new Error('富途牛牛配置未设置');
  }
  
  const timestamp = Date.now();
  
  // Token生成使用字符串类型参数
  const paramsForToken = {
    stockId: stockId,
    marketType: String(marketType),
    marketCode: '11', // 美股股票
    lotSize: '1',
    spreadCode: '45',
    underlyingStockId: '0',
    instrumentType: '3', // 股票
    subInstrumentType: '3002',
    _: String(timestamp),
  };
  
  const quoteToken = generateQuoteToken(paramsForToken);
  
  // 使用统一的富途牛牛配置获取headers
  const headers = getFutunnHeaders('https://www.moomoo.com/hans/stock/TSLA-US/options-chain');
  headers['quote-token'] = quoteToken;
  
  // URL参数使用数字类型
  const params: any = {
    stockId: Number(stockId),
    marketType: marketType,
    marketCode: 11,
    lotSize: 1,
    spreadCode: 45,
    underlyingStockId: 0,
    instrumentType: 3,
    subInstrumentType: 3002,
    _: timestamp,
  };
  
  try {
    // ✅ 改为统一走 moomooProxy
    const responseData = await moomooProxy({
      path: '/quote-api/quote-v2/get-stock-quote',
      params,
      cookies: headers['Cookie'],
      csrfToken: headers['futu-x-csrf-token'],
      quoteToken,
      referer: 'https://www.moomoo.com/hans/stock/TSLA-US/options-chain',
      timeout: 10000,
    });
    
    if (responseData?.code === 0 && responseData?.data) {
      const data = responseData.data;
      
      return {
        price: parsePrice(data.price || '0'),
        change: parsePrice(data.change || '0'),
        changeRatio: parsePercentage(data.changeRatio || '0'),
        priceOpen: parsePrice(data.priceOpen || '0'),
        priceHighest: parsePrice(data.priceHighest || '0'),
        priceLowest: parsePrice(data.priceLowest || '0'),
        volume: parseVolume(data.volume || '0'),
        turnover: parsePrice(data.turnover || '0'),
        priceBid: parsePrice(data.priceBid || '0'),
        priceAsk: parsePrice(data.priceAsk || '0'),
        volumeBid: parseInt(String(data.volumeBid || '0')) || 0,
        volumeAsk: parseInt(String(data.volumeAsk || '0')) || 0,
        marketStatus: data.market_status || 0,
        marketStatusText: data.market_status_text || '',
      };
    }
    
    logger.error('获取正股行情失败:', responseData);
    return null;
  } catch (error: any) {
    logger.error('获取正股行情失败:', error.message);
    if (error.response) {
      logger.error('API响应状态:', error.response.status, error.response.data);
    }
    return null;
  }
}

/**
 * 获取期权K线数据（日K）
 * 
 * @param optionId 期权ID
 * @param marketType 市场类型（默认2=美股）
 * @param count 数据条数（默认100）
 * @returns K线数据数组
 */
export async function getOptionKline(
  optionId: string,
  marketType: number = 2,
  count: number = 100
): Promise<Array<{
  timestamp: number;      // 时间戳（秒）
  open: number;           // 开盘价
  close: number;          // 收盘价
  high: number;           // 最高价
  low: number;            // 最低价
  volume: number;         // 成交量
  turnover: number;       // 成交额
  prevClose: number;      // 昨收
  change: number;         // 涨跌额
  openInterest?: number;  // 持仓量（可选）
}>> {
  const timestamp = Date.now();
  
  // Token参数（字符串类型，顺序很重要）
  const tokenParams: Record<string, string> = {
    stockId: optionId,
    marketType: String(marketType),
    type: '2', // 日K
    marketCode: '41',
    instrumentType: '8', // 期权
    subInstrumentType: '8002', // 期权子类型
    _: String(timestamp),
  };
  
  const quoteToken = generateQuoteToken(tokenParams);
  
  // 请求参数（数字类型）
  const requestParams: any = {
    stockId: Number(optionId),
    marketType: marketType,
    type: 2, // 日K
    marketCode: 41,
    instrumentType: 8,
    subInstrumentType: 8002,
    _: timestamp,
  };
  
  try {
    const headers = getFutunnHeaders('https://www.moomoo.com/hans/options/');
    
    // 使用边缘函数代理
    const responseData = await moomooProxy({
      path: '/quote-api/quote-v2/get-kline',
      params: requestParams,
      cookies: headers['Cookie'],
      csrfToken: headers['futu-x-csrf-token'],
      quoteToken: quoteToken,
      referer: 'https://www.moomoo.com/hans/options/',
      timeout: 15000,
    });
    
    if (responseData?.code === 0 && responseData?.data) {
      const klineList = responseData.data.list || [];
      
      return klineList.map((item: any) => ({
        timestamp: item.k || 0, // 时间戳（秒）
        open: parsePrice(item.o || '0'),
        close: parsePrice(item.c || '0'),
        high: parsePrice(item.h || '0'),
        low: parsePrice(item.l || '0'),
        volume: parseInt(String(item.v || '0')) || 0,
        turnover: parseInt(String(item.t || '0')) || 0,
        prevClose: parsePrice(item.lc || '0'),
        change: parsePrice(item.cp || '0'),
        openInterest: item.oi ? parseInt(String(item.oi)) : undefined,
      }));
    }
    
    logger.error('获取期权K线数据失败:', responseData);
    return [];
  } catch (error: any) {
    logger.error('获取期权K线数据失败:', error.message);
    if (error.response) {
      logger.error('API响应状态:', error.response.status, error.response.data);
    }
    return [];
  }
}

/**
 * 获取期权分时数据
 * 
 * @param optionId 期权ID
 * @param marketType 市场类型（默认2=美股）
 * @returns 分时数据数组
 */
export async function getOptionMinute(
  optionId: string,
  marketType: number = 2
): Promise<Array<{
  timestamp: number;      // 时间戳（秒）
  price: number;          // 价格
  volume: number;         // 成交量
  turnover: number;       // 成交额
  changeRatio: number;    // 涨跌幅（%）
  changePrice: number;    // 涨跌额
}>> {
  const timestamp = Date.now();
  
  // Token参数（字符串类型，顺序很重要）
  const tokenParams: Record<string, string> = {
    stockId: optionId,
    marketType: String(marketType),
    type: '1', // 分时
    marketCode: '41',
    instrumentType: '8', // 期权
    subInstrumentType: '8002', // 期权子类型
    _: String(timestamp),
  };
  
  const quoteToken = generateQuoteToken(tokenParams);
  
  // 请求参数（数字类型）
  const requestParams: any = {
    stockId: Number(optionId),
    marketType: marketType,
    type: 1, // 分时
    marketCode: 41,
    instrumentType: 8,
    subInstrumentType: 8002,
    _: timestamp,
  };
  
  try {
    const headers = getFutunnHeaders('https://www.moomoo.com/hans/options/');
    
    // 使用边缘函数代理
    const responseData = await moomooProxy({
      path: '/quote-api/quote-v2/get-quote-minute',
      params: requestParams,
      cookies: headers['Cookie'],
      csrfToken: headers['futu-x-csrf-token'],
      quoteToken: quoteToken,
      referer: 'https://www.moomoo.com/hans/options/',
      timeout: 15000,
    });
    
    if (responseData?.code === 0 && responseData?.data) {
      const minuteList = responseData.data.list || [];
      
      return minuteList.map((item: any) => ({
        timestamp: item.time || 0, // 时间戳（秒）
        price: item.cc_price ? parsePrice(String(item.cc_price)) : (item.price ? parsePrice(String(item.price)) / 1000 : 0), // 优先使用cc_price，否则price需要除以1000
        volume: parseInt(String(item.volume || '0')) || 0,
        turnover: parseInt(String(item.turnover || '0')) || 0,
        changeRatio: parsePercentage(item.ratio || '0'),
        changePrice: parsePrice(String(item.change_price || '0')),
      }));
    }
    
    logger.error('获取期权分时数据失败:', responseData);
    return [];
  } catch (error: any) {
    logger.error('获取期权分时数据失败:', error.message);
    if (error.response) {
      logger.error('API响应状态:', error.response.status, error.response.data);
    }
    return [];
  }
}

