/**
 * 动态持仓管理服务
 * 实现动态止盈/止损调整、市场环境响应、风险保护等功能
 */

import tradingRecommendationService from './trading-recommendation.service';
import { logger } from '../utils/logger';

/**
 * 持仓上下文接口
 */
export interface PositionContext {
  // 基础信息
  entryPrice: number;
  quantity: number;
  entryTime: string; // ISO 8601 格式
  
  // 止盈止损
  originalStopLoss: number;
  originalTakeProfit: number;
  currentStopLoss: number;
  currentTakeProfit: number;
  
  // 市场环境
  entryMarketEnv?: string;
  entryMarketStrength?: number;
  previousMarketEnv?: string;
  previousMarketStrength?: number;
  
  // 波动性
  originalATR?: number;
  currentATR?: number;
  
  // 调整历史
  adjustmentHistory?: Array<{
    timestamp: string;
    reason: string;
    stopLoss: number;
    takeProfit: number;
  }>;
  
  // 其他字段（向后兼容）
  orderId?: string;
  allocationAmount?: number;
  [key: string]: any;
}

/**
 * 调整结果接口
 */
export interface AdjustmentResult {
  shouldSell: boolean;
  exitReason?: string;
  context: PositionContext;
}

class DynamicPositionManager {
  /**
   * 获取持仓上下文（从数据库加载并补充缺失字段）
   */
  async getPositionContext(
    _strategyId: number,
    _symbol: string,
    currentContext: any
  ): Promise<PositionContext> {
    // 从现有上下文构建 PositionContext
    // 处理止盈止损：优先使用 currentStopLoss/currentTakeProfit，如果没有则使用 stopLoss/takeProfit
    const stopLoss = currentContext.currentStopLoss ?? currentContext.stopLoss;
    const takeProfit = currentContext.currentTakeProfit ?? currentContext.takeProfit;
    
    const context: PositionContext = {
      entryPrice: currentContext.entryPrice,
      quantity: currentContext.quantity,
      entryTime: currentContext.entryTime || new Date().toISOString(),
      originalStopLoss: currentContext.originalStopLoss ?? stopLoss,
      originalTakeProfit: currentContext.originalTakeProfit ?? takeProfit,
      currentStopLoss: stopLoss,
      currentTakeProfit: takeProfit,
      entryMarketEnv: currentContext.entryMarketEnv,
      entryMarketStrength: currentContext.entryMarketStrength,
      previousMarketEnv: currentContext.previousMarketEnv || currentContext.entryMarketEnv,
      previousMarketStrength: currentContext.previousMarketStrength || currentContext.entryMarketStrength,
      originalATR: currentContext.originalATR,
      currentATR: currentContext.currentATR,
      adjustmentHistory: currentContext.adjustmentHistory || [],
      orderId: currentContext.orderId,
      allocationAmount: currentContext.allocationAmount,
    };

    // 如果缺少原始止盈止损，使用当前值
    if (!context.originalStopLoss && context.currentStopLoss) {
      context.originalStopLoss = context.currentStopLoss;
    }
    if (!context.originalTakeProfit && context.currentTakeProfit) {
      context.originalTakeProfit = context.currentTakeProfit;
    }

    return context;
  }

  /**
   * 获取当前市场环境（带重试机制）
   * 解决并发请求导致失败的问题
   */
  async getCurrentMarketEnvironment(symbol: string): Promise<{
    marketEnv: string;
    marketStrength: number;
  }> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1秒
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const recommendation = await tradingRecommendationService.calculateRecommendation(symbol);
        return {
          marketEnv: recommendation.market_environment,
          marketStrength: recommendation.comprehensive_market_strength,
        };
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        const isRetryableError = 
          error?.message?.includes('数据不足') ||
          error?.message?.includes('获取失败') ||
          error?.message?.includes('timeout') ||
          error?.message?.includes('network') ||
          error?.code === 'ECONNRESET' ||
          error?.code === 'ETIMEDOUT';
        
        if (isLastAttempt || !isRetryableError) {
          logger.warn(
            `获取市场环境失败 (${symbol})${isLastAttempt ? ` (已重试${maxRetries}次)` : ''}:`,
            error.message
          );
          return {
            marketEnv: '中性',
            marketStrength: 0,
          };
        }
        
