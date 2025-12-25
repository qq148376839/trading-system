/**
 * 市场数据服务
 * 使用富途API获取SPX、USD Index、BTC的市场数据
 */

import axios from 'axios';
import crypto from 'crypto';
import { getFutunnHeaders } from '../config/futunn';
import { moomooProxy, getProxyMode } from '../utils/moomoo-proxy';
import { getQuoteContext } from '../config/longport';

interface CandlestickData {
  close: number;
  open: number;
  low: number;
  high: number;
  volume: number;
  turnover: number;
  timestamp: number;
}

class MarketDataService {
  private baseUrl = 'https://www.moomoo.com/quote-api/quote-v2';

  // 富途API配置（参考CLAUDE.md和Python脚本）
  // 注意：对于K线数据（get-kline），instrumentType和subInstrumentType固定为10和10001
  // 只有marketCode需要根据不同的市场来设置
  private config = {
    spx: {
      stockId: '200003',
      marketId: '2',
      marketCode: '24',  // SPX的marketCode（修正为24）
      instrumentType: '6',  // SPX使用6
      subInstrumentType: '6001',  // SPX使用6001
    },
    usdIndex: {
      stockId: '72000025',
      marketId: '11',
      marketCode: '121',  // USD Index的marketCode
      // instrumentType和subInstrumentType在K线请求中固定为10和10001
    },
    btc: {
      stockId: '12000015',
      marketId: '17',
      marketCode: '360',  // BTC正确的marketCode是360
      // BTC的instrumentType和subInstrumentType固定为11和11002
      instrumentType: '11',
      subInstrumentType: '11002',
    },
    vix: {
      stockId: '77768973045671', // VIX指数 (来源: Moomoo)
      marketId: '2',
      marketCode: '1201',
      instrumentType: '6',
      subInstrumentType: '6001',
    },
  };

  /**
   * 获取富途API的headers（使用统一配置）
   */
  private getHeaders(referer: string = 'https://www.moomoo.com/currency/USDINDEX-FX'): Record<string, string> {
    // 使用统一的富途牛牛配置
    const baseHeaders = getFutunnHeaders(referer);
    
    // 添加额外的headers（如果需要）
    return {
      ...baseHeaders,
      'accept-encoding': 'gzip, deflate, br, zstd',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };
  }

