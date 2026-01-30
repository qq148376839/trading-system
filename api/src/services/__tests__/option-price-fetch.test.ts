/**
 * 期权价格获取功能测试
 * 测试增强版的getCurrentMarketPrice方法
 */

import { jest } from '@jest/globals';

describe('期权价格获取测试', () => {
  let basicExecutionService: any;
  let mockQuoteContext: any;

  beforeEach(() => {
    // 重置模块缓存
    jest.resetModules();

    // 创建mock quote context
    mockQuoteContext = {
      quote: jest.fn(),
    };

    // Mock longport配置
    jest.mock('../../config/longport', () => ({
      getQuoteContext: jest.fn().mockResolvedValue(mockQuoteContext),
      getTradeContext: jest.fn(),
      OrderType: {},
      OrderSide: {},
      TimeInForceType: {},
      Decimal: {},
      OutsideRTH: {},
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('期权价格获取 - 使用lastDone字段', () => {
    it('应该成功获取期权的lastDone价格', async () => {
      // Mock返回数据
      mockQuoteContext.quote.mockResolvedValue([
        {
          symbol: 'QQQ260128C634000',
          lastDone: '1.25',
          bidPrice: '1.20',
          askPrice: '1.30',
        },
      ]);

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      const price = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C634000');

      expect(price).toBe(1.25);
      expect(mockQuoteContext.quote).toHaveBeenCalledWith(['QQQ260128C634000']);
    });
  });

  describe('期权价格获取 - 回退到中间价', () => {
    it('当没有lastDone时，应该使用bid-ask中间价', async () => {
      mockQuoteContext.quote.mockResolvedValue([
        {
          symbol: 'QQQ260128C635000',
          lastDone: null,
          bidPrice: '1.20',
          askPrice: '1.30',
        },
      ]);

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      const price = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C635000');

      expect(price).toBe(1.25); // (1.20 + 1.30) / 2
    });
  });

  describe('期权价格获取 - 回退到卖一价', () => {
    it('当没有lastDone和bid时，应该使用ask价格', async () => {
      mockQuoteContext.quote.mockResolvedValue([
        {
          symbol: 'QQQ260128C636000',
          lastDone: null,
          bidPrice: null,
          askPrice: '1.30',
        },
      ]);

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      const price = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C636000');

      expect(price).toBe(1.30);
    });
  });

  describe('期权价格获取 - 回退到买一价', () => {
    it('当只有bid价格时，应该使用bid价格', async () => {
      mockQuoteContext.quote.mockResolvedValue([
        {
          symbol: 'QQQ260128C637000',
          lastDone: null,
          bidPrice: '1.20',
          askPrice: null,
        },
      ]);

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      const price = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C637000');

      expect(price).toBe(1.20);
    });
  });

  describe('期权价格获取 - 价格缓存', () => {
    it('应该缓存期权价格，第二次调用使用缓存', async () => {
      mockQuoteContext.quote.mockResolvedValue([
        {
          symbol: 'QQQ260128C634000',
          lastDone: '1.25',
          bidPrice: '1.20',
          askPrice: '1.30',
        },
      ]);

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      // 第一次调用
      const price1 = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C634000');
      expect(price1).toBe(1.25);
      expect(mockQuoteContext.quote).toHaveBeenCalledTimes(1);

      // 第二次调用，应该使用缓存
      const price2 = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C634000');
      expect(price2).toBe(1.25);
      // quote方法不应该再被调用，因为使用了缓存
      expect(mockQuoteContext.quote).toHaveBeenCalledTimes(1);
    });
  });

  describe('期权价格获取 - 错误处理', () => {
    it('当API调用失败时，应该返回null', async () => {
      mockQuoteContext.quote.mockRejectedValue(new Error('API调用失败'));

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      const price = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C634000');

      expect(price).toBeNull();
    });

    it('当返回空数据时，应该返回null', async () => {
      mockQuoteContext.quote.mockResolvedValue([]);

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      const price = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C634000');

      expect(price).toBeNull();
    });

    it('当所有价格字段都无效时，应该返回null', async () => {
      mockQuoteContext.quote.mockResolvedValue([
        {
          symbol: 'QQQ260128C634000',
          lastDone: null,
          bidPrice: null,
          askPrice: null,
        },
      ]);

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      const price = await (basicExecutionService as any).getCurrentMarketPrice('QQQ260128C634000');

      expect(price).toBeNull();
    });
  });

  describe('股票价格获取 - 不使用缓存', () => {
    it('股票价格不应该使用期权缓存', async () => {
      mockQuoteContext.quote.mockResolvedValue([
        {
          symbol: 'QQQ.US',
          lastDone: '450.50',
          bidPrice: '450.45',
          askPrice: '450.55',
        },
      ]);

      const { default: BasicExecutionService } = await import('../basic-execution.service');
      basicExecutionService = new BasicExecutionService();

      // 第一次调用
      const price1 = await (basicExecutionService as any).getCurrentMarketPrice('QQQ.US');
      expect(price1).toBe(450.50);

      // 第二次调用，因为不是期权，不使用缓存
      const price2 = await (basicExecutionService as any).getCurrentMarketPrice('QQQ.US');
      expect(price2).toBe(450.50);
      expect(mockQuoteContext.quote).toHaveBeenCalledTimes(2);
    });
  });
});
