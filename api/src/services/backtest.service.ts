/**
 * 回测服务
 * Phase 2: 完整的回测服务实现
 */

import pool from '../config/database';
import { RecommendationStrategy } from './strategies/recommendation-strategy';
import tradingRecommendationService from './trading-recommendation.service';
import { getQuoteContext } from '../config/longport';
import { logger } from '../utils/logger';

export interface BacktestTrade {
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
  stopLoss?: number;  // 买入时的止损价
  takeProfit?: number;  // 买入时的止盈价
}

export type BacktestStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface BacktestResult {
  id?: number;
  strategyId: number;
  startDate: string;
  endDate: string;
  status?: BacktestStatus;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  totalReturn?: number;
  totalTrades?: number;
  winningTrades?: number;
  losingTrades?: number;
  winRate?: number;
  avgReturn?: number;
  maxDrawdown?: number;
  sharpeRatio?: number;
  avgHoldingTime?: number; // 小时
  trades?: BacktestTrade[];
  dailyReturns?: Array<{ date: string; return: number; equity: number }>;
  diagnosticLog?: any; // 诊断日志
}

class BacktestService {
  private initialCapital: number = 10000;

  /**
   * 获取历史K线数据
   * 注意：Longbridge的candlesticks API只返回最近N条数据，不支持指定日期范围
   * 所以我们需要计算从开始日期到今天的天数，获取足够多的历史数据
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

      // 计算从开始日期到今天的天数（因为API返回的是最近N条数据）
      const today = new Date();
      today.setHours(23, 59, 59, 999); // 设置为今天的最后一刻
      
      // 计算从开始日期到今天的天数差
      const daysFromStartToToday = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // 需要获取的数据量：从开始日期到今天的天数 + 一些缓冲（确保能覆盖到开始日期）
      // 最多获取1000条（Longbridge API的限制）
      const count = Math.min(daysFromStartToToday + 100, 1000);

      logger.log(`获取历史数据 (${symbol}): 需要从 ${startDate.toISOString().split('T')[0]} 到 ${endDate.toISOString().split('T')[0]}, 计算count=${count} (从开始日期到今天=${daysFromStartToToday}天)`);

      const candlesticks = await quoteCtx.candlesticks(
        symbol,
        Period.Day,
        count,
        AdjustType.NoAdjust
      );

      if (!candlesticks || candlesticks.length === 0) {
        logger.warn(`未获取到任何历史数据 (${symbol})`);
        return [];
      }

      logger.log(`获取到 ${candlesticks.length} 条历史数据 (${symbol}), 最早: ${new Date(candlesticks[candlesticks.length - 1].timestamp).toISOString().split('T')[0]}, 最晚: ${new Date(candlesticks[0].timestamp).toISOString().split('T')[0]}`);

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
        .filter((c: any) => {
          // 过滤出指定日期范围内的数据
          const cDate = new Date(c.timestamp);
          cDate.setHours(0, 0, 0, 0);
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          return cDate >= start && cDate <= end;
        })
        .sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime());

      if (result.length === 0) {
        logger.warn(`过滤后没有数据 (${symbol}): 开始日期=${startDate.toISOString().split('T')[0]}, 结束日期=${endDate.toISOString().split('T')[0]}`);
      } else {
        logger.log(`过滤后得到 ${result.length} 条数据 (${symbol})`);
      }

      return result;
    } catch (error: any) {
      logger.error(`获取历史数据失败 (${symbol}):`, error.message);
      throw error;
    }
  }

  /**
   * 执行回测
   * @param id 回测任务ID（可选，用于保存诊断日志）
   */
  async runBacktest(
    strategyId: number,
    symbols: string[],
    startDate: Date,
    endDate: Date,
    config?: any,
    id?: number
  ): Promise<BacktestResult> {
    logger.log(`开始回测: 策略ID=${strategyId}, 标的=${symbols.join(',')}`);
    logger.log(`时间范围: ${startDate.toISOString().split('T')[0]} 至 ${endDate.toISOString().split('T')[0]}`);

    // ✅ 添加诊断日志收集
    const diagnosticLog: {
      dataFetch: Array<{ symbol: string; success: boolean; count: number; error?: string }>;
      signalGeneration: Array<{ date: string; symbol: string; signal: string | null; error?: string }>;
      buyAttempts: Array<{ date: string; symbol: string; success: boolean; reason: string; details?: any }>;
      summary: {
        totalDates: number;
        totalSignals: number;
        totalBuyAttempts: number;
        totalBuySuccess: number;
        buyRejectReasons: Record<string, number>;
      };
    } = {
      dataFetch: [],
      signalGeneration: [],
      buyAttempts: [],
      summary: {
        totalDates: 0,
        totalSignals: 0,
        totalBuyAttempts: 0,
        totalBuySuccess: 0,
        buyRejectReasons: {},
      },
    };

    let currentCapital = this.initialCapital;
    const positions: Map<string, BacktestTrade> = new Map();
    const trades: BacktestTrade[] = [];
    const dailyEquity: Array<{ date: string; equity: number }> = [];

    // 获取所有标的的历史数据
    const allCandlesticks: Map<string, Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>> = new Map();
    
    // ✅ 在数据获取时记录日志
    for (const symbol of symbols) {
      try {
        const candlesticks = await this.getHistoricalCandlesticks(symbol, startDate, endDate);
        diagnosticLog.dataFetch.push({
          symbol,
          success: true,
          count: candlesticks.length,
        });
        
        if (candlesticks.length > 0) {
          allCandlesticks.set(symbol, candlesticks);
        } else {
          logger.warn(`回测 ${symbol}: 未获取到任何K线数据`);
        }
      } catch (error: any) {
        diagnosticLog.dataFetch.push({
          symbol,
          success: false,
          count: 0,
          error: error.message,
        });
        logger.error(`回测 ${symbol}: 数据获取失败`, error);
      }
    }

    if (allCandlesticks.size === 0) {
      // ✅ 保存诊断日志后再抛出错误
      if (id) {
        await this.saveDiagnosticLog(id, diagnosticLog);
      }
      throw new Error('无法获取任何历史数据');
    }

    // 获取所有日期（合并所有标的的日期）
    const allDates = new Set<string>();
    allCandlesticks.forEach((candles) => {
      candles.forEach((c) => {
        allDates.add(c.timestamp.toISOString().split('T')[0]);
      });
    });
    const sortedDates = Array.from(allDates).sort();
    
    // ✅ 记录总日期数
    diagnosticLog.summary.totalDates = sortedDates.length;

    // 创建策略实例
    const strategy = new RecommendationStrategy(strategyId, {});

      // 按日期遍历
      for (const dateStr of sortedDates) {
        // ✅ 使用日期的结束时间，确保包含当天的数据
        const currentDate = new Date(dateStr);
        currentDate.setHours(23, 59, 59, 999);

      // 检查每个标的的持仓
      for (const symbol of symbols) {
        const candlesticks = allCandlesticks.get(symbol);
        if (!candlesticks) continue;

        const candle = candlesticks.find(c => c.timestamp.toISOString().split('T')[0] === dateStr);
        if (!candle) continue;

        const currentPrice = candle.close;

        // 检查持仓的止损止盈
        if (positions.has(symbol)) {
          const trade = positions.get(symbol)!;
          
          // 使用买入时保存的止损止盈，而不是实时计算
          // 这样可以避免使用当前市场数据导致的历史回测错误
          const stopLoss = trade.stopLoss;
          const takeProfit = trade.takeProfit;

          if (stopLoss && currentPrice <= stopLoss) {
            this.simulateSell(symbol, dateStr, currentPrice, 'STOP_LOSS', trade, positions, trades, (amount) => {
              currentCapital += amount; // amount 是卖出收回的资金（price * quantity）
            });
          } else if (takeProfit && currentPrice >= takeProfit) {
            this.simulateSell(symbol, dateStr, currentPrice, 'TAKE_PROFIT', trade, positions, trades, (amount) => {
              currentCapital += amount; // amount 是卖出收回的资金（price * quantity）
            });
          }
        }

        // 如果没有持仓，尝试生成买入信号
        if (!positions.has(symbol)) {
          try {
            // ✅ 传入历史日期和历史K线数据，确保策略基于历史市场条件生成信号
            // 获取当前日期之前的历史K线数据（用于推荐服务）
            const historicalCandles = candlesticks.filter(c => 
              c.timestamp.toISOString().split('T')[0] <= dateStr
            );
            
            // 转换为推荐服务需要的格式（包含timestamp字段）
            const historicalStockCandlesticks = historicalCandles.map(c => ({
              close: c.close,
              open: c.open,
              high: c.high,
              low: c.low,
              volume: c.volume,
              timestamp: c.timestamp.getTime() / 1000, // 转换为秒级时间戳
            }));
            
            const intent = await strategy.generateSignal(
              symbol, 
              undefined, // marketData参数暂时不使用
              currentDate, // 传入当前回测日期
              historicalStockCandlesticks // 传入历史K线数据
            );
            
            // ✅ 记录信号生成日志
            diagnosticLog.summary.totalSignals++;
            diagnosticLog.signalGeneration.push({
              date: dateStr,
              symbol,
              signal: intent?.action || null,
            });
            
            if (intent && intent.action === 'BUY') {
              // 基于历史K线数据计算止损止盈（不使用实时推荐服务的止损止盈）
              const candlesticks = allCandlesticks.get(symbol);
              let stopLoss: number;
              let takeProfit: number;
              
              if (candlesticks) {
                // 找到当前日期之前的K线数据
                const historicalCandles = candlesticks.filter(c => 
                  c.timestamp.toISOString().split('T')[0] <= dateStr
                );
                
                if (historicalCandles.length >= 14) {
                  const atr = this.calculateATR(historicalCandles, 14);
                  const atrMultiplier = 2.0; // 默认ATR倍数
                  
                  // 止损：买入价 - ATR * 倍数，但至少5%止损
                  stopLoss = Math.max(
                    currentPrice - atr * atrMultiplier,
                    currentPrice * 0.95  // 至少5%止损
                  );
                  
                  // 止盈：买入价 + ATR * 倍数 * 1.5，但至少10%止盈
                  takeProfit = Math.min(
                    currentPrice + atr * atrMultiplier * 1.5,
                    currentPrice * 1.10  // 至少10%止盈
                  );
                  
                  // 确保止损 < 买入价 < 止盈
                  if (stopLoss >= currentPrice) {
                    stopLoss = currentPrice * 0.95;
                  }
                  if (takeProfit <= currentPrice) {
                    takeProfit = currentPrice * 1.10;
                  }
                } else {
                  // 数据不足，使用固定百分比
                  stopLoss = currentPrice * 0.95;
                  takeProfit = currentPrice * 1.10;
                }
              } else {
                // 没有历史数据，使用固定百分比
                stopLoss = currentPrice * 0.95;
                takeProfit = currentPrice * 1.10;
              }
              
              // 验证止损止盈的合理性
              if (stopLoss >= currentPrice) {
                logger.warn(`回测 ${symbol} ${dateStr}: 止损价(${stopLoss.toFixed(2)}) >= 买入价(${currentPrice.toFixed(2)})，调整为95%`);
                stopLoss = currentPrice * 0.95;
              }
              if (takeProfit <= currentPrice) {
                logger.warn(`回测 ${symbol} ${dateStr}: 止盈价(${takeProfit.toFixed(2)}) <= 买入价(${currentPrice.toFixed(2)})，调整为110%`);
                takeProfit = currentPrice * 1.10;
              }
              
              // ✅ 记录买入尝试
              diagnosticLog.summary.totalBuyAttempts++;
              const buyResult = this.simulateBuy(
                symbol, 
                dateStr, 
                currentPrice, 
                intent.reason || 'BUY_SIGNAL', 
                currentCapital, 
                positions, 
                stopLoss,
                takeProfit,
                (amount) => {
                  // amount 是负数（实际买入成本），所以用 += 来扣除
                  currentCapital += amount;
                }
              );
              
              // ✅ 记录买入结果
              if (buyResult.success) {
                diagnosticLog.summary.totalBuySuccess++;
                diagnosticLog.buyAttempts.push({
                  date: dateStr,
                  symbol,
                  success: true,
                  reason: '买入成功',
                  details: buyResult.details,
                });
              } else {
                const rejectReason = buyResult.reason || '未知原因';
                diagnosticLog.buyAttempts.push({
                  date: dateStr,
                  symbol,
                  success: false,
                  reason: rejectReason,
                  details: buyResult.details,
                });
                diagnosticLog.summary.buyRejectReasons[rejectReason] = 
                  (diagnosticLog.summary.buyRejectReasons[rejectReason] || 0) + 1;
              }
            }
          } catch (error: any) {
            // ✅ 记录信号生成失败
            diagnosticLog.signalGeneration.push({
              date: dateStr,
              symbol,
              signal: null,
              error: error.message,
            });
            logger.warn(`回测生成信号失败 (${symbol}, ${dateStr}):`, error.message);
          }
        }
      }

      // 记录每日权益
      // 权益 = 现金 + 持仓市值
      let dailyEquityValue = currentCapital;
      positions.forEach((trade) => {
        const symbolCandles = allCandlesticks.get(trade.symbol);
        if (symbolCandles) {
          const candle = symbolCandles.find(c => c.timestamp.toISOString().split('T')[0] === dateStr);
          if (candle) {
            // 持仓市值 = 当前价格 * 数量
            const positionValue = candle.close * trade.quantity;
            dailyEquityValue += positionValue;
          }
        }
      });
      dailyEquity.push({
        date: dateStr,
        equity: dailyEquityValue,
      });
    }

    // 平仓所有剩余持仓
    const lastDate = sortedDates[sortedDates.length - 1];
    for (const symbol of symbols) {
      if (positions.has(symbol)) {
        const trade = positions.get(symbol)!;
        const candlesticks = allCandlesticks.get(symbol);
        if (candlesticks && candlesticks.length > 0) {
          const lastCandle = candlesticks[candlesticks.length - 1];
          this.simulateSell(symbol, lastDate, lastCandle.close, 'BACKTEST_END', trade, positions, trades, (amount) => {
            currentCapital += amount; // amount 是卖出收回的资金（price * quantity）
          });
        }
      }
    }

    // 平仓后，更新最后一天的权益（使用平仓后的现金）
    if (dailyEquity.length > 0) {
      dailyEquity[dailyEquity.length - 1].equity = currentCapital;
    } else {
      // 如果没有记录，添加一条最终权益记录
      dailyEquity.push({
        date: lastDate,
        equity: currentCapital,
      });
    }

    // 计算性能指标
    const result = this.calculateMetrics(trades, dailyEquity, this.initialCapital);

    // ✅ 保存诊断日志
    if (id) {
      await this.saveDiagnosticLog(id, diagnosticLog);
    }

    return {
      strategyId,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      ...result,
    };
  }