        // 等待后重试（指数退避）
        const delay = retryDelay * Math.pow(2, attempt - 1);
        logger.debug(
          `获取市场环境失败 (${symbol})，${delay}ms后重试 (${attempt}/${maxRetries}):`,
          error.message
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // 理论上不会到达这里，但为了类型安全
    return {
      marketEnv: '中性',
      marketStrength: 0,
    };
  }

  /**
   * 计算市场环境恶化程度
   */
  calculateMarketDeterioration(
    previousEnv: string,
    currentEnv: string,
    previousStrength: number,
    currentStrength: number
  ): number {
    // 市场环境等级映射
    const envLevels: Record<string, number> = {
      '良好': 5,
      '中性利好': 4,
      '中性': 3,
      '中性利空': 2,
      '较差': 1,
    };

    const previousLevel = envLevels[previousEnv] || 3;
    const currentLevel = envLevels[currentEnv] || 3;

    // 环境等级变化（0-4）
    const levelChange = previousLevel - currentLevel;

    // 强度变化（归一化到0-1）
    const strengthChange = Math.max(0, (previousStrength - currentStrength) / 100);

    // 综合恶化程度（0-1）
    const deterioration = Math.min(1, (levelChange / 4) * 0.6 + strengthChange * 0.4);

    return deterioration;
  }

  /**
   * 根据市场环境调整止盈/止损
   */
  adjustByMarketEnvironment(
    context: PositionContext,
    currentPrice: number,
    currentMarketEnv: string,
    currentMarketStrength: number,
    pnlPercent: number
  ): Partial<AdjustmentResult> {
    let newStopLoss = context.currentStopLoss;
    let newTakeProfit = context.currentTakeProfit;
    let shouldSell = false;
    let exitReason = '';

    // 如果市场环境发生变化
    if (context.previousMarketEnv !== currentMarketEnv) {
      const deterioration = this.calculateMarketDeterioration(
        context.previousMarketEnv || context.entryMarketEnv || '中性',
        currentMarketEnv,
        context.previousMarketStrength || context.entryMarketStrength || 0,
        currentMarketStrength
      );

      // 市场环境恶化
      if (
        (context.previousMarketEnv === '良好' || context.previousMarketEnv === '中性利好') &&
        (currentMarketEnv === '较差' || currentMarketEnv === '中性利空')
      ) {
        if (pnlPercent > 3) {
          // 盈利超过3%：收紧止盈，保护利润
          if (context.originalTakeProfit) {
            newTakeProfit = Math.min(
              currentPrice * 1.01,
              context.originalTakeProfit * 0.95
            );
          } else if (context.currentTakeProfit) {
            newTakeProfit = Math.min(
              currentPrice * 1.01,
              context.currentTakeProfit * 0.95
            );
          }

          // 如果市场环境极度恶化，考虑立即止盈
          if (deterioration > 0.5) {
            shouldSell = true;
            exitReason = 'MARKET_DETERIORATION_PROFIT_PROTECTION';
          }
        } else if (pnlPercent > 0) {
          // 轻度盈利：收紧止盈，保护利润
          if (context.originalTakeProfit) {
            newTakeProfit = Math.min(
              currentPrice * 1.02,
              context.originalTakeProfit * 0.97
            );
          } else if (context.currentTakeProfit) {
            newTakeProfit = Math.min(
              currentPrice * 1.02,
              context.currentTakeProfit * 0.97
            );
          }
        } else if (pnlPercent > -2) {
          // 轻度亏损：收紧止损，避免进一步亏损
          if (context.originalStopLoss) {
            newStopLoss = Math.max(
              currentPrice * 0.99,
              context.originalStopLoss * 1.03
            );
          } else if (context.currentStopLoss) {
            newStopLoss = Math.max(
              currentPrice * 0.99,
              context.currentStopLoss * 1.03
            );
          }

          // 如果市场环境极度恶化，考虑止损
          if (deterioration > 0.7) {
            shouldSell = true;
            exitReason = 'MARKET_DETERIORATION_STOP_LOSS';
          }
        } else {
          // 深度亏损：保持原止损，不轻易调整
          // 除非市场环境极度恶化，否则持有
          if (deterioration > 0.8) {
            shouldSell = true;
            exitReason = 'MARKET_DETERIORATION_DEEP_LOSS';
          }
        }
      }

      // 市场环境改善
      if (
        (context.previousMarketEnv === '较差' || context.previousMarketEnv === '中性利空') &&
        (currentMarketEnv === '良好' || currentMarketEnv === '中性利好')
      ) {
        if (pnlPercent < 0) {
          // 亏损状态：放宽止损，给更多时间
          if (context.originalStopLoss) {
            newStopLoss = Math.max(
              context.originalStopLoss * 0.95,
              context.entryPrice * 0.92 // 最多放宽到入场价的92%
            );
          } else if (context.currentStopLoss) {
            newStopLoss = Math.max(
              context.currentStopLoss * 0.95,
              context.entryPrice * 0.92
            );
          }
        } else {
          // 盈利状态：放宽止盈，追求更高收益
          if (context.originalTakeProfit) {
            newTakeProfit = Math.min(
              context.originalTakeProfit * 1.05,
              context.entryPrice * 1.15 // 最多放宽到入场价的115%
            );
          } else if (context.currentTakeProfit) {
            newTakeProfit = Math.min(
              context.currentTakeProfit * 1.05,
              context.entryPrice * 1.15
            );
          }
        }
      }
    }

    return {
      shouldSell,
      exitReason,
      context: {
        ...context,
        currentStopLoss: newStopLoss,
        currentTakeProfit: newTakeProfit,
        previousMarketEnv: currentMarketEnv,
        previousMarketStrength: currentMarketStrength,
      },
    };
  }

