/**
 * 策略回测脚本
 * Phase 1: 简单的回测功能实现
 * 
 * 使用方式:
 * npm run backtest -- --strategy-id=1 --start-date=2025-01-01 --end-date=2025-12-01 --symbol=AAPL.US
 */

import dotenv from 'dotenv';
import pool from '../src/config/database';
import { RecommendationStrategy } from '../src/services/strategies/recommendation-strategy';
import tradingRecommendationService from '../src/services/trading-recommendation.service';
import { getQuoteContext } from '../src/config/longport';

// 加载环境变量
dotenv.config();

interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  entryReason: string;
  exitReason: string | null;
}

interface BacktestResult {
  totalReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgHoldingTime: number; // 小时
  trades: BacktestTrade[];
  dailyReturns: Array<{ date: string; return: number; equity: number }>;
}

class BacktestEngine {
  private initialCapital: number = 10000; // 初始资金
  private currentCapital: number = 10000;
  private positions: Map<string, BacktestTrade> = new Map();
  private trades: BacktestTrade[] = [];
  private dailyEquity: Array<{ date: string; equity: number }> = [];

  /**
   * 获取历史K线数据
   */
  private async getHistoricalCandlesticks(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>> {
    try {
      const quoteCtx = await getQuoteContext();
      const longport = require('longport');
      const { Period, AdjustType } = longport;

      // 计算需要的K线数量（大约）
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const count = Math.min(daysDiff + 50, 500); // 最多500根，确保有足够数据

      const candlesticks = await quoteCtx.candlesticks(
        symbol,
        Period.Day,
        count,
        AdjustType.NoAdjust
      );

      // 转换为标准格式并过滤日期范围
      const result = candlesticks
        .map((c: any) => ({
          timestamp: new Date(c.timestamp),
          open: typeof c.open === 'number' ? c.open : parseFloat(String(c.open || 0)),
          high: typeof c.high === 'number' ? c.high : parseFloat(String(c.high || 0)),
          low: typeof c.low === 'number' ? c.low : parseFloat(String(c.low || 0)),
          close: typeof c.close === 'number' ? c.close : parseFloat(String(c.close || 0)),
          volume: typeof c.volume === 'number' ? c.volume : parseFloat(String(c.volume || 0)),
        }))
        .filter((c: any) => c.timestamp >= startDate && c.timestamp <= endDate)
        .sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime());

      return result;
    } catch (error: any) {
      console.error(`获取历史数据失败 (${symbol}):`, error.message);
      return [];
    }
  }

  /**
   * 模拟买入
   */
  private simulateBuy(
    symbol: string,
    date: string,
    price: number,
    reason: string
  ): boolean {
    // 检查是否已有持仓
    if (this.positions.has(symbol)) {
      return false;
    }

    // 计算可买入数量（假设每次使用10%的资金）
    const tradeAmount = this.currentCapital * 0.1;
    const quantity = Math.floor(tradeAmount / price);

    if (quantity <= 0) {
      return false;
    }

    const trade: BacktestTrade = {
      symbol,
      entryDate: date,
      exitDate: null,
      entryPrice: price,
      exitPrice: null,
      quantity,
      pnl: 0,
      pnlPercent: 0,
      entryReason: reason,
      exitReason: null,
    };

    this.positions.set(symbol, trade);
    return true;
  }

  /**
   * 模拟卖出
   */
  private simulateSell(
    symbol: string,
    date: string,
    price: number,
    reason: string
  ): boolean {
    const trade = this.positions.get(symbol);
    if (!trade) {
      return false;
    }

    // 计算盈亏
    const pnl = (price - trade.entryPrice) * trade.quantity;
    const pnlPercent = ((price - trade.entryPrice) / trade.entryPrice) * 100;

    trade.exitDate = date;
    trade.exitPrice = price;
    trade.pnl = pnl;
    trade.pnlPercent = pnlPercent;
    trade.exitReason = reason;

    // 更新资金
    this.currentCapital += pnl;

    // 记录交易
    this.trades.push({ ...trade });
    this.positions.delete(symbol);

    return true;
  }

