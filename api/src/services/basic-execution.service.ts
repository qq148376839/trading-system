/**
 * 基础执行器服务
 * 直接调用 Longbridge SDK 进行实盘交易（模拟盘环境）
 */

import { getTradeContext, getQuoteContext, OrderType, OrderSide, TimeInForceType, Decimal, OutsideRTH } from '../config/longport';
import pool from '../config/database';
import { TradingIntent } from './strategies/strategy-base';
import { detectMarket } from '../utils/order-validation';
import { logger } from '../utils/logger';
import { normalizeSide, normalizeStatus } from '../routes/orders';
import orderPreventionMetrics from './order-prevention-metrics.service';
import todayOrdersCache from './today-orders-cache.service';
import shortValidationService from './short-position-validation.service';
import { longportRateLimiter, retryWithBackoff } from '../utils/longport-rate-limiter';
import optionPriceCacheService from './option-price-cache.service';
import { getOptionDetail } from './futunn-option-chain.service';
import orderSubmissionService from './order-submission.service';

export interface ExecutionResult {
  success: boolean;
  orderId?: string;
  avgPrice?: number;
  filledQuantity?: number;
  fees?: number; // 实际手续费（从订单详情获取）
  error?: string;
  orderStatus?: string; // 订单状态：FilledStatus, NewStatus, RejectedStatus 等
  submitted?: boolean; // 订单是否已成功提交到交易所
}

class BasicExecutionService {
  /**
   * 验证买入价格的合理性
   * @param buyPrice 买入价格
   * @param currentPrice 当前市场价格
   * @param symbol 标的代码
   * @returns 验证结果
   */
  private validateBuyPrice(
    buyPrice: number,
    currentPrice: number | null,
    symbol: string
  ): { valid: boolean; warning?: string; error?: string } {
    // 基础验证：价格必须大于0
    if (buyPrice <= 0) {
      return {
        valid: false,
        error: `买入价格无效: ${buyPrice}`,
      };
    }

    // 如果无法获取当前市场价格，跳过价格偏差验证（记录警告）
    if (currentPrice === null || currentPrice <= 0) {
      logger.warn(`无法获取${symbol}的当前市场价格，跳过价格偏差验证`);
      return { valid: true };
    }

    // 计算价格偏差百分比
    const priceDeviation = Math.abs((buyPrice - currentPrice) / currentPrice) * 100;

    // 偏差超过5%：拒绝订单（买入价格偏差应该更严格）
    if (priceDeviation > 5) {
      return {
        valid: false,
        error: `买入价格偏差过大: ${buyPrice.toFixed(2)} vs 市场价格 ${currentPrice.toFixed(2)} (偏差${priceDeviation.toFixed(2)}%)`,
      };
    }

    // 偏差在1%-5%之间：记录警告，但仍允许提交（限价单允许一定偏差）
    if (priceDeviation > 1) {
      return {
        valid: true,
        warning: `买入价格偏差较大: ${buyPrice.toFixed(2)} vs 市场价格 ${currentPrice.toFixed(2)} (偏差${priceDeviation.toFixed(2)}%)`,
      };
    }

    return { valid: true };
  }

  /**
   * 执行买入意图
   * 
   * 价格使用逻辑：
   * - entryPrice: 买入价格（限价单价格）
   */
  async executeBuyIntent(
    intent: TradingIntent,
    strategyId: number
  ): Promise<ExecutionResult> {
    if (!intent.quantity || !intent.entryPrice) {
      return {
        success: false,
        error: '缺少数量或价格信息',
      };
    }

    // 价格验证：获取当前市场价格并验证合理性
    const currentPrice = await this.getCurrentMarketPrice(intent.symbol, intent.metadata);
    const priceValidation = this.validateBuyPrice(intent.entryPrice, currentPrice, intent.symbol);
    
    if (!priceValidation.valid) {
      logger.error(`策略 ${strategyId} 标的 ${intent.symbol}: 价格验证失败 - ${priceValidation.error}`);
      // 如果价格验证失败，更新信号状态为REJECTED
      const signalId = (intent.metadata as any)?.signalId;
      if (signalId) {
        await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
      }
      return {
        success: false,
        error: priceValidation.error || '价格验证失败',
      };
    }

    // 如果有警告，记录日志
    if (priceValidation.warning) {
      logger.warn(`策略 ${strategyId} 标的 ${intent.symbol}: ${priceValidation.warning}`);
    }

    // 记录价格信息，便于调试和问题追踪
    logger.log(`策略 ${strategyId} 执行买入意图: ` +
      `标的=${intent.symbol}, ` +
      `数量=${intent.quantity}, ` +
      `买入价(entryPrice)=${intent.entryPrice.toFixed(2)}, ` +
      `市场价格=${currentPrice?.toFixed(2) || 'N/A'}, ` +
      `原因=${intent.reason}`);

    // 从intent.metadata中获取signal_id
    const signalId = (intent.metadata as any)?.signalId;

    try {
      return await this.submitOrder(
        intent.symbol,
        'BUY',
        intent.quantity,
        intent.entryPrice, // ✅ 买入时entryPrice就是买入价格
        strategyId,
        signalId,  // 新增参数：信号ID
        intent.metadata  // 传递metadata（虽然BUY订单不需要强制平仓，但保持接口一致）
      );
    } catch (error: any) {
      logger.error(`执行买入失败 (${intent.symbol}):`, error);
      // 如果订单提交失败，更新信号状态为REJECTED
      if (signalId) {
        await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
      }
      return {
        success: false,
        error: error.message || '未知错误',
      };
    }
  }

