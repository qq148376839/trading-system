/**
 * Options fee model (per-contract).
 *
 * 实际费率（长桥期权交易）：
 * - 佣金：1.49 USD/张（普通期权）或 0.99 USD/张（低价期权，每笔订单<0.1USD）
 * - 平台费：0.30 USD/张
 * - 期权交易费：0.18 USD/张
 * - 期权监管费：0.02375 USD/张
 * - 期权清算费：0.025 USD/张（每笔订单）
 * - 交易活动费：0.00329 USD/张（单笔订单最低0.01USD，仅卖单收取）
 */
export interface OptionsFeeModelConfig {
  commissionPerContract: number; // 佣金 USD/contract
  lowPriceCommission: number; // 低价期权佣金 USD/contract
  lowPriceThreshold: number; // 低价期权阈值 USD
  platformFeePerContract: number; // 平台费 USD/contract
  exchangeFeePerContract: number; // 期权交易费 USD/contract
  regulatoryFeePerContract: number; // 期权监管费 USD/contract
  clearingFeePerOrder: number; // 期权清算费 USD/order
  activityFeePerContract: number; // 交易活动费 USD/contract (仅卖单)
  activityFeeMin: number; // 交易活动费最低 USD (仅卖单)
}

export interface OptionsFeeBreakdown {
  contracts: number;
  commission: number;
  platformFee: number;
  exchangeFee: number;
  regulatoryFee: number;
  clearingFee: number;
  activityFee: number; // 仅卖单
  totalFees: number;
}

export const DEFAULT_OPTIONS_FEE_MODEL: OptionsFeeModelConfig = {
  commissionPerContract: 1.49, // 普通期权佣金
  lowPriceCommission: 0.99, // 低价期权佣金
  lowPriceThreshold: 0.10, // 低价阈值
  platformFeePerContract: 0.30, // 平台费
  exchangeFeePerContract: 0.18, // 期权交易费
  regulatoryFeePerContract: 0.02375, // 期权监管费
  clearingFeePerOrder: 0.025, // 期权清算费（每笔订单）
  activityFeePerContract: 0.00329, // 交易活动费
  activityFeeMin: 0.01, // 交易活动费最低
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function calculateOptionsFees(
  contracts: number,
  cfg: Partial<OptionsFeeModelConfig> = {},
  params?: {
    premium?: number; // 用于判断是否为低价期权
    side?: 'BUY' | 'SELL'; // 用于判断是否收取交易活动费
  }
): OptionsFeeBreakdown {
  const c = {
    ...DEFAULT_OPTIONS_FEE_MODEL,
    ...cfg,
  };

  const safeContracts = Math.max(0, Math.floor(contracts));

  if (safeContracts === 0) {
    return {
      contracts: 0,
      commission: 0,
      platformFee: 0,
      exchangeFee: 0,
      regulatoryFee: 0,
      clearingFee: 0,
      activityFee: 0,
      totalFees: 0,
    };
  }

  // 判断是否为低价期权（premium < 0.10）
  const isLowPrice = params?.premium !== undefined && params.premium < c.lowPriceThreshold;
  const commissionPerContract = isLowPrice ? c.lowPriceCommission : c.commissionPerContract;
  const commission = commissionPerContract * safeContracts;

  // 平台费
  const platformFee = c.platformFeePerContract * safeContracts;

  // 期权交易费
  const exchangeFee = c.exchangeFeePerContract * safeContracts;

  // 期权监管费
  const regulatoryFee = c.regulatoryFeePerContract * safeContracts;

  // 期权清算费（每笔订单）
  const clearingFee = c.clearingFeePerOrder;

  // 交易活动费（仅卖单）
  let activityFee = 0;
  if (params?.side === 'SELL') {
    const calculatedFee = c.activityFeePerContract * safeContracts;
    activityFee = Math.max(c.activityFeeMin, calculatedFee);
  }

  const totalFees = commission + platformFee + exchangeFee + regulatoryFee + clearingFee + activityFee;

  return {
    contracts: safeContracts,
    commission: round2(commission),
    platformFee: round2(platformFee),
    exchangeFee: round2(exchangeFee),
    regulatoryFee: round2(regulatoryFee),
    clearingFee: round2(clearingFee),
    activityFee: round2(activityFee),
    totalFees: round2(totalFees),
  };
}

export function estimateOptionOrderTotalCost(params: {
  premium: number; // option price per contract
  contracts: number;
  multiplier?: number; // default 100
  side?: 'BUY' | 'SELL'; // 用于计算交易活动费
  feeModel?: Partial<OptionsFeeModelConfig>;
}): { totalCost: number; fees: OptionsFeeBreakdown } {
  const multiplier = params.multiplier ?? 100;
  const fees = calculateOptionsFees(
    params.contracts,
    params.feeModel,
    {
      premium: params.premium,
      side: params.side || 'BUY',
    }
  );
  const premiumCost = (params.premium || 0) * multiplier * fees.contracts;
  return {
    totalCost: round2(premiumCost + fees.totalFees),
    fees,
  };
}

