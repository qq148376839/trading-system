/**
 * 交易推送服务 unsubscribe 功能测试
 * 
 * 测试目标：
 * 1. 验证 unsubscribe 方法的正确性
 * 2. 验证状态一致性
 * 3. 验证回调函数清理
 * 4. 验证错误处理
 */

import tradePushService from '../services/trade-push.service';
import logService from '../services/log.service';
import pool from '../config/database';

// 辅助函数：访问私有属性
function getPrivateProperty(obj: any, prop: string): any {
  return (obj as any)[prop];
}

function setPrivateProperty(obj: any, prop: string, value: any): void {
  (obj as any)[prop] = value;
}

describe('TradePushService unsubscribe 功能测试', () => {
  describe('状态检查', () => {
    it('未订阅时调用 unsubscribe 应该安全返回（幂等性）', async () => {
      // 重置状态
      setPrivateProperty(tradePushService, 'isSubscribed', false);
      setPrivateProperty(tradePushService, 'tradeContext', null);

      // 应该不抛出错误
      await expect(tradePushService.unsubscribe()).resolves.not.toThrow();
      expect(tradePushService.isActive()).toBe(false);
    });

    it('已订阅时调用 unsubscribe 应该成功取消订阅', async () => {
      // 模拟已订阅状态
      setPrivateProperty(tradePushService, 'isSubscribed', true);
      setPrivateProperty(tradePushService, 'tradeContext', {
        unsubscribe: jest.fn().mockResolvedValue(undefined),
        clearOnOrderChanged: jest.fn(),
      });

      await tradePushService.unsubscribe();

      expect(tradePushService.isActive()).toBe(false);
    });
  });

  describe('错误处理', () => {
    it('unsubscribe 失败时应该设置 isSubscribed 为 false', async () => {
      // 模拟 unsubscribe 失败
      setPrivateProperty(tradePushService, 'isSubscribed', true);
      setPrivateProperty(tradePushService, 'tradeContext', {
        unsubscribe: jest.fn().mockRejectedValue(new Error('Unsubscribe failed')),
      });

      await tradePushService.unsubscribe();

      // 即使失败，isSubscribed 也应该被设置为 false
      expect(tradePushService.isActive()).toBe(false);
    });

    it('tradeContext 为 null 时应该安全处理', async () => {
      setPrivateProperty(tradePushService, 'isSubscribed', true);
      setPrivateProperty(tradePushService, 'tradeContext', null);

      await expect(tradePushService.unsubscribe()).resolves.not.toThrow();
      expect(tradePushService.isActive()).toBe(false);
    });

    it('unsubscribe 方法不存在时应该安全处理', async () => {
      setPrivateProperty(tradePushService, 'isSubscribed', true);
      setPrivateProperty(tradePushService, 'tradeContext', {
        // 没有 unsubscribe 方法
      });

      await expect(tradePushService.unsubscribe()).resolves.not.toThrow();
      expect(tradePushService.isActive()).toBe(false);
    });
  });

  describe('回调函数清理', () => {
    it('如果SDK支持 clearOnOrderChanged，应该调用清理方法', async () => {
      const mockClearCallback = jest.fn();
      setPrivateProperty(tradePushService, 'isSubscribed', true);
      setPrivateProperty(tradePushService, 'tradeContext', {
        unsubscribe: jest.fn().mockResolvedValue(undefined),
        clearOnOrderChanged: mockClearCallback,
      });

      await tradePushService.unsubscribe();

      expect(mockClearCallback).toHaveBeenCalledTimes(1);
    });

    it('如果SDK不支持 clearOnOrderChanged，应该重置回调函数', async () => {
      const mockSetOnOrderChanged = jest.fn();
      setPrivateProperty(tradePushService, 'isSubscribed', true);
      setPrivateProperty(tradePushService, 'tradeContext', {
        unsubscribe: jest.fn().mockResolvedValue(undefined),
        setOnOrderChanged: mockSetOnOrderChanged,
        // 没有 clearOnOrderChanged 方法
      });

      await tradePushService.unsubscribe();

      // 应该调用 setOnOrderChanged 设置为空函数
      expect(mockSetOnOrderChanged).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('幂等性', () => {
    it('可以重复调用 unsubscribe（幂等性）', async () => {
      const mockUnsubscribe = jest.fn().mockResolvedValue(undefined);
      setPrivateProperty(tradePushService, 'isSubscribed', true);
      setPrivateProperty(tradePushService, 'tradeContext', {
        unsubscribe: mockUnsubscribe,
      });

      // 第一次调用
      await tradePushService.unsubscribe();
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
      expect(tradePushService.isActive()).toBe(false);

      // 第二次调用（应该不调用 unsubscribe，因为 isSubscribed 已经是 false）
      await tradePushService.unsubscribe();
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1); // 仍然是1次
      expect(tradePushService.isActive()).toBe(false);
    });
  });

  // 清理异步资源
  afterAll(async () => {
    // 先停止 LogService 的定时器，避免后续访问数据库
    logService.stop();
    
    // 等待一段时间确保定时器回调完成（包括队列调整和配置检查）
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 关闭数据库连接池（这会等待所有连接关闭）
    try {
      await pool.end();
    } catch (error: any) {
      // 如果连接池已经关闭，忽略错误
      if (!error.message?.includes('pool after calling end')) {
        console.error('关闭数据库连接池失败:', error.message);
      }
    }
    
    // 再等待一小段时间确保所有异步操作完成
    await new Promise(resolve => setTimeout(resolve, 200));
  });
});

