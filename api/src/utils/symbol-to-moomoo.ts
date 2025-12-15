/**
 * Symbol到Moomoo API参数的转换工具
 * 将Longbridge格式的symbol（如"700.HK", "AAPL.US"）转换为Moomoo API所需的参数
 */

/**
 * Symbol到Moomoo参数的映射
 * 注意：这个映射表需要根据实际情况维护和扩展
 */
const SYMBOL_TO_MOOMOO_MAP: Record<string, {
  stockId: string;
  marketId: string;
  marketCode: string;
  instrumentType: string;
  subInstrumentType: string;
}> = {
  // 美股示例（需要根据实际情况补充）
  // 'AAPL.US': {
  //   stockId: '201335',
  //   marketId: '2',
  //   marketCode: '11',
  //   instrumentType: '3',
  //   subInstrumentType: '3002',
  // },
  // 港股示例（需要根据实际情况补充）
  // '700.HK': {
  //   stockId: '700',
  //   marketId: '1',
  //   marketCode: '1',
  //   instrumentType: '3',
  //   subInstrumentType: '3002',
  // },
};

/**
 * 将Longbridge格式的symbol转换为Moomoo API参数
 * @param symbol Longbridge格式的symbol（如"700.HK", "AAPL.US"）
 * @returns Moomoo API参数，如果找不到则返回null
 */
export function symbolToMoomooParams(symbol: string): {
  stockId: string;
  marketId: string;
  marketCode: string;
  instrumentType: string;
  subInstrumentType: string;
} | null {
  // 先检查映射表
  if (SYMBOL_TO_MOOMOO_MAP[symbol]) {
    return SYMBOL_TO_MOOMOO_MAP[symbol];
  }

  // 尝试解析symbol格式
  // 格式：SYMBOL.MARKET（如"700.HK", "AAPL.US"）
  const parts = symbol.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [stockSymbol, market] = parts;
  
  // 根据市场类型设置默认参数
  // 注意：这只是示例，实际使用时需要通过搜索API获取准确的stockId
  if (market === 'US') {
    // 美股默认参数（需要实际stockId）
    return null; // 无法自动转换，需要搜索API
  } else if (market === 'HK') {
    // 港股：stockId通常是数字代码
    const stockId = stockSymbol;
    return {
      stockId: stockId,
      marketId: '1',  // 港股市场ID
      marketCode: '1',  // 港股marketCode
      instrumentType: '3',  // 股票
      subInstrumentType: '3002',  // 普通股票
    };
  } else if (market === 'SH' || market === 'SZ') {
    // A股
    return {
      stockId: stockSymbol,
      marketId: market === 'SH' ? '3' : '4',  // 上海/深圳
      marketCode: market === 'SH' ? '1' : '2',
      instrumentType: '3',
      subInstrumentType: '3002',
    };
  }

  return null;
}

/**
 * 检查symbol是否支持Moomoo降级
 * @param symbol Longbridge格式的symbol
 * @returns 是否支持Moomoo降级
 */
export function isMoomooFallbackSupported(symbol: string): boolean {
  const params = symbolToMoomooParams(symbol);
  return params !== null;
}