  /**
   * 生成quote-token（参照futunn获取行情.py）
   */
  private generateQuoteToken(params: Record<string, string>): string {
    // 使用JSON.stringify生成token（不是urlencode）
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
   * 获取K线数据（支持日K和分时数据）
   * type: 1 = 分时（使用get-quote-minute接口）, 2 = 日K（使用get-kline接口）
   * 注意：分时数据（type=1）必须使用get-quote-minute接口，不能使用get-kline接口
   */
  async getCandlesticksIntraday(
    stockId: string,
    marketId: string,
    marketCode: string,
    instrumentType: string,
    subInstrumentType: string,
    type: number = 2, // 1=分时, 2=日K
    count: number = 100
  ): Promise<CandlestickData[]> {
    try {
      const timestamp = Date.now();

      // 根据type选择接口和参数
      const isIntraday = type === 1;
      
      // 根据不同的stockId使用不同的referer，更接近浏览器行为
      let referer = 'https://www.moomoo.com/';
      if (stockId === '200003') {
        referer = 'https://www.moomoo.com/ja/index/.SPX-US'; // SPX
      } else if (stockId === '72000025') {
        referer = 'https://www.moomoo.com/currency/USDINDEX-FX'; // USD Index
      } else if (stockId === '12000015') {
        referer = 'https://www.moomoo.com/currency/BTC-FX'; // BTC
      }
      
      // Token参数（始终使用字符串格式）
      // 注意：参数顺序很重要！必须与浏览器请求顺序一致
      const tokenParams: Record<string, string> = {
        stockId: stockId,
        marketType: marketId,
        type: type.toString(),
        marketCode: marketCode,
        instrumentType: instrumentType,
        subInstrumentType: subInstrumentType,
        _: timestamp.toString(),
      };

      const quoteToken = this.generateQuoteToken(tokenParams);
      
      // 请求参数（使用数字格式）
      const requestParams: any = {
        stockId: Number(stockId),
        marketType: Number(marketId),
        type: type,
        marketCode: Number(marketCode),
        instrumentType: Number(instrumentType),
        subInstrumentType: Number(subInstrumentType),
        _: timestamp,
      };

      // 分时数据使用get-quote-minute接口，日K数据使用get-kline接口
      const apiPath = isIntraday 
        ? '/quote-api/quote-v2/get-quote-minute'
        : '/quote-api/quote-v2/get-kline';
      
      const headers = this.getHeaders(referer);
      
      // 只在错误时输出日志，减少正常请求的日志干扰

      // 使用边缘函数代理
      const responseData = await moomooProxy({
        path: apiPath,
        params: requestParams,
        cookies: headers['Cookie'],
        csrfToken: headers['futu-x-csrf-token'],
        quoteToken: quoteToken,
        referer: referer,
        timeout: 15000,
      });

      // 检查响应数据
      if (!responseData) {
        console.error(`[富途API错误] stockId=${stockId}, type=${type}: 响应数据为空`);
        return [];
      }

      if (responseData && responseData.code === 0) {
        let dataArray: any[] = [];

        if (Array.isArray(responseData.data)) {
          dataArray = responseData.data;
        } else if (responseData.data && Array.isArray(responseData.data.list)) {
          dataArray = responseData.data.list;
        } else {
          console.warn(`富途API数据结构未知 (stockId=${stockId}, type=${type}):`, {
            dataKeys: Object.keys(responseData.data || {}),
          });
          return [];
        }

        if (dataArray.length === 0) {
          return [];
        }

        // 对于分时数据，如果请求的数量大于实际返回的数量，使用全部数据
        // 否则只取最后count条（最新的数据）
        const slicedData = dataArray.length > count 
          ? dataArray.slice(-count)
          : dataArray;
        
        // 记录实际获取的数据量（用于调试）
        if (isIntraday && dataArray.length > count) {
          console.log(`分时数据截断: API返回${dataArray.length}条，使用最后${count}条`);
        }
        
        return this.parseCandlestickData(slicedData);
      } else {
        // 只在错误时输出日志
        const errorMsg = responseData?.message || '未知错误';
        console.error(`[富途API错误] stockId=${stockId}, type=${type}: ${errorMsg}`);
        return [];
      }
    } catch (error: any) {
      const errorMsg = error.response?.status === 504 
        ? `网关超时 (504)` 
        : error.message || '未知错误';
      // 简化错误日志
      console.error(`[富途API] stockId=${stockId}, type=${type}: ${errorMsg}`);
      return [];
    }
  }

  /**
   * 获取K线数据（日K）
   * type: 2 = 日K
   */
  async getCandlesticks(
    stockId: string,
    marketId: string,
    marketCode: string,
    instrumentType: string,
    subInstrumentType: string,
    count: number = 100
  ): Promise<CandlestickData[]> {
    return this.getCandlesticksIntraday(
      stockId,
      marketId,
      marketCode,
      instrumentType,
      subInstrumentType,
      2, // 日K
      count
    );
  }

  /**
   * 解析K线数据（统一的数据解析逻辑）
   */
  private parseCandlestickData(dataArray: any[]): CandlestickData[] {
    // 转换为标准格式
    // 富途API返回的数据结构有多种格式：
    // 1. K线数据（get-kline）：使用小写字母字段 o, c, h, l, v, k
    //    - o: 开盘价（字符串）
    //    - c: 收盘价（字符串）
    //    - h: 最高价（字符串）
    //    - l: 最低价（字符串）
    //    - v: 成交量（数字）
    //    - k: 时间戳（秒）
    // 2. 分时数据（get-quote-minute）：可能使用 cc_price, cc_open 等字段
    // 3. 其他格式：price/100, open/100 等
    return dataArray.map((item: any) => {
          // 价格字段解析：支持多种格式
          // 优先级：小写字母字段（o,c,h,l） > cc_*字段 > price/100 > 其他
          let close: number = 0;
          let open: number = 0;
          let high: number = 0;
          let low: number = 0;

          // 收盘价
          if (item.c !== undefined && item.c !== null && item.c !== '') {
            close = parseFloat(String(item.c));
          } else if (item.cc_price !== undefined && item.cc_price !== null) {
            close = parseFloat(String(item.cc_price));
          } else if (item.price !== undefined && item.price !== null) {
            close = parseFloat(String(item.price)) / 100;
          } else if (item.close !== undefined && item.close !== null) {
            close = parseFloat(String(item.close));
          }

          // 开盘价
          if (item.o !== undefined && item.o !== null && item.o !== '') {
            open = parseFloat(String(item.o));
          } else if (item.cc_open !== undefined && item.cc_open !== null) {
            open = parseFloat(String(item.cc_open));
          } else if (item.open !== undefined && item.open !== null) {
            const openVal = parseFloat(String(item.open));
            open = openVal > 1000 ? openVal / 100 : openVal; // 判断是否需要除以100
          } else {
            open = close; // 如果没有开盘价，使用收盘价
          }

          // 最高价
          if (item.h !== undefined && item.h !== null && item.h !== '') {
            high = parseFloat(String(item.h));
          } else if (item.cc_high !== undefined && item.cc_high !== null) {
            high = parseFloat(String(item.cc_high));
          } else if (item.high !== undefined && item.high !== null) {
            const highVal = parseFloat(String(item.high));
            high = highVal > 1000 ? highVal / 100 : highVal;
          } else {
            high = close;
          }

          // 最低价
          if (item.l !== undefined && item.l !== null && item.l !== '') {
            low = parseFloat(String(item.l));
          } else if (item.cc_low !== undefined && item.cc_low !== null) {
            low = parseFloat(String(item.cc_low));
          } else if (item.low !== undefined && item.low !== null) {
            const lowVal = parseFloat(String(item.low));
            low = lowVal > 1000 ? lowVal / 100 : lowVal;
          } else {
            low = close;
          }

          // 时间戳：优先使用k字段（K线时间戳），否则使用t字段
          let timestamp: number = 0;
          if (item.k !== undefined && item.k !== null && item.k !== 0) {
            timestamp = typeof item.k === 'number' ? item.k : parseInt(String(item.k));
          } else if (item.t !== undefined && item.t !== null && item.t !== 0) {
            timestamp = typeof item.t === 'number' ? item.t : parseInt(String(item.t));
          } else {
            timestamp = Math.floor(Date.now() / 1000);
          }

          // 成交量
          let volume: number = 0;
          if (item.v !== undefined && item.v !== null) {
            volume = typeof item.v === 'number' ? item.v : parseFloat(String(item.v));
          } else if (item.volume !== undefined && item.volume !== null) {
            volume = typeof item.volume === 'number' ? item.volume : parseFloat(String(item.volume));
          }

          // 成交额（turnover）
          let turnover: number = 0;
          if (item.turnover !== undefined && item.turnover !== null) {
            turnover = typeof item.turnover === 'number' ? item.turnover : parseFloat(String(item.turnover));
          }

          return {
            close: isNaN(close) ? 0 : close,
            open: isNaN(open) ? 0 : open,
            high: isNaN(high) ? 0 : high,
            low: isNaN(low) ? 0 : low,
            volume: isNaN(volume) ? 0 : volume,
            turnover: isNaN(turnover) ? 0 : turnover,
            timestamp: timestamp * 1000,  // 转换为毫秒时间戳
          };
        });
  }

  /**
   * 获取SPX日K数据
   */
  async getSPXCandlesticks(count: number = 100): Promise<CandlestickData[]> {
    return this.getCandlesticks(
      this.config.spx.stockId,
      this.config.spx.marketId,
      this.config.spx.marketCode,
      this.config.spx.instrumentType,  // SPX使用6
      this.config.spx.subInstrumentType,  // SPX使用6001
      count
    );
  }

  /**
   * 获取USD Index日K数据
   */
  async getUSDIndexCandlesticks(count: number = 100): Promise<CandlestickData[]> {
    return this.getCandlesticks(
      this.config.usdIndex.stockId,
      this.config.usdIndex.marketId,
      this.config.usdIndex.marketCode,
      '10',  // K线数据固定使用10
      '10001',  // K线数据固定使用10001
      count
    );
  }

  /**
   * 获取BTC日K数据
   */
  async getBTCCandlesticks(count: number = 100): Promise<CandlestickData[]> {
    return this.getCandlesticks(
      this.config.btc.stockId,
      this.config.btc.marketId,
      this.config.btc.marketCode,
      this.config.btc.instrumentType,  // BTC使用11
      this.config.btc.subInstrumentType,  // BTC使用11002
      count
    );
  }

  /**
   * 获取VIX恐慌指数日K数据
   * 使用LongPort API获取.VIX.US的K线数据
   * @param count 获取数量，默认100
   * @param targetDate 目标日期（可选），如果提供则使用historyCandlesticksByOffset获取历史数据
   */
  async getVIXCandlesticks(count: number = 100, targetDate?: Date): Promise<CandlestickData[]> {
    try {
      const quoteCtx = await getQuoteContext();
      const longport = require('longport');
      const { Period, AdjustType, NaiveDatetime } = longport;
      const { formatLongbridgeCandlestick } = require('../utils/candlestick-formatter');

      let candlesticks: any[] = [];

      if (targetDate) {
        // 使用historyCandlesticksByOffset获取历史数据
        // 参数：symbol, period, adjustType, forward, datetime, count, tradeSessions(可选)
        const targetNaiveDatetime = new NaiveDatetime(
          targetDate.getFullYear(),
          targetDate.getMonth() + 1,
          targetDate.getDate(),
          targetDate.getHours() || 23,
          targetDate.getMinutes() || 59,
          targetDate.getSeconds() || 59
        );

        candlesticks = await quoteCtx.historyCandlesticksByOffset(
          '.VIX.US',
          Period.Day,
          AdjustType.NoAdjust,
          false, // forward: false表示向历史数据方向查找
          targetNaiveDatetime,
          count
        );
      } else {
        // 如果没有提供targetDate，使用candlesticks获取最新数据（向后兼容）
        const { TradeSessions } = longport;
        candlesticks = await quoteCtx.candlesticks(
          '.VIX.US',
          Period.Day,
          count,
          AdjustType.NoAdjust,
          TradeSessions?.All || 100 // 使用All获取所有交易时段的数据
        );
      }

      // 转换为标准格式
      return candlesticks.map((c: any) => formatLongbridgeCandlestick(c));
    } catch (error: any) {
      console.error(`获取VIX数据失败:`, error.message);
      console.error(`错误详情:`, error);
      // 失败时返回空数组，不使用默认值
      return [];
    }
  }

  /**
   * 获取市场温度（LongPort SDK）
   * 返回市场温度值（0-100范围），失败时返回null（不使用默认值）
   * 
   * 根据LongPort API文档：https://open.longbridge.com/zh-CN/docs/quote/pull/market_temperature
   * 和Node.js SDK文档：https://longportapp.github.io/openapi/nodejs/classes/QuoteContext.html#markettemperature
   * 返回格式：MarketTemperature对象，包含 { temperature, description, valuation, sentiment, updated_at }
   */
  async getMarketTemperature(): Promise<number | null> {
    try {
      const quoteCtx = await getQuoteContext();
      const longport = require('longport');
      const { Market } = longport;
      
      // SDK已更新到3.0.18，应该包含marketTemperature方法
      // 直接调用，如果不存在会抛出错误
      let tempData: any = null;
      
      try {
        tempData = await quoteCtx.marketTemperature(Market.US);
        console.log(`[市场温度] 调用成功，返回数据类型:`, typeof tempData);
      } catch (error: any) {
        console.error(`[市场温度] 调用失败:`, error.message);
        console.error(`[市场温度] 错误详情:`, error);
        
        // 如果方法不存在，检查SDK版本
        if (error.message && error.message.includes('is not a function')) {
          try {
            const longportPackage = require('longport/package.json');
            console.error(`[市场温度] 当前SDK版本: ${longportPackage.version}`);
            console.error(`[市场温度] 请确认SDK版本 >= 3.0.0，当前版本可能不支持marketTemperature方法`);
          } catch (e) {
            // 忽略
          }
        }
        return null;
      }
      
      // 根据LongPort API文档和SDK文档，返回的是MarketTemperature对象
      // 需要调用toString()或直接访问属性
      let temperature: number | null = null;
      
      // 尝试多种方式提取temperature值
      if (tempData && typeof tempData === 'object') {
        // 方式1: 直接访问temperature属性（最可能的方式）
        if ('temperature' in tempData && typeof tempData.temperature === 'number') {
          temperature = tempData.temperature;
          console.log(`[市场温度] 从temperature属性获取: ${temperature}`);
        }
        // 方式2: 如果返回格式是 { code: 0, data: { temperature: ... } }
        else if ('data' in tempData && tempData.data && typeof tempData.data.temperature === 'number') {
          temperature = tempData.data.temperature;
          console.log(`[市场温度] 从data.temperature获取: ${temperature}`);
        }
        // 方式3: 尝试调用toString()然后解析（SDK对象通常有toString方法）
        else if (typeof tempData.toString === 'function') {
          const str = tempData.toString();
          console.log(`[市场温度] MarketTemperature toString():`, str);
          // 尝试从字符串中提取temperature值
          const match = str.match(/temperature[:\s]+(\d+(?:\.\d+)?)/i);
          if (match) {
            temperature = parseFloat(match[1]);
            console.log(`[市场温度] 从toString()解析: ${temperature}`);
          }
        }
        // 方式4: 尝试其他可能的字段名
        else if ('value' in tempData && typeof (tempData as any).value === 'number') {
          temperature = (tempData as any).value;
          console.log(`[市场温度] 从value属性获取: ${temperature}`);
        }
      } else if (typeof tempData === 'number') {
        temperature = tempData;
        console.log(`[市场温度] 直接返回数字: ${temperature}`);
      }
      
      // 如果无法解析，记录详细错误信息
      if (temperature === null) {
        console.error(`[市场温度] 数据结构未知，无法解析。`);
        console.error(`[市场温度] 返回数据类型:`, typeof tempData);
        console.error(`[市场温度] 返回数据:`, JSON.stringify(tempData, null, 2));
        if (tempData && typeof tempData.toString === 'function') {
          console.error(`[市场温度] toString():`, tempData.toString());
        }
        // 尝试列出所有属性
        if (tempData && typeof tempData === 'object') {
          console.error(`[市场温度] 对象属性:`, Object.keys(tempData));
          // 尝试列出所有可枚举和不可枚举的属性
          console.error(`[市场温度] 所有属性:`, Object.getOwnPropertyNames(tempData));
        }
        return null;
      }
      
      // 确保温度值在合理范围内（0-100）
      temperature = Math.max(0, Math.min(100, temperature));
      
      console.log(`[市场温度] 获取成功: ${temperature}`);
      return temperature;
    } catch (error: any) {
      console.error(`[市场温度] 获取失败:`, error.message);
      console.error(`[市场温度] 错误详情:`, error);
      console.error(`[市场温度] 错误堆栈:`, error.stack);
      // 失败时返回null，不使用默认值
      return null;
    }
  }

  /**
   * 获取历史市场温度（用于回测）
   * @param startDate 开始日期
   * @param endDate 结束日期
   */
  async getHistoricalMarketTemperature(startDate: Date, endDate: Date): Promise<number | null> {
    try {
      const quoteCtx = await getQuoteContext();
      const longport = require('longport');
      const { Market, NaiveDate } = longport;
      
      // 使用LongPort SDK获取历史市场温度
      // 注意：NaiveDate的构造方式：new NaiveDate(year, month, day)，month从1开始
      const start = new NaiveDate(startDate.getFullYear(), startDate.getMonth() + 1, startDate.getDate());
      const end = new NaiveDate(endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate());
      
      const historyData = await quoteCtx.historyMarketTemperature(Market.US, start, end);
      
      // 解析历史数据，返回最近一天的温度值
      // 假设返回格式为数组，取最后一个值
      if (Array.isArray(historyData) && historyData.length > 0) {
        const lastItem = historyData[historyData.length - 1];
        let temperature: number;
        
        if (typeof lastItem === 'number') {
          temperature = lastItem;
        } else if (lastItem && typeof lastItem === 'object' && 'value' in lastItem) {
          temperature = (lastItem as any).value;
        } else if (lastItem && typeof lastItem === 'object' && 'temperature' in lastItem) {
          temperature = (lastItem as any).temperature;
        } else {
          temperature = 50; // 默认中性值
        }
        
        temperature = Math.max(0, Math.min(100, temperature));
        return temperature;
      }
      
      // 如果没有历史数据，返回null
      return null;
    } catch (error: any) {
      console.warn(`获取历史市场温度失败:`, error.message);
      return null;
    }
  }

  /**
   * 获取小时K数据（用于BTC和USD指数）
   * 注意：富途API的分时数据获取方式可能需要调整，这里使用日K数据模拟
   * 实际使用时需要根据API文档调整type参数
   */
  async getHourlyCandlesticks(
    stockId: string,
    marketId: string,
    marketCode: string,
    instrumentType: string,
    subInstrumentType: string,
    count: number = 100
  ): Promise<CandlestickData[]> {
    // 注意：富途API可能不支持直接获取小时K
    // 这里先使用日K数据，后续根据实际API调整
    // type=1 可能表示分时数据，但具体格式需要测试
    return this.getCandlesticksIntraday(
      stockId,
      marketId,
      marketCode,
      instrumentType,
      subInstrumentType,
      1, // 分时数据（可能需要调整为实际的小时K类型）
      count
    );
  }

  /**
   * 获取BTC小时K数据
   * 注意：分时数据API通常返回更多数据（如500条），使用更大的默认值
   */
  async getBTCHourlyCandlesticks(count: number = 500): Promise<CandlestickData[]> {
    return this.getHourlyCandlesticks(
      this.config.btc.stockId,
      this.config.btc.marketId,
      this.config.btc.marketCode,
      this.config.btc.instrumentType,
      this.config.btc.subInstrumentType,
      count
    );
  }

  /**
   * 获取USD Index小时K数据
   * 注意：分时数据API通常返回更多数据（如500条），使用更大的默认值
   */
  async getUSDIndexHourlyCandlesticks(count: number = 500): Promise<CandlestickData[]> {
    return this.getHourlyCandlesticks(
      this.config.usdIndex.stockId,
      this.config.usdIndex.marketId,
      this.config.usdIndex.marketCode,
      '10',
      '10001',
      count
    );
  }


  /**
   * 获取历史市场数据（截止到指定日期）
   * @param targetDate 目标日期，获取该日期之前的数据（不包含未来数据）
   * @param count 需要的数据条数（从目标日期往前推）
   * @param includeIntraday 是否包含分时数据
   */
  async getHistoricalMarketData(targetDate: Date, count: number = 100, includeIntraday: boolean = false) {
    try {
      // 计算从目标日期到今天的天数
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const daysFromTargetToToday = Math.ceil((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // 需要获取的数据量：从目标日期到今天的天数 + 一些缓冲（确保能覆盖到目标日期）
      // 最多获取1000条（API的限制）
      const requestCount = Math.min(daysFromTargetToToday + 100, 1000);

      // 关键市场指标：必须全部成功，否则抛出错误
      const criticalPromises = [
        this.getSPXCandlesticks(requestCount).then(data => this.filterDataBeforeDate(data, targetDate, count)),
        this.getUSDIndexCandlesticks(requestCount).then(data => this.filterDataBeforeDate(data, targetDate, count)),
        this.getBTCCandlesticks(requestCount).then(data => this.filterDataBeforeDate(data, targetDate, count)),
      ];

      // VIX恐慌指数（重要但非关键，允许失败）
      // 使用historyCandlesticksByOffset获取历史数据，传入targetDate
      const vixPromise = this.getVIXCandlesticks(requestCount, targetDate)
        .then(data => this.filterDataBeforeDate(data, targetDate, count))
        .catch(err => {
          console.warn(`获取VIX历史数据失败:`, err.message);
          return [];
        });

      // 历史市场温度（重要但非关键，允许失败）
      // 计算历史温度的开始和结束日期
      const tempEndDate = targetDate;
      const tempStartDate = new Date(targetDate);
      tempStartDate.setDate(tempStartDate.getDate() - count * 2); // 2倍缓冲，确保覆盖
      
      const tempPromise = this.getHistoricalMarketTemperature(tempStartDate, tempEndDate)
        .catch(err => {
          console.warn(`获取历史市场温度失败:`, err.message);
          return null;
        });

      // 分时数据：可选，失败时返回空数组
      const optionalPromises: Promise<any[]>[] = [];
      if (includeIntraday) {
        optionalPromises.push(
          this.getUSDIndexHourlyCandlesticks(requestCount).then(data => this.filterDataBeforeDate(data, targetDate, count)).catch(err => {
            console.warn(`获取USD Index分时历史数据失败（非关键）:`, err.message);
            return [];
          }),
          this.getBTCHourlyCandlesticks(requestCount).then(data => this.filterDataBeforeDate(data, targetDate, count)).catch(err => {
            console.warn(`获取BTC分时历史数据失败（非关键）:`, err.message);
            return [];
          })
        );
      }

      // 先获取关键数据，如果失败会抛出错误
      const criticalResults = await Promise.all(criticalPromises.map(p => p.catch(err => {
        console.error(`获取历史市场数据失败:`, err.message);
        throw new Error(`历史市场数据获取失败: ${err.message}`);
      })));

      // 检查关键数据是否充足
      if (!criticalResults[0] || criticalResults[0].length < 50) {
        throw new Error(`SPX历史数据不足（${criticalResults[0]?.length || 0} < 50），无法提供交易建议`);
      }
      if (!criticalResults[1] || criticalResults[1].length < 50) {
        throw new Error(`USD Index历史数据不足（${criticalResults[1]?.length || 0} < 50），无法提供交易建议`);
      }
      if (!criticalResults[2] || criticalResults[2].length < 50) {
        throw new Error(`BTC历史数据不足（${criticalResults[2]?.length || 0} < 50），无法提供交易建议`);
      }

      // 获取可选数据（分时数据）
      const optionalResults = includeIntraday ? await Promise.all(optionalPromises) : [];
      
      // 获取 VIX 和 市场温度
      const vixData = await vixPromise;
      const marketTemp = await tempPromise;

      const result: any = {
        spx: criticalResults[0],
        usdIndex: criticalResults[1],
        btc: criticalResults[2],
        vix: vixData,
        marketTemperature: marketTemp,
      };

      if (includeIntraday) {
        result.usdIndexHourly = optionalResults[0] || [];
        result.btcHourly = optionalResults[1] || [];
      }

      // 输出数据获取结果摘要
      const dataSummary: Record<string, string> = {
        '目标日期': targetDate.toISOString().split('T')[0],
        SPX: `${criticalResults[0].length}条`,
        'USD Index': `${criticalResults[1].length}条`,
        BTC: `${criticalResults[2].length}条`,
      };
      if (includeIntraday) {
        dataSummary['USD Index分时'] = `${optionalResults[0]?.length || 0}条`;
        dataSummary['BTC分时'] = `${optionalResults[1]?.length || 0}条`;
      }
      console.log(`历史市场数据获取完成:`, dataSummary);

      return result;
    } catch (error: any) {
      console.error('批量获取历史市场数据失败:', error.message);
      throw new Error(`历史市场数据获取失败，无法提供交易建议: ${error.message}`);
    }
  }

  /**
   * 过滤数据，只保留指定日期之前的数据（不包含未来数据）
   * @param data K线数据数组
   * @param targetDate 目标日期
   * @param maxCount 最大返回条数（取最近的N条）
   */
  // ✅ 公开方法，供回测服务使用预获取的市场数据
  filterDataBeforeDate(data: CandlestickData[], targetDate: Date, maxCount: number): CandlestickData[] {
    // ✅ 使用目标日期的结束时间（23:59:59），确保包含目标日期当天的数据
    const targetDateEnd = new Date(targetDate);
    targetDateEnd.setHours(23, 59, 59, 999);
    const targetTimestampMs = targetDateEnd.getTime(); // 毫秒级时间戳
    
    // ✅ 调试日志：查看过滤前后的数据量
    console.log(`[历史数据过滤] 目标日期: ${targetDate.toISOString().split('T')[0]}, 目标时间戳(ms): ${targetTimestampMs}, 原始数据量: ${data.length}`);
    
    // 过滤出目标日期及之前的数据
    // 注意：CandlestickData.timestamp 可能是秒级或毫秒级，需要统一处理
    const filtered = data.filter(item => {
      let itemTimestampMs: number;
      if (typeof item.timestamp === 'number') {
        // 判断是秒级还是毫秒级（如果小于1e10则是秒级，否则是毫秒级）
        itemTimestampMs = item.timestamp < 1e10 ? item.timestamp * 1000 : item.timestamp;
      } else {
        itemTimestampMs = new Date(item.timestamp).getTime();
      }
      return itemTimestampMs <= targetTimestampMs;
    });
    
    // ✅ 调试日志：查看过滤后的数据量
    console.log(`[历史数据过滤] 过滤后数据量: ${filtered.length}, 需要返回: ${maxCount}条`);
    
    if (filtered.length === 0 && data.length > 0) {
      // ✅ 调试：如果过滤后没有数据，显示第一条和最后一条数据的时间戳
      const firstItem = data[0];
      const lastItem = data[data.length - 1];
      const firstTimestampMs = typeof firstItem.timestamp === 'number' 
        ? (firstItem.timestamp < 1e10 ? firstItem.timestamp * 1000 : firstItem.timestamp)
        : new Date(firstItem.timestamp).getTime();
      const lastTimestampMs = typeof lastItem.timestamp === 'number'
        ? (lastItem.timestamp < 1e10 ? lastItem.timestamp * 1000 : lastItem.timestamp)
        : new Date(lastItem.timestamp).getTime();
      console.log(`[历史数据过滤] 警告：过滤后无数据！`);
      console.log(`   目标时间戳(ms): ${targetTimestampMs} (${new Date(targetTimestampMs).toISOString()})`);
      console.log(`   第一条数据时间戳(ms): ${firstTimestampMs} (${new Date(firstTimestampMs).toISOString()}), 原始值: ${firstItem.timestamp}`);
      console.log(`   最后一条数据时间戳(ms): ${lastTimestampMs} (${new Date(lastTimestampMs).toISOString()}), 原始值: ${lastItem.timestamp}`);
      console.log(`   比较结果: ${firstTimestampMs <= targetTimestampMs ? '第一条<=目标' : '第一条>目标'}, ${lastTimestampMs <= targetTimestampMs ? '最后一条<=目标' : '最后一条>目标'}`);
    }

    // 按时间戳排序（从旧到新）
    filtered.sort((a, b) => {
      const timestampAMs = typeof a.timestamp === 'number'
        ? (a.timestamp < 1e10 ? a.timestamp * 1000 : a.timestamp)
        : new Date(a.timestamp).getTime();
      const timestampBMs = typeof b.timestamp === 'number'
        ? (b.timestamp < 1e10 ? b.timestamp * 1000 : b.timestamp)
        : new Date(b.timestamp).getTime();
      return timestampAMs - timestampBMs;
    });

    // 返回最近的N条数据
    return filtered.slice(-maxCount);
  }

  /**
   * 批量获取所有市场数据（包含分时数据）
   * 如果关键市场指标（SPX、USD Index、BTC）获取失败，将抛出错误，而不是返回空数组
   */
  async getAllMarketData(count: number = 100, includeIntraday: boolean = false) {
    try {
      // 关键市场指标：必须全部成功，否则抛出错误
      const criticalPromises = [
        this.getSPXCandlesticks(count).catch(err => {
          console.error(`获取SPX数据失败:`, err.message);
          throw new Error(`SPX数据获取失败: ${err.message}`);
        }),
        this.getUSDIndexCandlesticks(count).catch(err => {
          console.error(`获取USD Index日K数据失败:`, err.message);
          throw new Error(`USD Index数据获取失败: ${err.message}`);
        }),
        this.getBTCCandlesticks(count).catch(err => {
          console.error(`获取BTC数据失败:`, err.message);
          throw new Error(`BTC数据获取失败: ${err.message}`);
        }),
      ];

      // VIX 和 市场温度（非关键，允许失败）
      const vixPromise = this.getVIXCandlesticks(count).catch(err => {
        console.warn(`获取VIX数据失败:`, err.message);
        return [];
      });
      
      const marketTempPromise = this.getMarketTemperature().catch(err => {
        console.warn(`获取实时市场温度失败:`, err.message);
        return null;
      });

      // 分时数据：可选，失败时返回空数组
      const optionalPromises: Promise<any[]>[] = [];
      if (includeIntraday) {
        optionalPromises.push(
          this.getUSDIndexHourlyCandlesticks(count).catch(err => {
            console.warn(`获取USD Index分时数据失败（非关键）:`, err.message);
            return [];
          }),
          this.getBTCHourlyCandlesticks(count).catch(err => {
            console.warn(`获取BTC分时数据失败（非关键）:`, err.message);
            return [];
          })
        );
      }

      // 先获取关键数据，如果失败会抛出错误
      const criticalResults = await Promise.all(criticalPromises);

      // 检查关键数据是否充足
      if (!criticalResults[0] || criticalResults[0].length < 50) {
        throw new Error(`SPX数据不足（${criticalResults[0]?.length || 0} < 50），无法提供交易建议`);
      }
      if (!criticalResults[1] || criticalResults[1].length < 50) {
        throw new Error(`USD Index数据不足（${criticalResults[1]?.length || 0} < 50），无法提供交易建议`);
      }
      if (!criticalResults[2] || criticalResults[2].length < 50) {
        throw new Error(`BTC数据不足（${criticalResults[2]?.length || 0} < 50），无法提供交易建议`);
      }

      // 获取可选数据（分时数据）
      const optionalResults = includeIntraday ? await Promise.all(optionalPromises) : [];
      
      const vixData = await vixPromise;
      const marketTemp = await marketTempPromise;

      const result: any = {
        spx: criticalResults[0],
        usdIndex: criticalResults[1],
        btc: criticalResults[2],
        vix: vixData,
        marketTemperature: marketTemp,
      };

      if (includeIntraday) {
        result.usdIndexHourly = optionalResults[0] || [];
        result.btcHourly = optionalResults[1] || [];
      }

      // 输出数据获取结果摘要
      const dataSummary: Record<string, string> = {
        SPX: `${criticalResults[0].length}条`,
        'USD Index': `${criticalResults[1].length}条`,
        BTC: `${criticalResults[2].length}条`,
      };
      
      // 添加VIX和市场温度信息
      if (vixData && vixData.length > 0) {
        const lastVix = vixData[vixData.length - 1];
        const vixValue = typeof lastVix.close === 'number' ? lastVix.close : parseFloat(String(lastVix.close));
        dataSummary['VIX'] = `${vixValue.toFixed(2)} (${vixData.length}条)`;
      } else {
        dataSummary['VIX'] = '未获取';
      }
      
      if (marketTemp !== null && marketTemp !== undefined) {
        const tempValue = typeof marketTemp === 'number' ? marketTemp : (marketTemp?.value || marketTemp?.temperature || 50);
        dataSummary['市场温度'] = `${tempValue.toFixed(1)}`;
      } else {
        dataSummary['市场温度'] = '未获取';
      }
      
      if (includeIntraday) {
        dataSummary['USD Index分时'] = `${optionalResults[0]?.length || 0}条`;
        dataSummary['BTC分时'] = `${optionalResults[1]?.length || 0}条`;
      }
      console.log(`市场数据获取完成:`, dataSummary);

      return result;
    } catch (error: any) {
      console.error('批量获取市场数据失败:', error.message);
      // 关键市场指标获取失败，抛出错误，不返回空数据
      throw new Error(`市场数据获取失败，无法提供交易建议: ${error.message}`);
    }
  }
}

/**
 * 测试BTC请求（单独测试函数）
 * 用于调试BTC API参数问题
 */
export async function testBTCRequest() {
  const service = new MarketDataService();
  
  console.log('\n========== BTC请求测试 ==========');
  console.log('BTC配置:', service['config'].btc);
  
  try {
    const result = await service.getBTCCandlesticks(10);
    console.log('✅ BTC请求成功，返回数据条数:', result.length);
    if (result.length > 0) {
      console.log('第一条数据:', JSON.stringify(result[0], null, 2));
    }
    return result;
  } catch (error: any) {
    console.error('❌ BTC请求失败:', error.message);
    console.error('错误详情:', error);
    throw error;
  }
}

export default new MarketDataService();
