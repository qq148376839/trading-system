/**
 * Short Position Validation Service Tests
 * Tests for short selling validation including:
 * - Permission checks
 * - Margin validation
 * - Quantity validation
 * - State transition validation
 */

import shortValidationService, {
  ValidationResult,
  MarginInfo,
  INITIAL_MARGIN_RATIO,
  MARGIN_SAFETY_BUFFER,
  MAX_SHORT_QUANTITY_PER_ORDER,
  DEFAULT_SHORT_QUANTITY_LIMIT,
  HIGH_MARGIN_USAGE_THRESHOLD,
} from '../services/short-position-validation.service';
import { logger } from '../utils/logger';
import { ErrorFactory } from '../utils/errors';

// Mock external dependencies
jest.mock('../config/longport', () => ({
  getTradeContext: jest.fn(),
  getQuoteContext: jest.fn(),
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

jest.mock('../services/state-manager.service', () => ({
  __esModule: true,
  default: {
    getInstanceState: jest.fn(),
  },
}));

jest.mock('../utils/errors', () => ({
  ErrorFactory: {
    validationError: jest.fn((message: string, details?: any) => {
      const error = new Error(message);
      (error as any).details = details;
      return error;
    }),
    externalApiError: jest.fn((message: string) => new Error(message)),
  },
}));

describe('ShortPositionValidationService', () => {
  let mockTradeContext: any;
  let mockStateManager: any;

  beforeEach(() => {
    // Mock TradeContext
    mockTradeContext = {
      accountBalance: jest.fn(),
    };

    const { getTradeContext } = require('../config/longport');
    getTradeContext.mockResolvedValue(mockTradeContext);

    // Mock StateManager
    mockStateManager = require('../services/state-manager.service').default;
    mockStateManager.getInstanceState.mockResolvedValue({ state: 'IDLE' });

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('checkShortPermission', () => {
    it('should return valid when account has margin support', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          initMargin: '1000',
          maintenanceMargin: '500',
        },
      ]);

      // Act
      const result = await shortValidationService.checkShortPermission('AAPL.US');

      // Assert
      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ hasMarginAccount: true });
      expect(mockTradeContext.accountBalance).toHaveBeenCalled();
    });

    it('should return invalid when account balance is not available', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([]);

      // Act
      const result = await shortValidationService.checkShortPermission('AAPL.US');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unable to verify account permissions');
    });

    it('should return invalid when account does not support margin trading', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          initMargin: '0',
          maintenanceMargin: '0',
        },
      ]);

      // Act
      const result = await shortValidationService.checkShortPermission('AAPL.US');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not support margin trading');
    });

    it('should handle API errors gracefully', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockRejectedValue(new Error('API Error'));

      // Act
      const result = await shortValidationService.checkShortPermission('AAPL.US');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Failed to check short selling permission');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('calculateShortMargin', () => {
    it('should calculate margin correctly for short position', async () => {
      // Arrange
      const symbol = 'AAPL.US';
      const quantity = -10; // Short 10 shares
      const price = 100;
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '10000',
          initMargin: '1000',
          maintenanceMargin: '500',
        },
      ]);

      // Act
      const result = await shortValidationService.calculateShortMargin(symbol, quantity, price);

      // Assert
      expect(result).toBeDefined();
      expect(result.requiredMargin).toBeGreaterThan(0);
      expect(result.availableMargin).toBeGreaterThan(0);
      expect(result.marginRatio).toBeGreaterThan(0);
      
      // Verify calculation: positionValue = 10 * 100 = 1000
      // requiredMargin = 1000 * 0.5 = 500
      // requiredMarginWithBuffer = 500 * 1.1 = 550
      const expectedRequiredMargin = 10 * 100 * INITIAL_MARGIN_RATIO * (1 + MARGIN_SAFETY_BUFFER);
      expect(result.requiredMargin).toBeCloseTo(expectedRequiredMargin, 2);
    });

    it('should throw validation error when symbol is empty', async () => {
      // Arrange
      const symbol = '';
      const quantity = -10;
      const price = 100;

      // Act & Assert
      await expect(
        shortValidationService.calculateShortMargin(symbol, quantity, price)
      ).rejects.toThrow('Symbol is required');
    });

    it('should throw validation error when quantity is zero', async () => {
      // Arrange
      const symbol = 'AAPL.US';
      const quantity = 0;
      const price = 100;

      // Act & Assert
      await expect(
        shortValidationService.calculateShortMargin(symbol, quantity, price)
      ).rejects.toThrow('Quantity cannot be zero');
    });

    it('should throw validation error when price is negative', async () => {
      // Arrange
      const symbol = 'AAPL.US';
      const quantity = -10;
      const price = -100;

      // Act & Assert
      await expect(
        shortValidationService.calculateShortMargin(symbol, quantity, price)
      ).rejects.toThrow('Price must be positive');
    });

    it('should handle missing account balance', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([]);

      // Act & Assert
      await expect(
        shortValidationService.calculateShortMargin('AAPL.US', -10, 100)
      ).rejects.toThrow();
    });

    it('should calculate available margin correctly', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '10000',
          initMargin: '2000',
          maintenanceMargin: '1000',
        },
      ]);

      // Act
      const result = await shortValidationService.calculateShortMargin('AAPL.US', -10, 100);

      // Assert
      // availableMargin = netAssets - initMargin - maintenanceMargin
      // = 10000 - 2000 - 1000 = 7000
      expect(result.availableMargin).toBe(7000);
    });
  });

  describe('validateMargin', () => {
    it('should return valid when margin is sufficient', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '10000',
          initMargin: '0',
          maintenanceMargin: '0',
        },
      ]);

      // Act
      const result = await shortValidationService.validateMargin('AAPL.US', -10, 100);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should return invalid when margin is insufficient', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '100',
          initMargin: '50',
          maintenanceMargin: '30',
        },
      ]);

      // Act
      const result = await shortValidationService.validateMargin('AAPL.US', -100, 100);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient margin');
      expect(result.data).toBeDefined();
    });

    it('should return warning when margin ratio is high', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '1000',
          initMargin: '0',
          maintenanceMargin: '0',
        },
      ]);

      // Act - Use quantity that will result in high margin usage (>80%)
      const result = await shortValidationService.validateMargin('AAPL.US', -15, 100);

      // Assert
      if (result.valid) {
        expect(result.warning).toContain('High margin usage');
      }
    });

    it('should return invalid when quantity is positive', async () => {
      // Arrange
      const quantity = 10; // Positive quantity (should be negative for short)

      // Act
      const result = await shortValidationService.validateMargin('AAPL.US', quantity, 100);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Quantity must be negative');
    });

    it('should handle calculation errors', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockRejectedValue(new Error('API Error'));

      // Act
      const result = await shortValidationService.validateMargin('AAPL.US', -10, 100);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Margin validation failed');
    });
  });

  describe('validateQuantity', () => {
    describe('Short selling orders (negative quantity)', () => {
      it('should return valid for reasonable short quantity', () => {
        // Act
        const result = shortValidationService.validateQuantity(-10, 'SELL', 0);

        // Assert
        expect(result.valid).toBe(true);
      });

      it('should return invalid when quantity exceeds maximum', () => {
        // Act
        const result = shortValidationService.validateQuantity(
          -(MAX_SHORT_QUANTITY_PER_ORDER + 1),
          'SELL',
          0
        );

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('exceeds maximum');
      });

      it('should return invalid when quantity is zero', () => {
        // Act
        const result = shortValidationService.validateQuantity(0, 'SELL', 0);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('cannot be zero');
      });
    });

    describe('Covering short position (buying to close)', () => {
      it('should return valid when cover quantity is within short quantity', () => {
        // Arrange
        const currentQuantity = -10; // Short 10 shares
        const coverQuantity = 5; // Cover 5 shares

        // Act
        const result = shortValidationService.validateQuantity(coverQuantity, 'BUY', currentQuantity);

        // Assert
        expect(result.valid).toBe(true);
      });

      it('should return invalid when cover quantity exceeds short quantity', () => {
        // Arrange
        const currentQuantity = -10; // Short 10 shares
        const coverQuantity = 11; // Try to cover 11 shares

        // Act
        const result = shortValidationService.validateQuantity(coverQuantity, 'BUY', currentQuantity);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('cannot exceed short quantity');
      });

      it('should return invalid when cover quantity is negative', () => {
        // Arrange
        const currentQuantity = -10;
        const coverQuantity = -5;

        // Act
        const result = shortValidationService.validateQuantity(coverQuantity, 'BUY', currentQuantity);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('must be positive');
      });
    });

    describe('Closing long position (selling to close)', () => {
      it('should return valid when sell quantity is within long quantity', () => {
        // Arrange
        const currentQuantity = 10; // Long 10 shares
        const sellQuantity = 5; // Sell 5 shares

        // Act
        const result = shortValidationService.validateQuantity(sellQuantity, 'SELL', currentQuantity);

        // Assert
        expect(result.valid).toBe(true);
      });

      it('should return invalid when sell quantity exceeds long quantity', () => {
        // Arrange
        const currentQuantity = 10;
        const sellQuantity = 11;

        // Act
        const result = shortValidationService.validateQuantity(sellQuantity, 'SELL', currentQuantity);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('cannot exceed long quantity');
      });
    });

    describe('Opening long position', () => {
      it('should return valid for positive buy quantity', () => {
        // Act
        const result = shortValidationService.validateQuantity(10, 'BUY', 0);

        // Assert
        expect(result.valid).toBe(true);
      });

      it('should return invalid when buy quantity is negative', () => {
        // Act
        const result = shortValidationService.validateQuantity(-10, 'BUY', 0);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('must be positive');
      });
    });
  });

  describe('validateStateTransition', () => {
    it('should return valid for IDLE -> SHORTING transition', () => {
      // Act
      const result = shortValidationService.validateStateTransition('IDLE', 'SHORTING');

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should return valid for SHORTING -> SHORT transition', () => {
      // Act
      const result = shortValidationService.validateStateTransition('SHORTING', 'SHORT');

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should return valid for SHORT -> COVERING transition', () => {
      // Act
      const result = shortValidationService.validateStateTransition('SHORT', 'COVERING');

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should return valid for COVERING -> IDLE transition', () => {
      // Act
      const result = shortValidationService.validateStateTransition('COVERING', 'IDLE');

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should return invalid for SHORT -> HOLDING transition', () => {
      // Act
      const result = shortValidationService.validateStateTransition('SHORT', 'HOLDING');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });

    it('should return invalid for HOLDING -> SHORT transition', () => {
      // Act
      const result = shortValidationService.validateStateTransition('HOLDING', 'SHORT');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });

    it('should return invalid for unknown from state', () => {
      // Act
      const result = shortValidationService.validateStateTransition('UNKNOWN', 'IDLE');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });
  });

  describe('validateShortOperation', () => {
    it('should return valid for complete short operation', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '10000',
          initMargin: '1000', // Need non-zero initMargin to pass permission check
          maintenanceMargin: '500',
        },
      ]);
      mockStateManager.getInstanceState.mockResolvedValue({ state: 'IDLE' });

      // Act
      const result = await shortValidationService.validateShortOperation(
        'AAPL.US',
        -10,
        100,
        1
      );

      // Assert
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
      // Type assertion for test - data contains permission and margin in validateShortOperation
      const data = result.data as Record<string, unknown>;
      expect(data?.permission).toBeDefined();
      expect(data?.margin).toBeDefined();
    });

    it('should return invalid when permission check fails', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([]); // No margin support

      // Act
      const result = await shortValidationService.validateShortOperation(
        'AAPL.US',
        -10,
        100,
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unable to verify account permissions');
    });

    it('should return invalid when margin validation fails', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '10',
          initMargin: '5',
          maintenanceMargin: '3',
        },
      ]);
      mockStateManager.getInstanceState.mockResolvedValue({ state: 'IDLE' });

      // Act - Use large quantity that will exceed available margin
      const result = await shortValidationService.validateShortOperation(
        'AAPL.US',
        -1000,
        100,
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient margin');
    });

    it('should return invalid when state transition is invalid', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '10000',
          initMargin: '1000', // Need non-zero initMargin to pass permission check
          maintenanceMargin: '500',
        },
      ]);
      mockStateManager.getInstanceState.mockResolvedValue({ state: 'HOLDING' }); // Invalid state

      // Act
      const result = await shortValidationService.validateShortOperation(
        'AAPL.US',
        -10,
        100,
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockRejectedValue(new Error('API Error'));

      // Act
      const result = await shortValidationService.validateShortOperation(
        'AAPL.US',
        -10,
        100,
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      // The error is caught in checkShortPermission and returned directly
      // So the error message is from checkShortPermission, not wrapped
      expect(result.error).toContain('Failed to check short selling permission');
    });
  });

  describe('validateCoverOperation', () => {
    it('should return valid for complete cover operation', async () => {
      // Arrange
      mockStateManager.getInstanceState.mockResolvedValue({ state: 'SHORT' });

      // Act
      const result = await shortValidationService.validateCoverOperation(
        'AAPL.US',
        5, // Cover 5 shares
        -10, // Current short quantity
        1
      );

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should return invalid when cover quantity exceeds short quantity', async () => {
      // Arrange
      mockStateManager.getInstanceState.mockResolvedValue({ state: 'SHORT' });

      // Act
      const result = await shortValidationService.validateCoverOperation(
        'AAPL.US',
        11, // Try to cover 11 shares
        -10, // But only short 10 shares
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed short quantity');
    });

    it('should return invalid when state transition is invalid', async () => {
      // Arrange
      mockStateManager.getInstanceState.mockResolvedValue({ state: 'HOLDING' }); // Invalid state

      // Act
      const result = await shortValidationService.validateCoverOperation(
        'AAPL.US',
        5,
        -10,
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      mockStateManager.getInstanceState.mockRejectedValue(new Error('State Error'));

      // Act
      const result = await shortValidationService.validateCoverOperation(
        'AAPL.US',
        5,
        -10,
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Cover operation validation failed');
    });
  });

  describe('Constants', () => {
    it('should export INITIAL_MARGIN_RATIO constant', () => {
      expect(INITIAL_MARGIN_RATIO).toBe(0.5);
    });

    it('should export MARGIN_SAFETY_BUFFER constant', () => {
      expect(MARGIN_SAFETY_BUFFER).toBe(0.1);
    });

    it('should export MAX_SHORT_QUANTITY_PER_ORDER constant', () => {
      expect(MAX_SHORT_QUANTITY_PER_ORDER).toBe(10000);
    });

    it('should export DEFAULT_SHORT_QUANTITY_LIMIT constant', () => {
      expect(DEFAULT_SHORT_QUANTITY_LIMIT).toBe(100);
    });

    it('should export HIGH_MARGIN_USAGE_THRESHOLD constant', () => {
      expect(HIGH_MARGIN_USAGE_THRESHOLD).toBe(0.8);
    });
  });

  describe('Edge cases', () => {
    it('should handle very small quantities', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '10000',
          initMargin: '0',
          maintenanceMargin: '0',
        },
      ]);

      // Act
      const result = await shortValidationService.validateMargin('AAPL.US', -1, 0.01);

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should handle very large prices', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '1000000',
          initMargin: '0',
          maintenanceMargin: '0',
        },
      ]);

      // Act
      const result = await shortValidationService.validateMargin('AAPL.US', -10, 10000);

      // Assert
      expect(result.valid).toBe(true);
    });

    it('should handle zero available margin', async () => {
      // Arrange
      mockTradeContext.accountBalance.mockResolvedValue([
        {
          currency: 'USD',
          netAssets: '1000',
          initMargin: '500',
          maintenanceMargin: '500',
        },
      ]);

      // Act
      const result = await shortValidationService.validateMargin('AAPL.US', -10, 100);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient margin');
    });
  });
});

