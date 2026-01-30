/**
 * 分析失败交易的共同特性
 * 用于优化买入信号质量
 */

import * as fs from 'fs';
import * as path from 'path';

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
  stopLoss?: number;
  takeProfit?: number;
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

interface FailedTradeAnalysis {
  symbol: string;
  entryDate: string;
  exitDate: string;
  pnlPercent: number;
  exitReason: string;
  entryReason: string;
  holdingDays: number;
  marketEnv?: string;
  marketStrength?: number;
  stockTrend?: string;
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

  // 提取市场环境
  const marketEnvMatch = entryReason.match(/市场环境([^；]+)/);
  if (marketEnvMatch) {
    result.marketEnv = marketEnvMatch[1].trim();
  }

  // 提取市场强度
  const strengthMatch = entryReason.match(/综合市场强度\s*(\d+\.?\d*)/);
  if (strengthMatch) {
    result.marketStrength = parseFloat(strengthMatch[1]);
  }

  // 提取股票趋势
  const trendMatch = entryReason.match(/目标股票[^，]+，([^。]+)/);
  if (trendMatch) {
    result.stockTrend = trendMatch[1].trim();
  }

  return result;
}

/**
 * 计算持仓天数
 */
function calculateHoldingDays(entryDate: string, exitDate: string): number {
  const entry = new Date(entryDate);
  const exit = new Date(exitDate);
  const diffTime = Math.abs(exit.getTime() - entry.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * 分析失败交易
 */
function analyzeFailedTrades(backtestFile: string): void {
  console.log('='.repeat(80));
  console.log('失败交易分析');
  console.log('='.repeat(80));

  // 读取回测数据
  const data: BacktestData = JSON.parse(fs.readFileSync(backtestFile, 'utf-8'));
  const trades = data.trades;

  // 筛选失败交易（亏损交易）
  const failedTrades = trades
    .filter(t => t.pnl < 0)
    .map(t => {
      const analysis: FailedTradeAnalysis = {
        symbol: t.symbol,
        entryDate: t.entryDate,
        exitDate: t.exitDate,
        pnlPercent: t.pnlPercent,
        exitReason: t.exitReason,
        entryReason: t.entryReason,
        holdingDays: calculateHoldingDays(t.entryDate, t.exitDate),
        ...parseEntryReason(t.entryReason),
      };
      return analysis;
    });

  console.log(`\n总交易数: ${trades.length}`);
  console.log(`失败交易数: ${failedTrades.length}`);
  console.log(`胜率: ${data.performance.winRate.toFixed(2)}%`);

  // 1. 按退出原因分析
  console.log('\n' + '-'.repeat(80));
  console.log('1. 按退出原因分析');
  console.log('-'.repeat(80));
  const exitReasonStats: Record<string, number> = {};
  failedTrades.forEach(t => {
    exitReasonStats[t.exitReason] = (exitReasonStats[t.exitReason] || 0) + 1;
  });
  Object.entries(exitReasonStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      console.log(`${reason}: ${count}笔 (${((count / failedTrades.length) * 100).toFixed(1)}%)`);
    });

  // 2. 按市场环境分析
  console.log('\n' + '-'.repeat(80));
  console.log('2. 按市场环境分析');
  console.log('-'.repeat(80));
  const marketEnvStats: Record<string, number> = {};
  failedTrades.forEach(t => {
    const env = t.marketEnv || '未知';
    marketEnvStats[env] = (marketEnvStats[env] || 0) + 1;
  });
  Object.entries(marketEnvStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([env, count]) => {
      console.log(`${env}: ${count}笔 (${((count / failedTrades.length) * 100).toFixed(1)}%)`);
    });

  // 3. 按股票趋势分析
  console.log('\n' + '-'.repeat(80));
  console.log('3. 按股票趋势分析');
  console.log('-'.repeat(80));
  const stockTrendStats: Record<string, number> = {};
  failedTrades.forEach(t => {
    const trend = t.stockTrend || '未知';
    stockTrendStats[trend] = (stockTrendStats[trend] || 0) + 1;
  });
  Object.entries(stockTrendStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([trend, count]) => {
      console.log(`${trend}: ${count}笔 (${((count / failedTrades.length) * 100).toFixed(1)}%)`);
    });

  // 4. 按市场强度分析
  console.log('\n' + '-'.repeat(80));
  console.log('4. 按市场强度分析');
  console.log('-'.repeat(80));
  const strengthRanges = [
    { min: 0, max: 20, label: '0-20' },
    { min: 20, max: 25, label: '20-25' },
    { min: 25, max: 30, label: '25-30' },
    { min: 30, max: Infinity, label: '30+' },
  ];
  const strengthStats: Record<string, number> = {};
  failedTrades.forEach(t => {
    if (t.marketStrength !== undefined) {
      const range = strengthRanges.find(r => t.marketStrength! >= r.min && t.marketStrength! < r.max);
      const label = range ? range.label : '未知';
      strengthStats[label] = (strengthStats[label] || 0) + 1;
    }
  });
  Object.entries(strengthStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([range, count]) => {
      console.log(`市场强度 ${range}: ${count}笔 (${((count / failedTrades.length) * 100).toFixed(1)}%)`);
    });

  // 5. 按持仓时间分析
  console.log('\n' + '-'.repeat(80));
  console.log('5. 按持仓时间分析');
  console.log('-'.repeat(80));
  const holdingTimeRanges = [
    { min: 0, max: 3, label: '0-3天' },
    { min: 3, max: 7, label: '3-7天' },
    { min: 7, max: 14, label: '7-14天' },
    { min: 14, max: 30, label: '14-30天' },
    { min: 30, max: Infinity, label: '30天+' },
  ];
  const holdingTimeStats: Record<string, number> = {};
  failedTrades.forEach(t => {
    const range = holdingTimeRanges.find(r => t.holdingDays >= r.min && t.holdingDays < r.max);
    const label = range ? range.label : '未知';
    holdingTimeStats[label] = (holdingTimeStats[label] || 0) + 1;
  });
  Object.entries(holdingTimeStats)
    .sort((a, b) => {
      const aMin = holdingTimeRanges.find(r => r.label === a[0])?.min || 0;
      const bMin = holdingTimeRanges.find(r => r.label === b[0])?.min || 0;
      return aMin - bMin;
    })
    .forEach(([range, count]) => {
      console.log(`${range}: ${count}笔 (${((count / failedTrades.length) * 100).toFixed(1)}%)`);
    });

  // 6. 按标的分析（失败次数最多的标的）
  console.log('\n' + '-'.repeat(80));
  console.log('6. 失败次数最多的标的（Top 10）');
  console.log('-'.repeat(80));
  const symbolStats: Record<string, number> = {};
  failedTrades.forEach(t => {
    symbolStats[t.symbol] = (symbolStats[t.symbol] || 0) + 1;
  });
  Object.entries(symbolStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([symbol, count], index) => {
      console.log(`${index + 1}. ${symbol}: ${count}笔失败`);
    });

  // 7. 平均亏损分析
  console.log('\n' + '-'.repeat(80));
  console.log('7. 平均亏损分析');
  console.log('-'.repeat(80));
  const avgLoss = failedTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / failedTrades.length;
  const maxLoss = Math.min(...failedTrades.map(t => t.pnlPercent));
  const minLoss = Math.max(...failedTrades.map(t => t.pnlPercent));
  console.log(`平均亏损: ${avgLoss.toFixed(2)}%`);
  console.log(`最大亏损: ${maxLoss.toFixed(2)}%`);
  console.log(`最小亏损: ${minLoss.toFixed(2)}%`);

  // 8. 生成优化建议
  console.log('\n' + '='.repeat(80));
  console.log('优化建议');
  console.log('='.repeat(80));

  // 分析最常见的失败模式
  const stopLossFailures = failedTrades.filter(t => t.exitReason === 'STOP_LOSS').length;
  const stopLossRatio = (stopLossFailures / failedTrades.length) * 100;

  console.log(`\n止损失败占比: ${stopLossRatio.toFixed(1)}%`);
  if (stopLossRatio > 50) {
    console.log('⚠️  建议：止损设置可能过于严格，考虑放宽止损条件或优化止损位置');
  }

  // 分析市场环境
  const badMarketEnv = failedTrades.filter(t => 
    t.marketEnv && (t.marketEnv.includes('利空') || t.marketEnv.includes('较差'))
  ).length;
  const badMarketRatio = (badMarketEnv / failedTrades.length) * 100;
  console.log(`\n不利市场环境占比: ${badMarketRatio.toFixed(1)}%`);
  if (badMarketRatio > 30) {
    console.log('⚠️  建议：在市场环境不利时减少交易，或提高买入信号门槛');
  }

  // 分析股票趋势
  const downTrend = failedTrades.filter(t => 
    t.stockTrend && t.stockTrend.includes('下降')
  ).length;
  const downTrendRatio = (downTrend / failedTrades.length) * 100;
  console.log(`\n下降趋势占比: ${downTrendRatio.toFixed(1)}%`);
  if (downTrendRatio > 20) {
    console.log('⚠️  建议：避免在下降趋势中买入，或增加趋势确认');
  }

  // 分析持仓时间
  const shortHolding = failedTrades.filter(t => t.holdingDays <= 3).length;
  const shortHoldingRatio = (shortHolding / failedTrades.length) * 100;
  console.log(`\n短期持仓（≤3天）失败占比: ${shortHoldingRatio.toFixed(1)}%`);
  if (shortHoldingRatio > 40) {
    console.log('⚠️  建议：短期持仓失败率高，考虑增加持仓时间或优化买入时机');
  }

  // 保存详细分析结果
  const analysisResult = {
    summary: {
      totalTrades: trades.length,
      failedTrades: failedTrades.length,
      winRate: data.performance.winRate,
      avgLoss: avgLoss,
      maxLoss: maxLoss,
      minLoss: minLoss,
    },
    exitReasonStats,
    marketEnvStats,
    stockTrendStats,
    strengthStats,
    holdingTimeStats,
    symbolStats: Object.fromEntries(
      Object.entries(symbolStats).sort((a, b) => b[1] - a[1]).slice(0, 10)
    ),
    failedTrades: failedTrades.slice(0, 50), // 保存前50笔失败交易详情
  };

  const outputFile = path.join(
    path.dirname(backtestFile),
    `failed-trades-analysis-${Date.now()}.json`
  );
  fs.writeFileSync(outputFile, JSON.stringify(analysisResult, null, 2));
  console.log(`\n✅ 详细分析结果已保存到: ${outputFile}`);
}

// 主函数
if (require.main === module) {
  const backtestFile = process.argv[2];
  if (!backtestFile) {
    console.error('用法: ts-node analyze-failed-trades.ts <回测JSON文件>');
    process.exit(1);
  }

  if (!fs.existsSync(backtestFile)) {
    console.error(`错误: 文件不存在: ${backtestFile}`);
    process.exit(1);
  }

  analyzeFailedTrades(backtestFile);
}

export { analyzeFailedTrades };