  /**
   * 计算ATR（平均真实波幅）
   */
  private calculateATR(
    candlesticks: Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>,
    period: number = 14
  ): number {
    if (candlesticks.length < period + 1) {
      if (candlesticks.length > 0) {
        const recent = candlesticks.slice(-Math.min(period, candlesticks.length));
        const ranges = recent.map(c => c.high - c.low);
        return ranges.reduce((a, b) => a + b, 0) / ranges.length;
      }
      return 0;
    }

    const trueRanges: number[] = [];
    for (let i = 1; i < candlesticks.length; i++) {
      const prevClose = candlesticks[i - 1].close;
      const currentHigh = candlesticks[i].high;
      const currentLow = candlesticks[i].low;
      
      const tr1 = currentHigh - currentLow;
      const tr2 = Math.abs(currentHigh - prevClose);
      const tr3 = Math.abs(currentLow - prevClose);
      
      const tr = Math.max(tr1, tr2, tr3);
      trueRanges.push(tr);
    }

    const recentTRs = trueRanges.slice(-period);
    return recentTRs.reduce((a, b) => a + b, 0) / recentTRs.length;
  }

  /**
   * 模拟买入
   * 返回结果和失败原因，用于诊断日志
   */
  private simulateBuy(
    symbol: string,
    date: string,
    price: number,
    reason: string,
    currentCapital: number,
    positions: Map<string, BacktestTrade>,
    stopLoss: number,
    takeProfit: number,
    onCapitalChange: (amount: number) => void
  ): { success: boolean; reason?: string; details?: any } {
    if (positions.has(symbol)) {
      return { success: false, reason: '已有持仓' };
    }

    const tradeAmount = currentCapital * 0.1;
    const quantity = Math.floor(tradeAmount / price);

    if (quantity <= 0) {
      return { 
        success: false, 
        reason: `资金不足: 可用资金=${currentCapital.toFixed(2)}, 价格=${price.toFixed(2)}, 计算数量=${quantity}`,
        details: {
          currentCapital,
          price,
          tradeAmount,
          quantity,
        }
      };
    }

    // 计算实际买入成本（价格 * 数量）
    const actualCost = price * quantity;

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
      stopLoss,
      takeProfit,
    };