  /**
   * 根据持仓时间调整止盈/止损
   */
  adjustByHoldingTime(
    context: PositionContext,
    currentPrice: number,
    pnlPercent: number
  ): Partial<AdjustmentResult> {
    const entryTime = new Date(context.entryTime);
    const holdingHours = (Date.now() - entryTime.getTime()) / (1000 * 60 * 60);

    let newStopLoss = context.currentStopLoss;
    let newTakeProfit = context.currentTakeProfit;
    let shouldSell = false;
    let exitReason = '';

    if (holdingHours > 24) {
      // 持仓超过24小时：收紧止盈，考虑时间成本
      if (pnlPercent > 0) {
        // 盈利状态：收紧止盈，尽快卖出
        if (context.originalTakeProfit) {
          newTakeProfit = Math.min(
            currentPrice * 1.02,
            context.originalTakeProfit * 0.98
          );
        } else if (context.currentTakeProfit) {
          newTakeProfit = Math.min(
            currentPrice * 1.02,
            context.currentTakeProfit * 0.98
          );
        }
      }
    } else if (holdingHours < 1) {
      // 持仓不足1小时：严格止损，避免快速亏损
      if (pnlPercent < -2) {
        // 快速亏损：收紧止损
        if (context.originalStopLoss) {
          newStopLoss = Math.max(
            currentPrice * 0.98,
            context.originalStopLoss * 1.02
          );
        } else if (context.currentStopLoss) {
          newStopLoss = Math.max(
            currentPrice * 0.98,
            context.currentStopLoss * 1.02
          );
        }
      }
    }

    if (holdingHours > 48) {
      // 持仓超过48小时：强制评估
      // ✅ 修复：如果价格已经超过止盈价，应该在止盈检查时就卖出，而不是等到48小时
      // 这里只处理价格接近但未达到止盈价的情况
      if (pnlPercent > 0) {
        // 盈利状态：如果价格接近止盈价（95%），强制卖出
        // 注意：如果价格已经超过止盈价，应该在止盈检查时就卖出，这里不应该再触发
        if (context.currentTakeProfit && currentPrice >= context.currentTakeProfit * 0.95 && currentPrice < context.currentTakeProfit) {
          shouldSell = true;
          exitReason = 'HOLDING_TIME_PROFIT';
        } else if (context.currentTakeProfit && currentPrice >= context.currentTakeProfit) {
          // 价格已经超过止盈价，应该在止盈检查时就卖出，这里不应该触发
          // 但如果确实到了48小时还没卖出，说明止盈检查有问题，这里强制卖出
          shouldSell = true;
          exitReason = 'HOLDING_TIME_PROFIT_OVERRIDE';
        }
      } else if (pnlPercent < -3) {
        // 亏损超过3%：如果价格接近止损价（105%），强制卖出
        // 注意：如果价格已经低于止损价，应该在止损检查时就卖出，这里不应该再触发
        if (context.currentStopLoss && currentPrice <= context.currentStopLoss * 1.05 && currentPrice > context.currentStopLoss) {
          shouldSell = true;
          exitReason = 'HOLDING_TIME_LOSS';
        } else if (context.currentStopLoss && currentPrice <= context.currentStopLoss) {
          // 价格已经低于止损价，应该在止损检查时就卖出，这里不应该触发
          // 但如果确实到了48小时还没卖出，说明止损检查有问题，这里强制卖出
          shouldSell = true;
          exitReason = 'HOLDING_TIME_LOSS_OVERRIDE';
        }
      }
    }

    return {
      shouldSell,
      exitReason,
      context: {
        ...context,
        currentStopLoss: newStopLoss,
        currentTakeProfit: newTakeProfit,
      },
    };
  }

