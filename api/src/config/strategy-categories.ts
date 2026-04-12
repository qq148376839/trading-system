/**
 * 策略类别映射 — 同类别策略互斥（不能同时运行）
 * STOCK 类别：所有正股策略共享标的池和资金，并发会争抢
 * OPTION 类别：所有期权策略共享合约通道，并发会冲突
 */
export const STRATEGY_CATEGORIES: Record<string, string[]> = {
  STOCK: ['RECOMMENDATION_V1', 'TREND_FOLLOWING_V1', 'STOCK_SCREENING_V1'],
  OPTION: ['OPTION_INTRADAY_V1', 'OPTION_SCHWARTZ_V1'],
};

/**
 * 根据策略类型找到同类别的所有类型
 * 用于启动时互斥校验：同类别内只允许一个策略运行
 */
export function getSameCategoryTypes(type: string): string[] {
  for (const [, types] of Object.entries(STRATEGY_CATEGORIES)) {
    if (types.includes(type)) return types;
  }
  return [type]; // 未分类则仅限同类型
}
