/**
 * Short Position Validation Service
 * Handles validation for short selling operations including:
 * - Short selling permission checks
 * - Margin requirement validation
 * - Quantity validation
 * - State transition validation
 */

import { getTradeContext, getQuoteContext, Decimal } from '../config/longport';
import { logger } from '../utils/logger';
import stateManager from './state-manager.service';
import { ErrorFactory } from '../utils/errors';
import { longportRateLimiter, retryWithBackoff } from '../utils/longport-rate-limiter';

/**
 * Account balance interface from Longbridge SDK
 * Note: Decimal from longport is a value (class), not a type, so we use any for type compatibility
 */
interface AccountBalance {
  currency: string;
  totalCash?: any | string | number;
  availableCash?: any | string | number;
  frozenCash?: any | string | number;
  netAssets?: any | string | number;
  initMargin?: any | string | number;
  maintenanceMargin?: any | string | number;
  buyPower?: any | string | number;
  maxFinanceAmount?: any | string | number;
  remainingFinanceAmount?: any | string | number;
  riskLevel?: number;
  marginCall?: any | string | number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
  data?: Record<string, unknown> | MarginInfo;
}

export interface MarginInfo {
  requiredMargin: number;
  availableMargin: number;
  marginRatio: number;
  isSufficient: boolean;
}

/**
 * Constants for short position validation
 */
export const INITIAL_MARGIN_RATIO = 0.5; // 50% initial margin requirement for US stocks
export const MARGIN_SAFETY_BUFFER = 0.1; // 10% safety buffer
export const MAX_SHORT_QUANTITY_PER_ORDER = 10000; // Maximum short quantity per order
export const DEFAULT_SHORT_QUANTITY_LIMIT = 100; // Default limit for auto-calculated quantity
export const HIGH_MARGIN_USAGE_THRESHOLD = 0.8; // 80% threshold for high margin usage warning

class ShortPositionValidationService {

  /**
   * Check if account has short selling permission
   * @param symbol Stock symbol
   * @returns Validation result
   */
  async checkShortPermission(symbol: string): Promise<ValidationResult> {
    try {
      // TODO: Check if account has short selling permission
      // This may require checking account type or calling SDK method
      // For now, we assume permission is granted if account balance API is accessible
      
      const tradeCtx = await getTradeContext();
      const balances = await longportRateLimiter.execute(() =>
        // LongPort SDK typings are `any` in this repo; explicitly pin type to avoid `unknown` inference
        retryWithBackoff<any[]>(() => tradeCtx.accountBalance() as any)
      );
      
      if (!balances || balances.length === 0) {
        return {
          valid: false,
          error: 'Unable to verify account permissions: account balance not available',
        };
      }

      // Check if account supports margin trading (indicated by margin fields)
      const hasMarginSupport = balances.some((bal: AccountBalance) => {
        const initMargin = parseFloat(bal.initMargin?.toString() || '0');
        const maintenanceMargin = parseFloat(bal.maintenanceMargin?.toString() || '0');
        return initMargin > 0 || maintenanceMargin > 0;
      });

      if (!hasMarginSupport) {
        return {
          valid: false,
          error: 'Account does not support margin trading (short selling requires margin account)',
        };
      }

      // TODO: Check if specific symbol supports short selling
      // This may require checking symbol-specific restrictions
      // For now, we assume all symbols support short selling if account has margin support

      return {
        valid: true,
        data: {
          hasMarginAccount: true,
        },
      };
    } catch (error: unknown) {
      logger.error(`[Short Validation] Check short permission failed (${symbol}):`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        valid: false,
        error: `Failed to check short selling permission: ${errorMessage}`,
      };
    }
  }

