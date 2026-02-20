import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { getTradeContext, getQuoteContext, Decimal, OrderType, OrderSide, OrderStatus, Market, TimeInForceType, OutsideRTH } from '../config/longport';
import { validateOrderParams, normalizeOrderParams, detectMarket } from '../utils/order-validation';
import { longportRateLimiter, retryWithBackoff } from '../utils/longport-rate-limiter';
import orderSubmissionService from '../services/order-submission.service';
import { logger } from '../utils/logger';
import { normalizeOrderStatus } from '../utils/order-status';

export const ordersRouter = Router();

/**
 * 转换订单方向（side）字段
 * 支持枚举值（1=Buy, 2=Sell）和字符串（"Buy", "Sell"）
 */
export function normalizeSide(side: any): string {
  if (!side) return 'Unknown';
  
  // 如果是字符串，直接返回
  if (typeof side === 'string') {
    return side;
  }
  
  // 如果是数字枚举值
  if (typeof side === 'number') {
    // OrderSide.Buy = 1, OrderSide.Sell = 2
    return side === 1 ? 'Buy' : side === 2 ? 'Sell' : 'Unknown';
  }
  
  // 尝试转换为字符串
  const sideStr = side.toString();
  if (sideStr === '1' || sideStr === 'Buy') return 'Buy';
  if (sideStr === '2' || sideStr === 'Sell') return 'Sell';
  
  return sideStr;
}

/**
 * 转换订单状态（status）字段
 * 审计修复: H-12 — 统一使用 utils/order-status.ts 中的 normalizeOrderStatus
 *
 * 委托给统一实现，保留导出名称以兼容现有调用者（quant.ts, basic-execution.service.ts 等）
 */
export function normalizeStatus(status: string | number | null | undefined): string {
  return normalizeOrderStatus(status);
}
  
/**
 * 将字符串状态转换为OrderStatus枚举值
 * 用于SDK调用时的参数转换
 */
function parseOrderStatus(statusStr: string): any {
  // 根据官方文档：https://open.longbridge.com/zh-CN/docs/trade/trade-definition#orderstatus
  // SDK使用枚举值，需要将字符串转换为枚举
  const statusMap: Record<string, any> = {
    'NotReported': OrderStatus.NotReported,
    'ReplacedNotReported': OrderStatus.ReplacedNotReported,
    'ProtectedNotReported': OrderStatus.ProtectedNotReported,
    'VarietiesNotReported': OrderStatus.VarietiesNotReported,
    'Filled': OrderStatus.Filled,
    'FilledStatus': OrderStatus.Filled,
    'PartialFilled': OrderStatus.PartialFilled,
    'PartialFilledStatus': OrderStatus.PartialFilled,
    'New': OrderStatus.New,
    'NewStatus': OrderStatus.New,
    'WaitToNew': OrderStatus.WaitToNew,
    'Canceled': OrderStatus.Canceled,
    'CanceledStatus': OrderStatus.Canceled,
    'PendingCancelStatus': OrderStatus.PendingCancelStatus,
    'WaitToCancel': OrderStatus.WaitToCancel,
    'Rejected': OrderStatus.Rejected,
    'RejectedStatus': OrderStatus.Rejected,
    'Expired': OrderStatus.Expired,
    'ExpiredStatus': OrderStatus.Expired,
    'WaitToReplace': OrderStatus.WaitToReplace,
    'PendingReplaceStatus': OrderStatus.PendingReplaceStatus,
    'ReplacedStatus': OrderStatus.ReplacedStatus,
    'PartialWithdrawal': OrderStatus.PartialWithdrawal,
  };
  return statusMap[statusStr];
}

/**
 * 解析日期参数（支持时间戳秒、ISO字符串、Date对象）
 * SDK需要Date对象
 */
function parseDate(dateInput: any): Date {
  if (dateInput instanceof Date) {
    return dateInput;
  }
  if (typeof dateInput === 'string') {
    // ISO字符串
    if (dateInput.includes('T') || dateInput.includes('-')) {
      return new Date(dateInput);
    }
    // 时间戳字符串（秒）
    const ts = parseInt(dateInput);
    if (!isNaN(ts)) {
      return new Date(ts * 1000);
    }
  }
  if (typeof dateInput === 'number') {
    // 时间戳（秒）
    return new Date(dateInput * 1000);
  }
  throw new Error(`Invalid date format: ${dateInput}`);
}

/**
 * 转换订单类型（orderType）字段
 * 将数字枚举值转换为字符串枚举值（根据交易词典）
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/trade-definition#ordertype
 */
function normalizeOrderType(orderType: any): string {
  if (!orderType && orderType !== 0) return '';
  
  // 如果已经是字符串，直接返回
  if (typeof orderType === 'string') {
    return orderType;
  }
  
  // 如果是数字，转换为字符串枚举值
  // 根据 SDK 的实际枚举值映射（需要根据实际 SDK 调整）
  if (typeof orderType === 'number') {
    // 根据 Longbridge SDK 的 OrderType 枚举值映射
    // 注意：实际映射关系需要根据 SDK 文档确认
    const orderTypeMap: Record<number, string> = {
      1: 'LO',      // 限价单
      2: 'MO',      // 市价单
      3: 'ELO',     // 增强限价单
      4: 'AO',      // 竞价市价单
      5: 'ALO',     // 竞价限价单
      6: 'ODD',     // 碎股单挂单
      7: 'LIT',     // 触价限价单
      8: 'MIT',     // 触价市价单
      9: 'TSLPAMT', // 跟踪止损限价单（跟踪金额）
      10: 'TSLPPCT', // 跟踪止损限价单（跟踪涨跌幅）
      11: 'SLO',    // 特殊限价单
    };
    
    return orderTypeMap[orderType] || orderType.toString();
  }
  
  return orderType.toString();
}

/**
 * 翻译订单类型为中文
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/trade-definition#ordertype
 */
function translateOrderType(orderType: string): string {
  const orderTypeMap: Record<string, string> = {
    'LO': '限价单',
    'ELO': '增强限价单',
    'MO': '市价单',
    'AO': '竞价市价单',
    'ALO': '竞价限价单',
    'ODD': '碎股单挂单',
    'LIT': '触价限价单',
    'MIT': '触价市价单',
    'TSLPAMT': '跟踪止损限价单 (跟踪金额)',
    'TSLPPCT': '跟踪止损限价单 (跟踪涨跌幅)',
    'SLO': '特殊限价单，不支持改单',
  };
  
  return orderTypeMap[orderType] || orderType;
}

/**
 * 转换订单标记（tag）字段
 * 将数字枚举值转换为字符串枚举值
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/trade-definition
 */
