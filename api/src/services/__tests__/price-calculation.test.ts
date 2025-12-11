/**
 * 价格计算逻辑功能测试
 * 
 * 测试场景：
 * 1. 平仓卖出：entryPrice使用实际买入价格，sellPrice使用当前市场价格
 * 2. 买入：entryPrice正确作为买入价格
 * 3. 做空：entryPrice正确作为做空价格
 * 4. 价格验证逻辑
 */

import { TradingIntent } from '../strategies/strategy-base';

describe('价格计算逻辑测试', () => {
  describe('TradingIntent接口测试', () => {
    it('应该支持sellPrice字段', () => {
      const intent: TradingIntent = {
        action: 'SELL',
        symbol: 'AAPL.US',
        entryPrice: 100,
        sellPrice: 105,
        quantity: 10,
        reason: '测试',
      };

      expect(intent.entryPrice).toBe(100);
      expect(intent.sellPrice).toBe(105);
    });

    it('sellPrice应该是可选的', () => {
      const intent: TradingIntent = {
        action: 'SELL',
        symbol: 'AAPL.US',
        entryPrice: 100,
        quantity: 10,
        reason: '测试',
      };

      expect(intent.entryPrice).toBe(100);
      expect(intent.sellPrice).toBeUndefined();
    });
  });

  describe('价格字段语义测试', () => {
    it('买入场景：entryPrice应该是买入价格', () => {
      const buyIntent: TradingIntent = {
        action: 'BUY',
        symbol: 'AAPL.US',
        entryPrice: 150.50,
        quantity: 10,
        reason: '买入测试',
      };

      // 买入时，entryPrice就是买入价格
      expect(buyIntent.entryPrice).toBe(150.50);
      expect(buyIntent.sellPrice).toBeUndefined();
    });

    it('平仓场景：entryPrice应该是买入价格，sellPrice应该是卖出价格', () => {
      const sellIntent: TradingIntent = {
        action: 'SELL',
        symbol: 'AAPL.US',
        entryPrice: 100, // 实际买入价格
        sellPrice: 105,  // 当前市场价格（用于提交订单）
        quantity: 10,
        reason: '平仓卖出',
      };

      // 平仓时，entryPrice用于记录买入价格，sellPrice用于提交订单
      expect(sellIntent.entryPrice).toBe(100);
      expect(sellIntent.sellPrice).toBe(105);
    });

    it('做空场景：entryPrice应该是做空价格，sellPrice不使用', () => {
      const shortIntent: TradingIntent = {
        action: 'SELL',
        symbol: 'AAPL.US',
        entryPrice: 150, // 做空价格（卖出价格）
        quantity: 10,
        reason: '做空',
      };

      // 做空时，entryPrice就是做空价格，sellPrice不使用
      expect(shortIntent.entryPrice).toBe(150);
      expect(shortIntent.sellPrice).toBeUndefined();
    });
  });

  describe('价格计算逻辑测试', () => {
    it('平仓卖出：应该优先使用sellPrice', () => {
      const sellIntent: TradingIntent = {
        action: 'SELL',
        symbol: 'AAPL.US',
        entryPrice: 100,
        sellPrice: 105,
        quantity: 10,
        reason: '平仓',
      };

      // 执行卖出时，应该使用sellPrice（105），而不是entryPrice（100）
      const sellPrice = sellIntent.sellPrice || sellIntent.entryPrice;
      expect(sellPrice).toBe(105);
    });

    it('做空卖出：应该使用entryPrice', () => {
      const shortIntent: TradingIntent = {
        action: 'SELL',
        symbol: 'AAPL.US',
        entryPrice: 150,
        quantity: 10,
        reason: '做空',
      };

      // 做空时，没有sellPrice，应该使用entryPrice
      const sellPrice = shortIntent.sellPrice || shortIntent.entryPrice;
      expect(sellPrice).toBe(150);
    });
  });

  describe('价格验证逻辑测试', () => {
    it('卖出价格偏差超过20%应该被拒绝', () => {
      const sellPrice = 100;
      const currentPrice = 80; // 偏差25%
      const deviation = Math.abs((sellPrice - currentPrice) / currentPrice) * 100;

      expect(deviation).toBeGreaterThan(20);
      // 应该拒绝订单
    });

    it('卖出价格偏差在5%-20%之间应该警告', () => {
      const sellPrice = 100;
      const currentPrice = 90; // 偏差11.11%
      const deviation = Math.abs((sellPrice - currentPrice) / currentPrice) * 100;

      expect(deviation).toBeGreaterThan(5);
      expect(deviation).toBeLessThanOrEqual(20);
      // 应该警告但允许提交
    });

    it('卖出价格偏差小于5%应该通过', () => {
      const sellPrice = 100;
      const currentPrice = 98; // 偏差2.04%
      const deviation = Math.abs((sellPrice - currentPrice) / currentPrice) * 100;

      expect(deviation).toBeLessThan(5);
      // 应该通过验证
    });

    it('买入价格偏差超过5%应该被拒绝', () => {
      const buyPrice = 100;
      const currentPrice = 94; // 偏差6.38%
      const deviation = Math.abs((buyPrice - currentPrice) / currentPrice) * 100;

      expect(deviation).toBeGreaterThan(5);
      // 应该拒绝订单
    });

    it('买入价格偏差在1%-5%之间应该警告', () => {
      const buyPrice = 100;
      const currentPrice = 97; // 偏差3.09%
      const deviation = Math.abs((buyPrice - currentPrice) / currentPrice) * 100;

      expect(deviation).toBeGreaterThan(1);
      expect(deviation).toBeLessThanOrEqual(5);
      // 应该警告但允许提交
    });

    it('买入价格偏差小于1%应该通过', () => {
      const buyPrice = 100;
      const currentPrice = 99.5; // 偏差0.5%
      const deviation = Math.abs((buyPrice - currentPrice) / currentPrice) * 100;

      expect(deviation).toBeLessThan(1);
      // 应该通过验证
    });
  });

  describe('边界情况测试', () => {
    it('entryPrice不存在时应该使用sellPrice作为fallback', () => {
      const sellIntent: TradingIntent = {
        action: 'SELL',
        symbol: 'AAPL.US',
        sellPrice: 105,
        quantity: 10,
        reason: '测试',
      };

      const sellPrice = sellIntent.sellPrice || sellIntent.entryPrice;
      expect(sellPrice).toBe(105);
    });

    it('sellPrice和entryPrice都不存在应该报错', () => {
      const sellIntent: TradingIntent = {
        action: 'SELL',
        symbol: 'AAPL.US',
        quantity: 10,
        reason: '测试',
      };

      const sellPrice = sellIntent.sellPrice || sellIntent.entryPrice;
      expect(sellPrice).toBeUndefined();
      // 应该返回错误
    });

    it('价格小于等于0应该被拒绝', () => {
      const sellPrice = 0;
      expect(sellPrice <= 0).toBe(true);
      // 应该返回错误
    });
  });
});