  /**
   * 根据波动性调整止盈/止损（带重试机制）
   */
  async adjustByVolatility(
    context: PositionContext,
    symbol: string,
    currentPrice: number,
    pnlPercent: number
  ): Promise<Partial<AdjustmentResult>> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1秒
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 获取当前ATR
        const recommendation = await tradingRecommendationService.calculateRecommendation(symbol);
        const currentATR = recommendation.atr || 0;
        const atrPercent = currentATR > 0 ? currentATR / currentPrice : 0;

      // 如果没有原始ATR，使用当前ATR
      if (!context.originalATR) {
        context.originalATR = currentATR;
      }
      context.currentATR = currentATR;

      let newStopLoss = context.currentStopLoss;
      let newTakeProfit = context.currentTakeProfit;

      if (atrPercent > 0.05) {
        // 波动性超过5%：收紧止盈/止损
        if (pnlPercent > 0) {
          // 盈利状态：收紧止盈，保护利润
          newTakeProfit = Math.min(
            currentPrice * 1.03,
            context.originalTakeProfit * 0.97
          );
        } else {
          // 亏损状态：收紧止损，避免进一步亏损
          newStopLoss = Math.max(
            currentPrice * 0.97,
            context.originalStopLoss * 1.03
          );
        }
      }

        return {
          shouldSell: false,
          context: {
            ...context,
            currentStopLoss: newStopLoss,
            currentTakeProfit: newTakeProfit,
          },
        };
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        const isRetryableError = 
          error?.message?.includes('数据不足') ||
          error?.message?.includes('获取失败') ||
          error?.message?.includes('timeout') ||
          error?.message?.includes('network') ||
          error?.code === 'ECONNRESET' ||
          error?.code === 'ETIMEDOUT';
        
        if (isLastAttempt || !isRetryableError) {
          logger.warn(
            `波动性调整失败 (${symbol})${isLastAttempt ? ` (已重试${maxRetries}次)` : ''}:`,
            error.message
          );
          return {
            shouldSell: false,
            context,
          };
        }
        
        // 等待后重试（指数退避）
        const delay = retryDelay * Math.pow(2, attempt - 1);
        logger.debug(
          `波动性调整失败 (${symbol})，${delay}ms后重试 (${attempt}/${maxRetries}):`,
          error.message
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // 理论上不会到达这里，但为了类型安全
    return {
      shouldSell: false,
      context,
    };
  }

  /**
   * 检查风险保护机制
   */
  checkRiskProtection(
    context: PositionContext,
    currentPrice: number,
    _pnlPercent: number,
    _holdingHours: number
  ): Partial<AdjustmentResult> {
    let shouldSell = false;
    let exitReason = '';

    // 1. 盈亏平衡保护
    const breakEvenPrice = context.entryPrice * 1.01; // 考虑交易费用

    if (currentPrice >= breakEvenPrice && currentPrice < breakEvenPrice * 1.02) {
      // 在盈亏平衡点附近：如果市场环境恶化，考虑止盈
      // 这里不直接设置shouldSell，而是返回标记，由调用方根据市场环境决定
    }

    // 2. 持仓时间保护（已在 adjustByHoldingTime 中处理）
    // 3. 波动性保护（已在 adjustByVolatility 中处理）

    return {
      shouldSell,
      exitReason,
      context,
    };
  }