function normalizeTag(tag: any): string {
  if (!tag && tag !== 0) return 'Normal';
  
  // 如果已经是字符串，直接返回
  if (typeof tag === 'string') {
    return tag;
  }
  
  // 如果是数字，转换为字符串枚举值
  if (typeof tag === 'number') {
    const tagMap: Record<number, string> = {
      0: 'Normal',  // 普通订单
      1: 'Normal',  // 普通订单（兼容）
      2: 'GTC',     // 长期单
      3: 'Grey',    // 暗盘单
    };
    
    return tagMap[tag] || 'Normal';
  }
  
  return tag.toString();
}

/**
 * 转换有效期类型（timeInForce）字段
 * 将数字枚举值转换为字符串枚举值
 */
function normalizeTimeInForce(timeInForce: any): string {
  if (!timeInForce && timeInForce !== 0) return 'Day';
  
  // 如果已经是字符串，直接返回
  if (typeof timeInForce === 'string') {
    return timeInForce;
  }
  
  // 如果是数字，转换为字符串枚举值
  if (typeof timeInForce === 'number') {
    const timeInForceMap: Record<number, string> = {
      0: 'Unknown',
      1: 'Day',      // 当日有效
      2: 'Day',      // 当日有效（兼容）
      3: 'GTC',      // 长期有效
      4: 'IOC',      // 立即成交或取消
      5: 'FOK',      // 全部成交或取消
    };
    
    return timeInForceMap[timeInForce] || 'Day';
  }
  
  return timeInForce.toString();
}

/**
 * 转换盘前盘后（outsideRth）字段
 * 将数字枚举值转换为API文档中的字符串枚举值
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/trade-definition
 * 可选值：RTH_ONLY, ANY_TIME, OVERNIGHT
 */
function normalizeOutsideRth(outsideRth: any): string {
  if (outsideRth === null || outsideRth === undefined) return '';
  
  // 如果已经是字符串枚举值，直接返回
  if (typeof outsideRth === 'string') {
    // 如果是已知的枚举值，直接返回
    if (['RTH_ONLY', 'ANY_TIME', 'OVERNIGHT', 'UnknownOutsideRth'].includes(outsideRth)) {
      return outsideRth === 'UnknownOutsideRth' ? '' : outsideRth;
    }
    // 如果是其他字符串，尝试映射
    const strMap: Record<string, string> = {
      'NORMAL': 'ANY_TIME',
      'ONLY_RTH': 'RTH_ONLY',
      'ONLY_NRTH': 'ANY_TIME',
    };
    return strMap[outsideRth] || outsideRth;
  }
  
  // 如果是布尔值，转换为字符串枚举值
  if (typeof outsideRth === 'boolean') {
    return outsideRth ? 'ANY_TIME' : 'RTH_ONLY';
  }
  
  // 如果是数字，转换为字符串枚举值
  // 根据SDK的实际枚举值映射（需要根据实际SDK调整）
  if (typeof outsideRth === 'number') {
    const numMap: Record<number, string> = {
      0: 'RTH_ONLY',    // 不允许盘前盘后
      1: 'ANY_TIME',    // 允许盘前盘后
      2: 'OVERNIGHT',   // 夜盘
    };
    return numMap[outsideRth] || '';
  }
  
  return '';
}

/**
 * 翻译盘前盘后字段为中文
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/trade-definition
 */
function translateOutsideRth(outsideRth: string): string {
  if (!outsideRth || outsideRth === 'UnknownOutsideRth') {
    return '未知';
  }
  
  const outsideRthMap: Record<string, string> = {
    'RTH_ONLY': '不允许盘前盘后',
    'ANY_TIME': '允许盘前盘后',
    'OVERNIGHT': '夜盘',
  };
  
  return outsideRthMap[outsideRth] || outsideRth;
}

/**
 * 格式化订单历史明细
 * 将SDK返回的历史明细转换为API文档格式
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/trade-definition
 */
function formatOrderHistory(history: any[]): any[] {
  if (!Array.isArray(history)) return [];
  
  return history.map((item: any) => ({
    price: item.price?.toString() || item.submittedPrice?.toString() || '0',
    quantity: item.quantity?.toString() || item.executedQuantity?.toString() || '0',
    status: normalizeStatus(item.status),
    msg: item.msg || item.remark || '',
    time: formatTimestampSeconds(item.time || item.submittedAt || item.updatedAt),
  }));
}

/**
 * 格式化订单费用明细
 * 将SDK返回的费用明细转换为API文档格式
 */
function formatChargeDetail(chargeDetail: any): any {
  if (!chargeDetail) {
    return {
      total_amount: '0',
      currency: '',
      items: [],
    };
  }
  
  return {
    total_amount: chargeDetail.totalAmount?.toString() || chargeDetail.total_amount?.toString() || '0',
    currency: chargeDetail.currency || '',
    items: Array.isArray(chargeDetail.items) ? chargeDetail.items.map((item: any) => ({
      code: item.code || 'UNKNOWN',
      name: item.name || '',
      fees: Array.isArray(item.fees) ? item.fees.map((fee: any) => ({
        code: fee.code || '',
        name: fee.name || '',
        amount: fee.amount?.toString() || '0',
        currency: fee.currency || '',
      })) : [],
    })) : [],
  };
}

/**
 * 统一映射订单数据
 * 将Longbridge SDK返回的订单数据映射为统一格式
 * 保留所有官方字段，并将数字枚举值转换为字符串枚举值
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/trade-definition
 * 
 * 注意：此函数会根据 executedQuantity 自动修正订单状态
 * 如果已成交数量 > 0，但状态不是已成交，会自动修正为 FilledStatus 或 PartialFilledStatus
 */
