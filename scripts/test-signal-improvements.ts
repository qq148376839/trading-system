/**
 * 多方案测试脚本
 * 用于测试不同的买入信号优化方案
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestConfig {
  name: string;
  description: string;
  filters: {
    minMarketStrength?: number;
    excludeMarketEnvs?: string[];
    excludeStockTrends?: string[];
    minHoldingDays?: number;
  };
}

const testConfigs: TestConfig[] = [
  {
    name: 'baseline',
    description: '基准方案（无过滤）',
    filters: {},
  },
  {
    name: 'higher-market-strength',
    description: '提高市场强度门槛（≥22）',
    filters: {
      minMarketStrength: 22,
    },
  },
  {
    name: 'exclude-bad-market',
    description: '排除不利市场环境',
    filters: {
      excludeMarketEnvs: ['利空', '较差'],
    },
  },
  {
    name: 'exclude-down-trend',
    description: '排除下降趋势',
    filters: {
      excludeStockTrends: ['下降趋势'],
    },
  },
  {
    name: 'combined-1',
    description: '组合方案1：提高市场强度 + 排除不利市场',
    filters: {
      minMarketStrength: 22,
      excludeMarketEnvs: ['利空', '较差'],
    },
  },
  {
    name: 'combined-2',
    description: '组合方案2：提高市场强度 + 排除下降趋势',
    filters: {
      minMarketStrength: 22,
      excludeStockTrends: ['下降趋势'],
    },
  },
  {
    name: 'combined-3',
    description: '组合方案3：全部优化',
    filters: {
      minMarketStrength: 22,
      excludeMarketEnvs: ['利空', '较差'],
      excludeStockTrends: ['下降趋势'],
    },
  },
];

interface Trade {
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
  entryReason: string;
}

interface BacktestData {
  trades: Trade[];
  performance: {
    totalReturn: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
  };
}

/**
 * 解析entryReason，提取市场环境信息
 */
function parseEntryReason(entryReason: string): {
  marketEnv?: string;
  marketStrength?: number;
  stockTrend?: string;
} {
  const result: {
    marketEnv?: string;
    marketStrength?: number;
    stockTrend?: string;
  } = {};

  const marketEnvMatch = entryReason.match(/市场环境([^；]+)/);
  if (marketEnvMatch) {
    result.marketEnv = marketEnvMatch[1].trim();
  }

  const strengthMatch = entryReason.match(/综合市场强度\s*(\d+\.?\d*)/);
  if (strengthMatch) {
    result.marketStrength = parseFloat(strengthMatch[1]);
  }

  const trendMatch = entryReason.match(/目标股票[^，]+，([^。]+)/);
  if (trendMatch) {
    result.stockTrend = trendMatch[1].trim();
  }

  return result;
}

/**
 * 应用过滤条件
 */
function applyFilters(trade: Trade, config: TestConfig): boolean {
  const { marketEnv, marketStrength, stockTrend } = parseEntryReason(trade.entryReason);

  // 市场强度过滤
  if (config.filters.minMarketStrength !== undefined) {
    if (marketStrength === undefined || marketStrength < config.filters.minMarketStrength) {
      return false;
    }
  }

  // 市场环境过滤
  if (config.filters.excludeMarketEnvs && marketEnv) {
    if (config.filters.excludeMarketEnvs.some(env => marketEnv.includes(env))) {
      return false;
    }
  }

  // 股票趋势过滤
  if (config.filters.excludeStockTrends && stockTrend) {
    if (config.filters.excludeStockTrends.some(trend => stockTrend.includes(trend))) {
      return false;
    }
  }

  return true;
}

/**
 * 计算回测结果
 */
