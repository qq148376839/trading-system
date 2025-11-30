import { Router, Request, Response } from 'express';
import { getQuoteContext } from '../config/longport';
import { rateLimiter } from '../middleware/rateLimiter';

export const candlesticksRouter = Router();

/**
 * GET /api/candlesticks
 * 获取标的K线数据
 * 
 * 请求参数：
 * - symbol: string (必需) 标的代码，使用 ticker.region 格式，例如：700.HK
 * - period: string (必需) K线周期，支持：1m, 5m, 15m, 30m, 60m, day, week, month, year
 * - count: number (必需) 获取的K线数量
 * 
 * 响应：
 * - candlesticks: K线数据列表
 */
candlesticksRouter.get('/', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { symbol, period, count } = req.query;

    // 参数验证
    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: symbol',
        },
      });
    }

    if (!period) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: period',
        },
      });
    }

    if (!count) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: count',
        },
      });
    }

    // 验证symbol格式（支持 ticker.region 和 .ticker.region 格式）
    // 支持格式：AAPL.US, 700.HK, .SPX.US (标普500指数带前导点)
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (typeof symbol !== 'string' || !symbolPattern.test(symbol)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SYMBOL_FORMAT',
          message: '无效的标的代码格式。请使用 ticker.region 格式，例如：700.HK 或 .SPX.US',
        },
      });
    }

    // 验证period格式
    const periodMap: Record<string, string> = {
      '1m': 'Min_1',
      '5m': 'Min_5',
      '15m': 'Min_15',
      '30m': 'Min_30',
      '60m': 'Min_60',
      'day': 'Day',
      'week': 'Week',
      'month': 'Month',
      'year': 'Year',
    };

    const periodKey = period as string;
    if (!periodMap[periodKey]) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PERIOD',
          message: `无效的周期: ${period}。支持的周期: ${Object.keys(periodMap).join(', ')}`,
        },
      });
    }

    // 验证count
    const countNum = parseInt(count as string, 10);
    if (isNaN(countNum) || countNum <= 0 || countNum > 1000) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_COUNT',
          message: 'count必须是1-1000之间的整数',
        },
      });
    }

    // 调用长桥API
    const quoteCtx = await getQuoteContext();
    // 导入Period、AdjustType和TradeSessions枚举
    const longport = require('longport');
    const { Period, AdjustType, TradeSessions } = longport;
    
    // 将字符串映射转换为Period枚举值
    // 根据官方文档：Period.Min_1, Period.Day 等
    const periodEnumMap: Record<string, any> = {
      '1m': Period.Min_1,
      '5m': Period.Min_5,
      '15m': Period.Min_15,
      '30m': Period.Min_30,
      '60m': Period.Min_60,
      'day': Period.Day,
      'week': Period.Week,
      'month': Period.Month,
      'year': Period.Year,
    };

    const periodEnum = periodEnumMap[periodKey];
    if (!periodEnum) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PERIOD',
          message: `无效的周期: ${period}`,
        },
      });
    }

    // candlesticks方法参数：
    // symbol (string), period (Period), count (number), adjustType (AdjustType), tradeSessions (TradeSessions)
    // AdjustType.NoAdjust = 不复权，AdjustType.ForwardAdjust = 前复权
    // TradeSessions.Normal = 正常交易时段，TradeSessions.All = 所有交易时段（包括盘前盘后夜盘）
    // 使用TradeSessions.All获取所有交易时段的数据，包括盘前、盘中、盘后、夜盘
    const adjustType = AdjustType?.NoAdjust || 0; // 如果AdjustType不存在，使用0（NoAdjust）
    const tradeSessions = TradeSessions?.All || 100; // 使用All获取所有交易时段的数据
    
    const candlesticks = await quoteCtx.candlesticks(
      symbol as string, 
      periodEnum, 
      countNum, 
      adjustType,
      tradeSessions
    );

    // 返回结果
    // 注意：timestamp可能是Date对象或时间戳，需要统一处理
    res.json({
      success: true,
      data: {
        symbol,
        period,
        count: countNum,
        candlesticks: candlesticks.map(c => {
          // 处理timestamp：可能是Date对象、时间戳（秒或毫秒）或ISO字符串
          let timestamp: string | number;
          if (c.timestamp instanceof Date) {
            timestamp = c.timestamp.toISOString();
          } else if (typeof c.timestamp === 'number') {
            // 如果是时间戳，判断是秒还是毫秒
            if (c.timestamp > 1e12) {
              // 毫秒时间戳
              timestamp = new Date(c.timestamp).toISOString();
            } else {
              // 秒时间戳
              timestamp = new Date(c.timestamp * 1000).toISOString();
            }
          } else {
            timestamp = c.timestamp.toString();
          }
          
          return {
            timestamp: timestamp,
            open: c.open?.toString() || '0',
            high: c.high?.toString() || '0',
            low: c.low?.toString() || '0',
            close: c.close?.toString() || '0',
            volume: c.volume || 0,
            turnover: c.turnover?.toString() || '0',
            trade_session: c.tradeSession || undefined, // 交易时段信息
          };
        }),
      },
    });
  } catch (error: any) {
    console.error('获取K线数据失败:', error);

    // 处理长桥API错误
    if (error.code === '301600') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: '无效的请求参数',
        },
      });
    }

    if (error.code === '301606') {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: '请求频率过高，请稍后重试',
        },
      });
    }

    // 其他错误
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '服务器内部错误',
      },
    });
  }
});