export function mapOrderData(order: any): any {
  // 智能判断状态：如果 executedQuantity > 0 但 status 不是已成交状态，自动修正
  const executedQty = parseFloat(order.executedQuantity?.toString() || order.executed_quantity?.toString() || '0');
  const quantity = parseFloat(order.quantity?.toString() || order.submittedQuantity?.toString() || '0');
  let status = normalizeStatus(order.status);
  
  // 智能判断：如果已成交数量大于0，但状态不是已成交，则修正状态
  if (executedQty > 0) {
    if (executedQty >= quantity) {
      // 全部成交
      if (status !== 'FilledStatus' && status !== 'PartialFilledStatus') {
        status = 'FilledStatus';
      }
    } else {
      // 部分成交
      if (status !== 'FilledStatus' && status !== 'PartialFilledStatus') {
        status = 'PartialFilledStatus';
      }
    }
  }
  
  // 处理 outside_rth 字段，确保返回正确的字符串枚举值
  const outsideRthValue = normalizeOutsideRth(order.outsideRth || order.outside_rth);
  
  // 获取订单类型和盘前盘后的翻译
  const orderTypeValue = normalizeOrderType(order.orderType || order.order_type);
  const orderTypeText = translateOrderType(orderTypeValue);
  const outsideRthText = translateOutsideRth(outsideRthValue);
  
  return {
    // 基础字段（使用下划线命名，与API文档一致）
    order_id: order.orderId || order.order_id || '',
    symbol: order.symbol || '',
    stock_name: order.stockName || order.stock_name || '',
    side: normalizeSide(order.side),
    order_type: orderTypeValue,
    order_type_text: orderTypeText, // 订单类型中文翻译
    status: status,
    
    // 数量字段
    quantity: order.quantity?.toString() || order.submittedQuantity?.toString() || '0',
    executed_quantity: order.executedQuantity?.toString() || order.executed_quantity?.toString() || '0',
    
    // 价格字段
    price: order.price?.toString() || order.submittedPrice?.toString() || '',
    executed_price: order.executedPrice?.toString() || order.executed_price?.toString() || '0',
    last_done: order.lastDone?.toString() || order.last_done?.toString() || '',
    
    // 时间字段（转换为时间戳秒，符合API文档格式）
    submitted_at: formatTimestampSeconds(order.submittedAt || order.submitted_at),
    updated_at: formatTimestampSeconds(order.updatedAt || order.updated_at),
    trigger_at: formatTimestampSeconds(order.triggerAt || order.trigger_at),
    expire_date: order.expireDate || order.expire_date || '',
    
    // 条件单字段
    trigger_price: order.triggerPrice?.toString() || order.trigger_price?.toString() || '',
    trigger_status: order.triggerStatus || order.trigger_status || 'NOT_USED',
    
    // 跟踪单字段
    trailing_amount: order.trailingAmount?.toString() || order.trailing_amount?.toString() || '',
    trailing_percent: order.trailingPercent?.toString() || order.trailing_percent?.toString() || '',
    limit_offset: order.limitOffset?.toString() || order.limit_offset?.toString() || '',
    
    // 其他字段
    currency: order.currency || '',
    msg: order.msg || order.remark || '',
    tag: normalizeTag(order.tag),
    time_in_force: normalizeTimeInForce(order.timeInForce || order.time_in_force),
    outside_rth: outsideRthValue,
    outside_rth_text: outsideRthText, // 盘前盘后中文翻译
    remark: order.remark || '',
    
    // 免佣相关字段
    free_status: order.freeStatus || order.free_status || 'None',
    free_amount: order.freeAmount?.toString() || order.free_amount?.toString() || '',
    free_currency: order.freeCurrency || order.free_currency || '',
    
    // 抵扣相关字段
    deductions_status: order.deductionsStatus || order.deductions_status || 'NONE',
    deductions_amount: order.deductionsAmount?.toString() || order.deductions_amount?.toString() || '',
    deductions_currency: order.deductionsCurrency || order.deductions_currency || '',
    
    // 平台费抵扣相关字段
    platform_deducted_status: order.platformDeductedStatus || order.platform_deducted_status || 'NONE',
    platform_deducted_amount: order.platformDeductedAmount?.toString() || order.platform_deducted_amount?.toString() || '',
    platform_deducted_currency: order.platformDeductedCurrency || order.platform_deducted_currency || '',
    
    // 订单历史明细
    history: formatOrderHistory(order.history || order.executions || []),
    
    // 订单费用
    charge_detail: formatChargeDetail(order.chargeDetail || order.charge_detail),
    
    // 向后兼容：同时提供驼峰命名的字段
    orderId: order.orderId || order.order_id || '',
    stockName: order.stockName || order.stock_name || '',
    orderType: orderTypeValue,
    orderTypeText: orderTypeText, // 订单类型中文翻译
    executedQuantity: order.executedQuantity?.toString() || order.executed_quantity?.toString() || '0',
    executedPrice: order.executedPrice?.toString() || order.executed_price?.toString() || '0',
    lastDone: order.lastDone?.toString() || order.last_done?.toString() || '',
    submittedAt: formatTimestamp(order.submittedAt || order.submitted_at),
    updatedAt: formatTimestamp(order.updatedAt || order.updated_at),
    triggerAt: formatTimestamp(order.triggerAt || order.trigger_at),
    expireDate: order.expireDate || order.expire_date || '',
    triggerPrice: order.triggerPrice?.toString() || order.trigger_price?.toString() || '',
    triggerStatus: order.triggerStatus || order.trigger_status || 'NOT_USED',
    trailingAmount: order.trailingAmount?.toString() || order.trailing_amount?.toString() || '',
    trailingPercent: order.trailingPercent?.toString() || order.trailing_percent?.toString() || '',
    limitOffset: order.limitOffset?.toString() || order.limit_offset?.toString() || '',
    timeInForce: normalizeTimeInForce(order.timeInForce || order.time_in_force),
    outsideRth: outsideRthValue,
    outsideRthText: outsideRthText, // 盘前盘后中文翻译
    freeStatus: order.freeStatus || order.free_status || 'None',
    freeAmount: order.freeAmount?.toString() || order.free_amount?.toString() || '',
    freeCurrency: order.freeCurrency || order.free_currency || '',
    deductionsStatus: order.deductionsStatus || order.deductions_status || 'NONE',
    deductionsAmount: order.deductionsAmount?.toString() || order.deductions_amount?.toString() || '',
    deductionsCurrency: order.deductionsCurrency || order.deductions_currency || '',
    platformDeductedStatus: order.platformDeductedStatus || order.platform_deducted_status || 'NONE',
    platformDeductedAmount: order.platformDeductedAmount?.toString() || order.platform_deducted_amount?.toString() || '',
    platformDeductedCurrency: order.platformDeductedCurrency || order.platform_deducted_currency || '',
  };
}

/**
 * 格式化时间戳
 * 根据API文档，时间字段应返回时间戳（秒）格式
 * 但为了向后兼容，也支持ISO字符串格式
 */
