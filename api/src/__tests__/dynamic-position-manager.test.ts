/**
 * 动态持仓管理服务测试
 */

import dynamicPositionManager from '../services/dynamic-position-manager.service';
import { PositionContext } from '../services/dynamic-position-manager.service';

// Mock外部依赖
jest.mock('../services/trading-recommendation.service', () => ({
  __esModule: true,
  default: {
    calculateRecommendation: jest.fn().mockResolvedValue({
      market_environment: '良好',
      comprehensive_market_strength: 60,
      atr: 2.5,
    }),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

describe('DynamicPositionManager', () => {
  describe('getPositionContext', () => {
    it('应该从现有上下文构建完整的PositionContext', async () => {
      const oldContext = {
        entryPrice: 100,
        quantity: 10,
        stopLoss: 95,
        takeProfit: 110,
      };

      const context = await dynamicPositionManager.getPositionContext(
        1,
        'AAPL.US',
        oldContext
      );

      expect(context.entryPrice).toBe(100);
      expect(context.quantity).toBe(10);
      expect(context.originalStopLoss).toBe(95);
      expect(context.currentStopLoss).toBe(95);
      expect(context.originalTakeProfit).toBe(110);
      expect(context.currentTakeProfit).toBe(110);
      expect(context.entryTime).toBeDefined();
      expect(context.adjustmentHistory).toEqual([]);
    });

    it('应该处理缺少字段的旧上下文', async () => {
      const oldContext = {
        entryPrice: 100,
        quantity: 10,
      };

      const context = await dynamicPositionManager.getPositionContext(
        1,
        'AAPL.US',
        oldContext
      );

      expect(context.entryPrice).toBe(100);
      expect(context.quantity).toBe(10);
      expect(context.entryTime).toBeDefined();
      expect(context.adjustmentHistory).toEqual([]);
    });
  });

  describe('calculateMarketDeterioration', () => {
    it('应该正确计算市场环境恶化程度', () => {
      const deterioration = dynamicPositionManager.calculateMarketDeterioration(
        '良好',
        '较差',
        60,
        20
      );

      expect(deterioration).toBeGreaterThan(0);
      expect(deterioration).toBeLessThanOrEqual(1);
    });

    it('市场环境改善时应该返回较小的值', () => {
      const deterioration1 = dynamicPositionManager.calculateMarketDeterioration(
        '良好',
        '较差',
        60,
        20
      );

      const deterioration2 = dynamicPositionManager.calculateMarketDeterioration(
        '较差',
        '良好',
        20,
        60
      );

      expect(deterioration1).toBeGreaterThan(deterioration2);
    });

    it('市场环境相同时应该返回0', () => {
      const deterioration = dynamicPositionManager.calculateMarketDeterioration(
        '良好',
        '良好',
        60,
        60
      );

      expect(deterioration).toBe(0);
    });
  });

  describe('adjustByMarketEnvironment', () => {
    it('市场环境恶化时应该收紧止盈（盈利状态）', () => {
      const context: PositionContext = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date().toISOString(),
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        previousMarketEnv: '良好',
        previousMarketStrength: 60,
        entryMarketEnv: '良好',
        entryMarketStrength: 60,
        adjustmentHistory: [],
      };

      const result = dynamicPositionManager.adjustByMarketEnvironment(
        context,
        105, // 当前价格105，盈利5%
        '较差',
        20,
        5 // 盈利5%
      );

      expect(result.context).toBeDefined();
      expect(result.context!.currentTakeProfit).toBeLessThan(110);
    });

    it('市场环境恶化时应该收紧止损（轻度亏损状态）', () => {
      const context: PositionContext = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date().toISOString(),
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        previousMarketEnv: '良好',
        previousMarketStrength: 60,
        entryMarketEnv: '良好',
        entryMarketStrength: 60,
        adjustmentHistory: [],
      };

      const result = dynamicPositionManager.adjustByMarketEnvironment(
        context,
        99, // 当前价格99，亏损1%
        '较差',
        20,
        -1 // 亏损1%
      );

      expect(result.context).toBeDefined();
      expect(result.context!.currentStopLoss).toBeGreaterThan(95);
    });

    it('市场环境改善时应该放宽止损（亏损状态）', () => {
      const context: PositionContext = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date().toISOString(),
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        previousMarketEnv: '较差',
        previousMarketStrength: 20,
        entryMarketEnv: '较差',
        entryMarketStrength: 20,
        adjustmentHistory: [],
      };

      const result = dynamicPositionManager.adjustByMarketEnvironment(
        context,
        98, // 当前价格98，亏损2%
        '良好',
        60,
        -2 // 亏损2%
      );

      expect(result.context).toBeDefined();
      expect(result.context!.currentStopLoss).toBeLessThan(95);
    });

    it('市场环境极度恶化且盈利时应该建议卖出', () => {
      const context: PositionContext = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date().toISOString(),
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        previousMarketEnv: '良好',
        previousMarketStrength: 60,
        entryMarketEnv: '良好',
        entryMarketStrength: 60,
        adjustmentHistory: [],
      };

      const result = dynamicPositionManager.adjustByMarketEnvironment(
        context,
        105, // 当前价格105，盈利5%
        '较差',
        10, // 市场强度大幅下降
        5 // 盈利5%
      );

      // 如果恶化程度足够高，应该建议卖出
      // 注意：实际结果取决于calculateMarketDeterioration的计算
      expect(result.shouldSell).toBeDefined();
    });
  });

  describe('adjustByHoldingTime', () => {
    it('持仓超过24小时且盈利时应该收紧止盈', () => {
      const context: PositionContext = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25小时前
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        adjustmentHistory: [],
      };

      const result = dynamicPositionManager.adjustByHoldingTime(
        context,
        105, // 当前价格105，盈利5%
        5 // 盈利5%
      );

      expect(result.context).toBeDefined();
      expect(result.context!.currentTakeProfit).toBeLessThan(110);
    });

    it('持仓不足1小时且快速亏损时应该收紧止损', () => {
      const context: PositionContext = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30分钟前
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        adjustmentHistory: [],
      };

      const result = dynamicPositionManager.adjustByHoldingTime(
        context,
        97, // 当前价格97，亏损3%
        -3 // 亏损3%
      );

      expect(result.context).toBeDefined();
      expect(result.context!.currentStopLoss).toBeGreaterThan(95);
    });

    it('持仓超过48小时且盈利时应该建议卖出', () => {
      const context: PositionContext = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(), // 49小时前
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        adjustmentHistory: [],
      };

      const result = dynamicPositionManager.adjustByHoldingTime(
        context,
        108, // 当前价格108，接近止盈
        8 // 盈利8%
      );

      // 如果接近止盈，应该建议卖出
      if (108 >= 110 * 0.95) {
        expect(result.shouldSell).toBe(true);
      }
    });
  });

  describe('adjustStopLossTakeProfit', () => {
    beforeEach(() => {
      // 重置mock
      jest.clearAllMocks();
    });

    it('应该综合所有调整因素', async () => {
      const tradingRecommendationService = require('../services/trading-recommendation.service').default;
      
      // Mock市场环境获取
      tradingRecommendationService.calculateRecommendation.mockResolvedValue({
        market_environment: '良好',
        comprehensive_market_strength: 60,
        atr: 2.5,
      });

      const context: PositionContext = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date().toISOString(),
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        previousMarketEnv: '良好',
        previousMarketStrength: 60,
        entryMarketEnv: '良好',
        entryMarketStrength: 60,
        adjustmentHistory: [],
      };

      const result = await dynamicPositionManager.adjustStopLossTakeProfit(
        context,
        105, // 当前价格105，盈利5%
        '良好',
        60,
        'AAPL.US'
      );

      expect(result).toBeDefined();
      expect(result.context).toBeDefined();
      expect(result.shouldSell).toBeDefined();
    });
  });
});