  /**
   * 验证卖出价格的合理性
   * @param sellPrice 卖出价格
   * @param currentPrice 当前市场价格
   * @param symbol 标的代码
   * @returns 验证结果
   */
  private validateSellPrice(
    sellPrice: number,
    currentPrice: number | null,
    symbol: string
  ): { valid: boolean; warning?: string; error?: string } {
    // 基础验证：价格必须大于0
    if (sellPrice <= 0) {
      return {
        valid: false,
        error: `卖出价格无效: ${sellPrice}`,
      };
    }

    // 如果无法获取当前市场价格，跳过价格偏差验证（记录警告）
    if (currentPrice === null || currentPrice <= 0) {
      logger.warn(`无法获取${symbol}的当前市场价格，跳过价格偏差验证`);
      return { valid: true };
    }

    // 计算价格偏差百分比
    const priceDeviation = Math.abs((sellPrice - currentPrice) / currentPrice) * 100;

    // 偏差超过20%：拒绝订单
    if (priceDeviation > 20) {
      return {
        valid: false,
        error: `卖出价格偏差过大: ${sellPrice.toFixed(2)} vs 市场价格 ${currentPrice.toFixed(2)} (偏差${priceDeviation.toFixed(2)}%)`,
      };
    }

    // 偏差在5%-20%之间：记录警告，但仍允许提交
    if (priceDeviation > 5) {
      return {
        valid: true,
        warning: `卖出价格偏差较大: ${sellPrice.toFixed(2)} vs 市场价格 ${currentPrice.toFixed(2)} (偏差${priceDeviation.toFixed(2)}%)`,
      };
    }

    return { valid: true };
  }

  /**
   * 获取当前市场价格（用于价格验证）
   * 增强版：
   * - 期权使用富途API的getOptionDetail()（需要optionId和underlyingStockId）
   * - 股票使用LongPort API的quote()
   * - 支持价格缓存和多种价格字段回退
   */
  private async getCurrentMarketPrice(
    symbol: string,
    metadata?: any
  ): Promise<number | null> {
    try {
      // 检查是否为期权（包含6位数字+C/P+数字的模式）
      const isOption = /[A-Z]{1,5}\d{6}[CP]\d+/.test(symbol);

      // 如果是期权，先检查缓存
      if (isOption) {
        const cached = optionPriceCacheService.get(symbol);
        if (cached) {
          logger.debug(`${symbol} 使用缓存价格: ${cached.price.toFixed(4)}`);
          return cached.price;
        }

        // 期权：使用富途API获取详情
        if (metadata && metadata.optionId && metadata.underlyingStockId) {
          try {
            logger.debug(`${symbol} 使用富途API获取期权价格: optionId=${metadata.optionId}, underlyingStockId=${metadata.underlyingStockId}`);

            const detail = await getOptionDetail(
              String(metadata.optionId),
              String(metadata.underlyingStockId),
              metadata.marketType || 2
            );

            if (detail) {
              let price = detail.price;
              const bid = detail.priceBid || 0;
              const ask = detail.priceAsk || 0;
              let priceSource = 'futunn-lastPrice';

              // 如果最新价格无效，使用中间价
              if (price <= 0 && bid > 0 && ask > 0) {
                price = (bid + ask) / 2;
                priceSource = 'futunn-mid';
                logger.debug(`${symbol} 使用富途中间价: bid=${bid.toFixed(4)}, ask=${ask.toFixed(4)}, mid=${price.toFixed(4)}`);
              }

              // 如果仍然无效，使用ask
              if (price <= 0 && ask > 0) {
                price = ask;
                priceSource = 'futunn-ask';
                logger.debug(`${symbol} 使用富途卖一价: ${price.toFixed(4)}`);
              }

              // 最后尝试bid
              if (price <= 0 && bid > 0) {
                price = bid;
                priceSource = 'futunn-bid';
                logger.debug(`${symbol} 使用富途买一价: ${price.toFixed(4)}`);
              }

              if (price > 0) {
                // 缓存价格
                optionPriceCacheService.set(symbol, {
                  price,
                  bid: bid || price,
                  ask: ask || price,
                  mid: (bid > 0 && ask > 0) ? (bid + ask) / 2 : price,
                  timestamp: Date.now(),
                  underlyingPrice: detail.underlyingStock?.price || detail.underlyingPrice || 0,
                  source: 'futunn',
                });
                logger.debug(`${symbol} 富途API获取价格成功: ${price.toFixed(4)} (source: ${priceSource})`);
                return price;
              }
            }
          } catch (error: any) {
            logger.warn(`${symbol} 富途API获取期权价格失败:`, error.message);
          }
        } else {
          logger.warn(`${symbol} 是期权但缺少optionId或underlyingStockId，无法使用富途API`);
        }

        // 回退：尝试使用LongPort API（可能失败）
        logger.debug(`${symbol} 回退到LongPort API获取期权价格`);
      }

      // 股票或期权回退：使用LongPort API
      const { getQuoteContext } = await import('../config/longport');
      const quoteCtx = await getQuoteContext();
      const quotes = await quoteCtx.quote([symbol]);

      if (quotes && quotes.length > 0) {
        const quote = quotes[0];

        // 尝试多种价格字段，优先级：lastDone > last_done > 中间价 > 卖一价 > 买一价
        let price = 0;
        let bid = 0;
        let ask = 0;
        let priceSource = '';

        // 解析bid和ask价格
        if (quote.bidPrice) {
          bid = parseFloat((quote.bidPrice as any)?.toString() || '0');
        }
        if (quote.askPrice) {
          ask = parseFloat((quote.askPrice as any)?.toString() || '0');
        }

        // 1. 最近成交价（最优先）
        if (quote.lastDone) {
          price = parseFloat(quote.lastDone.toString());
          priceSource = 'lastDone';
        } else if (quote.last_done) {
          price = parseFloat(quote.last_done.toString());
          priceSource = 'last_done';
        }

        // 2. 如果没有最近成交价，使用中间价（bid-ask中点）
        if (price <= 0 && ask > 0 && bid > 0) {
          price = (ask + bid) / 2;
          priceSource = 'mid';
          logger.debug(`${symbol} 使用中间价: bid=${bid.toFixed(4)}, ask=${ask.toFixed(4)}, mid=${price.toFixed(4)}`);
        }

        // 3. 如果没有中间价，使用卖一价（ask）
        if (price <= 0 && ask > 0) {
          price = ask;
          priceSource = 'ask';
          logger.debug(`${symbol} 使用卖一价: ${price.toFixed(4)}`);
        }

        // 4. 最后尝试买一价（bid）
        if (price <= 0 && bid > 0) {
          price = bid;
          priceSource = 'bid';
          logger.debug(`${symbol} 使用买一价: ${price.toFixed(4)}`);
        }

        if (price > 0) {
          // 如果是期权，缓存价格信息
          if (isOption) {
            optionPriceCacheService.set(symbol, {
              price,
              bid: bid || price,
              ask: ask || price,
              mid: (bid > 0 && ask > 0) ? (bid + ask) / 2 : price,
              timestamp: Date.now(),
              underlyingPrice: 0,
              source: 'longport',
            });
            logger.debug(`${symbol} LongPort获取价格成功并缓存: ${price.toFixed(4)} (source: ${priceSource})`);
          }
          return price;
        } else {
          logger.warn(`${symbol} 所有价格字段均无效`, {
            hasLastDone: !!quote.lastDone,
            hasLast_done: !!quote.last_done,
            bid,
            ask
          });
        }
      } else {
        logger.warn(`${symbol} 未返回报价数据`);
      }
      return null;
    } catch (error: any) {
      logger.warn(`获取${symbol}当前市场价格失败:`, error.message);
      return null;
    }
  }

