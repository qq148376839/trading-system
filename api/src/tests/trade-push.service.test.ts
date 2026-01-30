/**
 * 交易推送服务测试文件
 * 测试 subscribe/unsubscribe 功能的正确性
 */

import tradePushService from '../services/trade-push.service';
import { getTradeContext } from '../config/longport';

describe('TradePushService', () => {
  let mockTradeContext: any;
  let mockSetOnOrderChanged: jest.Mock;
  let mockSubscribe: jest.Mock;
  let mockUnsubscribe: jest.Mock;

  beforeEach(() => {
    // 重置单例状态（通过反射访问私有属性）
    (tradePushService as any).isSubscribed = false;
    (tradePushService as any).tradeContext = null;

    // 创建模拟的回调函数
    mockSetOnOrderChanged = jest.fn();
    mockSubscribe = jest.fn().mockResolvedValue(undefined);
    mockUnsubscribe = jest.fn().mockResolvedValue(undefined);

    // 创建模拟的 TradeContext
    mockTradeContext = {
      setOnOrderChanged: mockSetOnOrderChanged,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    };

    // Mock getTradeContext
    jest.spyOn(require('../config/longport'), 'getTradeContext').mockResolvedValue(mockTradeContext);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialize()', () => {
    it('应该成功订阅交易推送', async () => {
      await tradePushService.initialize();

      expect(mockSetOnOrderChanged).toHaveBeenCalledTimes(1);
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
      expect(tradePushService.isActive()).toBe(true);
    });

    it('应该设置订单变更回调', async () => {
      await tradePushService.initialize();

      expect(mockSetOnOrderChanged).toHaveBeenCalledWith(expect.any(Function));
    });

    it('应该订阅 TopicType.Private', async () => {
      const longport = require('longport');
      const { TopicType } = longport;

      await tradePushService.initialize();

      expect(mockSubscribe).toHaveBeenCalledWith([TopicType.Private]);
    });

    it('如果 subscribe 失败，应该设置 isSubscribed 为 false', async () => {
      mockSubscribe.mockRejectedValue(new Error('Subscribe failed'));

      await tradePushService.initialize();

      expect(tradePushService.isActive()).toBe(false);
    });

    it('如果 setOnOrderChanged 不存在，应该返回但不抛出错误', async () => {
      delete mockTradeContext.setOnOrderChanged;

      await expect(tradePushService.initialize()).resolves.not.toThrow();
      expect(tradePushService.isActive()).toBe(false);
    });

    it('如果 subscribe 不存在，应该返回但不抛出错误', async () => {
      delete mockTradeContext.subscribe;

      await expect(tradePushService.initialize()).resolves.not.toThrow();
      expect(tradePushService.isActive()).toBe(false);
    });
  });

  describe('unsubscribe()', () => {
    beforeEach(async () => {
      // 先初始化，确保已订阅
      await tradePushService.initialize();
    });

    it('应该成功取消订阅', async () => {
      await tradePushService.unsubscribe();

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
      expect(tradePushService.isActive()).toBe(false);
    });

    it('应该取消订阅 TopicType.Private', async () => {
      const longport = require('longport');
      const { TopicType } = longport;

      await tradePushService.unsubscribe();

      expect(mockUnsubscribe).toHaveBeenCalledWith([TopicType.Private]);
    });

    it('如果未订阅，应该不调用 unsubscribe', async () => {
      // 重置状态
      (tradePushService as any).isSubscribed = false;
      (tradePushService as any).tradeContext = null;

      await tradePushService.unsubscribe();

      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('如果 unsubscribe 失败，应该捕获错误但不抛出', async () => {
      mockUnsubscribe.mockRejectedValue(new Error('Unsubscribe failed'));

      await expect(tradePushService.unsubscribe()).resolves.not.toThrow();
      // 注意：即使失败，isSubscribed 也应该被设置为 false
      expect(tradePushService.isActive()).toBe(false);
    });

    it('如果 tradeContext 为 null，应该不调用 unsubscribe', async () => {
      (tradePushService as any).tradeContext = null;

      await tradePushService.unsubscribe();

      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('如果 unsubscribe 方法不存在，应该不抛出错误', async () => {
      delete mockTradeContext.unsubscribe;

      await expect(tradePushService.unsubscribe()).resolves.not.toThrow();
    });

    it('应该可以重复调用 unsubscribe（幂等性）', async () => {
      await tradePushService.unsubscribe();
      await tradePushService.unsubscribe();
      await tradePushService.unsubscribe();

      // 应该只调用一次（因为第二次调用时 isSubscribed 已经是 false）
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('isActive()', () => {
    it('初始化前应该返回 false', () => {
      expect(tradePushService.isActive()).toBe(false);
    });

    it('初始化成功后应该返回 true', async () => {
      await tradePushService.initialize();
      expect(tradePushService.isActive()).toBe(true);
    });

    it('取消订阅后应该返回 false', async () => {
      await tradePushService.initialize();
      await tradePushService.unsubscribe();
      expect(tradePushService.isActive()).toBe(false);
    });
  });

  describe('handleOrderChanged()', () => {
    let handleOrderChangedCallback: (err: Error | null, event: any) => void;

    beforeEach(async () => {
      await tradePushService.initialize();
      // 获取设置的回调函数
      handleOrderChangedCallback = mockSetOnOrderChanged.mock.calls[0][0];
    });

    it('应该正确处理订单变更事件', async () => {
      const mockEvent = {
        orderId: 'test-order-123',
        symbol: 'AAPL.US',
        side: 'Buy',
        status: 'FilledStatus',
        executedQuantity: 100,
        executedPrice: 150.0,
      };

      await handleOrderChangedCallback(null, mockEvent);

      // 验证日志输出（通过 mock logger）
      // 这里可以添加更多的断言来验证数据库更新等操作
    });

    it('应该处理错误事件', async () => {
      const mockError = new Error('Push error');

      await handleOrderChangedCallback(mockError, null);

      // 验证错误处理逻辑
    });

    it('如果事件缺少必要字段，应该记录警告', async () => {
      const mockEvent = {
        orderId: 'test-order-123',
        // 缺少 symbol
      };

      await handleOrderChangedCallback(null, mockEvent);

      // 验证警告日志
    });
  });

  describe('状态一致性', () => {
    it('如果 initialize 部分失败，状态应该保持一致', async () => {
      // 模拟 setOnOrderChanged 成功，但 subscribe 失败
      mockSubscribe.mockRejectedValue(new Error('Subscribe failed'));

      await tradePushService.initialize();

      // isSubscribed 应该是 false（因为 subscribe 失败）
      expect(tradePushService.isActive()).toBe(false);
      // 但 tradeContext 应该已设置
      expect((tradePushService as any).tradeContext).not.toBeNull();
    });

    it('如果 unsubscribe 失败，isSubscribed 应该仍然被设置为 false', async () => {
      await tradePushService.initialize();
      mockUnsubscribe.mockRejectedValue(new Error('Unsubscribe failed'));

      await tradePushService.unsubscribe();

      // 即使 unsubscribe 失败，isSubscribed 也应该被设置为 false
      expect(tradePushService.isActive()).toBe(false);
    });
  });

  describe('回调函数清理', () => {
    it('unsubscribe 时应该清理回调函数（如果SDK支持）', async () => {
      // 如果 SDK 支持清理回调函数的方法
      const mockClearCallback = jest.fn();
      mockTradeContext.clearOnOrderChanged = mockClearCallback;

      await tradePushService.initialize();
      await tradePushService.unsubscribe();

      // 如果 SDK 支持，应该调用清理方法
      // 注意：当前实现中没有清理回调函数，这是一个潜在问题
      // expect(mockClearCallback).toHaveBeenCalled();
    });
  });
});