function calculateResults(filteredTrades: Trade[]): {
  totalReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgReturn: number;
  avgWin: number;
  avgLoss: number;
} {
  const totalTrades = filteredTrades.length;
  const winningTrades = filteredTrades.filter(t => t.pnl > 0).length;
  const losingTrades = filteredTrades.filter(t => t.pnl < 0).length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const totalReturn = filteredTrades.reduce((sum, t) => sum + t.pnlPercent, 0);
  const avgReturn = totalTrades > 0 ? totalReturn / totalTrades : 0;

  const wins = filteredTrades.filter(t => t.pnl > 0).map(t => t.pnlPercent);
  const losses = filteredTrades.filter(t => t.pnl < 0).map(t => t.pnlPercent);
  const avgWin = wins.length > 0 ? wins.reduce((sum, w) => sum + w, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / losses.length : 0;

  return {
    totalReturn,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    avgReturn,
    avgWin,
    avgLoss,
  };
}

/**
 * 运行测试
 */
function runTests(backtestFile: string): void {
  console.log('='.repeat(80));
  console.log('买入信号优化方案测试');
  console.log('='.repeat(80));

  // 读取回测数据
  const data: BacktestData = JSON.parse(fs.readFileSync(backtestFile, 'utf-8'));
  const allTrades = data.trades;

  console.log(`\n总交易数: ${allTrades.length}`);
  console.log(`基准胜率: ${data.performance.winRate.toFixed(2)}%`);
  console.log(`基准总收益率: ${data.performance.totalReturn.toFixed(2)}%\n`);

  const results: Array<{
    config: TestConfig;
    results: ReturnType<typeof calculateResults>;
    improvement: {
      winRateChange: number;
      returnChange: number;
      tradeCountChange: number;
    };
  }> = [];

  // 运行每个测试配置
  for (const config of testConfigs) {
    const filteredTrades = allTrades.filter(trade => applyFilters(trade, config));
    const testResults = calculateResults(filteredTrades);

    const improvement = {
      winRateChange: testResults.winRate - data.performance.winRate,
      returnChange: testResults.totalReturn - data.performance.totalReturn,
      tradeCountChange: testResults.totalTrades - allTrades.length,
    };

    results.push({
      config,
      results: testResults,
      improvement,
    });

    console.log('-'.repeat(80));
    console.log(`方案: ${config.name}`);
    console.log(`描述: ${config.description}`);
    console.log(`交易数: ${testResults.totalTrades} (${improvement.tradeCountChange > 0 ? '+' : ''}${improvement.tradeCountChange})`);
    console.log(`胜率: ${testResults.winRate.toFixed(2)}% (${improvement.winRateChange > 0 ? '+' : ''}${improvement.winRateChange.toFixed(2)}%)`);
    console.log(`总收益率: ${testResults.totalReturn.toFixed(2)}% (${improvement.returnChange > 0 ? '+' : ''}${improvement.returnChange.toFixed(2)}%)`);
    console.log(`平均收益率: ${testResults.avgReturn.toFixed(2)}%`);
    console.log(`平均盈利: ${testResults.avgWin.toFixed(2)}%`);
    console.log(`平均亏损: ${testResults.avgLoss.toFixed(2)}%`);
  }

  // 找出最佳方案
  console.log('\n' + '='.repeat(80));
  console.log('最佳方案推荐');
  console.log('='.repeat(80));

  // 按胜率排序
  const bestWinRate = results
    .filter(r => r.results.totalTrades >= allTrades.length * 0.5) // 至少保留50%的交易
    .sort((a, b) => b.results.winRate - a.results.winRate)[0];

  // 按总收益率排序
  const bestReturn = results
    .filter(r => r.results.totalTrades >= allTrades.length * 0.5)
    .sort((a, b) => b.results.totalReturn - a.results.totalReturn)[0];

  // 按综合评分排序（胜率 * 0.4 + 总收益率 * 0.6）
  const bestOverall = results
    .filter(r => r.results.totalTrades >= allTrades.length * 0.5)
    .sort((a, b) => {
      const scoreA = a.results.winRate * 0.4 + a.results.totalReturn * 0.6;
      const scoreB = b.results.winRate * 0.4 + b.results.totalReturn * 0.6;
      return scoreB - scoreA;
    })[0];

  console.log(`\n最佳胜率方案: ${bestWinRate.config.name}`);
  console.log(`  胜率: ${bestWinRate.results.winRate.toFixed(2)}%`);
  console.log(`  总收益率: ${bestWinRate.results.totalReturn.toFixed(2)}%`);
  console.log(`  交易数: ${bestWinRate.results.totalTrades}`);

  console.log(`\n最佳收益率方案: ${bestReturn.config.name}`);
  console.log(`  胜率: ${bestReturn.results.winRate.toFixed(2)}%`);
  console.log(`  总收益率: ${bestReturn.results.totalReturn.toFixed(2)}%`);
  console.log(`  交易数: ${bestReturn.results.totalTrades}`);

  console.log(`\n最佳综合方案: ${bestOverall.config.name}`);
  console.log(`  胜率: ${bestOverall.results.winRate.toFixed(2)}%`);
  console.log(`  总收益率: ${bestOverall.results.totalReturn.toFixed(2)}%`);
  console.log(`  交易数: ${bestOverall.results.totalTrades}`);

  // 保存测试结果
  const outputFile = path.join(
    path.dirname(backtestFile),
    `signal-improvement-test-${Date.now()}.json`
  );
  fs.writeFileSync(outputFile, JSON.stringify({
    baseline: {
      totalTrades: allTrades.length,
      winRate: data.performance.winRate,
      totalReturn: data.performance.totalReturn,
    },
    testResults: results,
    recommendations: {
      bestWinRate: bestWinRate.config.name,
      bestReturn: bestReturn.config.name,
      bestOverall: bestOverall.config.name,
    },
  }, null, 2));
  console.log(`\n✅ 测试结果已保存到: ${outputFile}`);
}

// 主函数
if (require.main === module) {
  const backtestFile = process.argv[2];
  if (!backtestFile) {
    console.error('用法: ts-node test-signal-improvements.ts <回测JSON文件>');
    process.exit(1);
  }

  if (!fs.existsSync(backtestFile)) {
    console.error(`错误: 文件不存在: ${backtestFile}`);
    process.exit(1);
  }

  runTests(backtestFile);
}

export { runTests, testConfigs };




