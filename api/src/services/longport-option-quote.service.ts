/**
 * 长桥期权行情服务
 *
 * 封装 LongPort SDK 的期权行情 API，作为期权价格/IV 的主数据源。
 * 富途 API 降级为备用数据源。
 *
 * 价格获取优先级：
 * 1. 缓存（optionPriceCacheService）
 * 2. LongPort optionQuote() → lastDone + IV
 * 3. LongPort depth() → bid/ask 中间价（当 lastDone=0 时）
 * 4. 富途 getOptionDetail()（备用，需 optionId + underlyingStockId）
 * 5. LongPort quote()（最终备用）
 * 6. 富途 getFutunnOptionQuote()（终极兜底，仅需 symbol 字符串）
 */

import { getQuoteContext } from '../config/longport';
import { logger } from '../utils/logger';
import optionPriceCacheService from './option-price-cache.service';
import { getOptionDetail } from './futunn-option-chain.service';
import { getFutunnOptionQuote } from './futunn-option-quote.service';

export interface OptionQuoteResult {
  price: number;
  iv: number;
  openInterest: number;
  volume: number;
  strikePrice: number;
  underlyingSymbol: string;
  bid: number;
  ask: number;
  source: string;
  contractMultiplier: number;
}

export interface OptionGreeksResult {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface OptionDepthResult {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
}

export interface OptionPriceResult {
  price: number;
  bid: number;
  ask: number;
  iv: number;
  source: string;
}

export interface StrikePriceInfoResult {
  price: number;
  callSymbol: string;
  putSymbol: string;
  standard: boolean;
}

class LongPortOptionQuoteService {
  /**
   * 获取期权到期日列表
   * 调用 LongPort optionChainExpiryDateList API
   * @param symbol - 标的代码，如 "AAPL.US"
   * @returns 到期日字符串数组，格式 "YYYYMMDD"
   */
  async getOptionExpiryDates(symbol: string): Promise<string[]> {
    try {
      const quoteCtx = await getQuoteContext();
      const dates = await quoteCtx.optionChainExpiryDateList(symbol);

      if (!dates || dates.length === 0) {
        return [];
      }

      // NaiveDate → "YYYYMMDD" 字符串
      return dates.map((d: any) => {
        const year = d.year;
        const month = String(d.month).padStart(2, '0');
        const day = String(d.day).padStart(2, '0');
        return `${year}${month}${day}`;
      });
    } catch (error: any) {
      logger.warn(`${symbol} LongPort optionChainExpiryDateList 失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取某到期日的行权价列表（含 call/put symbol）
   * 调用 LongPort optionChainInfoByDate API
   * @param symbol - 标的代码，如 "AAPL.US"
   * @param expiryDate - 到期日，格式 "YYYYMMDD"
   * @returns StrikePriceInfoResult[]
   */
  async getOptionChainByDate(symbol: string, expiryDate: string): Promise<StrikePriceInfoResult[]> {
    try {
      const longport = require('longport');
      const { NaiveDate } = longport;

      const year = parseInt(expiryDate.substring(0, 4), 10);
      const month = parseInt(expiryDate.substring(4, 6), 10);
      const day = parseInt(expiryDate.substring(6, 8), 10);
      const naiveDate = new NaiveDate(year, month, day);

      const quoteCtx = await getQuoteContext();
      const chain = await quoteCtx.optionChainInfoByDate(symbol, naiveDate);

      if (!chain || chain.length === 0) {
        return [];
      }

      return chain.map((item: any) => ({
        price: parseFloat(item.price?.toString() || '0'),
        callSymbol: item.callSymbol || '',
        putSymbol: item.putSymbol || '',
        standard: item.standard ?? true,
      }));
    } catch (error: any) {
      logger.warn(`${symbol} LongPort optionChainInfoByDate(${expiryDate}) 失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取期权行情（含 IV）
   * 调用 LongPort optionQuote API
   */
  async getOptionQuote(symbol: string): Promise<OptionQuoteResult | null> {
    try {
      const quoteCtx = await getQuoteContext();
      const quotes = await quoteCtx.optionQuote([symbol]);

      if (!quotes || quotes.length === 0) {
        return null;
      }

      const q = quotes[0];
      const price = parseFloat(q.lastDone?.toString() || '0');

      // LongPort OptionQuote 所有字段都是顶级属性（不是子对象）
      // SDK 类型定义中没有 bidPrice/askPrice，尝试从 depth 获取
      const rawIV = parseFloat(q.impliedVolatility?.toString() || '0');
      // LongPort 返回小数 (0.35 = 35%)，归一化为百分比制 (35.0) 以匹配 Moomoo 格式
      // 安全阈值：小于 5 判定为小数制（5.0 小数制 = 500% IV，极端罕见）
      const iv = rawIV > 0 && rawIV < 5 ? rawIV * 100 : rawIV;
      const openInterest = typeof q.openInterest === 'number' ? q.openInterest : 0;
      const strikePrice = parseFloat(q.strikePrice?.toString() || '0');
      const underlyingSymbol = q.underlyingSymbol || '';
      const volume = typeof q.volume === 'number' ? q.volume : 0;
      const contractMultiplier = parseFloat(q.contractMultiplier?.toString() || '100') || 100;

      // OptionQuote 类没有 bid/ask，尝试通过 depth 获取盘口
      let bid = 0;
      let ask = 0;
      try {
        const depthData = await this.getOptionDepth(symbol);
        if (depthData) {
          bid = depthData.bestBid;
          ask = depthData.bestAsk;
        }
      } catch {
        // depth 获取失败不影响主流程
      }

      return {
        price,
        iv,
        openInterest,
        volume,
        strikePrice,
        underlyingSymbol,
        bid,
        ask,
        source: 'longport-optionQuote',
        contractMultiplier,
      };
    } catch (error: any) {
      // 权限错误不用 error 级别
      const isPermissionError = error.message && (
        error.message.includes('301604') ||
        error.message.includes('no quote access')
      );
      if (isPermissionError) {
        logger.debug(`${symbol} LongPort optionQuote 权限不足: ${error.message}`);
      } else {
        logger.warn(`${symbol} LongPort optionQuote 失败: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * 获取盘口 bid/ask
   * 调用 LongPort depth API
   */
  async getOptionDepth(symbol: string): Promise<OptionDepthResult | null> {
    try {
      const quoteCtx = await getQuoteContext();
      const depthData = await quoteCtx.depth(symbol);

      if (!depthData) {
        return null;
      }

      // depth 返回结构: { asks: [{price, volume, orderNum}], bids: [{price, volume, orderNum}] }
      const asks = depthData.asks || [];
      const bids = depthData.bids || [];

      const bestAsk = asks.length > 0 ? parseFloat(asks[0].price?.toString() || '0') : 0;
      const bestBid = bids.length > 0 ? parseFloat(bids[0].price?.toString() || '0') : 0;

      if (bestBid <= 0 && bestAsk <= 0) {
        return null;
      }

      const midPrice = (bestBid > 0 && bestAsk > 0)
        ? (bestBid + bestAsk) / 2
        : (bestAsk > 0 ? bestAsk : bestBid);

      return { bestBid, bestAsk, midPrice };
    } catch (error: any) {
      logger.warn(`${symbol} LongPort depth 失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 批量获取期权 Greeks（Delta/Gamma/Theta/Vega/Rho）
   * 调用 LongPort calcIndexes API
   * @param symbols - 期权合约代码数组
   * @returns Map<symbol, OptionGreeksResult>
   */
  async getGreeks(symbols: string[]): Promise<Map<string, OptionGreeksResult>> {
    const result = new Map<string, OptionGreeksResult>();
    if (!symbols || symbols.length === 0) return result;

    try {
      const longport = require('longport');
      const { CalcIndex } = longport;
      const quoteCtx = await getQuoteContext();

      const calcResults = await quoteCtx.calcIndexes(symbols, [
        CalcIndex.Delta,
        CalcIndex.Gamma,
        CalcIndex.Theta,
        CalcIndex.Vega,
        CalcIndex.Rho,
      ]);

      for (const item of calcResults) {
        result.set(item.symbol, {
          delta: parseFloat(item.delta?.toString() || '0'),
          gamma: parseFloat(item.gamma?.toString() || '0'),
          theta: parseFloat(item.theta?.toString() || '0'),
          vega: parseFloat(item.vega?.toString() || '0'),
          rho: parseFloat(item.rho?.toString() || '0'),
        });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`LongPort calcIndexes 失败 (${symbols.length} symbols): ${msg}`);
    }

    return result;
  }

  /**
   * 统一价格获取（含缓存 + fallback 链）
   *
   * 获取链：
   * 1. 缓存
   * 2. LongPort optionQuote() → lastDone
   * 3. LongPort depth() → bid/ask 中间价（当 lastDone=0）
   * 4. 富途 getOptionDetail()（备用）
   * 5. LongPort quote()（最终备用）
   */
  async getOptionPrice(
    symbol: string,
    optionMeta?: {
      optionId?: string;
      underlyingStockId?: string;
      marketType?: number;
    }
  ): Promise<OptionPriceResult | null> {
    // 1. 缓存
    const cached = optionPriceCacheService.get(symbol);
    if (cached) {
      logger.debug(`${symbol} 使用缓存价格: ${cached.price.toFixed(4)} (source: cache-${cached.source})`);
      return {
        price: cached.price,
        bid: cached.bid,
        ask: cached.ask,
        iv: 0, // 缓存不存储 IV
        source: `cache(${cached.source})`,
      };
    }

    // 2. LongPort optionQuote
    let iv = 0;
    const optQuote = await this.getOptionQuote(symbol);
    if (optQuote) {
      iv = optQuote.iv;
      let price = optQuote.price;
      let bid = optQuote.bid;
      let ask = optQuote.ask;
      let source = 'longport-optionQuote';

      // 如果 lastDone 为 0 但有 bid/ask，使用中间价
      if (price <= 0 && bid > 0 && ask > 0) {
        price = (bid + ask) / 2;
        source = 'longport-optionQuote-mid';
      } else if (price <= 0 && ask > 0) {
        price = ask;
        source = 'longport-optionQuote-ask';
      } else if (price <= 0 && bid > 0) {
        price = bid;
        source = 'longport-optionQuote-bid';
      }

      if (price > 0) {
        // 缓存
        optionPriceCacheService.set(symbol, {
          price,
          bid: bid || price,
          ask: ask || price,
          mid: (bid > 0 && ask > 0) ? (bid + ask) / 2 : price,
          timestamp: Date.now(),
          underlyingPrice: 0,
          source: 'longport',
        });
        logger.debug(`${symbol} LongPort optionQuote 价格: ${price.toFixed(4)} IV=${iv.toFixed(2)} (source: ${source})`);
        return { price, bid, ask, iv, source };
      }
    }

    // 3. LongPort depth（当 optionQuote 的 lastDone=0 时）
    const depth = await this.getOptionDepth(symbol);
    if (depth && depth.midPrice > 0) {
      optionPriceCacheService.set(symbol, {
        price: depth.midPrice,
        bid: depth.bestBid,
        ask: depth.bestAsk,
        mid: depth.midPrice,
        timestamp: Date.now(),
        underlyingPrice: 0,
        source: 'longport',
      });
      logger.debug(`${symbol} LongPort depth 中间价: ${depth.midPrice.toFixed(4)}`);
      return {
        price: depth.midPrice,
        bid: depth.bestBid,
        ask: depth.bestAsk,
        iv,
        source: 'longport-depth',
      };
    }

    // 4. 富途 getOptionDetail（备用）
    const optionId = optionMeta?.optionId;
    const underlyingStockId = optionMeta?.underlyingStockId;
    const marketType = optionMeta?.marketType || 2;

    if (optionId && underlyingStockId) {
      try {
        const detail = await getOptionDetail(
          String(optionId),
          String(underlyingStockId),
          marketType
        );

        if (detail) {
          let price = detail.price;
          const bid = detail.priceBid || 0;
          const ask = detail.priceAsk || 0;
          let source = 'futunn-lastPrice';

          if (price <= 0 && bid > 0 && ask > 0) {
            price = (bid + ask) / 2;
            source = 'futunn-mid';
          }
          if (price <= 0 && ask > 0) {
            price = ask;
            source = 'futunn-ask';
          }
          if (price <= 0 && bid > 0) {
            price = bid;
            source = 'futunn-bid';
          }

          const futuIV = detail.option?.impliedVolatility || 0;

          if (price > 0) {
            optionPriceCacheService.set(symbol, {
              price,
              bid: bid || price,
              ask: ask || price,
              mid: (bid > 0 && ask > 0) ? (bid + ask) / 2 : price,
              timestamp: Date.now(),
              underlyingPrice: detail.underlyingStock?.price || detail.underlyingPrice || 0,
              source: 'futunn',
            });
            logger.debug(`${symbol} 富途API获取价格: ${price.toFixed(4)} (source: ${source})`);
            return { price, bid, ask, iv: iv || futuIV, source };
          }
        }
      } catch (error: any) {
        logger.warn(`${symbol} 富途API获取期权价格失败: ${error.message}`);
      }
    }

    // 5. LongPort quote()（最终备用）
    try {
      const quoteCtx = await getQuoteContext();
      const quotes = await quoteCtx.quote([symbol]);

      if (quotes && quotes.length > 0) {
        const q = quotes[0];
        let price = parseFloat(q.lastDone?.toString() || (q as any).last_done?.toString() || '0');
        const bid = parseFloat((q as any).bidPrice?.toString() || '0');
        const ask = parseFloat((q as any).askPrice?.toString() || '0');
        let source = 'longport-quote-lastDone';

        if (price <= 0 && bid > 0 && ask > 0) {
          price = (bid + ask) / 2;
          source = 'longport-quote-mid';
        } else if (price <= 0 && ask > 0) {
          price = ask;
          source = 'longport-quote-ask';
        } else if (price <= 0 && bid > 0) {
          price = bid;
          source = 'longport-quote-bid';
        }

        if (price > 0) {
          optionPriceCacheService.set(symbol, {
            price,
            bid: bid || price,
            ask: ask || price,
            mid: (bid > 0 && ask > 0) ? (bid + ask) / 2 : price,
            timestamp: Date.now(),
            underlyingPrice: 0,
            source: 'longport',
          });
          logger.debug(`${symbol} LongPort quote 价格: ${price.toFixed(4)} (source: ${source})`);
          return { price, bid, ask, iv, source };
        }
      }
    } catch (error: any) {
      logger.warn(`${symbol} LongPort quote 失败: ${error.message}`);
    }

    // 6. 富途 getFutunnOptionQuote()（终极兜底，仅需 symbol 字符串）
    // 当 optionMeta 缺失导致 level 4 跳过，且 LongPort 全部失败时，
    // 使用三步流程（searchStock → getOptionFromChain → getOptionQuote）作为最终手段
    try {
      const futunnQuote = await getFutunnOptionQuote(symbol);
      if (futunnQuote && futunnQuote.last_done > 0) {
        const price = futunnQuote.last_done;
        optionPriceCacheService.set(symbol, {
          price,
          bid: price,
          ask: price,
          mid: price,
          timestamp: Date.now(),
          underlyingPrice: 0,
          source: 'futunn-quote',
        });
        logger.info(`${symbol} 富途三步流程兜底成功: ${price.toFixed(4)} (source: futunn-quote-fallback)`);
        return { price, bid: 0, ask: 0, iv: 0, source: 'futunn-quote-fallback' };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`${symbol} 富途三步流程兜底失败: ${msg}`);
    }

    return null;
  }
}

// 导出单例
const longportOptionQuoteService = new LongPortOptionQuoteService();
export default longportOptionQuoteService;