function formatTimestamp(timestamp: any, returnTimestamp: boolean = false): string {
  if (!timestamp) return returnTimestamp ? '0' : '';
  
  let timestampSeconds: number;
  
  if (typeof timestamp === 'string') {
    if (timestamp.includes('T') || timestamp.includes('-')) {
      // ISO字符串格式
      const date = new Date(timestamp);
      timestampSeconds = Math.floor(date.getTime() / 1000);
    } else {
      // 已经是时间戳字符串
      const ts = parseInt(timestamp, 10);
      timestampSeconds = isNaN(ts) ? 0 : ts;
    }
  } else if (typeof timestamp === 'number') {
    // 如果是毫秒时间戳，转换为秒
    if (timestamp > 1000000000000) {
      timestampSeconds = Math.floor(timestamp / 1000);
    } else {
      timestampSeconds = timestamp;
    }
  } else if (timestamp instanceof Date) {
    timestampSeconds = Math.floor(timestamp.getTime() / 1000);
  } else {
    return returnTimestamp ? '0' : '';
  }
  
  if (returnTimestamp) {
    return timestampSeconds.toString();
  }
  
  // 默认返回ISO字符串格式（向后兼容）
  return new Date(timestampSeconds * 1000).toISOString();
}

/**
 * 格式化时间戳为秒（用于API文档格式）
 */
function formatTimestampSeconds(timestamp: any): string {
  return formatTimestamp(timestamp, true);
}

/**
 * @openapi
 * components:
 *   schemas:
 *     Order:
 *       type: object
 *       properties:
 *         order_id:
 *           type: string
 *           description: 订单ID
 *         symbol:
 *           type: string
 *           description: 股票代码 (e.g., 700.HK)
 *         stock_name:
 *           type: string
 *           description: 股票名称
 *         side:
 *           type: string
 *           enum: [Buy, Sell]
 *           description: 交易方向
 *         order_type:
 *           type: string
 *           description: 订单类型代码
 *         order_type_text:
 *           type: string
 *           description: 订单类型中文说明
 *         status:
 *           type: string
 *           description: 订单状态
 *         quantity:
 *           type: string
 *           description: 委托数量
 *         executed_quantity:
 *           type: string
 *           description: 已成交数量
 *         price:
 *           type: string
 *           description: 委托价格
 *         executed_price:
 *           type: string
 *           description: 成交均价
 *         submitted_at:
 *           type: string
 *           description: 提交时间(秒级时间戳)
 *         updated_at:
 *           type: string
 *           description: 更新时间(秒级时间戳)
 */

/**
 * @openapi
 * /orders/account-balance:
 *   get:
 *     tags:
 *       - 订单管理
 *     summary: 查询账户余额
 *     description: 获取当前账户的资金状况，包括现金、购买力等信息
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           enum: [HKD, USD, CNY]
 *         description: 指定币种 (可选)
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
 *                     balances:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           currency:
 *                             type: string
 *                             description: 币种
 *                           totalCash:
 *                             type: string
 *                             description: 现金总额
 *                           netAssets:
 *                             type: string
 *                             description: 净资产
 *                           buyPower:
 *                             type: string
 *                             description: 购买力
 *                           cashInfos:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 currency:
 *                                   type: string
 *                                 availableCash:
 *                                   type: string
 *                                   description: 可用现金
 *       429:
 *         description: 请求频率过高
 *       500:
 *         description: 服务器内部错误
 */
ordersRouter.get('/account-balance', async (req: Request, res: Response) => {
  try {
    const { currency } = req.query;

    const tradeCtx = await getTradeContext();
    
    // 根据文档，currency是可选的字符串参数
    // 如果不传或传null，应该使用undefined或不传参数
    // 只有当currency存在且是有效字符串时才传递
    const balances = currency && typeof currency === 'string' && currency.trim()
      ? await tradeCtx.accountBalance(currency.trim())
      : await tradeCtx.accountBalance();

    res.json({
      success: true,
      data: {
        balances: balances.map((bal: any) => {
          // 根据测试脚本的输出，实际返回的数据结构是：
          // {
          //   buyPower: "799899.98",
          //   cashInfos: [{ currency, availableCash, frozenCash, ... }],
          //   currency: "HKD",
          //   netAssets: "799899.99",
          //   totalCash: "799899.99",
          //   ...
          // }
          // 我们需要从cashInfos中提取各个币种的现金信息
          const result: any = {
            currency: bal.currency || 'USD',
            totalCash: bal.totalCash?.toString() || '0',
            netAssets: bal.netAssets?.toString() || '0',
            buyPower: bal.buyPower?.toString() || '0',
            maxFinanceAmount: bal.maxFinanceAmount?.toString(),
            remainingFinanceAmount: bal.remainingFinanceAmount?.toString(),
            riskLevel: bal.riskLevel?.toString(),
            marginCall: bal.marginCall?.toString(),
            initMargin: bal.initMargin?.toString(),
            maintenanceMargin: bal.maintenanceMargin?.toString(),
            market: bal.market,
            cashInfos: [],
            frozenTransactionFees: [],
          };
          
          // 如果有cashInfos数组，提取每个币种的信息
          if (bal.cashInfos && Array.isArray(bal.cashInfos)) {
            result.cashInfos = bal.cashInfos.map((cashInfo: any) => ({
              currency: cashInfo.currency,
              availableCash: cashInfo.availableCash?.toString() || '0',
              frozenCash: cashInfo.frozenCash?.toString() || '0',
              settlingCash: cashInfo.settlingCash?.toString() || '0',
              withdrawCash: cashInfo.withdrawCash?.toString() || '0',
            }));
            
            // 为了向后兼容，如果请求的是特定币种，返回该币种的信息
            if (currency && typeof currency === 'string') {
              const targetCashInfo = bal.cashInfos.find((ci: any) => ci.currency === currency.toUpperCase());
              if (targetCashInfo) {
                result.cash = targetCashInfo.availableCash?.toString() || '0';
                result.availableCash = targetCashInfo.availableCash?.toString() || '0';
                result.frozenCash = targetCashInfo.frozenCash?.toString() || '0';
              }
            }
          }
          
          // 如果有frozenTransactionFees数组，提取冻结费用信息
          if (bal.frozenTransactionFees && Array.isArray(bal.frozenTransactionFees)) {
            result.frozenTransactionFees = bal.frozenTransactionFees.map((fee: any) => ({
              currency: fee.currency,
              frozenTransactionFee: fee.frozenTransactionFee?.toString() || '0',
            }));
          }
          
          return result;
        }),
      },
    });
  } catch (error: any) {
    logger.error('查询账户余额失败:', error);
    
    // 处理频率限制错误
    if (error.message && (error.message.includes('429') || error.message.includes('429002'))) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: '请求频率过高，请稍后再试。账户余额查询已自动节流，请避免频繁刷新。',
        },
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'QUERY_BALANCE_FAILED',
        message: error.message || '查询账户余额失败',
      },
    });
  }
});

/**
 * POST /api/orders/sync-status
 * 同步订单状态和持仓数据
 */
