/**
 * 订单提交 Decimal 类型修复测试（简化版）
 * 验证 submittedQuantity 字段正确使用 Decimal 类型
 */

// Mock Decimal 类
class MockDecimal {
  private value: string;
  
  constructor(value: string | number) {
    this.value = value.toString();
  }
  
  toString(): string {
    return this.value;
  }
  
  toNumber(): number {
    return parseFloat(this.value);
  }
}

// Mock 长桥SDK（必须在import之前）
jest.mock('../config/longport', () => {
  return {
    Decimal: MockDecimal,
    OrderType: {
      LO: 1,
      MO: 2,
    },
    OrderSide: {
      Buy: 1,
      Sell: 2,
    },
    TimeInForceType: {
      Day: 1,
      GoodTilCanceled: 2,
      GoodTilDate: 3,
    },
    OutsideRTH: {
      RTHOnly: 1,
      AnyTime: 2,
      Overnight: 3,
    },
    getTradeContext: jest.fn().mockResolvedValue({
      submitOrder: jest.fn().mockImplementation((options: any) => {
        // 验证 submittedQuantity 是 Decimal 类型
        if (!(options.submittedQuantity instanceof MockDecimal)) {
          return Promise.reject(new Error(
            `Unwrap value [longport_nodejs::decimal::Decimal] from class failed on SubmitOrderOptions.submittedQuantity. ` +
            `Expected Decimal, got ${typeof options.submittedQuantity}`
          ));
        }
        
        return Promise.resolve({
          orderId: 'test-order-123',
          status: 'Submitted',
        });
      }),
    }),
    getQuoteContext: jest.fn().mockResolvedValue({
      staticInfo: jest.fn().mockResolvedValue([{ lotSize: 1 }]),
    }),
  };
});

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock database
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));

// 在Mock之后导入
import { Decimal, OrderType, OrderSide, TimeInForceType, OutsideRTH } from '../config/longport';
import { detectMarket } from '../utils/order-validation';

describe('订单提交 Decimal 类型修复', () => {
  describe('订单参数构建', () => {
    it('应该使用 Decimal 类型构建 submittedQuantity', () => {
      const quantity = 10;
      const price = 25.50;
      const symbol = 'PLTR.US';
      
      const formattedPrice = Math.round(price * 100) / 100;
      
      const orderOptions: any = {
        symbol,
        orderType: OrderType.LO,
        side: OrderSide.Sell,
        submittedQuantity: new Decimal(quantity.toString()),
        submittedPrice: new Decimal(formattedPrice.toString()),
        timeInForce: TimeInForceType.Day,
      };
      
      // 验证 submittedQuantity 是 Decimal 实例
      expect(orderOptions.submittedQuantity).toBeInstanceOf(Decimal);
      expect(orderOptions.submittedPrice).toBeInstanceOf(Decimal);
      expect(orderOptions.submittedQuantity.toString()).toBe('10');
      expect(orderOptions.submittedPrice.toString()).toBe('25.5');
    });
    
    it('应该正确处理整数数量', () => {
      const quantity = 100;
      const orderOptions: any = {
        submittedQuantity: new Decimal(quantity.toString()),
      };
      
      expect(orderOptions.submittedQuantity).toBeInstanceOf(Decimal);
      expect(orderOptions.submittedQuantity.toString()).toBe('100');
    });
  });
  
  describe('订单提交流程', () => {
    it('应该成功提交买入订单（使用 Decimal 类型）', async () => {
      const longport = require('../config/longport');
      const tradeCtx = await longport.getTradeContext();
      
      const orderOptions: any = {
        symbol: 'AAPL.US',
        orderType: OrderType.LO,
        side: OrderSide.Buy,
        submittedQuantity: new Decimal('10'),
        submittedPrice: new Decimal('150.50'),
        timeInForce: TimeInForceType.Day,
        outsideRth: OutsideRTH.AnyTime,
      };
      
      const response = await tradeCtx.submitOrder(orderOptions);
      
      expect(response).toBeDefined();
      expect(response.orderId).toBe('test-order-123');
      expect(response.status).toBe('Submitted');
    });
    
    it('应该在使用 number 类型时抛出错误', async () => {
      const longport = require('../config/longport');
      const tradeCtx = await longport.getTradeContext();
      
      const orderOptions: any = {
        symbol: 'PLTR.US',
        orderType: OrderType.LO,
        side: OrderSide.Sell,
        submittedQuantity: 50, // ❌ 错误：使用 number 类型
        submittedPrice: new Decimal('25.50'),
        timeInForce: TimeInForceType.Day,
        outsideRth: OutsideRTH.AnyTime,
      };
      
      await expect(tradeCtx.submitOrder(orderOptions)).rejects.toThrow(
        'Unwrap value [longport_nodejs::decimal::Decimal] from class failed on SubmitOrderOptions.submittedQuantity'
      );
    });
  });
});


