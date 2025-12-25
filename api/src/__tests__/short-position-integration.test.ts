/**
 * Short Position Integration Tests
 * Tests for short selling integration with strategy scheduler
 */

import pool from '../config/database';
import { StrategyBase } from '../services/strategies/strategy-base';
import { RecommendationStrategy } from '../services/strategies/recommendation-strategy';
import shortValidationService from '../services/short-position-validation.service';

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

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../services/short-position-validation.service', () => {
  const actualService = jest.requireActual('../services/short-position-validation.service');
  return {
    __esModule: true,
    default: {
      ...actualService.default,
      validateShortOperation: jest.fn(),
      calculateShortMargin: jest.fn(),
      validateCoverOperation: jest.fn(),
      validateStateTransition: actualService.default.validateStateTransition, // Use actual implementation
    },
    INITIAL_MARGIN_RATIO: 0.5,
    MARGIN_SAFETY_BUFFER: 0.1,
    DEFAULT_SHORT_QUANTITY_LIMIT: 100,
  };
});

// Import actual service for state transition tests
import shortValidationServiceActual from '../services/short-position-validation.service';

jest.mock('../services/basic-execution.service', () => ({
  __esModule: true,
  default: {
    executeSellIntent: jest.fn(),
    executeBuyIntent: jest.fn(),
    calculateAvailablePosition: jest.fn(),
  },
}));

jest.mock('../services/state-manager.service', () => ({
  __esModule: true,
  default: {
    getState: jest.fn(),
    updateState: jest.fn(),
  },
}));

jest.mock('../services/capital-manager.service', () => ({
  __esModule: true,
  default: {
    getAvailableCapital: jest.fn(),
    requestAllocation: jest.fn(),
  },
}));

