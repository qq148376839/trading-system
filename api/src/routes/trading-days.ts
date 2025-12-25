import { Router, Request, Response, NextFunction } from 'express';
import tradingDaysService from '../services/trading-days.service';
import tradingSessionService from '../services/trading-session.service';
import { getMarketFromSymbol } from '../utils/trading-days';
import { AppError, ErrorCode } from '../utils/errors';

export const tradingDaysRouter = Router();

/**
 * @openapi
 * /trading-days/is-trading-day:
 *   get:
 *     tags:
 *       - 交易日服务
 *     summary: 判断指定日期是否为交易日
 *     description: 使用Longbridge SDK获取真实交易日数据，判断指定日期是否为交易日。支持US、HK、SH、SZ市场。
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-22"
 *         description: 要查询的日期（YYYY-MM-DD格式）
 *       - in: query
 *         name: market
 *         required: false
 *         schema:
 *           type: string
 *           enum: [US, HK, SH, SZ]
 *           default: US
 *         description: 市场类型（US-美股，HK-港股，SH-上交所，SZ-深交所）
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
 *                     date:
 *                       type: string
 *                       example: "2024-12-22"
 *                     market:
 *                       type: string
 *                       example: "US"
 *                     isTradingDay:
 *                       type: boolean
 *                       example: true
 *       400:
 *         description: 请求参数错误
 *       500:
 *         description: 服务器内部错误
 */