  /**
   * 计算可用持仓（扣除未成交卖出订单占用）
   * @param symbol 标的代码
   * @returns 可用持仓信息
   */
  async calculateAvailablePosition(symbol: string): Promise<{
    actualQuantity: number;
    pendingQuantity: number;
    availableQuantity: number;
    positionType?: 'LONG' | 'SHORT' | 'NONE';
  }> {
    try {
      // 1. 获取实际持仓
      const tradeCtx = await getTradeContext();
      const positions = await tradeCtx.stockPositions();
      
      // 处理不同的数据结构：可能是 positions.positions 或 positions.channels[].positions
      let positionsArray: any[] = [];
      
      if (positions) {
        if (positions.positions && Array.isArray(positions.positions)) {
          positionsArray = positions.positions;
        } else if (positions.channels && Array.isArray(positions.channels)) {
          for (const channel of positions.channels) {
            if (channel.positions && Array.isArray(channel.positions)) {
              positionsArray.push(...channel.positions);
            }
          }
        }
      }
      
      // 查找该标的的实际持仓
      const position = positionsArray.find((p: any) => p.symbol === symbol);
      const actualQuantity = position ? parseFloat(position.quantity?.toString() || '0') : 0;
      
      // ⚠️ 修复：判断持仓类型
      let positionType: 'LONG' | 'SHORT' | 'NONE';
      if (actualQuantity > 0) {
        positionType = 'LONG';
      } else if (actualQuantity < 0) {
        positionType = 'SHORT';
      } else {
        positionType = 'NONE';
      }
      
      // 2. 查询未成交订单（使用统一缓存服务）
      const todayOrders = await todayOrdersCache.getTodayOrders();
      const pendingStatuses = [
        'NotReported',
        'NewStatus',
        'WaitToNew',
        'PartialFilledStatus',
        'PendingReplaceStatus',
        'WaitToReplace',
        'ReplacedNotReported',
        'ProtectedNotReported',
        'VarietiesNotReported',
      ];
      
      let pendingSellQuantity = 0;  // 未成交卖出订单（平仓或卖空）
      let pendingBuyQuantity = 0;   // 未成交买入订单（开仓或平仓）
      
      for (const order of todayOrders) {
        const orderSymbol = order.symbol || order.stock_name;
        const orderSide = order.side;
        const isSell = orderSide === 'Sell' || orderSide === 2 || orderSide === 'SELL' || orderSide === 'sell';
        const isBuy = orderSide === 'Buy' || orderSide === 1 || orderSide === 'BUY' || orderSide === 'buy';
        
        if (orderSymbol === symbol) {
          // 使用 normalizeStatus 标准化订单状态
          const normalizedStatus = normalizeStatus(order.status);
          
          if (pendingStatuses.includes(normalizedStatus)) {
            // 计算未成交数量：总数量 - 已成交数量
            const totalQuantity = parseFloat(order.quantity?.toString() || order.submitted_quantity?.toString() || '0');
            const executedQuantity = parseFloat(order.executedQuantity?.toString() || order.executed_quantity?.toString() || '0');
            const pending = Math.max(0, Math.abs(totalQuantity) - Math.abs(executedQuantity));
            
            if (isSell) {
              pendingSellQuantity += pending;
            } else if (isBuy) {
              pendingBuyQuantity += pending;
            }
          }
        }
      }
      
      // ⚠️ 修复：计算可用持仓（区分做多和卖空）
      let availableQuantity: number;
      let pendingQuantity: number;
      
      if (positionType === 'LONG') {
        // 做多持仓：可用 = 实际持仓 - 未成交卖出订单（平仓）
        pendingQuantity = pendingSellQuantity;
        availableQuantity = Math.max(0, actualQuantity - pendingSellQuantity);
      } else if (positionType === 'SHORT') {
        // 卖空持仓：可用 = |实际持仓| - 未成交买入订单（平仓）
        pendingQuantity = pendingBuyQuantity;
        const absActualQuantity = Math.abs(actualQuantity);
        availableQuantity = Math.max(0, absActualQuantity - pendingBuyQuantity);
      } else {
        // 无持仓：可用 = 0
        pendingQuantity = 0;
        availableQuantity = 0;
      }
      
      logger.log(`计算可用持仓: ${symbol}, 实际持仓=${actualQuantity}, 持仓类型=${positionType}, 未成交卖出=${pendingSellQuantity}, 未成交买入=${pendingBuyQuantity}, 可用持仓=${availableQuantity}`);
      
      return {
        actualQuantity,
        pendingQuantity,
        availableQuantity,
        positionType
      };
    } catch (error: any) {
      logger.error(`计算可用持仓失败 (${symbol}):`, error);
      // ⚠️ 修复：查询失败时返回0，但不阻止卖空（由其他验证逻辑处理）
      return {
        actualQuantity: 0,
        pendingQuantity: 0,
        availableQuantity: 0,
        positionType: 'NONE'
      };
    }
  }

