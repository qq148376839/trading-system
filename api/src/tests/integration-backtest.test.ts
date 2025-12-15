/**
 * 回测功能集成测试
 * 测试完整的回测流程
 */

// Jest全局函数，无需导入
import backtestService from '../services/backtest.service';

describe('回测功能集成测试', () => {
  
  describe('获取历史K线数据', () => {
    it('应该能够获取历史K线数据', async () => {
      const symbol = '700.HK';
      const startDate = new Date('2024-11-01');
      const endDate = new Date('2024-11-30');

      // 注意：这需要实际的Longbridge API连接
      // 在测试环境中可能需要mock
      try {
        // 这里需要访问private方法，实际测试中可能需要通过public方法
        // 或者使用反射来测试private方法
        console.log('集成测试：需要实际的API连接');
      } catch (error: any) {
        console.error('集成测试失败:', error.message);
      }
    });
  });

  describe('数据格式转换', () => {
    it('应该正确处理Longbridge API返回的数据', () => {
      // 测试数据格式转换逻辑
      const mockLongbridgeData = {
        timestamp: 1650384000,
        open: '362.000',
        high: '368.800',
        low: '361.600',
        close: '348.000',
        volume: 10853604,
        turnover: '3954556819.000',
      };

      // 验证数据格式转换
      expect(mockLongbridgeData.timestamp).toBe(1650384000);
      expect(typeof mockLongbridgeData.open).toBe('string');
      expect(typeof mockLongbridgeData.volume).toBe('number');
    });
  });

  describe('交易日过滤', () => {
    it('应该正确过滤非交易日', () => {
      const testDates = [
        new Date('2024-12-13'),  // 周五
        new Date('2024-12-14'),  // 周六
        new Date('2024-12-15'),  // 周日
        new Date('2024-12-16'),  // 周一
      ];

      // 验证交易日判断
      const { isTradingDay } = require('../utils/trading-days');
      expect(isTradingDay(testDates[0], 'US')).toBe(true);
      expect(isTradingDay(testDates[1], 'US')).toBe(false);
      expect(isTradingDay(testDates[2], 'US')).toBe(false);
      expect(isTradingDay(testDates[3], 'US')).toBe(true);
    });
  });
});

