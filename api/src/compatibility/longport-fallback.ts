// LongPort 兼容层 - 当原生模块不可用时提供模拟实现
export class LongPortFallback {
  static async initialize() {
    console.warn('LongPort 原生模块不可用，使用兼容模式启动');
    console.warn('此模式下无法连接实际券商接口，仅支持本地数据管理功能');
    
    // 返回一个模拟对象，提供基本的结构但不执行实际API调用
    return {
      quote: {
        subscribe: async () => {
          console.log('Quote subscription skipped in compatibility mode');
        },
        unsubscribe: async () => {
          console.log('Quote unsubscription skipped in compatibility mode');
        }
      },
      trade: {
        subscribe: async () => {
          console.log('Trade subscription skipped in compatibility mode');
        },
        unsubscribe: async () => {
          console.log('Trade unsubscription skipped in compatibility mode');
        }
      },
      // 模拟其他必要的方法
      http: {
        getAccountBalance: async () => {
          console.warn('Account balance unavailable in compatibility mode');
          return null;
        },
        getStockPositions: async () => {
          console.warn('Stock positions unavailable in compatibility mode');
          return [];
        },
        getFundPositions: async () => {
          console.warn('Fund positions unavailable in compatibility mode');
          return [];
        },
        submitOrder: async () => {
          throw new Error('Order submission unavailable in compatibility mode');
        },
        replaceOrder: async () => {
          throw new Error('Order replacement unavailable in compatibility mode');
        },
        cancelOrder: async () => {
          throw new Error('Order cancellation unavailable in compatibility mode');
        }
      },
      // 添加其他必要方法的模拟实现
      dispose: async () => {
        console.log('LongPort disposed in compatibility mode');
      }
    };
  }
}