ordersRouter.post('/sync-status', async (req: Request, res: Response) => {
  try {
    const tradeCtx = await getTradeContext();
    
    // 1. 同步订单状态
    const orders = await tradeCtx.todayOrders({});
    
    // 打印原始订单数据（用于分析）
    if (orders.length > 0) {
      logger.debug('\n========== sync-status - todayOrders API 原始返回 ==========');
      logger.debug(`订单数量: ${orders.length}`);
      logger.debug(JSON.stringify(orders, null, 2));
      logger.debug('==============================================================\n');
    }
    
    let syncedCount = 0;
    for (const order of orders) {
      try {
        // 使用normalizeStatus函数转换状态（返回完整的枚举值名称）
        const statusStr = normalizeStatus(order.status);
        let dbStatus = 'PENDING';
        
        // 根据Longbridge API文档的完整枚举值名称进行判断
        if (statusStr === 'FilledStatus' || statusStr === 'PartialFilledStatus') {
          dbStatus = 'SUCCESS';
        } else if (statusStr === 'CanceledStatus' || statusStr === 'PendingCancelStatus' || statusStr === 'WaitToCancel') {
          dbStatus = 'CANCELLED';
        } else if (statusStr === 'RejectedStatus') {
          dbStatus = 'FAILED';
        } else if (statusStr === 'NewStatus' || statusStr === 'WaitToNew' || statusStr === 'NotReported' ||
                   statusStr === 'ReplacedNotReported' || statusStr === 'ProtectedNotReported' ||
                   statusStr === 'VarietiesNotReported') {
          dbStatus = 'PENDING';
        }

        const updateResult = await pool.query(
          `UPDATE trades 
           SET status = $1, updated_at = NOW() 
           WHERE order_id = $2`,
          [dbStatus, order.orderId]
        );
        
        if (updateResult.rowCount !== null && updateResult.rowCount > 0) {
          syncedCount++;
        }
      } catch (updateError) {
        logger.error(`更新订单 ${order.orderId} 状态失败:`, updateError);
      }
    }
    
    // 2. 查询待处理订单详情（添加延迟，避免频率限制）
    const pendingOrders = await pool.query(
      `SELECT order_id FROM trades 
       WHERE status = 'PENDING' AND order_id IS NOT NULL 
       AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       LIMIT 10`
    );
    
      let detailSyncedCount = 0;
      for (let i = 0; i < pendingOrders.rows.length; i++) {
        const row = pendingOrders.rows[i];
        try {
          // 添加延迟，避免频率限制（每2秒查询一个订单）
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          const orderDetail = await tradeCtx.orderDetail(row.order_id);
          // 使用normalizeStatus函数转换状态（返回完整的枚举值名称）
          const statusStr = normalizeStatus(orderDetail.status);
          let dbStatus = 'PENDING';
          
          // 根据Longbridge API文档的完整枚举值名称进行判断
          if (statusStr === 'FilledStatus' || statusStr === 'PartialFilledStatus') {
            dbStatus = 'SUCCESS';
          } else if (statusStr === 'CanceledStatus' || statusStr === 'PendingCancelStatus' || statusStr === 'WaitToCancel') {
            dbStatus = 'CANCELLED';
          } else if (statusStr === 'RejectedStatus') {
            dbStatus = 'FAILED';
          } else if (statusStr === 'NewStatus' || statusStr === 'WaitToNew' || statusStr === 'NotReported' ||
                     statusStr === 'ReplacedNotReported' || statusStr === 'ProtectedNotReported' ||
                     statusStr === 'VarietiesNotReported') {
            dbStatus = 'PENDING';
          }
          
          await pool.query(
            `UPDATE trades 
             SET status = $1, updated_at = NOW() 
             WHERE order_id = $2`,
            [dbStatus, row.order_id]
          );
          
          detailSyncedCount++;
        } catch (detailError: any) {
          // 处理频率限制错误
          if (detailError.message && (detailError.message.includes('429') || detailError.message.includes('429002'))) {
            logger.warn(`订单详情查询频率限制，已处理 ${detailSyncedCount} 个订单，剩余订单将在下次同步时处理`);
            break; // 遇到频率限制，停止查询
          } else if (detailError.message && detailError.message.includes('602023')) {
            // 602023: 内部服务器错误，可能是订单不存在或已过期
            logger.warn(`订单 ${row.order_id} 可能不存在或已过期（602023）`);
          } else {
            logger.error(`查询订单 ${row.order_id} 详情失败:`, detailError);
          }
        }
      }
    
    // 3. 同步持仓数据
    let positionsSynced = 0;
    try {
      const stockPositions = await tradeCtx.stockPositions();
      const allPositions: any[] = [];
      
      // 根据实际返回的数据结构：{ channels: [{ accountChannel: string, positions: [...] }] }
      if (stockPositions && typeof stockPositions === 'object') {
        if (stockPositions.channels && Array.isArray(stockPositions.channels)) {
          for (const channel of stockPositions.channels) {
            // 优先查找positions字段（实际返回的数据结构）
            if (channel.positions && Array.isArray(channel.positions)) {
              allPositions.push(...channel.positions);
            }
            // 也支持stockInfo字段（向后兼容）
            else if (channel.stockInfo && Array.isArray(channel.stockInfo)) {
              allPositions.push(...channel.stockInfo);
            }
          }
        } else if (Array.isArray(stockPositions)) {
          allPositions.push(...stockPositions);
        } else if (stockPositions.stockInfo && Array.isArray(stockPositions.stockInfo)) {
          allPositions.push(...stockPositions.stockInfo);
        }
      }
      
      for (const pos of allPositions) {
        try {
          const quantity = parseFloat(pos.quantity?.toString() || '0');
          const costPrice = parseFloat(pos.costPrice?.toString() || pos.cost_price?.toString() || '0');
          const availableQuantity = parseFloat(pos.availableQuantity?.toString() || pos.available_quantity?.toString() || '0');
          
          // 如果没有当前价格，使用成本价作为占位符（后续会通过行情API更新）
          const lastPrice = parseFloat(pos.lastPrice?.toString() || pos.last_price?.toString() || costPrice);
          const marketValue = parseFloat(pos.marketValue?.toString() || pos.market_value?.toString() || (quantity * lastPrice));
          const unrealizedPl = parseFloat(pos.unrealizedPl?.toString() || pos.unrealized_pl?.toString() || '0');
          const unrealizedPlRatio = parseFloat(pos.unrealizedPlRatio?.toString() || pos.unrealized_pl_ratio?.toString() || '0');
          
          await pool.query(
            `INSERT INTO positions (
              symbol, symbol_name, quantity, available_quantity, 
              cost_price, current_price, market_value, 
              unrealized_pl, unrealized_pl_ratio, currency, position_side,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (symbol) DO UPDATE SET
              symbol_name = EXCLUDED.symbol_name,
              quantity = EXCLUDED.quantity,
              available_quantity = EXCLUDED.available_quantity,
              cost_price = EXCLUDED.cost_price,
              current_price = EXCLUDED.current_price,
              market_value = EXCLUDED.market_value,
              unrealized_pl = EXCLUDED.unrealized_pl,
              unrealized_pl_ratio = EXCLUDED.unrealized_pl_ratio,
              currency = EXCLUDED.currency,
              position_side = EXCLUDED.position_side,
              updated_at = NOW()`,
            [
              pos.symbol,
              pos.symbolName || pos.symbol_name || '',
              quantity,
              availableQuantity,
              costPrice,
              lastPrice,
              marketValue,
              unrealizedPl,
              unrealizedPlRatio,
              pos.currency || 'USD',
              pos.positionSide || pos.position_side || 'Long',
            ]
          );
          
          positionsSynced++;
        } catch (posError) {
          logger.error(`同步持仓 ${pos.symbol} 失败:`, posError);
        }
      }
    } catch (posSyncError) {
      logger.error('同步持仓数据失败:', posSyncError);
    }
    
    res.json({
      success: true,
      data: {
        ordersSynced: syncedCount,
        detailsSynced: detailSyncedCount,
        positionsSynced: positionsSynced,
        message: `已同步 ${syncedCount} 个订单状态，${detailSyncedCount} 个订单详情，${positionsSynced} 个持仓`,
      },
    });
  } catch (error: any) {
    logger.error('同步订单状态和持仓失败:', error);
    
    // 处理频率限制错误
    if (error.message && (error.message.includes('429') || error.message.includes('429002'))) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: 'API请求频率过高，请稍后再试。同步操作已部分完成，建议等待一段时间后重试。',
        },
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'SYNC_FAILED',
        message: error.message || '同步失败',
      },
    });
  }
});

