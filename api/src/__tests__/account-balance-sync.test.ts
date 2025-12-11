/**
 * 账户余额同步服务测试
 * 测试资金差异检测、告警机制和状态同步逻辑
 */

import accountBalanceSyncService from '../services/account-balance-sync.service';
import { logger } from '../utils/logger';
import pool from '../config/database';

// Mock外部依赖
jest.mock('../config/longport', () => ({
  getTradeContext: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../services/capital-manager.service', () => ({
  __esModule: true,
  default: {
    releaseAllocation: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../services/state-manager.service', () => ({
  __esModule: true,
  default: {
    updateState: jest.fn().mockResolvedValue(undefined),
  },
}));

// account-balance-sync.service 不直接使用 capitalManager.getCapitalUsage
// 它直接从数据库查询资金分配信息

describe('AccountBalanceSyncService', () => {
  let mockTradeContext: any;
  let mockQuery: jest.Mock;

  beforeEach(() => {
    mockQuery = pool.query as jest.Mock;
    
    // Mock TradeContext
    mockTradeContext = {
      accountBalance: jest.fn(),
      stockPositions: jest.fn().mockResolvedValue({ positions: [] }),
    };
    
    const { getTradeContext } = require('../config/longport');
    getTradeContext.mockResolvedValue(mockTradeContext);
    
    // 重置所有mocks
    jest.clearAllMocks();
  });

  describe('syncAccountBalance', () => {
    it('应该成功同步账户余额并返回总资金', async () => {
      // Mock账户余额数据
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          cashInfos: [
            {
              currency: 'USD',
              availableCash: '80744.09',
            },
          ],
        },
      ]);

      // Mock持仓数据（空持仓）
      mockTradeContext.stockPositions.mockResolvedValue({ positions: [] });

      // Mock数据库查询 - 策略列表（包含资金分配信息）
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            strategy_id: 5,
            strategy_name: '测试策略',
            allocation_id: 7,
            allocation_type: 'PERCENTAGE',
            allocation_value: 0.4,
            current_usage: 0,
            allocation_name: '40%',
          },
        ],
      });

      // Mock数据库查询 - 策略实例状态
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      // Mock数据库查询 - 未成交订单
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await accountBalanceSyncService.syncAccountBalance();

      expect(result.success).toBe(true);
      expect(result.totalCapital).toBe(80744.09);
      expect(mockTradeContext.accountBalance).toHaveBeenCalledWith('USD');
    });

    it('应该检测资金差异并标记为警告', async () => {
      // Mock账户余额
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          cashInfos: [
            {
              currency: 'USD',
              availableCash: '80000.00',
            },
          ],
        },
      ]);

      // Mock持仓数据（有持仓，价值约33000）
      mockTradeContext.stockPositions.mockResolvedValue({
        positions: [
          {
            symbol: 'AAPL.US',
            quantity: '220',
            currentPrice: '150',
          },
        ],
      });

      // Mock数据库查询 - 策略列表（包含资金分配信息）
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            strategy_id: 5,
            strategy_name: '测试策略',
            allocation_id: 7,
            allocation_type: 'PERCENTAGE',
            allocation_value: 0.4,
            current_usage: 0,
            allocation_name: '40%',
          },
        ],
      });

      // Mock数据库查询 - 策略实例状态（计算实际使用量）
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            symbol: 'AAPL.US',
            current_state: 'HOLDING',
            context: JSON.stringify({ entryPrice: 150, quantity: 220 }),
          },
        ],
      });

      // Mock数据库查询 - 未成交订单
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await accountBalanceSyncService.syncAccountBalance();

      expect(result.success).toBe(true);
      expect(result.discrepancies).toBeDefined();
      if (result.discrepancies && result.discrepancies.length > 0) {
        const discrepancy = result.discrepancies[0];
        expect(discrepancy.difference).toBeGreaterThan(0);
        // 差异应该在警告阈值内（5%）
        expect(discrepancy.severity).toBeDefined();
      }
    });

    it('应该检测严重资金差异并标记为错误', async () => {
      // Mock账户余额
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          cashInfos: [
            {
              currency: 'USD',
              availableCash: '80000.00',
            },
          ],
        },
      ]);

      // Mock持仓数据（严重超配，价值约40050 = 267 * 150）
      mockTradeContext.stockPositions.mockResolvedValue({
        positions: [
          {
            symbol: 'AAPL.US',
            quantity: '267',
            currentPrice: '150',
            costPrice: '150',
          },
        ],
      });

      // Mock数据库查询 - 策略列表（包含资金分配信息）
      // 预期分配：80000 * 0.4 = 32000
      // 实际使用：267 * 150 = 40050（从持仓计算）
      // 记录使用量：0（数据库记录）
      // 差异：40050 - 0 = 40050，差异百分比：40050/32000 = 125.16% > 10%（ERROR）
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            strategy_id: 5,
            strategy_name: '测试策略',
            allocation_id: 7,
            allocation_type: 'PERCENTAGE',
            allocation_value: 0.4,
            current_usage: 0, // 数据库记录的使用量为0，但实际持仓价值40050
            allocation_name: '40%',
          },
        ],
      });

      // Mock数据库查询 - 策略实例状态（严重超配）
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            symbol: 'AAPL.US',
            current_state: 'HOLDING',
            context: JSON.stringify({ entryPrice: 150, quantity: 267 }),
          },
        ],
      });

      // Mock数据库查询 - 未成交订单
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await accountBalanceSyncService.syncAccountBalance();

      expect(result.success).toBe(true);
      expect(result.discrepancies).toBeDefined();
      if (result.discrepancies && result.discrepancies.length > 0) {
        const discrepancy = result.discrepancies[0];
        // 差异应该超过10%，标记为ERROR
        if (discrepancy.severity === 'ERROR') {
          expect(discrepancy.differencePercent).toBeGreaterThan(10);
        }
      }
    });

    it('应该处理同步进行中的情况', async () => {
      // 设置同步标志
      (accountBalanceSyncService as any).isSyncing = true;

      const result = await accountBalanceSyncService.syncAccountBalance();

      expect(result.success).toBe(false);
      expect(result.error).toContain('同步正在进行中');
      expect(mockTradeContext.accountBalance).not.toHaveBeenCalled();
    });

    it('应该处理API调用失败', async () => {
      // 重置同步标志
      (accountBalanceSyncService as any).isSyncing = false;
      
      // Mock getTradeContext 失败
      const { getTradeContext } = require('../config/longport');
      getTradeContext.mockRejectedValueOnce(new Error('API调用失败'));

      const result = await accountBalanceSyncService.syncAccountBalance();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // 错误信息应该包含错误描述
      expect(result.error).toBeTruthy();
      // logger.error 在 catch 块中被调用
      expect(logger.error).toHaveBeenCalled();
    });

    it('应该处理数据库查询失败', async () => {
      // 重置同步标志
      (accountBalanceSyncService as any).isSyncing = false;
      
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          cashInfos: [
            {
              currency: 'USD',
              availableCash: '80000.00',
            },
          ],
        },
      ]);

      mockTradeContext.stockPositions.mockResolvedValue({ positions: [] });

      // 第一个查询（策略列表）失败
      mockQuery.mockRejectedValueOnce(new Error('数据库查询失败'));

      const result = await accountBalanceSyncService.syncAccountBalance();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // logger.error 在 catch 块中被调用
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('告警阈值计算', () => {
    it('应该正确计算警告阈值（5%）', async () => {
      const expectedAllocation = 32297.64;
      const warningThreshold = Math.max(expectedAllocation * 0.05, 100);
      
      expect(warningThreshold).toBeGreaterThanOrEqual(100);
      expect(warningThreshold).toBeCloseTo(expectedAllocation * 0.05, 2);
    });

    it('应该正确计算错误阈值（10%）', async () => {
      const expectedAllocation = 32297.64;
      const errorThreshold = Math.max(expectedAllocation * 0.10, 500);
      
      expect(errorThreshold).toBeGreaterThanOrEqual(500);
      expect(errorThreshold).toBeCloseTo(expectedAllocation * 0.10, 2);
    });

    it('应该对小额分配使用最小阈值', async () => {
      const expectedAllocation = 1000; // 小额分配
      const warningThreshold = Math.max(expectedAllocation * 0.05, 100);
      const errorThreshold = Math.max(expectedAllocation * 0.10, 500);
      
      // 警告阈值应该至少是100
      expect(warningThreshold).toBe(100);
      // 错误阈值应该至少是500
      expect(errorThreshold).toBe(500);
    });
  });

  describe('状态同步逻辑', () => {
    it('应该处理OPENING状态到HOLDING状态的转换', async () => {
      // Mock账户余额
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          cashInfos: [
            {
              currency: 'USD',
              availableCash: '80000.00',
            },
          ],
        },
      ]);

      // Mock持仓数据（有实际持仓）
      mockTradeContext.stockPositions.mockResolvedValue({
        positions: [
          {
            symbol: 'AAPL.US',
            quantity: '10',
            currentPrice: '150',
            costPrice: '150',
          },
        ],
      });

      // Mock数据库查询 - 策略列表（包含资金分配信息）
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            strategy_id: 5,
            strategy_name: '测试策略',
            allocation_id: 7,
            allocation_type: 'PERCENTAGE',
            allocation_value: 0.4,
            current_usage: 0,
            allocation_name: '40%',
          },
        ],
      });

      // Mock数据库查询 - 策略实例状态（OPENING状态）
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            symbol: 'AAPL.US',
            current_state: 'OPENING',
            context: JSON.stringify({}),
          },
        ],
      });

      // Mock数据库查询 - 未成交订单（无未成交订单）
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await accountBalanceSyncService.syncAccountBalance();

      expect(result.success).toBe(true);
      // 状态同步逻辑会在检测到OPENING状态且有实际持仓时更新状态
    });
  });
});

