/**
 * Option intraday strategy (long-only).
 *
 * Implementation approach:
 * - Use the existing stock recommendation engine on the underlying symbol.
 * - Map recommendation BUY -> buy CALL, recommendation SELL -> buy PUT.
 * - Select a liquid contract (0DTE or nearest) via futunn option chain/detail.
 * - Provide scheduler with allocationAmountOverride = premium*multiplier*contracts + fees.
 *
 * Exit is primarily handled by the scheduler's market-close forced exit logic.
 */
import { StrategyBase, TradingIntent } from './strategy-base';
import tradingRecommendationService from '../trading-recommendation.service';
import optionRecommendationService from '../option-recommendation.service';
import { selectOptionContract } from '../options-contract-selector.service';
import { estimateOptionOrderTotalCost } from '../options-fee.service';

type DirectionMode = 'FOLLOW_SIGNAL' | 'CALL_ONLY' | 'PUT_ONLY';
type ExpirationMode = '0DTE' | 'NEAREST';
type PositionSizingMode = 'FIXED_CONTRACTS' | 'MAX_PREMIUM';

export interface OptionIntradayStrategyConfig {
  assetClass?: 'OPTION';
  expirationMode?: ExpirationMode;
  directionMode?: DirectionMode;
  positionSizing?: {
    mode: PositionSizingMode;
    fixedContracts?: number;
    maxPremiumUsd?: number;
  };
  liquidityFilters?: {
    minOpenInterest?: number;
    maxBidAskSpreadAbs?: number;
    maxBidAskSpreadPct?: number;
  };
  greekFilters?: {
    deltaMin?: number;
    deltaMax?: number;
    thetaMaxAbs?: number;
  };
  tradeWindow?: {
    noNewEntryBeforeCloseMinutes?: number;
    forceCloseBeforeCloseMinutes?: number; // enforced elsewhere, default 30
  };
  feeModel?: {
    commissionPerContract?: number;
    minCommissionPerOrder?: number;
    platformFeePerContract?: number;
  };
  entryPriceMode?: 'ASK' | 'MID';
}

export class OptionIntradayStrategy extends StrategyBase {
  constructor(strategyId: number, config: OptionIntradayStrategyConfig = {}) {
    super(strategyId, config as any);
  }

