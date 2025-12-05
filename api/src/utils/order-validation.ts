/**
 * 订单参数验证工具函数
 * 根据 Longbridge OpenAPI 文档进行参数验证
 * 参考：https://open.longbridge.com/zh-CN/docs/trade/order/submit
 */

export interface SubmitOrderRequest {
  symbol: string;
  order_type: string;
  side: string;
  submitted_quantity: string;
  submitted_price?: string;
  trigger_price?: string;
  limit_offset?: string;
  trailing_amount?: string;
  trailing_percent?: string;
  expire_date?: string;
  outside_rth?: string;
  time_in_force?: string;
  remark?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 检测市场类型（美股/港股）
 */
export function detectMarket(symbol: string): 'US' | 'HK' | 'UNKNOWN' {
  if (symbol.endsWith('.US')) {
    return 'US';
  }
  if (symbol.endsWith('.HK')) {
    return 'HK';
  }
  return 'UNKNOWN';
}

/**
 * 验证订单参数
 */
export function validateOrderParams(params: SubmitOrderRequest): ValidationResult {
  const errors: string[] = [];

  // 1. Symbol 格式验证
  const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
  if (!symbolPattern.test(params.symbol)) {
    errors.push('无效的标的代码格式。请使用 ticker.region 格式，例如：AAPL.US 或 .SPX.US');
  }

  // 2. 订单类型验证
  const validOrderTypes = [
    'LO',      // 限价单
    'ELO',     // 增强限价单
    'MO',      // 市价单
    'AO',      // 竞价市价单
    'ALO',     // 竞价限价单
    'ODD',     // 碎股单
    'LIT',     // 触价限价单
    'MIT',     // 触价市价单
    'TSLPAMT', // 跟踪止损限价单（跟踪金额）
    'TSLPPCT', // 跟踪止损限价单（跟踪涨跌幅）
    'SLO',     // 特殊限价单
  ];

  if (!validOrderTypes.includes(params.order_type)) {
    errors.push(`无效的订单类型: ${params.order_type}。支持的类型: ${validOrderTypes.join(', ')}`);
  }

  // 3. 买卖方向验证
  if (params.side !== 'Buy' && params.side !== 'Sell') {
    errors.push('无效的交易方向。必须是 Buy 或 Sell');
  }

  // 4. 数量验证
  const quantityNum = parseInt(params.submitted_quantity);
  if (isNaN(quantityNum) || quantityNum <= 0) {
    errors.push('无效的数量。必须是大于0的整数');
  }

  // 5. 限价单价格验证（需要价格的订单类型）
  const priceRequiredTypes = ['LO', 'ELO', 'ALO', 'ODD', 'SLO', 'LIT'];
  if (priceRequiredTypes.includes(params.order_type)) {
    if (!params.submitted_price || isNaN(parseFloat(params.submitted_price))) {
      errors.push(`${params.order_type} 订单需要提供有效的 submitted_price`);
    }
  }

  // 6. 条件单触发价格验证
  if (['LIT', 'MIT'].includes(params.order_type)) {
    if (!params.trigger_price || isNaN(parseFloat(params.trigger_price))) {
      errors.push(`${params.order_type} 订单需要提供有效的 trigger_price`);
    }
  }

  // 7. 跟踪止损单验证
  if (params.order_type === 'TSLPAMT') {
    if (!params.trailing_amount || isNaN(parseFloat(params.trailing_amount))) {
      errors.push('TSLPAMT 订单需要提供有效的 trailing_amount');
    }
    if (!params.limit_offset || isNaN(parseFloat(params.limit_offset))) {
      errors.push('TSLPAMT 订单需要提供有效的 limit_offset');
    }
  }

  if (params.order_type === 'TSLPPCT') {
    if (!params.trailing_percent || isNaN(parseFloat(params.trailing_percent))) {
      errors.push('TSLPPCT 订单需要提供有效的 trailing_percent');
    }
    if (!params.limit_offset || isNaN(parseFloat(params.limit_offset))) {
      errors.push('TSLPPCT 订单需要提供有效的 limit_offset');
    }
  }

  // 8. 长期单过期日期验证
  const timeInForce = params.time_in_force || 'Day';
  if (timeInForce === 'GTD') {
    if (!params.expire_date) {
      errors.push('GTD 订单需要提供 expire_date');
    } else {
      // 验证日期格式 YYYY-MM-DD
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if (!datePattern.test(params.expire_date)) {
        errors.push('expire_date 格式错误，请使用 YYYY-MM-DD 格式，例如：2025-12-31');
      } else {
        // 验证日期是否有效
        const date = new Date(params.expire_date);
        if (isNaN(date.getTime())) {
          errors.push('expire_date 不是有效的日期');
        } else {
          // 验证日期不能是过去
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (date < today) {
            errors.push('expire_date 不能是过去的日期');
          }
        }
      }
    }
  }

  // 9. 美股盘前盘后验证
  const market = detectMarket(params.symbol);
  if (market === 'US') {
    if (!params.outside_rth) {
      errors.push('美股订单需要提供 outside_rth 参数');
    } else {
      const validOutsideRth = ['RTH_ONLY', 'ANY_TIME', 'OVERNIGHT'];
      if (!validOutsideRth.includes(params.outside_rth)) {
        errors.push(`无效的 outside_rth 值。必须是以下之一: ${validOutsideRth.join(', ')}`);
      }
    }
  }

  // 10. 订单有效期验证
  const validTimeInForce = ['Day', 'GTC', 'GTD'];
  if (timeInForce && !validTimeInForce.includes(timeInForce)) {
    errors.push(`无效的 time_in_force 值。必须是以下之一: ${validTimeInForce.join(', ')}`);
  }

  // 11. 备注长度验证
  if (params.remark && params.remark.length > 64) {
    errors.push('备注长度不能超过 64 字符');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 规范化订单参数（处理兼容性）
 */
export function normalizeOrderParams(params: any): SubmitOrderRequest {
  // 处理旧的参数命名（向后兼容）
  const normalized: SubmitOrderRequest = {
    symbol: params.symbol || params.symbol,
    order_type: params.order_type || params.orderType || params.order_type,
    side: params.side || params.side,
    submitted_quantity: params.submitted_quantity || params.quantity || params.submitted_quantity,
    submitted_price: params.submitted_price || params.price,
    trigger_price: params.trigger_price || params.triggerPrice,
    limit_offset: params.limit_offset || params.limitOffset,
    trailing_amount: params.trailing_amount || params.trailingAmount,
    trailing_percent: params.trailing_percent || params.trailingPercent,
    expire_date: params.expire_date || params.expireDate,
    outside_rth: params.outside_rth || params.outsideRth,
    time_in_force: params.time_in_force || params.timeInForce || 'Day',
    remark: params.remark,
  };

  // 处理 side：支持数字枚举值
  if (typeof normalized.side === 'number') {
    normalized.side = normalized.side === 1 ? 'Buy' : normalized.side === 2 ? 'Sell' : normalized.side.toString();
  }

  // 处理 order_type：支持数字枚举值（部分）
  if (typeof normalized.order_type === 'number') {
    const orderTypeMap: Record<number, string> = {
      1: 'LO',
      2: 'AO',
      3: 'ELO',
      4: 'EAO',
    };
    normalized.order_type = orderTypeMap[normalized.order_type] || normalized.order_type.toString();
  }

  return normalized;
}


