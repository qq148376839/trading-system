/**
 * 统一订单提交服务
 *
 * 目的：
 * - 提供唯一的订单提交入口
 * - 手动下单（orders.ts）和量化下单（basic-execution.service.ts）都使用此服务
 * - 支持股票和期权订单
 * - 统一的验证、错误处理、日志记录
 *
 * 架构设计：
 * - 从 orders.ts 的 POST /submit 端点提取核心逻辑
 * - 提供内部 API 供其他服务调用
 * - 确保所有订单都经过相同的验证和提交流程
 */

import {
  getTradeContext,
  getQuoteContext,
  Decimal,
  OrderType,
  OrderSide,
  TimeInForceType,
  OutsideRTH
} from '../config/longport';
import { validateOrderParams, normalizeOrderParams, detectMarket } from '../utils/order-validation';
import { longportRateLimiter, retryWithBackoff } from '../utils/longport-rate-limiter';
import { logger } from '../utils/logger';

/**
 * 订单提交参数
 */
export interface OrderSubmissionParams {
  symbol: string;
  side: 'Buy' | 'Sell';
  order_type: string;
  submitted_quantity: string;
  submitted_price?: string;
  time_in_force?: string;
  outside_rth?: string;
  remark?: string;
  trigger_price?: string;
  trailing_amount?: string;
  trailing_percent?: string;
  limit_offset?: string;
  expire_date?: string;
}

/**
 * 订单提交结果
 */
export interface OrderSubmissionResult {
  success: boolean;
  orderId?: string;
  status?: string;
  error?: {
    code: string;
    message: string;
    details?: string[];
  };
}

/**
 * 统一订单提交服务类
 */
