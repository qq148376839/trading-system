/**
 * 分析交易成本对收益的影响
 */

import * as fs from 'fs';
import * as path from 'path';

interface Trade {
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
}

interface BacktestData {
  trades: Trade[];
  performance: {
    totalReturn: number;
    totalTrades: number;
    initialCapital?: number;
  };
}

interface CostConfig {
  name: string;
  commissionRate: number; // 手续费率（如0.001表示0.1%）
  slippageRate: number; // 滑点率（如0.0005表示0.05%）
}

const costConfigs: CostConfig[] = [
  {
    name: 'no-cost',
    commissionRate: 0,
    slippageRate: 0,
  },
  {
    name: 'low-cost',
    commissionRate: 0.001, // 0.1%
    slippageRate: 0.0005, // 0.05%
  },
  {
    name: 'medium-cost',
    commissionRate: 0.002, // 0.2%
    slippageRate: 0.001, // 0.1%
  },
  {
    name: 'high-cost',
    commissionRate: 0.003, // 0.3%
    slippageRate: 0.002, // 0.2%
  },
];

/**
 * 计算交易成本
 */
function calculateCosts(
  trade: Trade,
  config: CostConfig
): {
  entryCost: number;
  exitCost: number;
  totalCost: number;
  costPercent: number;
} {
  const entryValue = trade.entryPrice * trade.quantity;
  const exitValue = trade.exitPrice * trade.quantity;

  // 买入成本：手续费 + 滑点
  const entryCommission = entryValue * config.commissionRate;
  const entrySlippage = entryValue * config.slippageRate;
  const entryCost = entryCommission + entrySlippage;

  // 卖出成本：手续费 + 滑点
  const exitCommission = exitValue * config.commissionRate;
  const exitSlippage = exitValue * config.slippageRate;
  const exitCost = exitCommission + exitSlippage;

  const totalCost = entryCost + exitCost;
  const costPercent = (totalCost / entryValue) * 100;

  return {
    entryCost,
    exitCost,
    totalCost,
    costPercent,
  };
}

/**
 * 分析交易成本影响
 */