  async generateSignal(symbol: string): Promise<TradingIntent | null> {
    // symbol here is the underlying (from symbol pool)
    const cfg = this.config as OptionIntradayStrategyConfig;

    // 1) 使用期权专用推荐服务（替代股票推荐）
    const optionRec = await optionRecommendationService.calculateOptionRecommendation(symbol);

    console.log(`📊 [期权推荐] ${symbol}:`, {
      direction: optionRec.direction,
      confidence: optionRec.confidence,
      marketScore: optionRec.marketScore,
      intradayScore: optionRec.intradayScore,
      finalScore: optionRec.finalScore,
      riskLevel: optionRec.riskLevel,
      reasoning: optionRec.reasoning
    });

    // 如果推荐HOLD或风险过高，跳过
    if (optionRec.direction === 'HOLD') {
      console.log(`📍 [${symbol}] 推荐方向为HOLD，不生成信号`);
      return null;
    }
    if (optionRec.riskLevel === 'EXTREME') {
      console.warn(`⚠️ [${symbol}跳过] 风险等级EXTREME，不生成信号`);
      return null;
    }

    // 2) Decide option direction (可选择强制方向或跟随信号)
    const directionMode: DirectionMode = cfg.directionMode || 'FOLLOW_SIGNAL';
    let direction: 'CALL' | 'PUT';
    if (directionMode === 'CALL_ONLY') {
      direction = 'CALL';
    } else if (directionMode === 'PUT_ONLY') {
      direction = 'PUT';
    } else {
      // 跟随期权推荐信号
      direction = optionRec.direction as 'CALL' | 'PUT';
    }

    // 3) Select contract (0DTE default)
    const expirationMode: ExpirationMode = cfg.expirationMode || '0DTE';
    const selected = await selectOptionContract({
      underlyingSymbol: symbol,
      expirationMode,
      direction,
      candidateStrikes: 8,
      liquidityFilters: cfg.liquidityFilters,
      greekFilters: cfg.greekFilters,
    });

    if (!selected) {
      console.warn(`❌ [${symbol}无合约] 未找到合适的期权合约 (${direction}, ${expirationMode})`);
      return null;
    }

    // 4) Determine entry price (limit)
    const entryPriceMode = cfg.entryPriceMode || 'ASK';
    const premium = entryPriceMode === 'MID'
      ? (selected.mid || selected.last)
      : (selected.ask || selected.mid || selected.last);

    // [检查点8] 入场价格有效性
    console.log(
      `📍 [${symbol}价格] ${entryPriceMode}=${premium?.toFixed(2) || 'N/A'} | ASK=${selected.ask?.toFixed(2)}, BID=${selected.bid?.toFixed(2)}, MID=${selected.mid?.toFixed(2)}`
    );

    if (!premium || premium <= 0) {
      console.warn(`❌ [${symbol}价格无效] ${entryPriceMode}价格=${premium}，无法下单`);
      return null;
    }

    // 5) Determine contracts (default 1)
    const sizing = cfg.positionSizing || { mode: 'FIXED_CONTRACTS' as const, fixedContracts: 1 };
    let contracts = 1;
    if (sizing.mode === 'FIXED_CONTRACTS') {
      contracts = Math.max(1, Math.floor(sizing.fixedContracts || 1));
    } else if (sizing.mode === 'MAX_PREMIUM') {
      const budget = Math.max(0, (sizing.maxPremiumUsd || 0));
      // Find max contracts such that premium*multiplier*n + fees(n) <= budget
      let n = 1;
      for (; n <= 20; n++) {
        const est = estimateOptionOrderTotalCost({
          premium,
          contracts: n,
          multiplier: selected.multiplier,
          feeModel: cfg.feeModel,
        });
        if (est.totalCost > budget) break;
      }
      contracts = Math.max(1, n - 1);
    }

    const est = estimateOptionOrderTotalCost({
      premium,
      contracts,
      multiplier: selected.multiplier,
      feeModel: cfg.feeModel,
    });

    const intent: TradingIntent = {
      action: 'BUY',
      symbol: selected.optionSymbol, // IMPORTANT: order is placed on option symbol
      entryPrice: premium,
      quantity: contracts,
      reason: `期权开仓(${direction}) 置信度:${optionRec.confidence}% ${optionRec.reasoning.slice(0, 100) || ''}`.trim(),
      metadata: {
        assetClass: 'OPTION',
        underlyingSymbol: symbol,
        optionDirection: direction,
        optionType: selected.optionType,
        optionSymbol: selected.optionSymbol,
        optionId: selected.optionId,
        underlyingStockId: selected.underlyingStockId,
        marketType: selected.marketType,
        strikeDate: selected.strikeDate,
        strikePrice: selected.strikePrice,
        multiplier: selected.multiplier,
        bid: selected.bid,
        ask: selected.ask,
        mid: selected.mid,
        openInterest: selected.openInterest,
        impliedVolatility: selected.impliedVolatility,
        delta: selected.delta,
        theta: selected.theta,
        timeValue: selected.timeValue,
        estimatedFees: est.fees,
        allocationAmountOverride: est.totalCost,
      },
    };

    const signalId = await this.logSignal(intent);
    intent.metadata = { ...(intent.metadata || {}), signalId };

    // [检查点9] 信号生成成功
    console.log(
      `✅ [${symbol}信号] ${direction} ${selected.optionSymbol} | 合约=${contracts}, 权利金=$${premium.toFixed(2)}, 预估成本=$${est.totalCost.toFixed(2)} | Delta=${selected.delta?.toFixed(3)}, Theta=${selected.theta?.toFixed(3)}`
    );

    return intent;
  }
}

