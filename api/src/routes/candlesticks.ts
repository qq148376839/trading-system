import { Router, Request, Response, NextFunction } from 'express';
import { getQuoteContext } from '../config/longport';
import { rateLimiter } from '../middleware/rateLimiter';
import { ErrorFactory, normalizeError } from '../utils/errors';

export const candlesticksRouter = Router();

/**
 * @openapi
 * /candlesticks:
 *   get:
 *     tags:
 *       - 市场分析
 *     summary: 获取 K 线数据
 *     description: 获取指定标的的 K 线数据
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: 标的代码 (e.g. 700.HK)
 *       - in: query
 *         name: period
 *         required: true
 *         schema:
 *           type: string
 *           enum: [1m, 5m, 15m, 30m, 60m, day, week, month, year]
 *         description: K线周期
 *       - in: query
 *         name: count
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *         description: K线数量
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
 *                     candlesticks:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           timestamp:
 *                             type: string
 *                           open:
 *                             type: string
 *                           high:
 *                             type: string
 *                           low:
 *                             type: string
 *                           close:
 *                             type: string
 *                           volume:
 *                             type: number
 */
candlesticksRouter.get('/', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol, period, count } = req.query;

    // 参数验证
    if (!symbol) {
      return next(ErrorFactory.missingParameter('symbol'));
    }

    if (!period) {
      return next(ErrorFactory.missingParameter('period'));
    }

    if (!count) {
      return next(ErrorFactory.missingParameter('count'));
    }

    // 验证symbol格式（支持 ticker.region 和 .ticker.region 格式）
    // 支持格式：AAPL.US, 700.HK, .SPX.US (标普500指数带前导点)
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (typeof symbol !== 'string' || !symbolPattern.test(symbol)) {
      return next(ErrorFactory.validationError('无效的标的代码格式。请使用 ticker.region 格式，例如：700.HK 或 .SPX.US'));
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
      return next(ErrorFactory.validationError(`无效的周期: ${period}。支持的周期: ${Object.keys(periodMap).join(', ')}`));
    }

    // 验证count
    const countNum = parseInt(count as string, 10);
    if (isNaN(countNum) || countNum <= 0 || countNum > 1000) {
      return next(ErrorFactory.validationError('count必须是1-1000之间的整数'));
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
      return next(ErrorFactory.validationError(`无效的周期: ${period}`));
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
    // 使用统一的错误处理（normalizeError会自动处理长桥API错误码）
    const appError = normalizeError(error);
    return next(appError);
  }
});

/**
 * Period字符串到Longbridge SDK Period枚举的映射（共用）
 */