tradingDaysRouter.get('/is-trading-day', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, market = 'US' } = req.query;

    if (!date || typeof date !== 'string') {
      return next(new AppError(
        ErrorCode.MISSING_PARAMETER,
        '日期参数必填，格式：YYYY-MM-DD',
        400
      ));
    }

    const validMarkets = ['US', 'HK', 'SH', 'SZ'];
    if (!validMarkets.includes(market as string)) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        `市场类型无效，支持：${validMarkets.join(', ')}`,
        400
      ));
    }

    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '日期格式无效，请使用 YYYY-MM-DD 格式',
        400
      ));
    }

    const isTradingDay = await tradingDaysService.isTradingDay(
      dateObj,
      market as 'US' | 'HK' | 'SH' | 'SZ'
    );

    res.json({
      success: true,
      data: {
        date,
        market,
        isTradingDay,
      },
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * @openapi
 * /trading-days/get-trading-days:
 *   get:
 *     tags:
 *       - 交易日服务
 *     summary: 获取指定日期范围内的交易日列表
 *     description: 使用Longbridge SDK获取真实交易日数据。支持日期范围超过一个月时自动分批获取。注意：API仅支持查询最近一年的数据，未来日期会自动限制到当前日期。
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-01"
 *         description: 开始日期（YYYY-MM-DD格式）
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-31"
 *         description: 结束日期（YYYY-MM-DD格式）
 *       - in: query
 *         name: market
 *         required: false
 *         schema:
 *           type: string
 *           enum: [US, HK, SH, SZ]
 *           default: US
 *         description: 市场类型（US-美股，HK-港股，SH-上交所，SZ-深交所）
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
 *                     market:
 *                       type: string
 *                       example: "US"
 *                     startDate:
 *                       type: string
 *                       example: "2024-12-01"
 *                     endDate:
 *                       type: string
 *                       example: "2024-12-31"
 *                     tradingDays:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["20241202", "20241203", "20241204"]
 *                     count:
 *                       type: number
 *                       example: 20
 *       400:
 *         description: 请求参数错误
 *       500:
 *         description: 服务器内部错误
 */
tradingDaysRouter.get('/get-trading-days', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, market = 'US' } = req.query;

    if (!startDate || typeof startDate !== 'string') {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '开始日期参数必填，格式：YYYY-MM-DD',
        400
      ));
    }

    if (!endDate || typeof endDate !== 'string') {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '结束日期参数必填，格式：YYYY-MM-DD',
        400
      ));
    }

    const validMarkets = ['US', 'HK', 'SH', 'SZ'];
    if (!validMarkets.includes(market as string)) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        `市场类型无效，支持：${validMarkets.join(', ')}`,
        400
      ));
    }

    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '日期格式无效，请使用 YYYY-MM-DD 格式',
        400
      ));
    }

    if (startDateObj > endDateObj) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '开始日期不能晚于结束日期',
        400
      ));
    }

    const tradingDaysSet = await tradingDaysService.getTradingDays(
      market as 'US' | 'HK' | 'SH' | 'SZ',
      startDateObj,
      endDateObj
    );

    // 转换为数组并排序
    const tradingDays = Array.from(tradingDaysSet).sort();

    res.json({
      success: true,
      data: {
        market,
        startDate,
        endDate,
        tradingDays,
        count: tradingDays.length,
      },
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * @openapi
 * /trading-days/get-trading-days-list:
 *   get:
 *     tags:
 *       - 交易日服务
 *     summary: 获取指定日期范围内的交易日列表（Date格式）
 *     description: 获取交易日列表，返回Date对象数组。注意：此方法目前未被实际使用，项目中主要使用 getTradingDays() 方法。
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-01"
 *         description: 开始日期（YYYY-MM-DD格式）
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-31"
 *         description: 结束日期（YYYY-MM-DD格式）
 *       - in: query
 *         name: market
 *         required: false
 *         schema:
 *           type: string
 *           enum: [US, HK, SH, SZ]
 *           default: US
 *         description: 市场类型（US-美股，HK-港股，SH-上交所，SZ-深交所）
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
 *                     market:
 *                       type: string
 *                       example: "US"
 *                     startDate:
 *                       type: string
 *                       example: "2024-12-01"
 *                     endDate:
 *                       type: string
 *                       example: "2024-12-31"
 *                     tradingDays:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: date-time
 *                       example: ["2024-12-02T00:00:00.000Z", "2024-12-03T00:00:00.000Z"]
 *                     count:
 *                       type: number
 *                       example: 20
 *       400:
 *         description: 请求参数错误
 *       500:
 *         description: 服务器内部错误
 */
tradingDaysRouter.get('/get-trading-days-list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, market = 'US' } = req.query;

    if (!startDate || typeof startDate !== 'string') {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '开始日期参数必填，格式：YYYY-MM-DD',
        400
      ));
    }

    if (!endDate || typeof endDate !== 'string') {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '结束日期参数必填，格式：YYYY-MM-DD',
        400
      ));
    }

    const validMarkets = ['US', 'HK', 'SH', 'SZ'];
    if (!validMarkets.includes(market as string)) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        `市场类型无效，支持：${validMarkets.join(', ')}`,
        400
      ));
    }

    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '日期格式无效，请使用 YYYY-MM-DD 格式',
        400
      ));
    }

    if (startDateObj > endDateObj) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        '开始日期不能晚于结束日期',
        400
      ));
    }

    const tradingDaysList = await tradingDaysService.getTradingDaysList(
      startDateObj,
      endDateObj,
      market as 'US' | 'HK' | 'SH' | 'SZ'
    );

    res.json({
      success: true,
      data: {
        market,
        startDate,
        endDate,
        tradingDays: tradingDaysList.map(date => date.toISOString()),
        count: tradingDaysList.length,
      },
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * @openapi
 * /trading-days/get-trading-sessions:
 *   get:
 *     tags:
 *       - 交易日服务
 *     summary: 获取各市场当日交易时段
 *     description: 使用Longbridge SDK获取各市场当日交易时段信息，包括常规交易时段、盘前、盘后等
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
 *                     sessions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           market:
 *                             type: string
 *                             example: "US"
 *                           tradeSession:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 begTime:
 *                                   type: number
 *                                   example: 930
 *                                 endTime:
 *                                   type: number
 *                                   example: 1600
 *                                 tradeSession:
 *                                   type: number
 *                                   example: 0
 *       500:
 *         description: 服务器内部错误
 */
tradingDaysRouter.get('/get-trading-sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = await tradingSessionService.getTradingSessions();

    res.json({
      success: true,
      data: {
        sessions,
        count: sessions.length,
      },
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * @openapi
 * /trading-days/is-in-trading-session:
 *   get:
 *     tags:
 *       - 交易日服务
 *     summary: 判断当前是否在交易时段内
 *     description: 根据市场类型和当前时间，判断是否在交易时段内
 *     parameters:
 *       - in: query
 *         name: market
 *         required: false
 *         schema:
 *           type: string
 *           enum: [US, HK, SH, SZ]
 *           default: US
 *         description: 市场类型（US-美股，HK-港股，SH-上交所，SZ-深交所）
 *       - in: query
 *         name: symbol
 *         required: false
 *         schema:
 *           type: string
 *           example: "AAPL.US"
 *         description: 标的代码（如果提供，会自动识别市场类型，忽略market参数）
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
 *                     market:
 *                       type: string
 *                       example: "US"
 *                     isInTradingSession:
 *                       type: boolean
 *                       example: true
 *                     currentTime:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: 请求参数错误
 *       500:
 *         description: 服务器内部错误
 */
tradingDaysRouter.get('/is-in-trading-session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { market = 'US', symbol } = req.query;

    let actualMarket: 'US' | 'HK' | 'SH' | 'SZ' = market as 'US' | 'HK' | 'SH' | 'SZ';
    
    // 如果提供了symbol，优先使用symbol的市场类型
    if (symbol && typeof symbol === 'string') {
      actualMarket = getMarketFromSymbol(symbol);
    }

    const validMarkets = ['US', 'HK', 'SH', 'SZ'];
    if (!validMarkets.includes(actualMarket)) {
      return next(new AppError(
        ErrorCode.VALIDATION_ERROR,
        `市场类型无效，支持：${validMarkets.join(', ')}`,
        400
      ));
    }

    const isInTradingSession = await tradingSessionService.isInTradingSession(actualMarket);
    const now = new Date();

    res.json({
      success: true,
      data: {
        market: actualMarket,
        isInTradingSession,
        currentTime: now.toISOString(),
      },
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * @openapi
 * /trading-days/clear-cache:
 *   post:
 *     tags:
 *       - 交易日服务
 *     summary: 清除交易日和交易时段缓存
 *     description: 清除交易日服务和交易时段服务的缓存，强制重新从Longbridge API获取数据
 *     responses:
 *       200:
 *         description: 缓存清除成功
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
 *                       example: "缓存已清除（交易日和交易时段）"
 *       500:
 *         description: 服务器内部错误
 */
tradingDaysRouter.post('/clear-cache', async (req: Request, res: Response, next: NextFunction) => {
  try {
    tradingDaysService.clearCache();
    tradingSessionService.clearCache();

    res.json({
      success: true,
      data: {
        message: '缓存已清除（交易日和交易时段）',
      },
    });
  } catch (error: any) {
    next(error);
  }
});