/**
 * @openapi
 * /orders/history:
 *   get:
 *     tags:
 *       - 订单管理
 *     summary: 查询历史订单
 *     description: 查询过去90天内的订单记录
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *         description: 股票代码
 *       - in: query
 *         name: start_at
 *         schema:
 *           type: string
 *           format: date
 *         description: 开始日期 (YYYY-MM-DD)
 *       - in: query
 *         name: end_at
 *         schema:
 *           type: string
 *           format: date
 *         description: 结束日期 (YYYY-MM-DD)
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
 *                     orders:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Order'
 *                     hasMore:
 *                       type: boolean
 *                       description: 是否还有更多数据
 */
ordersRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const { symbol, status, side, market, start_at, end_at } = req.query;

    const tradeCtx = await getTradeContext();
    
    // 构建查询选项（SDK格式，使用枚举值）
    const options: any = {};
    
    if (symbol) {
      options.symbol = symbol as string;
    }
    
    if (status) {
      // status可以是逗号分隔的字符串，如："Filled,New" 或数组
      const statusList = typeof status === 'string' 
        ? status.split(',').map(s => s.trim())
        : Array.isArray(status) ? status.map(s => String(s)) : [];
      
      // 转换为OrderStatus枚举值数组
      const statusEnums = statusList
        .map((s: string) => parseOrderStatus(String(s)))
        .filter((s: any): s is any => s !== undefined);
      
      if (statusEnums.length > 0) {
        options.status = statusEnums;
      }
    }
    
    if (side) {
      // 使用OrderSide枚举值
      const sideStr = String(side);
      options.side = sideStr === 'Buy' || sideStr === 'buy' ? OrderSide.Buy : OrderSide.Sell;
    }
    
    if (market) {
      // 使用Market枚举值
      const marketStr = String(market);
      options.market = marketStr === 'US' || marketStr === 'us' ? Market.US : Market.HK;
    }
    
    if (start_at) {
      // SDK需要Date对象
      try {
        options.startAt = parseDate(start_at);
      } catch (error: any) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DATE_FORMAT',
            message: `无效的开始时间格式: ${start_at}`,
          },
        });
      }
    }
    
    if (end_at) {
      // SDK需要Date对象
      try {
        options.endAt = parseDate(end_at);
      } catch (error: any) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DATE_FORMAT',
            message: `无效的结束时间格式: ${end_at}`,
          },
        });
      }
    }
    
    // 调用SDK查询历史订单
    // 参考官方示例：ctx.historyOrders({ symbol: "700.HK", status: [OrderStatus.Filled, OrderStatus.New], ... })
    const orders = await tradeCtx.historyOrders(options);
    
    // 使用统一映射函数
    const mappedOrders = orders.map(mapOrderData);
    
    res.json({
      success: true,
      data: {
        orders: mappedOrders,
        // 注意：SDK返回的是Order[]数组，没有hasMore字段
        // 如果需要分页，需要根据返回数量判断（每次最多1000条）
        hasMore: orders.length >= 1000,
      },
    });
  } catch (error: any) {
    logger.error('查询历史订单失败:', error);
    
    // 处理频率限制错误
    if (error.message && (error.message.includes('429') || error.message.includes('429002'))) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: 'API请求频率过高，请稍后再试。',
        },
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'QUERY_HISTORY_ORDERS_FAILED',
        message: error.message || '查询历史订单失败',
      },
    });
  }
});

/**
 * @openapi
 * /orders/today:
 *   get:
 *     tags:
 *       - 订单管理
 *     summary: 查询今日订单
 *     description: 获取当天的所有订单记录
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *         description: 股票代码
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: 订单状态过滤 (e.g. "Filled,New")
 *       - in: query
 *         name: side
 *         schema:
 *           type: string
 *           enum: [Buy, Sell]
 *         description: 交易方向
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
 *                     orders:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Order'
 */