  /**
   * 验证卖出订单持仓
   * ⚠️ 修复：支持卖空和平仓两种场景
   * @param symbol 标的代码
   * @param quantity 卖出数量（正数=平仓，负数=卖空）
   * @param strategyId 策略ID
   * @returns 验证结果
   */
  async validateSellPosition(
    symbol: string,
    quantity: number,
    strategyId: number
  ): Promise<{
    valid: boolean;
    availableQuantity: number;
    actualQuantity: number;
    pendingQuantity: number;
    reason?: string;
  }> {
    try {
      // 计算可用持仓
      const positionInfo = await this.calculateAvailablePosition(symbol);
      
      // ⚠️ 修复：区分卖空和平仓
      const isShortOrder = quantity < 0;
      const absQuantity = Math.abs(quantity);
      
      if (isShortOrder) {
        // 卖空订单（负数）：不需要持仓验证（开仓操作）
        // ⚠️ 完善错误处理：卖空权限和保证金验证在 strategy-scheduler 中已完成
        // 这里只做基础的数量验证
        const quantityCheck = shortValidationService.validateQuantity(absQuantity, 'SELL', 0);
        
        if (!quantityCheck.valid) {
          orderPreventionMetrics.recordPositionValidation(false);
          orderPreventionMetrics.recordOrderRejected('position');
          
          return {
            valid: false,
            availableQuantity: 0,
            actualQuantity: positionInfo.actualQuantity,
            pendingQuantity: positionInfo.pendingQuantity,
            reason: quantityCheck.error || 'Quantity validation failed',
          };
        }
        
        logger.log(`[持仓验证] 卖空订单: ${symbol}, 数量=${quantity}（负数），数量验证通过`);
        
        // 记录监控指标
        orderPreventionMetrics.recordPositionValidation(true);
        
        return {
          valid: true,
          availableQuantity: 0,  // 卖空订单不占用持仓
          actualQuantity: positionInfo.actualQuantity,
          pendingQuantity: positionInfo.pendingQuantity
        };
      } else if (positionInfo.positionType === 'SHORT') {
        // 有卖空持仓，买入平仓
        // 验证：买入数量不能超过卖空数量
        const shortQuantity = Math.abs(positionInfo.actualQuantity);
        
        if (quantity > shortQuantity) {
          // 记录监控指标
          orderPreventionMetrics.recordPositionValidation(false);
          orderPreventionMetrics.recordOrderRejected('position');
          
          return {
            valid: false,
            availableQuantity: shortQuantity,
            actualQuantity: positionInfo.actualQuantity,
            pendingQuantity: positionInfo.pendingQuantity,
            reason: `平仓数量(${quantity})不能超过卖空数量(${shortQuantity})`
          };
        }
        
        // 记录监控指标
        orderPreventionMetrics.recordPositionValidation(true);
        
        return {
          valid: true,
          availableQuantity: shortQuantity - positionInfo.pendingQuantity,  // 可用平仓数量
          actualQuantity: positionInfo.actualQuantity,
          pendingQuantity: positionInfo.pendingQuantity
        };
      } else {
        // 做多持仓，卖出平仓
        // 验证卖出数量
        if (quantity > positionInfo.availableQuantity) {
          // 记录监控指标
          orderPreventionMetrics.recordPositionValidation(false);
          orderPreventionMetrics.recordOrderRejected('position');
          
          return {
            valid: false,
            availableQuantity: positionInfo.availableQuantity,
            actualQuantity: positionInfo.actualQuantity,
            pendingQuantity: positionInfo.pendingQuantity,
            reason: `可用持仓不足：实际持仓=${positionInfo.actualQuantity}，未成交订单占用=${positionInfo.pendingQuantity}，可用持仓=${positionInfo.availableQuantity}，请求卖出=${quantity}`
          };
        }
        
        // 记录监控指标
        orderPreventionMetrics.recordPositionValidation(true);
        
        return {
          valid: true,
          availableQuantity: positionInfo.availableQuantity,
          actualQuantity: positionInfo.actualQuantity,
          pendingQuantity: positionInfo.pendingQuantity
        };
      }
    } catch (error: any) {
      logger.error(`验证卖出订单持仓失败 (${symbol}):`, error);
      // 保守处理，验证失败时拒绝卖出
      return {
        valid: false,
        availableQuantity: 0,
        actualQuantity: 0,
        pendingQuantity: 0,
        reason: `持仓验证失败，为安全起见拒绝卖出: ${error.message}`
      };
    }
  }

  /**
   * 执行卖出意图
   * 
   * 价格使用逻辑：
   * - 平仓场景：优先使用sellPrice（当前市场价格），entryPrice用于记录买入价格
   * - 做空场景：使用entryPrice（做空价格），sellPrice不使用
   */
  async executeSellIntent(
    intent: TradingIntent,
    strategyId: number
  ): Promise<ExecutionResult> {
    // 验证必要参数
    if (!intent.quantity) {
      return {
        success: false,
        error: '缺少数量信息',
      };
    }

    // ⚠️ 修复：支持负数数量（卖空订单）
    const isShortOrder = intent.quantity < 0;
    const absQuantity = Math.abs(intent.quantity);

    // 确定卖出价格
    // 优先级：sellPrice > entryPrice
    // sellPrice: 用于平仓场景（推荐）
    // entryPrice: 用于做空场景（fallback）
    const sellPrice = intent.sellPrice || intent.entryPrice;
    
    if (!sellPrice || sellPrice <= 0) {
      return {
        success: false,
        error: `缺少有效的卖出价格信息 (sellPrice=${intent.sellPrice}, entryPrice=${intent.entryPrice})`,
      };
    }

    // 价格验证：获取当前市场价格并验证合理性
    const currentPrice = await this.getCurrentMarketPrice(intent.symbol, intent.metadata);
    const priceValidation = this.validateSellPrice(sellPrice, currentPrice, intent.symbol);
    
    if (!priceValidation.valid) {
      logger.error(`策略 ${strategyId} 标的 ${intent.symbol}: 价格验证失败 - ${priceValidation.error}`);
      return {
        success: false,
        error: priceValidation.error || '价格验证失败',
      };
    }

    // 如果有警告，记录日志
    if (priceValidation.warning) {
      logger.warn(`策略 ${strategyId} 标的 ${intent.symbol}: ${priceValidation.warning}`);
    }

    // ⚠️ 修复：持仓验证（区分做空和平仓）
    if (isShortOrder) {
      // 卖空订单：不需要持仓验证（开仓操作）
      // TODO: 添加保证金验证
      logger.log(`策略 ${strategyId} 执行做空意图: ` +
        `标的=${intent.symbol}, ` +
        `数量=${intent.quantity}（负数）, ` +
        `做空价=${sellPrice.toFixed(2)}, ` +
        `市场价格=${currentPrice?.toFixed(2) || 'N/A'}, ` +
        `原因=${intent.reason}`);
    } else {
      // 平仓订单：需要持仓验证
      const positionValidation = await this.validateSellPosition(
        intent.symbol,
        intent.quantity,
        strategyId
      );
      
      if (!positionValidation.valid) {
        logger.error(`策略 ${strategyId} 标的 ${intent.symbol}: 持仓验证失败 - ${positionValidation.reason}`);
        // 如果订单提交失败，更新信号状态为REJECTED
        const signalId = (intent.metadata as any)?.signalId;
        if (signalId) {
          await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
        }
        return {
          success: false,
          error: positionValidation.reason || '持仓验证失败',
        };
      }

      // 记录价格信息，便于调试和问题追踪
      logger.log(`策略 ${strategyId} 执行卖出意图: ` +
        `标的=${intent.symbol}, ` +
        `数量=${intent.quantity}, ` +
        `卖出价=${sellPrice.toFixed(2)}, ` +
        `买入价(entryPrice)=${intent.entryPrice?.toFixed(2) || 'N/A'}, ` +
        `市场价格=${currentPrice?.toFixed(2) || 'N/A'}, ` +
        `可用持仓=${positionValidation.availableQuantity}, ` +
        `原因=${intent.reason}`);
    }

    // 从intent.metadata中获取signal_id
    const signalId = (intent.metadata as any)?.signalId;

    try {
      // ⚠️ 修复：提交订单时使用原始数量（可能是负数）
      return await this.submitOrder(
        intent.symbol,
        'SELL',
        intent.quantity,  // 保持原始数量（负数表示卖空）
        sellPrice,
        strategyId,
        signalId,
        intent.metadata  // 传递metadata用于期权强制平仓判断
      );
    } catch (error: any) {
      logger.error(`执行卖出失败 (${intent.symbol}):`, error);
      // 如果订单提交失败，更新信号状态为REJECTED
      if (signalId) {
        await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
      }
      return {
        success: false,
        error: error.message || '未知错误',
      };
    }
  }