function getPeriodEnumMap(): { stringMap: Record<string, string>; enumMap: Record<string, unknown> } {
  const longport = require('longport');
  const { Period } = longport;

  const stringMap: Record<string, string> = {
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

  const enumMap: Record<string, unknown> = {
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

  return { stringMap, enumMap };
}

/**
 * 将K线数据的timestamp统一转换为ISO字符串
 */
function normalizeTimestamp(timestamp: unknown): string {
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  if (typeof timestamp === 'number') {
    // 判断是秒级还是毫秒级时间戳
    if (timestamp > 1e12) {
      return new Date(timestamp).toISOString();
    }
    return new Date(timestamp * 1000).toISOString();
  }
  return String(timestamp);
}

/**
 * @openapi
 * /candlesticks/history:
 *   get:
 *     tags:
 *       - 市场分析
 *     summary: 获取历史 K 线数据（按偏移量）
 *     description: |
 *       使用 Longbridge SDK 的 historyCandlesticksByOffset 方法获取指定时间点的历史 K 线数据。
 *       适用于回测信号验证、历史行情回放等场景。
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: 标的代码 (e.g. TSLA.US, AAPL.US, .SPX.US)
 *       - in: query
 *         name: period
 *         required: true
 *         schema:
 *           type: string
 *           enum: [1m, 5m, 15m, 30m, 60m, day, week, month, year]
 *         description: K线周期
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 基准时间点 (ISO 8601 格式，e.g. 2025-01-15T14:30:00)
 *       - in: query
 *         name: direction
 *         required: false
 *         schema:
 *           type: string
 *           enum: [Forward, Backward]
 *           default: Backward
 *         description: 查询方向。Backward=从基准时间向历史方向，Forward=从基准时间向未来方向
 *       - in: query
 *         name: count
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *         description: K线数量
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
 *                     symbol:
 *                       type: string
 *                     period:
 *                       type: string
 *                     direction:
 *                       type: string
 *                     date:
 *                       type: string
 *                     count:
 *                       type: integer
 *                     candlesticks:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           timestamp:
 *                             type: string
 *                           open:
 *                             type: string
 *                           high:
 *                             type: string
 *                           low:
 *                             type: string
 *                           close:
 *                             type: string
 *                           volume:
 *                             type: number
 *                           turnover:
 *                             type: string
 */
candlesticksRouter.get('/history', rateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol, period, date, direction, count } = req.query;

    // ── 参数验证 ──

    if (!symbol) {
      return next(ErrorFactory.missingParameter('symbol'));
    }

    if (!period) {
      return next(ErrorFactory.missingParameter('period'));
    }

    if (!date) {
      return next(ErrorFactory.missingParameter('date'));
    }

    // 验证 symbol 格式（支持 ticker.region 和 .ticker.region 格式）
    const symbolPattern = /^\.?[A-Z0-9]+\.[A-Z]{2}$/;
    if (typeof symbol !== 'string' || !symbolPattern.test(symbol)) {
      return next(ErrorFactory.validationError(
        '无效的标的代码格式。请使用 ticker.region 格式，例如：TSLA.US 或 .SPX.US'
      ));
    }

    // 验证 period
    const { enumMap } = getPeriodEnumMap();
    const periodKey = period as string;
    const periodEnum = enumMap[periodKey];
    if (!periodEnum) {
      return next(ErrorFactory.validationError(
        `无效的周期: ${period}。支持的周期: ${Object.keys(enumMap).join(', ')}`
      ));
    }

    // 验证 date（ISO 8601 格式）
    const dateStr = date as string;
    const parsedDate = new Date(dateStr);
    if (isNaN(parsedDate.getTime())) {
      return next(ErrorFactory.validationError(
        `无效的日期格式: ${dateStr}。请使用 ISO 8601 格式，例如：2025-01-15T14:30:00`
      ));
    }

    // 验证 direction
    const directionStr = (direction as string) || 'Backward';
    if (directionStr !== 'Forward' && directionStr !== 'Backward') {
      return next(ErrorFactory.validationError(
        `无效的方向: ${directionStr}。支持的值: Forward, Backward`
      ));
    }
    const isForward = directionStr === 'Forward';

    // 验证 count
    const countNum = count ? parseInt(count as string, 10) : 100;
    if (isNaN(countNum) || countNum <= 0 || countNum > 1000) {
      return next(ErrorFactory.validationError('count 必须是 1-1000 之间的整数'));
    }

    // ── 调用 Longbridge API ──

    const quoteCtx = await getQuoteContext();
    const longport = require('longport');
    const { AdjustType, NaiveDatetime } = longport;

    // 将 JavaScript Date 转换为 NaiveDatetime（Longbridge SDK 要求的格式）
    // NaiveDatetime 构造函数：new NaiveDatetime(year, month, day, hour, minute, second)
    // 注意：month 从 1 开始（1=1月，12=12月）
    const naiveDatetime = new NaiveDatetime(
      parsedDate.getFullYear(),
      parsedDate.getMonth() + 1,
      parsedDate.getDate(),
      parsedDate.getHours(),
      parsedDate.getMinutes(),
      parsedDate.getSeconds()
    );

    const adjustType = AdjustType?.NoAdjust || 0;

    // historyCandlesticksByOffset 参数：
    // symbol, period, adjustType, forward, datetime, count
    const candlesticks = await quoteCtx.historyCandlesticksByOffset(
      symbol as string,
      periodEnum,
      adjustType,
      isForward,
      naiveDatetime,
      countNum
    );

    // ── 格式化响应 ──

    const formattedCandlesticks = (candlesticks || []).map((c: { timestamp: unknown; open: unknown; high: unknown; low: unknown; close: unknown; volume: number; turnover: unknown; tradeSession: unknown }) => ({
      timestamp: normalizeTimestamp(c.timestamp),
      open: c.open?.toString() || '0',
      high: c.high?.toString() || '0',
      low: c.low?.toString() || '0',
      close: c.close?.toString() || '0',
      volume: c.volume || 0,
      turnover: c.turnover?.toString() || '0',
      trade_session: c.tradeSession || undefined,
    }));

    res.json({
      success: true,
      data: {
        symbol,
        period: periodKey,
        direction: directionStr,
        date: dateStr,
        count: countNum,
        returned: formattedCandlesticks.length,
        candlesticks: formattedCandlesticks,
      },
    });
  } catch (error: unknown) {
    const appError = normalizeError(error);
    return next(appError);
  }
});
