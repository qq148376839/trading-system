/**
 * 推荐策略实现
 * 基于现有的 TradingRecommendationService 逻辑
 */

import { StrategyBase, TradingIntent } from './strategy-base';
import tradingRecommendationService from '../trading-recommendation.service';
import { logger } from '../../utils/logger';

export class RecommendationStrategy extends StrategyBase {
  constructor(strategyId: number, config: Record<string, any> = {}) {
    super(strategyId, config);
  }

  /**
   * 生成交易信号
   * 复用 TradingRecommendationService 的逻辑
   * @param symbol 股票代码
   * @param marketData 市场数据（可选，用于回测时传入历史数据）
   * @param targetDate 目标日期（可选，用于回测时指定历史日期）
   * @param historicalStockCandlesticks 历史股票K线数据（可选，用于回测）
   */
  async generateSignal(
    symbol: string, 
    marketData?: any,
    targetDate?: Date,
    historicalStockCandlesticks?: any[],
    preFetchedMarketData?: { spx?: any[]; usdIndex?: any[]; btc?: any[] } // ✅ 新增：预获取的市场数据（用于回测优化）
  ): Promise<TradingIntent | null> {
    try {
      // 调用现有的推荐服务生成推荐（如果提供了targetDate则使用历史数据）
      const recommendation = await tradingRecommendationService.calculateRecommendation(
        symbol,
        targetDate,
        historicalStockCandlesticks,
        preFetchedMarketData // ✅ 传递预获取的市场数据
      );

      // 如果推荐是 HOLD，返回 null（不生成信号）
      if (recommendation.action === 'HOLD') {
        return null;
      }

      // 转换为 TradingIntent
      const intent: TradingIntent = {
        action: recommendation.action,
        symbol: recommendation.symbol,
        entryPriceRange: recommendation.entry_price_range,
        entryPrice: (recommendation.entry_price_range.min + recommendation.entry_price_range.max) / 2, // 取中值
        stopLoss: recommendation.stop_loss,
        takeProfit: recommendation.take_profit,
        reason: recommendation.analysis_summary,
        metadata: {
          marketEnvironment: recommendation.market_environment,
          comprehensiveMarketStrength: recommendation.comprehensive_market_strength,
          trendConsistency: recommendation.trend_consistency,
          riskRewardRatio: recommendation.risk_reward_ratio,
          riskNote: recommendation.risk_note,
          spxUsdRelationshipAnalysis: recommendation.spx_usd_relationship_analysis,
        },
      };

      // 记录信号到数据库，获取signal_id
      const signalId = await this.logSignal(intent);
      
      // 将signal_id添加到intent的metadata中，传递给订单提交流程
      intent.metadata = {
        ...intent.metadata,
        signalId,  // 新增：信号ID，用于关联订单
      };

      return intent;
    } catch (error: any) {
      logger.error(`策略 ${this.strategyId} 生成信号失败 (${symbol}):`, error);
      
      // 记录错误但不抛出异常，返回 null 表示不生成信号
      return null;
    }
  }

  /**
   * 覆盖 onTick 方法（如果需要实时响应）
   */
  async onTick(symbol: string, quote: any): Promise<void> {
    // 可以在这里实现实时价格监控逻辑
    // 例如：检查止损止盈触发条件
    const currentState = await this.getCurrentState(symbol);
    
    if (currentState === 'HOLDING') {
      // 检查止损止盈
      const instance = await this.stateManager.getInstanceState(this.strategyId, symbol);
      if (instance?.context) {
        const stopLoss = instance.context.stopLoss;
        const takeProfit = instance.context.takeProfit;
        const currentPrice = parseFloat(quote.last_done?.toString() || '0');

        if (stopLoss && currentPrice <= stopLoss) {
          // 触发止损
          await this.updateState(symbol, 'CLOSING', {
            ...instance.context,
            exitReason: 'STOP_LOSS',
            exitPrice: currentPrice,
          });
        } else if (takeProfit && currentPrice >= takeProfit) {
          // 触发止盈
          await this.updateState(symbol, 'CLOSING', {
            ...instance.context,
            exitReason: 'TAKE_PROFIT',
            exitPrice: currentPrice,
          });
        }
      }
    }
  }

  /**
   * 覆盖 onBar 方法（如果需要基于 K 线数据）
   */
  async onBar(_symbol: string, _candlesticks: any[]): Promise<void> {
    // 可以在这里实现基于 K 线的策略逻辑
    // 例如：检查趋势变化、形态识别等
  }
}