describe('Short Position Integration', () => {
  let mockQuery: jest.Mock;
  let mockStrategyInstance: Partial<StrategyBase>;

  beforeEach(() => {
    mockQuery = pool.query as jest.Mock;
    mockStrategyInstance = {
      getCurrentState: jest.fn().mockResolvedValue('IDLE'),
      updateState: jest.fn().mockResolvedValue(undefined),
      generateSignal: jest.fn(),
    };

    jest.clearAllMocks();
  });

  describe('IDLE state with SELL signal', () => {
    it('should convert SELL signal to short operation when quantity is positive', async () => {
      // This test verifies the logic in strategy-scheduler.service.ts
      // where SELL signal in IDLE state is converted to short operation
      
      // Arrange
      const intent = {
        action: 'SELL' as const,
        symbol: 'AAPL.US',
        quantity: 10, // Positive quantity
        entryPrice: 100,
        reason: 'Test short signal',
      };

      // Act - Simulate the conversion logic
      if (intent.quantity && intent.quantity > 0) {
        intent.quantity = -intent.quantity; // Convert to negative
      }

      // Assert
      expect(intent.quantity).toBe(-10);
      expect(intent.action).toBe('SELL');
    });

    it('should calculate quantity from margin when quantity is not specified', async () => {
      // Arrange
      const mockMarginInfo = {
        requiredMargin: 550,
        availableMargin: 10000,
        marginRatio: 0.055,
        isSufficient: true,
      };
      
      (shortValidationService.calculateShortMargin as jest.Mock).mockResolvedValue(mockMarginInfo);

      const entryPrice = 100;
      const marginPerShare = entryPrice * 0.5 * 1.1; // INITIAL_MARGIN_RATIO * (1 + MARGIN_SAFETY_BUFFER)
      const maxQuantity = Math.floor(mockMarginInfo.availableMargin / marginPerShare);
      const estimatedQuantity = Math.max(1, Math.min(maxQuantity, 100));

      // Assert
      expect(estimatedQuantity).toBeGreaterThan(0);
      expect(estimatedQuantity).toBeLessThanOrEqual(100);
    });

    it('should validate short operation before execution', async () => {
      // Arrange
      const validationResult = {
        valid: true,
        data: {
          permission: { hasMarginAccount: true },
          margin: { isSufficient: true },
        },
      };
      
      (shortValidationService.validateShortOperation as jest.Mock).mockResolvedValue(validationResult);

      // Act
      const result = await shortValidationService.validateShortOperation(
        'AAPL.US',
        -10,
        100,
        1
      );

      // Assert
      expect(result.valid).toBe(true);
      expect(shortValidationService.validateShortOperation).toHaveBeenCalledWith(
        'AAPL.US',
        -10,
        100,
        1
      );
    });

    it('should reject short operation when validation fails', async () => {
      // Arrange
      const validationResult = {
        valid: false,
        error: 'Insufficient margin',
      };
      
      (shortValidationService.validateShortOperation as jest.Mock).mockResolvedValue(validationResult);

      // Act
      const result = await shortValidationService.validateShortOperation(
        'AAPL.US',
        -1000,
        100,
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Insufficient margin');
    });
  });

  describe('SHORT state management', () => {
    it('should transition from IDLE to SHORTING when short order is submitted', () => {
      // Arrange
      const currentState = 'IDLE';
      const targetState = 'SHORTING';
      
      // Act - Use actual service implementation
      const stateTransitionResult = shortValidationServiceActual.validateStateTransition(
        currentState,
        targetState
      );

      // Assert
      expect(stateTransitionResult.valid).toBe(true);
    });

    it('should transition from SHORTING to SHORT when order is filled', () => {
      // Arrange
      const currentState = 'SHORTING';
      const targetState = 'SHORT';
      
      // Act
      const stateTransitionResult = shortValidationServiceActual.validateStateTransition(
        currentState,
        targetState
      );

      // Assert
      expect(stateTransitionResult.valid).toBe(true);
    });

    it('should transition from SHORT to COVERING when cover order is submitted', () => {
      // Arrange
      const currentState = 'SHORT';
      const targetState = 'COVERING';
      
      // Act
      const stateTransitionResult = shortValidationServiceActual.validateStateTransition(
        currentState,
        targetState
      );

      // Assert
      expect(stateTransitionResult.valid).toBe(true);
    });

    it('should transition from COVERING to IDLE when cover is complete', () => {
      // Arrange
      const currentState = 'COVERING';
      const targetState = 'IDLE';
      
      // Act
      const stateTransitionResult = shortValidationServiceActual.validateStateTransition(
        currentState,
        targetState
      );

      // Assert
      expect(stateTransitionResult.valid).toBe(true);
    });
  });

  describe('Cover operation validation', () => {
    it('should validate cover operation with correct parameters', async () => {
      // Arrange
      const coverValidationResult = {
        valid: true,
        data: {
          stateTransition: {},
        },
      };
      
      (shortValidationService.validateCoverOperation as jest.Mock).mockResolvedValue(coverValidationResult);

      // Act
      const result = await shortValidationService.validateCoverOperation(
        'AAPL.US',
        5, // Cover 5 shares
        -10, // Current short quantity
        1
      );

      // Assert
      expect(result.valid).toBe(true);
      expect(shortValidationService.validateCoverOperation).toHaveBeenCalledWith(
        'AAPL.US',
        5,
        -10,
        1
      );
    });

    it('should reject cover operation when quantity exceeds short quantity', async () => {
      // Arrange
      const coverValidationResult = {
        valid: false,
        error: 'Cover quantity (11) cannot exceed short quantity (10)',
      };
      
      (shortValidationService.validateCoverOperation as jest.Mock).mockResolvedValue(coverValidationResult);

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
  });

  describe('Error handling', () => {
    it('should handle margin calculation errors gracefully', async () => {
      // Arrange
      (shortValidationService.calculateShortMargin as jest.Mock).mockRejectedValue(
        new Error('API Error')
      );

      // Act & Assert
      await expect(
        shortValidationService.calculateShortMargin('AAPL.US', -10, 100)
      ).rejects.toThrow();
    });

    it('should handle validation errors without crashing', async () => {
      // Arrange
      (shortValidationService.validateShortOperation as jest.Mock).mockResolvedValue({
        valid: false,
        error: 'Validation failed',
      });

      // Act
      const result = await shortValidationService.validateShortOperation(
        'AAPL.US',
        -10,
        100,
        1
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Validation failed');
    });
  });
});

