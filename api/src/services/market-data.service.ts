/**
 * 市场数据服务
 * 使用富途API获取SPX、USD Index、BTC的市场数据
 */

import axios from 'axios';
import crypto from 'crypto';
import { getFutunnHeaders } from '../config/futunn';
import { moomooProxy, getProxyMode } from '../utils/moomoo-proxy';

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

      const result: any = {
        spx: criticalResults[0],
        usdIndex: criticalResults[1],
        btc: criticalResults[2],
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
