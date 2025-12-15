/**
 * 回测历史数据优化功能测试套件
 * 测试所有已实现的功能
 */

// Jest全局函数（describe, it, expect）无需导入
import { formatLongbridgeCandlestick, formatLongbridgeCandlestickForBacktest, formatMoomooCandlestickForBacktest } from '../utils/candlestick-formatter';
import { apiRateLimiter } from '../utils/api-rate-limiter';
import { quotaMonitor } from '../utils/quota-monitor';
import { isTradingDay, getMarketFromSymbol, getTradingDays } from '../utils/trading-days';
import { symbolToMoomooParams, isMoomooFallbackSupported } from '../utils/symbol-to-moomoo';
import { simulateIntradayPrices, simulateMarketEnvironment, validateSimulatedPrices } from '../utils/market-simulation';

describe('回测历史数据优化功能测试', () => {
  
  describe('1. 数据格式转换工具', () => {
    it('应该正确转换Longbridge数据为标准格式', () => {
      const longbridgeData = {
        timestamp: 1650384000,  // 秒级时间戳
        open: '362.000',
        high: '368.800',
        low: '361.600',
        close: '348.000',
        volume: 10853604,
        turnover: '3954556819.000',
      };

      const result = formatLongbridgeCandlestick(longbridgeData);

      expect(result.timestamp).toBe(1650384000 * 1000);  // 转换为毫秒
      expect(result.open).toBe(362.0);
      expect(result.high).toBe(368.8);
      expect(result.low).toBe(361.6);
      expect(result.close).toBe(348.0);
      expect(result.volume).toBe(10853604);
      expect(result.turnover).toBe(3954556819.0);
    });

    it('应该正确转换Longbridge数据为回测格式', () => {
      const longbridgeData = {
        timestamp: 1650384000,
        open: '362.000',
        high: '368.800',
        low: '361.600',
        close: '348.000',
        volume: 10853604,
        turnover: '3954556819.000',
      };

      const result = formatLongbridgeCandlestickForBacktest(longbridgeData);

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.getTime()).toBe(1650384000 * 1000);
      expect(result.open).toBe(362.0);
      expect(result.turnover).toBe(3954556819.0);
    });

    it('应该正确转换Moomoo数据为回测格式', () => {
      const moomooData = {
        timestamp: 1275364800 * 1000,  // 毫秒时间戳
        open: 1.266654,
        high: 2.027926387,
        low: 1.16932164,
        close: 1.58865078,
        volume: 539665050,
        turnover: 0,  // Moomoo不提供turnover
      };

      const result = formatMoomooCandlestickForBacktest(moomooData);

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.open).toBe(1.266654);
      expect(result.turnover).toBe(0);
    });
  });

  describe('2. API频次限制处理', () => {
    it('应该正确记录请求', async () => {
      apiRateLimiter.reset();
      
      const initialCount = apiRateLimiter.getCurrentRequestCount();
      expect(initialCount).toBe(0);

      await apiRateLimiter.waitIfNeeded();
      const afterCount = apiRateLimiter.getCurrentRequestCount();
      expect(afterCount).toBe(1);
    });

    it('应该正确计算剩余配额', async () => {
      apiRateLimiter.reset();
      
      const remaining = apiRateLimiter.getRemainingQuota();
      expect(remaining).toBe(60);  // 最大60次
    });
  });

  describe('3. 配额监控', () => {
    it('应该正确记录查询', async () => {
      quotaMonitor.reset();
      
      await quotaMonitor.recordQuery('AAPL.US');
      await quotaMonitor.recordQuery('AAPL.US');  // 重复，应该去重
      await quotaMonitor.recordQuery('MSFT.US');

      const quota = await quotaMonitor.checkQuota(1000);
      expect(quota.currentUsage).toBe(2);  // 去重后只有2个标的
    });

    it('应该正确计算配额使用率', async () => {
      quotaMonitor.reset();
      
      await quotaMonitor.recordQuery('AAPL.US');
      const usageRate = await quotaMonitor.getUsageRate(1000);
      expect(usageRate).toBe(0.1);  // 1/1000 = 0.1%
    });
  });

  describe('4. 交易日判断', () => {
    it('应该正确判断交易日', () => {
      // 2024-12-13是周五，应该是交易日
      const friday = new Date('2024-12-13');
      expect(isTradingDay(friday, 'US')).toBe(true);

      // 2024-12-14是周六，不是交易日
      const saturday = new Date('2024-12-14');
      expect(isTradingDay(saturday, 'US')).toBe(false);

      // 2024-12-15是周日，不是交易日
      const sunday = new Date('2024-12-15');
      expect(isTradingDay(sunday, 'US')).toBe(false);
    });

    it('应该正确提取市场类型', () => {
      expect(getMarketFromSymbol('AAPL.US')).toBe('US');
      expect(getMarketFromSymbol('700.HK')).toBe('HK');
      expect(getMarketFromSymbol('000001.SH')).toBe('SH');
      expect(getMarketFromSymbol('000001.SZ')).toBe('SZ');
    });

    it('应该正确获取交易日列表', () => {
      const startDate = new Date('2024-12-09');  // 周一
      const endDate = new Date('2024-12-15');    // 周日

      const tradingDays = getTradingDays(startDate, endDate, 'US');
      
      // 应该包含5个交易日（周一到周五）
      expect(tradingDays.length).toBe(5);
      expect(tradingDays[0].getDay()).toBe(1);  // 周一
      expect(tradingDays[4].getDay()).toBe(5);  // 周五
    });
  });

  describe('5. Symbol到Moomoo参数转换', () => {
    it('应该正确转换港股symbol', () => {
      const params = symbolToMoomooParams('700.HK');
      expect(params).not.toBeNull();
      if (params) {
        expect(params.marketId).toBe('1');
        expect(params.marketCode).toBe('1');
      }
    });

    it('应该正确判断是否支持Moomoo降级', () => {
      expect(isMoomooFallbackSupported('700.HK')).toBe(true);
      expect(isMoomooFallbackSupported('UNKNOWN.SYMBOL')).toBe(false);
    });
  });

  describe('6. 市场环境模拟', () => {
    it('应该正确模拟分时价格序列', () => {
      const dailyCandle = {
        timestamp: new Date('2024-12-13'),
        open: 100,
        high: 105,
        low: 98,
        close: 102,
        volume: 1000000,
      };

      const simulatedPrices = simulateIntradayPrices(dailyCandle, 10);  // 生成10个点

      expect(simulatedPrices.length).toBe(10);
      expect(simulatedPrices[0].price).toBeCloseTo(100, 2);  // 开盘价
      expect(simulatedPrices[9].price).toBeCloseTo(102, 2);  // 收盘价
      
      // 所有价格应该在最高价和最低价范围内
      simulatedPrices.forEach(p => {
        expect(p.price).toBeGreaterThanOrEqual(98);
        expect(p.price).toBeLessThanOrEqual(105);
      });
    });

    it('应该正确验证模拟数据', () => {
      const dailyCandle = {
        timestamp: new Date('2024-12-13'),
        open: 100,
        high: 105,
        low: 98,
        close: 102,
        volume: 1000000,
      };

      const simulatedPrices = simulateIntradayPrices(dailyCandle);
      const validation = validateSimulatedPrices(simulatedPrices, dailyCandle);

      expect(validation.isValid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('应该正确模拟市场环境', () => {
      const dailyCandle = {
        timestamp: new Date('2024-12-13'),
        open: 100,
        high: 105,
        low: 98,
        close: 102,
        volume: 1000000,
      };

      const marketEnv = simulateMarketEnvironment(dailyCandle);

      expect(marketEnv.open).toBe(100);
      expect(marketEnv.high).toBe(105);
      expect(marketEnv.low).toBe(98);
      expect(marketEnv.close).toBe(102);
    });
  });

  describe('7. 边界情况处理', () => {
    it('应该处理异常数据', () => {
      const invalidData = {
        timestamp: new Date('2024-12-13'),
        open: 100,
        high: 98,  // 最高价低于最低价
        low: 105,
        close: 102,
        volume: 1000000,
      };

      const simulatedPrices = simulateIntradayPrices(invalidData);
      expect(simulatedPrices.length).toBe(0);  // 应该返回空数组
    });

    it('应该处理零价格', () => {
      const zeroPriceData = {
        timestamp: new Date('2024-12-13'),
        open: 0,
        high: 105,
        low: 98,
        close: 102,
        volume: 1000000,
      };

      const simulatedPrices = simulateIntradayPrices(zeroPriceData);
      expect(simulatedPrices.length).toBe(0);  // 应该返回空数组
    });
  });
});