  /**
   * 检查止损止盈
   */
  private checkStopLossTakeProfit(
    symbol: string,
    currentPrice: number,
    stopLoss: number,
    takeProfit: number
  ): string | null {
    const trade = this.positions.get(symbol);
    if (!trade) {
      return null;
    }

    if (currentPrice <= stopLoss) {
      return 'STOP_LOSS';
    }
    if (currentPrice >= takeProfit) {
      return 'TAKE_PROFIT';
    }
    return null;
  }

  /**
   * 执行回测
   */
  async runBacktest(
    strategyId: number,
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<BacktestResult> {
    console.log(`\n开始回测: 策略ID=${strategyId}, 标的=${symbol}`);
    console.log(`时间范围: ${startDate.toISOString().split('T')[0]} 至 ${endDate.toISOString().split('T')[0]}`);

    // 重置状态
    this.initialCapital = 10000;
    this.currentCapital = 10000;
    this.positions.clear();
    this.trades = [];
    this.dailyEquity = [];

    // 获取历史K线数据
    const candlesticks = await this.getHistoricalCandlesticks(symbol, startDate, endDate);
    if (candlesticks.length === 0) {
      throw new Error(`无法获取 ${symbol} 的历史数据`);
    }

    console.log(`获取到 ${candlesticks.length} 根K线数据`);

    // 创建策略实例
    const strategy = new RecommendationStrategy(strategyId);

    // 按日期遍历K线
    for (let i = 0; i < candlesticks.length; i++) {
      const candle = candlesticks[i];
      const dateStr = candle.timestamp.toISOString().split('T')[0];
      const currentPrice = candle.close;

      // 检查持仓的止损止盈
      if (this.positions.has(symbol)) {
        const trade = this.positions.get(symbol)!;
        
        // 获取策略推荐以获取止损止盈
        try {
          const recommendation = await tradingRecommendationService.calculateRecommendation(symbol);
          const stopLoss = recommendation.stop_loss;
          const takeProfit = recommendation.take_profit;

          const exitReason = this.checkStopLossTakeProfit(symbol, currentPrice, stopLoss, takeProfit);
          if (exitReason) {
            this.simulateSell(symbol, dateStr, currentPrice, exitReason);
          }
        } catch (error: any) {
          console.warn(`获取推荐失败 (${dateStr}):`, error.message);
        }
      }

      // 如果没有持仓，尝试生成买入信号
      if (!this.positions.has(symbol) && i < candlesticks.length - 1) {
        try {
          const intent = await strategy.generateSignal(symbol, undefined);
          if (intent && intent.action === 'BUY') {
            // 使用当前K线的收盘价作为买入价
            this.simulateBuy(symbol, dateStr, currentPrice, intent.reason || 'BUY_SIGNAL');
          }
        } catch (error: any) {
          // 忽略错误，继续回测
        }
      }

      // 记录每日权益
      let dailyEquity = this.currentCapital;
      this.positions.forEach((trade) => {
        const unrealizedPnl = (currentPrice - trade.entryPrice) * trade.quantity;
        dailyEquity += unrealizedPnl;
      });
      this.dailyEquity.push({
        date: dateStr,
        equity: dailyEquity,
      });
    }

    // 平仓所有剩余持仓
    const lastCandle = candlesticks[candlesticks.length - 1];
    const lastDate = lastCandle.timestamp.toISOString().split('T')[0];
    this.positions.forEach((trade, sym) => {
      this.simulateSell(sym, lastDate, lastCandle.close, 'BACKTEST_END');
    });

    // 计算性能指标
    return this.calculateMetrics();
  }

  /**
   * 计算性能指标
   */
  private calculateMetrics(): BacktestResult {
    const totalReturn = ((this.currentCapital - this.initialCapital) / this.initialCapital) * 100;
    const totalTrades = this.trades.length;
    const winningTrades = this.trades.filter(t => t.pnl > 0).length;
    const losingTrades = this.trades.filter(t => t.pnl < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgReturn = totalTrades > 0
      ? this.trades.reduce((sum, t) => sum + t.pnlPercent, 0) / totalTrades
      : 0;

    // 计算最大回撤
    let maxDrawdown = 0;
    let peak = this.initialCapital;
    for (const day of this.dailyEquity) {
      if (day.equity > peak) {
        peak = day.equity;
      }
      const drawdown = ((day.equity - peak) / peak) * 100;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // 计算夏普比率（简化版）
    const returns = this.dailyEquity.slice(1).map((day, i) => {
      const prevEquity = this.dailyEquity[i].equity;
      return prevEquity > 0 ? ((day.equity - prevEquity) / prevEquity) * 100 : 0;
    });
    const avgReturn2 = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn2, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn2 / stdDev : 0;

    // 计算平均持仓时间
    const holdingTimes = this.trades.map(t => {
      if (!t.exitDate) return 0;
      const entry = new Date(t.entryDate);
      const exit = new Date(t.exitDate);
      return (exit.getTime() - entry.getTime()) / (1000 * 60 * 60); // 小时
    });
    const avgHoldingTime = holdingTimes.length > 0
      ? holdingTimes.reduce((sum, t) => sum + t, 0) / holdingTimes.length
      : 0;

    // 计算每日收益率
    const dailyReturns = this.dailyEquity.slice(1).map((day, i) => {
      const prevEquity = this.dailyEquity[i].equity;
      const returnPercent = prevEquity > 0 ? ((day.equity - prevEquity) / prevEquity) * 100 : 0;
      return {
        date: day.date,
        return: returnPercent,
        equity: day.equity,
      };
    });

    return {
      totalReturn,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      avgReturn,
      maxDrawdown,
      sharpeRatio,
      avgHoldingTime,
      trades: this.trades,
      dailyReturns,
    };
  }

  /**
   * 打印报告
   */
  printReport(result: BacktestResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('回测报告');
    console.log('='.repeat(60));
    console.log(`总收益率: ${result.totalReturn.toFixed(2)}%`);
    console.log(`总交易次数: ${result.totalTrades}`);
    console.log(`盈利交易: ${result.winningTrades}`);
    console.log(`亏损交易: ${result.losingTrades}`);
    console.log(`胜率: ${result.winRate.toFixed(2)}%`);
    console.log(`平均收益率: ${result.avgReturn.toFixed(2)}%`);
    console.log(`最大回撤: ${result.maxDrawdown.toFixed(2)}%`);
    console.log(`夏普比率: ${result.sharpeRatio.toFixed(2)}`);
    console.log(`平均持仓时间: ${result.avgHoldingTime.toFixed(2)} 小时`);
    console.log('\n交易明细:');
    console.log('-'.repeat(60));
    result.trades.forEach((trade, index) => {
      console.log(`\n交易 #${index + 1}:`);
      console.log(`  标的: ${trade.symbol}`);
      console.log(`  买入日期: ${trade.entryDate}`);
      console.log(`  卖出日期: ${trade.exitDate || 'N/A'}`);
      console.log(`  买入价: $${trade.entryPrice.toFixed(2)}`);
      console.log(`  卖出价: $${trade.exitPrice?.toFixed(2) || 'N/A'}`);
      console.log(`  数量: ${trade.quantity}`);
      console.log(`  盈亏: $${trade.pnl.toFixed(2)} (${trade.pnlPercent > 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%)`);
      console.log(`  买入原因: ${trade.entryReason}`);
      console.log(`  卖出原因: ${trade.exitReason || 'N/A'}`);
    });
    console.log('\n' + '='.repeat(60));
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  let strategyId = 1;
  let startDate = new Date('2025-01-01');
  let endDate = new Date('2025-12-01');
  let symbol = 'AAPL.US';

  // 解析命令行参数
  for (const arg of args) {
    if (arg.startsWith('--strategy-id=')) {
      strategyId = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--start-date=')) {
      startDate = new Date(arg.split('=')[1]);
    } else if (arg.startsWith('--end-date=')) {
      endDate = new Date(arg.split('=')[1]);
    } else if (arg.startsWith('--symbol=')) {
      symbol = arg.split('=')[1];
    }
  }

  try {
    const engine = new BacktestEngine();
    const result = await engine.runBacktest(strategyId, symbol, startDate, endDate);
    engine.printReport(result);
  } catch (error: any) {
    console.error('回测失败:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 运行
if (require.main === module) {
  main();
}