function analyzeTradingCosts(backtestFile: string): void {
  console.log('='.repeat(80));
  console.log('交易成本影响分析');
  console.log('='.repeat(80));

  // 读取回测数据
  const data: BacktestData = JSON.parse(fs.readFileSync(backtestFile, 'utf-8'));
  const trades = data.trades;
  const initialCapital = data.performance.initialCapital || 10000;

  console.log(`\n总交易数: ${trades.length}`);
  console.log(`初始资金: $${initialCapital.toLocaleString()}`);
  console.log(`无成本总收益率: ${data.performance.totalReturn.toFixed(2)}%\n`);

  const results: Array<{
    config: CostConfig;
    totalCost: number;
    netReturn: number;
    netReturnPercent: number;
    impact: number;
  }> = [];

  // 计算每个成本配置的影响
  for (const config of costConfigs) {
    let totalCost = 0;
    let totalPnL = 0;

    trades.forEach(trade => {
      const costs = calculateCosts(trade, config);
      totalCost += costs.totalCost;
      totalPnL += trade.pnl;
    });

    const netPnL = totalPnL - totalCost;
    const netReturn = (netPnL / initialCapital) * 100;
    const netReturnPercent = netReturn;
    const impact = data.performance.totalReturn - netReturnPercent;

    results.push({
      config,
      totalCost,
      netReturn: netPnL,
      netReturnPercent,
      impact,
    });

    console.log('-'.repeat(80));
    console.log(`成本配置: ${config.name}`);
    console.log(`  手续费率: ${(config.commissionRate * 100).toFixed(2)}%`);
    console.log(`  滑点率: ${(config.slippageRate * 100).toFixed(2)}%`);
    console.log(`  总成本: $${totalCost.toFixed(2)}`);
    console.log(`  净收益率: ${netReturnPercent.toFixed(2)}%`);
    console.log(`  成本影响: -${impact.toFixed(2)}%`);
  }

  // 分析成本对交易的影响
  console.log('\n' + '='.repeat(80));
  console.log('成本影响分析');
  console.log('='.repeat(80));

  // 找出平均交易成本
  const avgCostPerTrade = results
    .filter(r => r.config.name !== 'no-cost')
    .map(r => r.totalCost / trades.length);
  const avgCost = avgCostPerTrade.reduce((sum, cost) => sum + cost, 0) / avgCostPerTrade.length;

  console.log(`\n平均每笔交易成本: $${avgCost.toFixed(2)}`);
  console.log(`总交易成本（中等成本）: $${results.find(r => r.config.name === 'medium-cost')?.totalCost.toFixed(2)}`);

  // 分析哪些交易会因为成本而变成亏损
  const mediumCostConfig = costConfigs.find(c => c.name === 'medium-cost')!;
  const losingTradesWithCost = trades.filter(trade => {
    const costs = calculateCosts(trade, mediumCostConfig);
    const netPnL = trade.pnl - costs.totalCost;
    return netPnL < 0 && trade.pnl > 0; // 原本盈利，加上成本后亏损
  }).length;

  console.log(`\n因成本从盈利变亏损的交易数: ${losingTradesWithCost}笔`);
  console.log(`占比: ${((losingTradesWithCost / trades.length) * 100).toFixed(2)}%`);

  // 分析成本对胜率的影响
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const winRateWithoutCost = (winningTrades / trades.length) * 100;

  const winningTradesWithCost = trades.filter(trade => {
    const costs = calculateCosts(trade, mediumCostConfig);
    const netPnL = trade.pnl - costs.totalCost;
    return netPnL > 0;
  }).length;
  const winRateWithCost = (winningTradesWithCost / trades.length) * 100;

  console.log(`\n胜率变化:`);
  console.log(`  无成本: ${winRateWithoutCost.toFixed(2)}%`);
  console.log(`  有成本（中等）: ${winRateWithCost.toFixed(2)}%`);
  console.log(`  影响: -${(winRateWithoutCost - winRateWithCost).toFixed(2)}%`);

  // 分析小额交易的成本影响
  const smallTrades = trades.filter(t => {
    const tradeValue = t.entryPrice * t.quantity;
    return tradeValue < 500; // 小于$500的交易
  });

  if (smallTrades.length > 0) {
    console.log(`\n小额交易（<$500）分析:`);
    console.log(`  数量: ${smallTrades.length}笔`);
    
    const smallTradesCost = smallTrades.reduce((sum, trade) => {
      const costs = calculateCosts(trade, mediumCostConfig);
      return sum + costs.totalCost;
    }, 0);
    
    const smallTradesPnL = smallTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const smallTradesNetPnL = smallTradesPnL - smallTradesCost;
    
    console.log(`  总成本: $${smallTradesCost.toFixed(2)}`);
    console.log(`  总盈亏: $${smallTradesPnL.toFixed(2)}`);
    console.log(`  净盈亏: $${smallTradesNetPnL.toFixed(2)}`);
    console.log(`  成本占比: ${((smallTradesCost / Math.abs(smallTradesPnL)) * 100).toFixed(2)}%`);
  }

  // 生成建议
  console.log('\n' + '='.repeat(80));
  console.log('优化建议');
  console.log('='.repeat(80));

  const mediumCostImpact = results.find(r => r.config.name === 'medium-cost')?.impact || 0;
  if (mediumCostImpact > 5) {
    console.log(`\n⚠️  成本影响较大（-${mediumCostImpact.toFixed(2)}%），建议：`);
    console.log('  1. 减少交易频率，提高交易质量');
    console.log('  2. 避免小额交易（成本占比高）');
    console.log('  3. 优化交易时机，减少滑点');
  } else {
    console.log(`\n✅ 成本影响较小（-${mediumCostImpact.toFixed(2)}%），当前交易频率合理`);
  }

  // 保存分析结果
  const outputFile = path.join(
    path.dirname(backtestFile),
    `trading-costs-analysis-${Date.now()}.json`
  );
  fs.writeFileSync(outputFile, JSON.stringify({
    summary: {
      totalTrades: trades.length,
      initialCapital,
      returnWithoutCost: data.performance.totalReturn,
    },
    costConfigs: results,
    impactAnalysis: {
      avgCostPerTrade,
      losingTradesWithCost,
      winRateWithoutCost,
      winRateWithCost,
      smallTradesCount: smallTrades.length,
    },
  }, null, 2));
  console.log(`\n✅ 分析结果已保存到: ${outputFile}`);
}

// 主函数
if (require.main === module) {
  const backtestFile = process.argv[2];
  if (!backtestFile) {
    console.error('用法: ts-node analyze-trading-costs.ts <回测JSON文件>');
    process.exit(1);
  }

  if (!fs.existsSync(backtestFile)) {
    console.error(`错误: 文件不存在: ${backtestFile}`);
    process.exit(1);
  }

  analyzeTradingCosts(backtestFile);
}

export { analyzeTradingCosts, costConfigs };