  /**
   * Calculate required margin for short position
   * @param symbol Stock symbol
   * @param quantity Short quantity (negative number)
   * @param price Short price
   * @returns Margin information
   */
  async calculateShortMargin(
    symbol: string,
    quantity: number,
    price: number
  ): Promise<MarginInfo> {
    // Input validation
    if (!symbol || symbol.trim() === '') {
      throw ErrorFactory.validationError('Symbol is required for margin calculation');
    }
    if (quantity === 0) {
      throw ErrorFactory.validationError('Quantity cannot be zero');
    }
    if (price <= 0) {
      throw ErrorFactory.validationError('Price must be positive');
    }

    try {
      const absQuantity = Math.abs(quantity);
      const tradeCtx = await getTradeContext();
      const balances = await longportRateLimiter.execute(() =>
        retryWithBackoff<any[]>(() => tradeCtx.accountBalance() as any)
      );
      
      // Find USD balance (or first balance)
      const usdBalance = balances.find((bal: AccountBalance) => bal.currency === 'USD') || balances[0];
      
      if (!usdBalance) {
        throw ErrorFactory.externalApiError('Longbridge', 'Unable to get account balance');
      }

      // Get margin requirements
      // Initial margin requirement: typically 50% of position value for US stocks
      // Maintenance margin requirement: typically 30% of position value
      // We use a conservative 50% initial margin requirement
      const positionValue = absQuantity * price;
      const requiredMargin = positionValue * INITIAL_MARGIN_RATIO;
      
      // Add safety buffer
      const requiredMarginWithBuffer = requiredMargin * (1 + MARGIN_SAFETY_BUFFER);

      // Get available margin
      // Available margin = Net assets - Initial margin - Maintenance margin
      const netAssets = parseFloat(usdBalance.netAssets?.toString() || '0');
      const currentInitMargin = parseFloat(usdBalance.initMargin?.toString() || '0');
      const currentMaintenanceMargin = parseFloat(usdBalance.maintenanceMargin?.toString() || '0');
      
      // Available margin = Net assets - (current initial margin + current maintenance margin)
      const availableMargin = Math.max(0, netAssets - currentInitMargin - currentMaintenanceMargin);

      const isSufficient = availableMargin >= requiredMarginWithBuffer;
      const marginRatio = availableMargin > 0 ? requiredMarginWithBuffer / availableMargin : Infinity;

      return {
        requiredMargin: requiredMarginWithBuffer,
        availableMargin,
        marginRatio,
        isSufficient,
      };
    } catch (error: unknown) {
      logger.error(`[Short Validation] Calculate short margin failed (${symbol}):`, error);
      if (error instanceof Error && error.message.includes('validation') || error instanceof Error && error.message.includes('external')) {
        throw error; // Re-throw AppError
      }
      throw ErrorFactory.validationError(
        `Failed to calculate margin for ${symbol}`,
        { symbol, originalError: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Validate margin for short position
   * @param symbol Stock symbol
   * @param quantity Short quantity (negative number)
   * @param price Short price
   * @returns Validation result
   */
  async validateMargin(
    symbol: string,
    quantity: number,
    price: number
  ): Promise<ValidationResult> {
    try {
      if (quantity >= 0) {
        return {
          valid: false,
          error: 'Quantity must be negative for short selling',
        };
      }

      const marginInfo = await this.calculateShortMargin(symbol, quantity, price);

      if (!marginInfo.isSufficient) {
        return {
          valid: false,
          error: `Insufficient margin: Required=${marginInfo.requiredMargin.toFixed(2)}, Available=${marginInfo.availableMargin.toFixed(2)}, Ratio=${(marginInfo.marginRatio * 100).toFixed(2)}%`,
          data: marginInfo as unknown as Record<string, unknown>,
        };
      }

      // Warning if margin ratio is high (>80%)
      if (marginInfo.marginRatio > HIGH_MARGIN_USAGE_THRESHOLD) {
        return {
          valid: true,
          warning: `High margin usage: ${(marginInfo.marginRatio * 100).toFixed(2)}% of available margin`,
          data: marginInfo as unknown as Record<string, unknown>,
        };
      }

      return {
        valid: true,
        data: marginInfo,
      };
    } catch (error: unknown) {
      logger.error(`[Short Validation] Validate margin failed (${symbol}):`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        valid: false,
        error: `Margin validation failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Validate quantity for short position operations
   * @param quantity Order quantity
   * @param action Order action (BUY/SELL)
   * @param currentQuantity Current position quantity
   * @returns Validation result
   */
  validateQuantity(
    quantity: number,
    action: 'BUY' | 'SELL',
    currentQuantity: number
  ): ValidationResult {
    // Validate quantity is not zero
    if (quantity === 0) {
      return {
        valid: false,
        error: 'Quantity cannot be zero',
      };
    }

    if (action === 'SELL' && quantity < 0) {
      // Short selling order (negative quantity)
      // Validate quantity is reasonable (not too large)
      const absQuantity = Math.abs(quantity);
      
      if (absQuantity > MAX_SHORT_QUANTITY_PER_ORDER) {
        return {
          valid: false,
          error: `Short quantity too large: ${absQuantity} exceeds maximum ${MAX_SHORT_QUANTITY_PER_ORDER}`,
        };
      }

      return {
        valid: true,
      };
    } else if (action === 'BUY' && currentQuantity < 0) {
      // Covering short position (buying to close short)
      const shortQuantity = Math.abs(currentQuantity);
      
      if (quantity > shortQuantity) {
        return {
          valid: false,
          error: `Cover quantity (${quantity}) cannot exceed short quantity (${shortQuantity})`,
        };
      }

      if (quantity <= 0) {
        return {
          valid: false,
          error: 'Cover quantity must be positive',
        };
      }

      return {
        valid: true,
      };
    } else if (action === 'SELL' && currentQuantity > 0) {
      // Closing long position (selling to close long)
      if (quantity > currentQuantity) {
        return {
          valid: false,
          error: `Sell quantity (${quantity}) cannot exceed long quantity (${currentQuantity})`,
        };
      }

      return {
        valid: true,
      };
    } else if (action === 'BUY' && currentQuantity >= 0) {
      // Opening long position
      if (quantity <= 0) {
        return {
          valid: false,
          error: 'Buy quantity must be positive for opening long position',
        };
      }

      return {
        valid: true,
      };
    }

    return {
      valid: true,
    };
  }

  /**
   * Validate state transition
   * @param fromState Current state
   * @param toState Target state
   * @returns Validation result
   */
  validateStateTransition(fromState: string, toState: string): ValidationResult {
    // Define valid state transitions
    const validTransitions: Record<string, string[]> = {
      'IDLE': ['OPENING', 'SHORTING'],
      'OPENING': ['HOLDING', 'IDLE'],
      'SHORTING': ['SHORT', 'IDLE'],
      'HOLDING': ['CLOSING', 'IDLE'],
      'SHORT': ['COVERING', 'IDLE'],
      'CLOSING': ['IDLE'],
      'COVERING': ['IDLE'],
      'COOLDOWN': ['IDLE'],
    };

    const allowedStates = validTransitions[fromState] || [];

    if (!allowedStates.includes(toState)) {
      return {
        valid: false,
        error: `Invalid state transition: ${fromState} -> ${toState}. Allowed transitions from ${fromState}: ${allowedStates.join(', ')}`,
      };
    }

    return {
      valid: true,
    };
  }

  /**
   * Comprehensive validation for short selling operation
   * @param symbol Stock symbol
   * @param quantity Short quantity (negative number)
   * @param price Short price
   * @param strategyId Strategy ID
   * @returns Validation result
   */
  async validateShortOperation(
    symbol: string,
    quantity: number,
    price: number,
    strategyId: number
  ): Promise<ValidationResult> {
    try {
      // 1. Check short selling permission
      const permissionCheck = await this.checkShortPermission(symbol);
      if (!permissionCheck.valid) {
        return permissionCheck;
      }

      // 2. Validate margin
      const marginCheck = await this.validateMargin(symbol, quantity, price);
      if (!marginCheck.valid) {
        return marginCheck;
      }

      // 3. Validate quantity
      const quantityCheck = this.validateQuantity(quantity, 'SELL', 0);
      if (!quantityCheck.valid) {
        return quantityCheck;
      }

      // 4. Get current state and validate state transition
      const currentState = await stateManager.getInstanceState(strategyId, symbol);
      const stateTransitionCheck = this.validateStateTransition(currentState?.state || 'IDLE', 'SHORTING');
      if (!stateTransitionCheck.valid) {
        return stateTransitionCheck;
      }

      return {
        valid: true,
        data: {
          permission: permissionCheck.data,
          margin: marginCheck.data,
          stateTransition: stateTransitionCheck.data,
        },
      };
    } catch (error: unknown) {
      logger.error(`[Short Validation] Comprehensive validation failed (${symbol}):`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        valid: false,
        error: `Short operation validation failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Validate covering short position operation
   * @param symbol Stock symbol
   * @param quantity Cover quantity (positive number)
   * @param currentQuantity Current short quantity (negative number)
   * @param strategyId Strategy ID
   * @returns Validation result
   */
  async validateCoverOperation(
    symbol: string,
    quantity: number,
    currentQuantity: number,
    strategyId: number
  ): Promise<ValidationResult> {
    try {
      // 1. Validate quantity
      const quantityCheck = this.validateQuantity(quantity, 'BUY', currentQuantity);
      if (!quantityCheck.valid) {
        return quantityCheck;
      }

      // 2. Validate state transition
      const currentState = await stateManager.getInstanceState(strategyId, symbol);
      const stateTransitionCheck = this.validateStateTransition(currentState?.state || 'SHORT', 'COVERING');
      if (!stateTransitionCheck.valid) {
        return stateTransitionCheck;
      }

      return {
        valid: true,
        data: {
          stateTransition: stateTransitionCheck.data,
        },
      };
    } catch (error: unknown) {
      logger.error(`[Short Validation] Cover operation validation failed (${symbol}):`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        valid: false,
        error: `Cover operation validation failed: ${errorMessage}`,
      };
    }
  }
}

export default new ShortPositionValidationService();