ordersRouter.get('/today', async (req: Request, res: Response) => {
  try {
    const { symbol, status, side, market, order_id } = req.query;

    const tradeCtx = await getTradeContext();
    
    // 构建查询选项（SDK格式，使用枚举值）
    const options: any = {};
    
    if (symbol) {
      options.symbol = symbol as string;
    }
    
    if (status) {
      // status可以是逗号分隔的字符串，如："Filled,New" 或数组
      const statusList = typeof status === 'string' 
        ? status.split(',').map(s => s.trim())
        : Array.isArray(status) ? status.map(s => String(s)) : [];
      
      // 转换为OrderStatus枚举值数组
      const statusEnums = statusList
        .map((s: string) => parseOrderStatus(String(s)))
        .filter((s: any): s is any => s !== undefined);
      
      if (statusEnums.length > 0) {
        options.status = statusEnums;
      }
    }
    
    if (side) {
      // 使用OrderSide枚举值
      const sideStr = String(side);
      options.side = sideStr === 'Buy' || sideStr === 'buy' ? OrderSide.Buy : OrderSide.Sell;
    }
    
    if (market) {
      // 使用Market枚举值
      const marketStr = String(market);
      options.market = marketStr === 'US' || marketStr === 'us' ? Market.US : Market.HK;
    }
    
    if (order_id) {
      options.orderId = String(order_id);
    }

    // 调用SDK查询今日订单
    // 参考官方示例：ctx.todayOrders({ symbol: "700.HK", status: [OrderStatus.Filled, OrderStatus.New], ... })
    const orders = await tradeCtx.todayOrders(options);
    
    // 使用统一映射函数（移除数据库同步逻辑）
    const mappedOrders = orders.map(mapOrderData);
    
    res.json({
      success: true,
      data: {
        orders: mappedOrders,
      },
    });
  } catch (error: any) {
    logger.error('查询今日订单失败:', error);
    
    // 处理频率限制错误
    if (error.message && (error.message.includes('429') || error.message.includes('429002'))) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: 'API请求频率过高，请稍后再试。建议减少刷新频率或等待一段时间后重试。',
        },
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'QUERY_TODAY_ORDERS_FAILED',
        message: error.message || '查询今日订单失败',
      },
    });
  }
});

/**
 * @openapi
 * /orders/submit:
 *   post:
 *     tags:
 *       - 订单管理
 *     summary: 提交交易订单
 *     description: 创建新的买入或卖出委托
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - symbol
 *               - side
 *               - order_type
 *               - submitted_quantity
 *             properties:
 *               symbol:
 *                 type: string
 *                 description: 股票代码 (e.g. 700.HK)
 *                 example: "700.HK"
 *               side:
 *                 type: string
 *                 enum: [Buy, Sell]
 *                 description: 交易方向
 *                 example: "Buy"
 *               order_type:
 *                 type: string
 *                 enum: [LO, MO, ELO, AO, ALO]
 *                 description: 订单类型 (LO=限价单, MO=市价单)
 *                 example: "LO"
 *               submitted_quantity:
 *                 type: string
 *                 description: 委托数量
 *                 example: "100"
 *               submitted_price:
 *                 type: string
 *                 description: 委托价格 (限价单必填)
 *                 example: "350.20"
 *               time_in_force:
 *                 type: string
 *                 enum: [Day, GTC, GTD]
 *                 description: 订单有效期
 *                 default: Day
 *               remark:
 *                 type: string
 *                 description: 订单备注
 *     responses:
 *       201:
 *         description: 订单提交成功
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
 *                     orderId:
 *                       type: string
 *                       description: 系统生成的订单ID
 *                     status:
 *                       type: string
 *                       description: 初始状态
 *       400:
 *         description: 参数错误 (如最小交易单位不符)
 */
ordersRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    // ✅ 架构改进：使用统一订单提交服务
    // 确保手动下单和量化下单使用相同的逻辑
    const submitResult = await orderSubmissionService.submitOrder(req.body);

    if (!submitResult.success) {
      return res.status(400).json({
        success: false,
        error: submitResult.error,
      });
    }

    const normalizedParams = normalizeOrderParams(req.body);

    // 保存交易记录到数据库
    const tradeRecord = await pool.query(
      `INSERT INTO trades (symbol, side, quantity, price, status, order_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [
        normalizedParams.symbol,
        normalizedParams.side.toUpperCase(),
        parseInt(normalizedParams.submitted_quantity),
        normalizedParams.submitted_price || null,
        'PENDING', // 初始状态为待处理
        submitResult.orderId || null,
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        orderId: submitResult.orderId,
        status: submitResult.status,
        trade: tradeRecord.rows[0],
      },
    });
  } catch (error: any) {
    logger.error('提交订单失败:', error);
    
    // 尝试保存失败的交易记录
    try {
      const normalizedParams = normalizeOrderParams(req.body);
      await pool.query(
        `INSERT INTO trades (symbol, side, quantity, price, status, error_message, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [
          normalizedParams.symbol || 'UNKNOWN',
          normalizedParams.side?.toUpperCase() || 'UNKNOWN',
          parseInt(normalizedParams.submitted_quantity) || 0,
          normalizedParams.submitted_price || null,
          'FAILED',
          error.message || 'Unknown error',
        ]
      );
    } catch (dbError) {
      logger.error('保存失败交易记录时出错:', dbError);
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'ORDER_SUBMIT_FAILED',
        message: error.message || '提交订单失败',
      },
    });
  }
});

/**
 * GET /api/orders/security-info
 * 获取标的基础信息（包含最小交易单位lot size）
 */
ordersRouter.get('/security-info', async (req: Request, res: Response) => {
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

    // 获取 QuoteContext
    const quoteCtx = await getQuoteContext();
    
    // 调用 SDK 获取标的基础信息
    const staticInfoList = await quoteCtx.staticInfo([symbol as string]);
    
    if (!staticInfoList || staticInfoList.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SECURITY_NOT_FOUND',
          message: `未找到标的: ${symbol}`,
        },
      });
    }

    const staticInfo = staticInfoList[0];

    // 返回响应
    res.json({
      success: true,
      data: {
        symbol: staticInfo.symbol,
        name_cn: staticInfo.nameCn,
        name_en: staticInfo.nameEn,
        name_hk: staticInfo.nameHk,
        lot_size: staticInfo.lotSize,
        currency: staticInfo.currency,
        exchange: staticInfo.exchange,
      },
    });
  } catch (error: any) {
    logger.error('获取标的基础信息失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SECURITY_INFO_FAILED',
        message: error.message || '获取标的基础信息失败',
      },
    });
  }
});

/**
 * GET /api/orders/estimate-max-quantity
 * 预估最大购买数量
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/order/estimate_available_buy_limit
 */