  /**
   * 动态调整止盈/止损
   */
  async adjustStopLossTakeProfit(
    context: PositionContext,
    currentPrice: number,
    currentMarketEnv: string,
    currentMarketStrength: number,
    symbol: string
  ): Promise<AdjustmentResult> {
    const pnlPercent = ((currentPrice - context.entryPrice) / context.entryPrice) * 100;
    const entryTime = new Date(context.entryTime);
    const holdingHours = (Date.now() - entryTime.getTime()) / (1000 * 60 * 60);

    let adjustedContext = { ...context };
    let shouldSell = false;
    let exitReason = '';

    // 1. 市场环境变化调整
    const marketAdjustment = this.adjustByMarketEnvironment(
      adjustedContext,
      currentPrice,
      currentMarketEnv,
      currentMarketStrength,
      pnlPercent
    );
    adjustedContext = marketAdjustment.context as PositionContext;
    if (marketAdjustment.shouldSell && !shouldSell) {
      shouldSell = true;
      exitReason = marketAdjustment.exitReason || '';
    }

    // 2. 持仓时间调整
    const timeAdjustment = this.adjustByHoldingTime(
      adjustedContext,
      currentPrice,
      pnlPercent
    );
    const timeContext = timeAdjustment.context as PositionContext;
    // 安全地合并止损/止盈值，处理 undefined 情况
    if (timeContext.currentStopLoss !== undefined) {
      adjustedContext.currentStopLoss = adjustedContext.currentStopLoss !== undefined
        ? Math.max(adjustedContext.currentStopLoss, timeContext.currentStopLoss)
        : timeContext.currentStopLoss;
    }
    if (timeContext.currentTakeProfit !== undefined) {
      adjustedContext.currentTakeProfit = adjustedContext.currentTakeProfit !== undefined
        ? Math.min(adjustedContext.currentTakeProfit, timeContext.currentTakeProfit)
        : timeContext.currentTakeProfit;
    }
    if (timeAdjustment.shouldSell && !shouldSell) {
      shouldSell = true;
      exitReason = timeAdjustment.exitReason || '';
    }

    // 3. 波动性调整
    const volatilityAdjustment = await this.adjustByVolatility(
      adjustedContext,
      symbol,
      currentPrice,
      pnlPercent
    );
    const volContext = volatilityAdjustment.context as PositionContext;
    // 安全地合并止损/止盈值，处理 undefined 情况
    if (volContext.currentStopLoss !== undefined) {
      adjustedContext.currentStopLoss = adjustedContext.currentStopLoss !== undefined
        ? Math.max(adjustedContext.currentStopLoss, volContext.currentStopLoss)
        : volContext.currentStopLoss;
    }
    if (volContext.currentTakeProfit !== undefined) {
      adjustedContext.currentTakeProfit = adjustedContext.currentTakeProfit !== undefined
        ? Math.min(adjustedContext.currentTakeProfit, volContext.currentTakeProfit)
        : volContext.currentTakeProfit;
    }

    // 4. 风险保护检查
    const protectionCheck = this.checkRiskProtection(
      adjustedContext,
      currentPrice,
      pnlPercent,
      holdingHours
    );
    if (protectionCheck.shouldSell && !shouldSell) {
      shouldSell = true;
      exitReason = protectionCheck.exitReason || '';
    }

    // 5. 记录调整历史（如果有变化）
    // 使用安全的比较，处理 undefined 情况
    const hasAdjustment =
      (adjustedContext.currentStopLoss !== undefined && adjustedContext.currentStopLoss !== context.currentStopLoss) ||
      (adjustedContext.currentTakeProfit !== undefined && adjustedContext.currentTakeProfit !== context.currentTakeProfit);

    if (hasAdjustment) {
      adjustedContext.adjustmentHistory = [
        ...(adjustedContext.adjustmentHistory || []),
        {
          timestamp: new Date().toISOString(),
          reason: exitReason || 'DYNAMIC_ADJUSTMENT',
          stopLoss: adjustedContext.currentStopLoss,
          takeProfit: adjustedContext.currentTakeProfit,
        },
      ];
    }

    return {
      shouldSell,
      exitReason,
      context: adjustedContext,
    };
  }
}

// 导出单例
export default new DynamicPositionManager();