class OrderSubmissionService {
  /**
   * 提交订单（核心方法）
   *
   * 此方法包含完整的订单提交逻辑：
   * 1. 参数验证和规范化
   * 2. Lot size 验证
   * 3. 构建订单选项
   * 4. 调用 LongPort SDK 提交订单
   * 5. 错误处理和日志记录
   *
   * @param params 订单参数
   * @returns 订单提交结果
   */
  async submitOrder(params: OrderSubmissionParams): Promise<OrderSubmissionResult> {
    try {
      // 1. 规范化参数（支持新旧参数命名）
      const normalizedParams = normalizeOrderParams(params);

      // 2. 参数验证
      const validation = validateOrderParams(normalizedParams);
      if (!validation.valid) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '参数验证失败',
            details: validation.errors,
          },
        };
      }

      // 3. 验证最小交易单位（lot size）
      const lotSizeValidation = await this.validateLotSize(
        normalizedParams.symbol,
        normalizedParams.submitted_quantity
      );
      if (!lotSizeValidation.valid) {
        return {
          success: false,
          error: lotSizeValidation.error!,
        };
      }

      // 4. 构建订单选项
      const orderOptions = await this.buildOrderOptions(normalizedParams);
      if (!orderOptions.success) {
        return {
          success: false,
          error: orderOptions.error!,
        };
      }

      // 5. 记录订单提交日志
      logger.log('提交订单:', {
        symbol: normalizedParams.symbol,
        side: normalizedParams.side,
        orderType: normalizedParams.order_type,
        quantity: normalizedParams.submitted_quantity,
        price: normalizedParams.submitted_price,
      });

      // 6. 提交订单到 LongPort SDK
      const tradeCtx = await getTradeContext();
      const response = await longportRateLimiter.execute(() =>
        retryWithBackoff<any>(() => tradeCtx.submitOrder(orderOptions.data!) as any)
      );

      if (!response || !response.orderId) {
        return {
          success: false,
          error: {
            code: 'ORDER_SUBMIT_FAILED',
            message: '订单提交失败：未返回订单ID',
          },
        };
      }

      logger.log('订单提交成功:', {
        orderId: response.orderId,
        symbol: normalizedParams.symbol,
      });

      return {
        success: true,
        orderId: response.orderId,
        status: response.status,
      };

    } catch (error: any) {
      logger.error('订单提交失败:', error);

      return {
        success: false,
        error: {
          code: 'ORDER_SUBMIT_FAILED',
          message: error.message || '提交订单失败',
        },
      };
    }
  }

  /**
   * 验证最小交易单位（lot size）
   */
  private async validateLotSize(
    symbol: string,
    quantityStr: string
  ): Promise<{ valid: boolean; error?: { code: string; message: string; details?: string[] } }> {
    try {
      const quoteCtx = await getQuoteContext();
      const staticInfoList = await quoteCtx.staticInfo([symbol]);

      if (staticInfoList && staticInfoList.length > 0) {
        const lotSize = staticInfoList[0].lotSize;
        const quantity = parseInt(quantityStr);

        if (lotSize > 0 && quantity % lotSize !== 0) {
          return {
            valid: false,
            error: {
              code: 'INVALID_LOT_SIZE',
              message: `数量不符合最小交易单位要求。最小交易单位为 ${lotSize}，请输入 ${lotSize} 的倍数。`,
              details: [
                `当前数量: ${quantity}`,
                `最小交易单位: ${lotSize}`,
                `建议数量: ${Math.ceil(quantity / lotSize) * lotSize}`
              ],
            },
          };
        }
      }

      return { valid: true };

    } catch (error: any) {
      // 如果获取lot size失败，不阻止订单提交，只记录警告
      logger.warn('获取最小交易单位失败，跳过验证:', error);
      return { valid: true };
    }
  }

  /**
   * 构建订单选项（转换为 LongPort SDK 格式）
   */
  private async buildOrderOptions(
    params: any
  ): Promise<{ success: boolean; data?: any; error?: { code: string; message: string } }> {
    try {
      // 1. 转换订单类型
      const orderTypeEnum = OrderType[params.order_type as keyof typeof OrderType];
      if (orderTypeEnum === undefined) {
        return {
          success: false,
          error: {
            code: 'INVALID_ORDER_TYPE',
            message: `无效的订单类型: ${params.order_type}`,
          },
        };
      }

      // 2. 转换交易方向
      const sideEnum = OrderSide[params.side as keyof typeof OrderSide];
      if (sideEnum === undefined) {
        return {
          success: false,
          error: {
            code: 'INVALID_SIDE',
            message: `无效的交易方向: ${params.side}`,
          },
        };
      }

      // 3. 转换订单有效期
      let timeInForceEnum = TimeInForceType.Day; // 默认值
      if (params.time_in_force) {
        const timeInForceMap: Record<string, any> = {
          'Day': TimeInForceType.Day,
          'GTC': TimeInForceType.GoodTilCanceled,
          'GTD': TimeInForceType.GoodTilDate,
        };
        timeInForceEnum = timeInForceMap[params.time_in_force] || TimeInForceType.Day;
      }

      // 4. 构建基础订单选项
      const orderOptions: any = {
        symbol: params.symbol,
        orderType: orderTypeEnum,
        side: sideEnum,
        submittedQuantity: new Decimal(params.submitted_quantity),
        timeInForce: timeInForceEnum,
      };

      // 5. 添加价格（限价单、触价限价单等需要）
      if (params.submitted_price) {
        orderOptions.submittedPrice = new Decimal(params.submitted_price);
      }

      // 6. 添加触发价格（条件单需要）
      if (params.trigger_price) {
        orderOptions.triggerPrice = new Decimal(params.trigger_price);
      }

      // 7. 添加跟踪参数（跟踪止损单需要）
      if (params.trailing_amount) {
        orderOptions.trailingAmount = new Decimal(params.trailing_amount);
      }
      if (params.trailing_percent) {
        orderOptions.trailingPercent = new Decimal(params.trailing_percent);
      }
      if (params.limit_offset) {
        orderOptions.limitOffset = new Decimal(params.limit_offset);
      }

      // 8. 添加过期日期（GTD订单需要）
      if (params.expire_date && timeInForceEnum === TimeInForceType.GoodTilDate) {
        orderOptions.expireDate = new Date(params.expire_date);
      }

      // 9. 添加盘前盘后选项（美股订单需要）
      const market = detectMarket(params.symbol);
      if (market === 'US' && params.outside_rth) {
        const outsideRthMap: Record<string, any> = {
          'RTH_ONLY': OutsideRTH.RTHOnly,
          'ANY_TIME': OutsideRTH.AnyTime,
          'OVERNIGHT': OutsideRTH.Overnight,
        };
        orderOptions.outsideRth = outsideRthMap[params.outside_rth];
      }

      // 10. 添加备注
      if (params.remark) {
        orderOptions.remark = params.remark;
      }

      return {
        success: true,
        data: orderOptions,
      };

    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'BUILD_ORDER_OPTIONS_FAILED',
          message: error.message || '构建订单选项失败',
        },
      };
    }
  }
}

// 导出单例
export const orderSubmissionService = new OrderSubmissionService();
export default orderSubmissionService;