ordersRouter.get('/estimate-max-quantity', async (req: Request, res: Response) => {
  try {
    const { symbol, order_type, side, price, currency, order_id, use_margin } = req.query;

    // 参数验证
    if (!symbol || !order_type || !side) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: symbol, order_type, side',
        },
      });
    }

    // 验证订单类型
    const validOrderTypes = ['LO', 'ELO', 'MO', 'AO', 'ALO', 'ODD', 'LIT', 'MIT', 'TSLPAMT', 'TSLPPCT', 'SLO'];
    if (!validOrderTypes.includes(order_type as string)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ORDER_TYPE',
          message: `无效的订单类型: ${order_type}`,
        },
      });
    }

    // 验证交易方向
    if (side !== 'Buy' && side !== 'Sell') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SIDE',
          message: '无效的交易方向。必须是 Buy 或 Sell',
        },
      });
    }

    // 获取 TradeContext
    const tradeCtx = await getTradeContext();

    // 转换订单类型
    const orderTypeEnum = OrderType[order_type as keyof typeof OrderType];
    if (orderTypeEnum === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ORDER_TYPE',
          message: `无效的订单类型: ${order_type}`,
        },
      });
    }

    // 转换交易方向
    const sideEnum = OrderSide[side as keyof typeof OrderSide];
    if (sideEnum === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SIDE',
          message: `无效的交易方向: ${side}`,
        },
      });
    }

    // 构建请求参数
    const options: any = {
      symbol: symbol as string,
      orderType: orderTypeEnum,
      side: sideEnum,
    };

    // 可选参数
    if (price) {
      options.price = new Decimal(price as string);
    }
    if (currency) {
      options.currency = currency as string;
    }
    if (order_id) {
      options.orderId = order_id as string;
    }

    // 调用 SDK
    const response = await tradeCtx.estimateMaxPurchaseQuantity(options);

    // 根据是否使用融资返回相应的最大数量
    const useMargin = use_margin === 'true' || use_margin === '1';
    const maxQty = useMargin 
      ? (response.marginMaxQty?.toString() || '0')
      : (response.cashMaxQty?.toString() || '0');

    // 返回响应
    res.json({
      success: true,
      data: {
        cash_max_qty: response.cashMaxQty?.toString() || '0',
        margin_max_qty: response.marginMaxQty?.toString() || '0',
        max_qty: maxQty, // 根据use_margin参数返回的最大数量
        use_margin: useMargin,
      },
    });
  } catch (error: any) {
    logger.error('预估最大购买数量失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ESTIMATE_FAILED',
        message: error.message || '预估最大购买数量失败',
      },
    });
  }
});

/**
 * PUT /api/orders/:orderId
 * 修改订单（必须在GET和DELETE之前，因为都是/:orderId）
 */
ordersRouter.put('/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { quantity, price } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少订单ID',
        },
      });
    }

    // 至少需要提供一个修改参数
    if (quantity === undefined && price === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '至少需要提供 quantity 或 price 参数',
        },
      });
    }

    const tradeCtx = await getTradeContext();
    
    // 构建修改选项
    const replaceOptions: any = {
      orderId: orderId,
    };

    if (quantity !== undefined) {
      const quantityNum = parseInt(quantity);
      if (isNaN(quantityNum) || quantityNum <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUANTITY',
            message: '无效的数量。必须是大于0的整数',
          },
        });
      }
      // ⚠️ 修复：LongPort replaceOrder.quantity 需要 Decimal
      replaceOptions.quantity = new Decimal(quantityNum.toString());
    }

    if (price !== undefined) {
      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PRICE',
            message: '无效的价格。必须是大于0的数字',
          },
        });
      }
      replaceOptions.price = new Decimal(priceNum.toString());
    }

    logger.info('修改订单参数:', JSON.stringify(replaceOptions, null, 2));

    // 调用replaceOrder API
    await longportRateLimiter.execute(() =>
      // LongPort SDK typings are `any` in this repo; explicitly pin type to avoid `unknown` inference
      retryWithBackoff<any>(() => tradeCtx.replaceOrder(replaceOptions) as any)
    );

    // 更新数据库中的订单记录
    try {
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (quantity !== undefined) {
        updateFields.push(`quantity = $${paramIndex++}`);
        updateValues.push(parseInt(quantity));
      }
      if (price !== undefined) {
        updateFields.push(`price = $${paramIndex++}`);
        updateValues.push(parseFloat(price));
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(orderId);

      await pool.query(
        `UPDATE trades 
         SET ${updateFields.join(', ')} 
         WHERE order_id = $${paramIndex}`,
        updateValues
      );
    } catch (dbError) {
      logger.error('更新数据库订单记录失败:', dbError);
      // 不返回错误，因为订单已经修改成功
    }

    res.json({
      success: true,
      data: {
        message: '订单已修改',
        orderId: orderId,
      },
    });
  } catch (error: any) {
    logger.error('修改订单失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REPLACE_ORDER_FAILED',
        message: error.message || '修改订单失败',
      },
    });
  }
});

/**
 * @openapi
 * /orders/{orderId}:
 *   get:
 *     tags:
 *       - 订单管理
 *     summary: 查询订单详情
 *     description: 根据订单ID获取单笔订单的详细信息
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: 订单ID
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
 *                     order:
 *                       $ref: '#/components/schemas/Order'
 *       404:
 *         description: 订单不存在
 */
ordersRouter.get('/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少订单ID',
        },
      });
    }

    const tradeCtx = await getTradeContext();
    
    // 调用SDK查询订单详情
    // 参考官方示例：ctx.orderDetail("701276261045858304")
    const orderDetail = await tradeCtx.orderDetail(orderId);
    
    // 使用统一映射函数
    const mappedOrder = mapOrderData(orderDetail);

    res.json({
      success: true,
      data: {
        order: mappedOrder,
      },
    });
  } catch (error: any) {
    logger.error('查询订单详情失败:', error);
    
    // 处理订单不存在错误
    if (error.message && (error.message.includes('602023') || error.message.includes('not found'))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: '订单不存在或已过期',
        },
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'QUERY_ORDER_DETAIL_FAILED',
        message: error.message || '查询订单详情失败',
      },
    });
  }
});

/**
 * @openapi
 * /orders/{orderId}:
 *   delete:
 *     tags:
 *       - 订单管理
 *     summary: 撤销订单
 *     description: 取消一笔未完全成交的订单
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: 订单ID
 *     responses:
 *       200:
 *         description: 撤单指令提交成功
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
 *                     message:
 *                       type: string
 *                       example: 订单已取消
 *       500:
 *         description: 撤单失败
 */
ordersRouter.delete('/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少订单ID',
        },
      });
    }

    const tradeCtx = await getTradeContext();
    await tradeCtx.cancelOrder(orderId);

    // 更新数据库中的交易记录状态
    await pool.query(
      `UPDATE trades SET status = $1, updated_at = NOW() WHERE order_id = $2`,
      ['CANCELLED', orderId]
    );

    res.json({
      success: true,
      data: {
        message: '订单已取消',
      },
    });
  } catch (error: any) {
    logger.error('取消订单失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CANCEL_ORDER_FAILED',
        message: error.message || '取消订单失败',
      },
    });
  }
});