    positions.set(symbol, trade);
    // 扣除实际买入成本，而不是计划投入金额
    // 这样可以确保买入扣除和卖出收回的金额匹配
    onCapitalChange(-actualCost);
    return { 
      success: true, 
      details: {
        quantity,
        actualCost,
        entryPrice: price,
      }
    };
  }

  /**
   * 模拟卖出
   */
  private simulateSell(
    symbol: string,
    date: string,
    price: number,
    reason: string,
    trade: BacktestTrade,
    positions: Map<string, BacktestTrade>,
    trades: BacktestTrade[],
    onCapitalChange: (amount: number) => void
  ): void {
    const pnl = (price - trade.entryPrice) * trade.quantity;
    const pnlPercent = ((price - trade.entryPrice) / trade.entryPrice) * 100;

    trade.exitDate = date;
    trade.exitPrice = price;
    trade.pnl = pnl;
    trade.pnlPercent = pnlPercent;
    trade.exitReason = reason;

    // 卖出时：收回卖出资金 = 卖出价格 * 数量
    // 买入时扣除了 entryPrice * quantity，卖出时加上 price * quantity
    // 盈亏 = (price - entryPrice) * quantity = price * quantity - entryPrice * quantity
    // 所以卖出后资金 = currentCapital + price * quantity
    // 其中 currentCapital 已经扣除了 entryPrice * quantity
    const sellAmount = price * trade.quantity;
    onCapitalChange(sellAmount);
    trades.push({ ...trade });
    positions.delete(symbol);
  }

  /**
   * 计算性能指标
   */
  private calculateMetrics(
    trades: BacktestTrade[],
    dailyEquity: Array<{ date: string; equity: number }>,
    initialCapital: number
  ): Omit<BacktestResult, 'strategyId' | 'startDate' | 'endDate'> {
    const totalReturn = ((dailyEquity[dailyEquity.length - 1]?.equity || initialCapital) - initialCapital) / initialCapital * 100;
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.pnl > 0).length;
    const losingTrades = trades.filter(t => t.pnl < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgReturn = totalTrades > 0
      ? trades.reduce((sum, t) => sum + t.pnlPercent, 0) / totalTrades
      : 0;

    // 计算最大回撤
    let maxDrawdown = 0;
    let peak = initialCapital;
    for (const day of dailyEquity) {
      if (day.equity > peak) {
        peak = day.equity;
      }
      const drawdown = ((day.equity - peak) / peak) * 100;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // 计算夏普比率
    const returns = dailyEquity.slice(1).map((day, i) => {
      const prevEquity = dailyEquity[i].equity;
      return prevEquity > 0 ? ((day.equity - prevEquity) / prevEquity) * 100 : 0;
    });
    const avgReturn2 = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const variance = returns.length > 0
      ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn2, 2), 0) / returns.length
      : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn2 / stdDev : 0;

    // 计算平均持仓时间
    const holdingTimes = trades.map(t => {
      if (!t.exitDate) return 0;
      const entry = new Date(t.entryDate);
      const exit = new Date(t.exitDate);
      return (exit.getTime() - entry.getTime()) / (1000 * 60 * 60);
    });
    const avgHoldingTime = holdingTimes.length > 0
      ? holdingTimes.reduce((sum, t) => sum + t, 0) / holdingTimes.length
      : 0;

    // 计算每日收益率
    const dailyReturns = dailyEquity.slice(1).map((day, i) => {
      const prevEquity = dailyEquity[i].equity;
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
      trades,
      dailyReturns,
    };
  }

  /**
   * 创建回测任务（异步）
   */
  async createBacktestTask(
    strategyId: number,
    symbols: string[],
    startDate: Date,
    endDate: Date,
    config?: any
  ): Promise<number> {
    const query = `
      INSERT INTO backtest_results (
        strategy_id, start_date, end_date, config, 
        status, started_at, created_at
      )
      VALUES ($1, $2, $3, $4, 'PENDING', NOW(), NOW())
      RETURNING id
    `;
    
    const values = [
      strategyId,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
      JSON.stringify(config || {}),
    ];

    const res = await pool.query(query, values);
    return res.rows[0].id;
  }

  /**
   * 更新回测状态
   */
  async updateBacktestStatus(
    id: number,
    status: BacktestStatus,
    errorMessage?: string
  ): Promise<void> {
    const query = `
      UPDATE backtest_results
      SET status = $1,
          error_message = $2,
          ${status === 'RUNNING' ? 'started_at = NOW(),' : ''}
          ${status === 'COMPLETED' || status === 'FAILED' ? 'completed_at = NOW(),' : ''}
          updated_at = NOW()
      WHERE id = $3
    `;

    await pool.query(query, [status, errorMessage || null, id]);
  }

  /**
   * 保存回测结果到数据库
   */
  async saveBacktestResult(result: BacktestResult, config?: any): Promise<number> {
    const query = `
      INSERT INTO backtest_results (
        strategy_id, start_date, end_date, config, result, 
        status, completed_at, created_at
      )
      VALUES ($1, $2, $3, $4, $5, 'COMPLETED', NOW(), NOW())
      RETURNING id
    `;
    
    const values = [
      result.strategyId,
      result.startDate,
      result.endDate,
      JSON.stringify(config || {}),
      JSON.stringify(result),
    ];

    const res = await pool.query(query, values);
    return res.rows[0].id;
  }

  /**
   * 更新回测结果（用于异步执行完成后）
   */
  async updateBacktestResult(id: number, result: BacktestResult): Promise<void> {
    const query = `
      UPDATE backtest_results
      SET result = $1,
          status = 'COMPLETED',
          completed_at = NOW()
      WHERE id = $2
    `;

    await pool.query(query, [JSON.stringify(result), id]);
  }

  /**
   * 保存诊断日志
   */
  async saveDiagnosticLog(id: number, diagnosticLog: any): Promise<void> {
    const query = `
      UPDATE backtest_results
      SET diagnostic_log = $1,
          updated_at = NOW()
      WHERE id = $2
    `;

    await pool.query(query, [JSON.stringify(diagnosticLog), id]);
  }

  /**
   * 异步执行回测
   */
  async executeBacktestAsync(
    id: number,
    strategyId: number,
    symbols: string[],
    startDate: Date,
    endDate: Date,
    config?: any
  ): Promise<void> {
    try {
      // 更新状态为运行中
      await this.updateBacktestStatus(id, 'RUNNING');

      // ✅ 执行回测，传递id参数用于保存诊断日志
      const result = await this.runBacktest(strategyId, symbols, startDate, endDate, config, id);

      // 保存结果
      await this.updateBacktestResult(id, {
        ...result,
        id,
        strategyId,
        startDate: result.startDate,
        endDate: result.endDate,
      });

      logger.log(`回测任务 ${id} 完成`);
    } catch (error: any) {
      logger.error(`回测任务 ${id} 失败:`, error);
      await this.updateBacktestStatus(id, 'FAILED', error.message || '回测执行失败');
    }
  }

  /**
   * 获取回测状态
   */
  async getBacktestStatus(id: number): Promise<{
    id: number;
    status: BacktestStatus;
    errorMessage?: string;
    startedAt?: string;
    completedAt?: string;
  } | null> {
    const query = `
      SELECT id, status, error_message, started_at, completed_at
      FROM backtest_results
      WHERE id = $1
    `;

    const res = await pool.query(query, [id]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      id: row.id,
      status: row.status || 'COMPLETED',
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  /**
   * 获取回测结果
   */
  async getBacktestResult(id: number, includeDetails: boolean = true): Promise<BacktestResult | null> {
    const query = `
      SELECT id, strategy_id, start_date, end_date, config, result, status, error_message, started_at, completed_at, created_at, diagnostic_log
      FROM backtest_results
      WHERE id = $1
    `;

    const res = await pool.query(query, [id]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    
    // 如果状态不是 COMPLETED，返回基本信息
    if (row.status !== 'COMPLETED') {
      return {
        id: row.id,
        strategyId: row.strategy_id,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status || 'COMPLETED',
        errorMessage: row.error_message,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      } as BacktestResult;
    }

    // PostgreSQL JSONB 字段可能已经是对象，也可能需要解析
    let resultData: any = {};
    if (row.result) {
      if (typeof row.result === 'string') {
        try {
          resultData = JSON.parse(row.result);
        } catch (e) {
          logger.error('解析回测结果失败:', e);
          // 如果解析失败，返回空对象而不是抛出错误
          resultData = {};
        }
      } else if (typeof row.result === 'object') {
        resultData = row.result;
      }
    }
    // 如果 result 为 null 或 undefined，resultData 保持为空对象

    // 如果不需要详细信息，限制数据量
    if (!includeDetails) {
      if (resultData.trades && Array.isArray(resultData.trades)) {
        resultData.trades = resultData.trades.slice(0, 100); // 只返回前100条交易
      }
      if (resultData.dailyReturns && Array.isArray(resultData.dailyReturns)) {
        // 对于每日收益，可以采样返回
        const dailyReturns = resultData.dailyReturns;
        if (dailyReturns.length > 500) {
          const step = Math.ceil(dailyReturns.length / 500);
          resultData.dailyReturns = dailyReturns.filter((_: any, i: number) => i % step === 0);
        }
      }
    }

    // ✅ 解析诊断日志
    let diagnosticLog: any = null;
    if (row.diagnostic_log) {
      if (typeof row.diagnostic_log === 'string') {
        try {
          diagnosticLog = JSON.parse(row.diagnostic_log);
        } catch (e) {
          logger.error('解析诊断日志失败:', e);
        }
      } else if (typeof row.diagnostic_log === 'object') {
        diagnosticLog = row.diagnostic_log;
      }
    }

    const result: BacktestResult = {
      id: row.id,
      strategyId: row.strategy_id,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status || 'COMPLETED',
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      diagnosticLog, // ✅ 添加诊断日志
      ...resultData,
    };

    return result;
  }

  /**
   * 获取策略的所有回测结果（列表视图，不包含详细交易数据）
   */
  async getBacktestResultsByStrategy(strategyId: number): Promise<BacktestResult[]> {
    const query = `
      SELECT id, strategy_id, start_date, end_date, config, result, status, error_message, started_at, completed_at, created_at
      FROM backtest_results
      WHERE strategy_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const res = await pool.query(query, [strategyId]);
    return res.rows.map((row) => {
      // PostgreSQL JSONB 字段可能已经是对象，也可能需要解析
      let resultData: any = {};
      if (row.result) {
        if (typeof row.result === 'string') {
          try {
            resultData = JSON.parse(row.result);
          } catch (e) {
            logger.error(`解析回测结果失败 (ID: ${row.id}):`, e);
            resultData = {};
          }
        } else if (typeof row.result === 'object') {
          resultData = row.result;
        }
      }
      // 如果 result 为 null 或 undefined，resultData 保持为空对象

      // 列表视图不需要详细的交易数据和每日收益数据
      const summary: BacktestResult = {
        id: row.id,
        strategyId: row.strategy_id,
        startDate: row.start_date,
        endDate: row.end_date,
        totalReturn: resultData.totalReturn || 0,
        totalTrades: resultData.totalTrades || 0,
        winningTrades: resultData.winningTrades || 0,
        losingTrades: resultData.losingTrades || 0,
        winRate: resultData.winRate || 0,
        avgReturn: resultData.avgReturn || 0,
        maxDrawdown: resultData.maxDrawdown || 0,
        sharpeRatio: resultData.sharpeRatio || 0,
        avgHoldingTime: resultData.avgHoldingTime || 0,
        trades: [], // 列表视图不包含交易详情
        dailyReturns: [], // 列表视图不包含每日收益
      };

      return summary;
    });
  }
}

export default new BacktestService();