  /**
   * 提交订单（重构版本 - 使用统一订单提交服务）
   *
   * 架构改进：
   * - 使用 order-submission.service.ts 统一处理订单提交
   * - 确保量化下单和手动下单使用相同的逻辑
   * - 支持期权和股票订单
   */
  private async submitOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
    strategyId: number,
    signalId?: number,
    metadata?: any
  ): Promise<ExecutionResult> {
    try {
      // ⚠️ 修复：支持负数数量（卖空订单）
      const isShortOrder = quantity < 0;
      let normalizedQuantity = quantity;
      let absQuantity = Math.abs(normalizedQuantity);

      // 格式化价格（根据市场确定小数位数）
      const market = detectMarket(symbol);
      let formattedPrice: number;

      if (market === 'US') {
        // 美股：保留2位小数
        formattedPrice = Math.round(price * 100) / 100;
      } else if (market === 'HK') {
        // 港股：保留3位小数
        formattedPrice = Math.round(price * 1000) / 1000;
      } else {
        // 其他市场：保留2位小数
        formattedPrice = Math.round(price * 100) / 100;
      }

      // 确保价格大于0
      if (formattedPrice <= 0) {
        return {
          success: false,
          error: `价格无效: ${price} -> ${formattedPrice}`,
        };
      }

      logger.log(`策略 ${strategyId} 提交订单:`, {
        symbol,
        side,
        quantity: normalizedQuantity,
        isShortOrder: isShortOrder,
        originalPrice: price,
        formattedPrice: formattedPrice,
        market,
      });

      // ✅ 核心改进：使用统一订单提交服务
      // 确保量化下单和手动下单使用相同的逻辑（支持期权）

      // 判断是否为期权快速平仓（止盈止损、强制平仓等）
      // 使用市价单确保快速成交，避免限价单无法成交导致亏损扩大
      const isOptionForceClose =
        metadata?.assetClass === 'OPTION' &&
        metadata?.forceClose === true;

      // 方案一：市价单 + 限价单Fallback（渐进式策略）
      let submitResult: any;

      if (isOptionForceClose) {
        // 步骤1：先尝试市价单（对流动性好的期权能获得更好的价格）
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 期权快速平仓，先尝试市价单（Market Order）`);

        const marketOrderParams: any = {
          symbol,
          side: side === 'BUY' ? 'Buy' : 'Sell',
          order_type: 'MO',
          submitted_quantity: absQuantity.toString(),
          time_in_force: 'Day',
          outside_rth: market === 'US' ? 'ANY_TIME' : 'RTH_ONLY',
          remark: `策略${strategyId}自动下单（期权强制平仓-市价单）`,
        };

        submitResult = await orderSubmissionService.submitOrder(marketOrderParams);

        // 步骤2：如果市价单被拒绝（流动性不足），fallback到极低价限价单
        if (!submitResult.success) {
          const errorMsg = submitResult.error?.message || '';
          const isLiquidityError =
            errorMsg.includes('603059') ||
            errorMsg.includes('liquidity') ||
            errorMsg.includes('counterpart');

          if (isLiquidityError) {
            logger.warn(
              `策略 ${strategyId} 标的 ${symbol}: 市价单被拒绝（流动性不足），fallback到极低价限价单`
            );

            // 使用极低价格的限价单，确保快速成交
            // 对于深度虚值期权：使用$0.01
            // 对于其他期权：使用当前价的10%，最低$0.01
            const fallbackPrice =
              formattedPrice < 0.1 ? 0.01 : Math.max(0.01, formattedPrice * 0.1);

            logger.log(
              `策略 ${strategyId} 标的 ${symbol}: 使用极低价限价单 $${fallbackPrice.toFixed(2)}（原价 $${formattedPrice.toFixed(2)}）`
            );

            const limitOrderParams: any = {
              symbol,
              side: side === 'BUY' ? 'Buy' : 'Sell',
              order_type: 'LO',
              submitted_quantity: absQuantity.toString(),
              submitted_price: fallbackPrice.toFixed(2),
              time_in_force: 'Day',
              outside_rth: market === 'US' ? 'ANY_TIME' : 'RTH_ONLY',
              remark: `策略${strategyId}自动下单（期权强制平仓-限价单fallback）`,
            };

            submitResult = await orderSubmissionService.submitOrder(limitOrderParams);
          }
        }
      } else {
        // 普通订单：使用限价单
        const orderParams: any = {
          symbol,
          side: side === 'BUY' ? 'Buy' : 'Sell',
          order_type: 'LO',
          submitted_quantity: absQuantity.toString(),
          submitted_price: formattedPrice.toString(),
          time_in_force: 'Day',
          outside_rth: market === 'US' ? 'ANY_TIME' : 'RTH_ONLY',
          remark: `策略${strategyId}自动下单`,
        };

        submitResult = await orderSubmissionService.submitOrder(orderParams);
      }

      if (!submitResult.success || !submitResult.orderId) {
        // 如果订单提交失败，更新信号状态为REJECTED
        if (signalId) {
          await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
        }
        return {
          success: false,
          error: submitResult.error?.message || '订单提交失败',
        };
      }

      const orderId = submitResult.orderId;
      logger.log(`策略 ${strategyId} 订单提交成功，订单ID: ${orderId}`);

      // 5. 记录订单到数据库
      try {
        // 数据库里保留原始语义数量（卖空为负数），用于后续状态/风控逻辑
        await this.recordOrder(strategyId, symbol, side, normalizedQuantity, price, orderId, signalId);
      } catch (dbError: any) {
        logger.error(`记录订单到数据库失败 (${orderId}):`, dbError.message);
        // 不阻止后续流程，因为订单已经提交成功
      }

      // 6. 如果订单提交成功，更新信号状态为EXECUTED
      if (signalId) {
        try {
          await this.updateSignalStatusBySignalId(signalId, 'EXECUTED');
        } catch (signalError: any) {
          logger.warn(`更新信号状态失败 (signalId: ${signalId}, orderId: ${orderId}):`, signalError.message);
          // 不阻止后续流程
        }
      }

      // 7. 等待订单成交（异步，不阻塞）
      // 注意：这里不等待订单成交，因为订单可能不会立即成交
      // 后续通过定时任务同步订单状态
      const orderDetail = await this.waitForOrderFill(orderId, 10000); // 10秒超时

      // 8. 如果订单已成交，确认信号状态为EXECUTED
      const normalizedStatus = this.normalizeStatus(orderDetail.status);
      if (normalizedStatus === 'FilledStatus' || normalizedStatus === 'PartialFilledStatus') {
        if (signalId) {
          try {
            await this.updateSignalStatusBySignalId(signalId, 'EXECUTED');
          } catch (signalError: any) {
            logger.warn(`确认信号状态失败 (signalId: ${signalId}, orderId: ${orderId}):`, signalError.message);
          }
        }
      } else if (normalizedStatus === 'RejectedStatus') {
        // 如果订单被拒绝，更新信号状态为REJECTED
        if (signalId) {
          try {
            await this.updateSignalStatusBySignalId(signalId, 'REJECTED');
          } catch (signalError: any) {
            logger.warn(`更新信号状态为REJECTED失败 (signalId: ${signalId}, orderId: ${orderId}):`, signalError.message);
          }
        }
      } else if (normalizedStatus === 'CanceledStatus' || normalizedStatus === 'PendingCancelStatus') {
        // 如果订单被取消，更新信号状态为IGNORED
        if (signalId) {
          try {
            await this.updateSignalStatusBySignalId(signalId, 'IGNORED');
          } catch (signalError: any) {
            logger.warn(`更新信号状态为IGNORED失败 (signalId: ${signalId}, orderId: ${orderId}):`, signalError.message);
          }
        }
      }

      // 9. 获取实际手续费
      const fees = await this.getOrderFees(orderId);

      // 10. 记录交易到数据库（如果已成交）
      if (normalizedStatus === 'FilledStatus' || normalizedStatus === 'PartialFilledStatus') {
        try {
          await this.recordTrade(strategyId, symbol, side, orderDetail, fees);
        } catch (tradeError: any) {
          logger.error(`记录交易到数据库失败 (${orderId}):`, tradeError.message);
        }
      }

      // 判断订单是否已成交
      const isFilled = normalizedStatus === 'FilledStatus';
      const isRejected = normalizedStatus === 'RejectedStatus' || normalizedStatus === 'CanceledStatus';
      
      return {
        success: isFilled,
        orderId,
        avgPrice: parseFloat(orderDetail.executedPrice?.toString() || orderDetail.executed_price?.toString() || '0'),
        filledQuantity: parseInt(orderDetail.executedQuantity?.toString() || orderDetail.executed_quantity?.toString() || '0'),
        fees,
        orderStatus: normalizedStatus,
        submitted: true, // 订单已成功提交到交易所
        // 如果订单被拒绝或取消，设置错误信息
        error: isRejected ? `订单状态: ${normalizedStatus}` : undefined,
      };
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 提交订单失败 (${symbol}):`, error);
      
      // 提取错误信息
      let errorMessage = '未知错误';
      if (error.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error.toString) {
        errorMessage = error.toString();
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 获取订单实际手续费
   */
  private async getOrderFees(orderId: string): Promise<number> {
    try {
      const tradeCtx = await getTradeContext();
      const orderDetail = await tradeCtx.orderDetail(orderId);

      // 从 charge_detail 中提取总手续费
      const chargeDetail = (orderDetail as any).chargeDetail || (orderDetail as any).charge_detail;
      if (chargeDetail && chargeDetail.total_amount) {
        return parseFloat(chargeDetail.total_amount.toString());
      }

      // 如果没有 charge_detail，返回 0（后续会通过估算补充）
      return 0;
    } catch (error: any) {
      logger.error(`获取订单手续费失败 (${orderId}):`, error);
      return 0;
    }
  }

  /**
   * 等待订单成交
   * 使用 todayOrders() 批量查询，避免频率限制
   */
  private async waitForOrderFill(
    orderId: string,
    timeout: number = 10000 // 10秒超时（减少等待时间，避免阻塞）
  ): Promise<any> {
    try {
      const tradeCtx = await getTradeContext();
      const startTime = Date.now();
      let lastError: any = null;

      while (Date.now() - startTime < timeout) {
        try {
          // 使用批量查询 todayOrders() 替代单个订单查询，避免频率限制
          const todayOrders = await tradeCtx.todayOrders({});
          
          // 从批量结果中查找目标订单
          const order = this.findOrderInList(todayOrders, orderId);
          
          if (order) {
            const status = this.normalizeStatus(order.status);

            if (status === 'FilledStatus' || status === 'PartialFilledStatus') {
              return order;
            }

            if (status === 'CanceledStatus' || status === 'RejectedStatus') {
              // 订单已取消或拒绝，返回订单详情而不是抛出错误
              return order;
            }
          } else {
            // 订单不在今日订单列表中，可能是新订单还未同步，继续等待
            logger.log(`订单 ${orderId} 尚未出现在今日订单列表中，继续等待...`);
          }

          // 等待 2 秒后再次查询
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (queryError: any) {
          // 如果查询失败，记录错误但继续重试
          // lastError = queryError; // Commented out unused variable
          
          // 如果是频率限制错误，延长等待时间
          if (queryError.message && (queryError.message.includes('429') || queryError.message.includes('429002'))) {
            logger.warn(`订单查询频率限制，等待更长时间后重试 (${orderId})`);
            await new Promise((resolve) => setTimeout(resolve, 5000)); // 等待5秒
          } else {
            logger.warn(`批量查询今日订单失败 (${orderId}):`, queryError.message);
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      // 超时，尝试最后一次批量查询
      try {
        const tradeCtx = await getTradeContext();
        const todayOrders = await tradeCtx.todayOrders({});
        const order = this.findOrderInList(todayOrders, orderId);
        
        if (order) {
          return order;
        }
      } catch (error: any) {
        logger.warn(`超时后批量查询订单失败 (${orderId}):`, error.message);
      }

      // 如果查询失败，返回一个基本结构
      logger.warn(`订单 ${orderId} 查询超时，返回默认状态`);
      return {
        orderId,
        status: 'NewStatus', // 假设是新订单状态
        executedPrice: null,
        executedQuantity: 0,
      };
    } catch (error: any) {
      logger.error(`等待订单成交失败 (${orderId}):`, error);
      // 返回一个基本结构，避免后续代码崩溃
      return {
        orderId,
        status: 'Unknown',
        executedPrice: null,
        executedQuantity: 0,
      };
    }
  }

  /**
   * 从订单列表中查找指定订单
   */
  private findOrderInList(orders: any, orderId: string): any | null {
    if (!orders) return null;

    // 处理不同的返回格式
    let orderList: any[] = [];
    
    if (Array.isArray(orders)) {
      orderList = orders;
    } else if (orders.orders && Array.isArray(orders.orders)) {
      orderList = orders.orders;
    } else if (orders.list && Array.isArray(orders.list)) {
      orderList = orders.list;
    }

    // 查找匹配的订单
    for (const order of orderList) {
      const id = order.orderId || order.order_id || order.id;
      if (id && id.toString() === orderId.toString()) {
        return order;
      }
    }

    return null;
  }

  /**
   * 标准化订单状态
   */
  private normalizeStatus(status: any): string {
    if (typeof status === 'string') {
      // 如果是简写形式，转换为完整形式
      const statusMap: Record<string, string> = {
        'Filled': 'FilledStatus',
        'PartialFilled': 'PartialFilledStatus',
        'New': 'NewStatus',
        'Canceled': 'CanceledStatus',
        'Rejected': 'RejectedStatus',
      };
      return statusMap[status] || status;
    }
    return String(status);
  }

  /**
   * 记录订单到数据库
   */
  private async recordOrder(
    strategyId: number,
    symbol: string,
    side: string,
    quantity: number,
    price: number,
    orderId: string,
    signalId?: number
  ): Promise<void> {
    await pool.query(
      `INSERT INTO execution_orders 
       (strategy_id, symbol, order_id, side, quantity, price, current_status, execution_stage, signal_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'SUBMITTED', 1, $7)`,
      [strategyId, symbol, orderId, side, quantity, price, signalId || null]
    );
  }

  /**
   * 根据信号ID更新信号状态
   */
  private async updateSignalStatusBySignalId(
    signalId: number,
    status: 'EXECUTED' | 'REJECTED' | 'IGNORED'
  ): Promise<void> {
    try {
      const result = await pool.query(
        'UPDATE strategy_signals SET status = $1 WHERE id = $2',
        [status, signalId]
      );
      
      if (result.rowCount === 0) {
        logger.warn(`未找到信号 ${signalId}`);
      } else {
        logger.debug(`信号 ${signalId} 状态已更新为 ${status}`);
      }
    } catch (error: any) {
      logger.error(`更新信号状态失败 (signalId: ${signalId}):`, error);
      throw error;
    }
  }

  /**
   * 根据订单ID更新信号状态（通过signal_id关联）
   */
  async updateSignalStatusByOrderId(
    orderId: string,
    status: 'EXECUTED' | 'REJECTED' | 'IGNORED'
  ): Promise<void> {
    try {
      // First, try to update using signal_id (for new orders)
      let result = await pool.query(
        `UPDATE strategy_signals 
         SET status = $1 
         WHERE id IN (
           SELECT signal_id FROM execution_orders 
           WHERE order_id = $2 AND signal_id IS NOT NULL
         )`,
        [status, orderId]
      );
      
      // If no signal was updated and order doesn't have signal_id, try time window matching (for historical orders)
      if (result.rowCount === 0) {
        // Get order information
        const orderResult = await pool.query(
          `SELECT strategy_id, symbol, side, created_at, signal_id
           FROM execution_orders 
           WHERE order_id = $1`,
          [orderId]
        );
        
        if (orderResult.rows.length === 0) {
          logger.warn(`未找到订单 ${orderId}`);
          return;
        }
        
        const order = orderResult.rows[0];
        
        // If order already has signal_id but signal wasn't found, skip
        if (order.signal_id) {
          logger.warn(`订单 ${orderId} 有 signal_id=${order.signal_id}，但信号不存在`);
          return;
        }
        
        // Try time window matching (fallback for historical orders)
        // ✅ 修复BUG 3: 放宽时间窗口从5分钟增加到30分钟，提高匹配成功率
        const orderSide = normalizeSide(order.side);
        const orderTime = new Date(order.created_at);
        const timeWindowStart = new Date(orderTime.getTime() - 30 * 60 * 1000); // 30 minutes before
        const timeWindowEnd = new Date(orderTime.getTime() + 30 * 60 * 1000); // 30 minutes after
        
        // ✅ 修复：正确处理各种side格式（BUY/Buy/buy -> BUY, SELL/Sell/sell -> SELL）
        const orderSideUpper = orderSide.toUpperCase();
        const signalType = orderSideUpper === 'BUY' ? 'BUY' : 'SELL';
        
        // ✅ 修复：添加调试日志
        logger.debug(
          `尝试时间窗口匹配: orderId=${orderId}, strategy_id=${order.strategy_id}, ` +
          `symbol=${order.symbol}, signalType=${signalType}, ` +
          `timeWindow=${timeWindowStart.toISOString()} 到 ${timeWindowEnd.toISOString()}`
        );

        result = await pool.query(
          `UPDATE strategy_signals 
           SET status = $1 
           WHERE id = (
             SELECT id
             FROM strategy_signals
             WHERE strategy_id = $2 
               AND symbol = $3 
               AND signal_type = $4
               AND created_at >= $5 
               AND created_at <= $6
               AND status = 'PENDING'
             ORDER BY 
               CASE 
                 WHEN created_at <= $7 THEN 0  -- Prefer signals before order creation
                 ELSE 1  -- Then signals after order creation
               END,
               ABS(EXTRACT(EPOCH FROM (created_at - $7)))  -- Among same priority, choose closest
             LIMIT 1
           )
           RETURNING id`,
          [
            status,
            order.strategy_id,
            order.symbol,
            signalType,
            timeWindowStart,
            timeWindowEnd,
            order.created_at,  // Add order creation time for priority sorting
          ]
        );
        
        logger.debug(
          `UPDATE结果: rowCount=${result.rowCount}, rows=${JSON.stringify(result.rows)}`
        );
        
        if (result.rowCount !== null && result.rowCount > 0) {
          const signalIds = result.rows.map(r => r.id);
          logger.debug(`订单 ${orderId} 通过时间窗口匹配更新了信号状态: ${signalIds.join(',')}`);
          
          // Optionally, backfill signal_id for future use
          if (signalIds.length === 1) {
            const backfillResult = await pool.query(
              `UPDATE execution_orders SET signal_id = $1 WHERE order_id = $2`,
              [signalIds[0], orderId]
            );
            logger.debug(
              `已回填订单 ${orderId} 的 signal_id=${signalIds[0]}, ` +
              `backfillRowCount=${backfillResult.rowCount}`
            );
          }
        } else {
          logger.warn(
            `未找到订单 ${orderId} 关联的信号 ` +
            `(strategy_id=${order.strategy_id}, symbol=${order.symbol}, side=${orderSide}, signalType=${signalType})`
          );
        }
      } else {
        logger.debug(`订单 ${orderId} 关联的信号状态已更新为 ${status}`);
      }
    } catch (error: any) {
      logger.error(`更新信号状态失败 (订单: ${orderId}):`, error);
      throw error;
    }
  }

  /**
   * 记录交易到数据库（公开方法，供订单追踪调用）
   */
  async recordTrade(
    strategyId: number,
    symbol: string,
    side: string,
    orderDetail: any,
    fees: number
  ): Promise<void> {
    const avgPrice = parseFloat(orderDetail.executedPrice?.toString() || '0');
    const filledQuantity = parseInt(orderDetail.executedQuantity?.toString() || '0');
    const status = this.normalizeStatus(orderDetail.status);
    const orderId = orderDetail.orderId || orderDetail.order_id;

    // 判断是开仓还是平仓
    const existingTrade = await pool.query(
      `SELECT id FROM auto_trades 
       WHERE strategy_id = $1 AND symbol = $2 AND side = $3 AND close_time IS NULL
       ORDER BY open_time DESC LIMIT 1`,
      [strategyId, symbol, side === 'BUY' ? 'SELL' : 'BUY'] // 平仓时 side 相反
    );

    if (existingTrade.rows.length > 0 && side === 'SELL') {
      // 平仓：更新现有交易记录
      const tradeId = existingTrade.rows[0].id;
      const openTrade = await pool.query(
        'SELECT avg_price, quantity FROM auto_trades WHERE id = $1',
        [tradeId]
      );

      if (openTrade.rows.length > 0) {
        const openPrice = parseFloat(openTrade.rows[0].avg_price);
        const openQuantity = parseInt(openTrade.rows[0].quantity);
        const pnl = (avgPrice - openPrice) * Math.min(filledQuantity, openQuantity);

        await pool.query(
          `UPDATE auto_trades 
           SET close_time = NOW(), pnl = $1, fees = $2, status = $3
           WHERE id = $4`,
          [pnl, fees, status === 'FilledStatus' ? 'FILLED' : 'PARTIALLY_FILLED', tradeId]
        );
      }
    } else {
      // 开仓：插入新交易记录
      await pool.query(
        `INSERT INTO auto_trades 
         (strategy_id, symbol, side, quantity, avg_price, fees, status, order_id, open_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          strategyId,
          symbol,
          side,
          filledQuantity,
          avgPrice,
          fees,
          status === 'FilledStatus' ? 'FILLED' : 'PARTIALLY_FILLED',
          orderId,
        ]
      );
    }

    // 更新订单状态（将API状态转换为数据库状态格式）
    // API状态: FilledStatus, PartialFilledStatus
    // 数据库状态: FILLED, PARTIALLY_FILLED
    let dbStatus = 'SUBMITTED';
    if (status === 'FilledStatus') {
      dbStatus = 'FILLED';
    } else if (status === 'PartialFilledStatus') {
      dbStatus = 'PARTIALLY_FILLED';
    } else if (status === 'CanceledStatus' || status === 'PendingCancelStatus' || status === 'WaitToCancel') {
      dbStatus = 'CANCELLED';
    } else if (status === 'RejectedStatus') {
      dbStatus = 'REJECTED';
    } else {
      dbStatus = status; // 其他状态保持原样
    }
    
    await pool.query(
      `UPDATE execution_orders 
       SET current_status = $1, updated_at = NOW()
       WHERE order_id = $2`,
      [dbStatus, orderId]
    );
  }
}

// 导出单例
export default new BasicExecutionService();

