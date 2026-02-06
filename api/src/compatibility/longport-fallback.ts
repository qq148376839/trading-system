// LongPort 兼容层 - 当原生模块不可用时提供模拟实现
import { logger } from '../utils/logger';

export class LongPortFallback {
  static async initialize() {
    logger.warn('LongPort 原生模块不可用，使用兼容模式启动');
    logger.warn('此模式下无法连接实际券商接口，仅支持本地数据管理功能');
    
    // 返回一个模拟对象，提供基本的结构但不执行实际API调用
    return {
      quote: {
        subscribe: async () => {
          logger.debug('Quote subscription skipped in compatibility mode');
        },
        unsubscribe: async () => {
          logger.debug('Quote unsubscription skipped in compatibility mode');
        }
      },
      trade: {
        subscribe: async () => {
          logger.debug('Trade subscription skipped in compatibility mode');
        },
        unsubscribe: async () => {
          logger.debug('Trade unsubscription skipped in compatibility mode');
        }
      },
      // 模拟其他必要的方法
      http: {
        getAccountBalance: async () => {
          logger.warn('Account balance unavailable in compatibility mode');
          return null;
        },
        getStockPositions: async () => {
          logger.warn('Stock positions unavailable in compatibility mode');
          return [];
        },
        getFundPositions: async () => {
          logger.warn('Fund positions unavailable in compatibility mode');
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
        logger.debug('LongPort disposed in compatibility mode');
      }
    };
  }
}
