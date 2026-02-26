/**
 * 策略调度器服务
 * 定时触发策略运行，管理策略生命周期
 */

import pool from '../config/database';
import { StrategyBase, TradingIntent } from './strategies/strategy-base';
import { RecommendationStrategy } from './strategies/recommendation-strategy';
import { OptionIntradayStrategy } from './strategies/option-intraday-strategy';
import stockSelector from './stock-selector.service';
import capitalManager from './capital-manager.service';
import stateManager from './state-manager.service';
import basicExecutionService from './basic-execution.service';
import dynamicPositionManager from './dynamic-position-manager.service';
import tradingRecommendationService from './trading-recommendation.service';
import { logger } from '../utils/logger';
import { getTradeContext } from '../config/longport';
import orderPreventionMetrics from './order-prevention-metrics.service';
import todayOrdersCache from './today-orders-cache.service';
import tradingDaysService from './trading-days.service';
import tradingSessionService from './trading-session.service';
import { getMarketFromSymbol } from '../utils/trading-days';
import shortValidationService from './short-position-validation.service';
import { INITIAL_MARGIN_RATIO, MARGIN_SAFETY_BUFFER, DEFAULT_SHORT_QUANTITY_LIMIT } from './short-position-validation.service';
import { getMarketCloseWindow } from './market-session.service';
import { getOptionPrefixesForUnderlying, isLikelyOptionSymbol } from '../utils/options-symbol';
import { estimateOptionOrderTotalCost } from './options-fee.service';
import { getOptionDetail } from './futunn-option-chain.service';
import { longportRateLimiter, retryWithBackoff } from '../utils/longport-rate-limiter';
import { normalizeOrderStatus } from '../utils/order-status';
import longportOptionQuoteService from './longport-option-quote.service';
import marketDataCacheService from './market-data-cache.service';
import marketDataService from './market-data.service';
import trailingStopProtectionService from './trailing-stop-protection.service';


// 定义执行汇总接口
interface ExecutionSummary {
  strategyId: number;
  startTime: number;
  totalTargets: number;
  idle: string[];      // IDLE 状态标的
  holding: string[];   // HOLDING 状态标的
  signals: string[];   // 生成信号的标的
  errors: string[];    // 发生错误的标的
  actions: string[];   // 执行了操作（买入/卖出/更新状态）的标的
  other: string[];     // 其他状态（如OPENING/CLOSING/COOLDOWN）
}

class StrategyScheduler {
  private runningStrategies: Map<number, NodeJS.Timeout> = new Map();
  private orderMonitorIntervals: Map<number, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  // 持仓缓存：避免频繁调用 stockPositions() API
  private positionCache: Map<string, { positions: any[]; timestamp: number }> = new Map();
  private readonly POSITION_CACHE_TTL = 30000; // 30秒缓存
  // 订单提交缓存：防止重复提交订单
  private orderSubmissionCache: Map<string, { timestamp: number; orderId?: string }> = new Map();
  private readonly ORDER_CACHE_TTL = 60000; // 60秒缓存
  // 策略执行锁：防止并发执行（当执行时间超过间隔时）
  private strategyExecutionLocks: Map<number, boolean> = new Map();
  // 260225 Iron Dome: 防御系统
  private ironDomeIntervals: Map<number, NodeJS.Timeout> = new Map();
  // TSLPPCT 连续失败计数（per strategy，内存级，进程重启归零 = 安全）
  private tslpFailureCount: Map<number, number> = new Map();
  private readonly TSLP_FAILURE_THRESHOLD = 2; // 失败 >= 2 次禁止开仓
  // H2 修复：每日重置追踪（per strategy）
  private lastDailyResetDate: Map<number, string> = new Map();

  /**
   * 启动策略调度器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('策略调度器已在运行');
      return;
    }

    this.isRunning = true;
    logger.log('策略调度器已启动', { dbWrite: false });

    // 恢复所有运行中策略的状态
    await stateManager.restoreRunningStrategies();

    // 启动所有运行中的策略
    await this.startAllRunningStrategies();
  }

  /**
   * 停止策略调度器
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // 停止所有策略
    for (const [strategyId, intervalId] of this.runningStrategies.entries()) {
      clearInterval(intervalId);
      this.runningStrategies.delete(strategyId);
    }
    
    // 停止所有订单监控
    if (this.orderMonitorIntervals) {
      for (const [strategyId, monitorId] of this.orderMonitorIntervals.entries()) {
        clearInterval(monitorId);
        this.orderMonitorIntervals.delete(strategyId);
      }
    }

    // 停止所有 Iron Dome 防御循环
    if (this.ironDomeIntervals) {
      for (const [, domeId] of this.ironDomeIntervals.entries()) {
        clearInterval(domeId);
      }
      this.ironDomeIntervals.clear();
    }

    logger.log('策略调度器已停止', { dbWrite: false });
  }

  /**
   * 启动所有运行中的策略
   */
  private async startAllRunningStrategies(): Promise<void> {
    const strategiesResult = await pool.query(
      `SELECT id, name, type, config, symbol_pool_config, status
       FROM strategies WHERE status = 'RUNNING'`
    );

    // 预热市场数据缓存：在启动策略之前先获取一次市场数据
    // 避免多个策略同时启动时并发请求导致 API 限流
    if (strategiesResult.rows.length > 0) {
      try {
        logger.log('启动前预热市场数据缓存...');
        await marketDataCacheService.getMarketData(100, true);
        logger.log('市场数据缓存预热完成');
      } catch (err: any) {
        logger.warn(`市场数据缓存预热失败(不阻塞策略启动): ${err?.message}`);
      }
    }

    for (const strategy of strategiesResult.rows) {
      await this.startStrategy(strategy.id);
    }
  }

  /**
   * 启动单个策略
   */
  async startStrategy(strategyId: number): Promise<void> {
    // 检查策略是否已在运行
    if (this.runningStrategies.has(strategyId)) {
      logger.warn(`策略 ${strategyId} 已在运行`);
      return;
    }

    // 查询策略配置
    const strategyResult = await pool.query(
      `SELECT id, name, type, config, symbol_pool_config, status 
       FROM strategies WHERE id = $1`,
      [strategyId]
    );

    if (strategyResult.rows.length === 0) {
      throw new Error(`策略 ${strategyId} 不存在`);
    }

    const strategy = strategyResult.rows[0];

    if (strategy.status !== 'RUNNING') {
      throw new Error(`策略 ${strategy.name} 状态不是 RUNNING`);
    }

    // 创建策略实例
    const strategyInstance = this.createStrategyInstance(
      strategy.type,
      strategyId,
      strategy.config
    );

    // C6 修复：启动时清理残留的 OPENING/SHORTING 状态（进程崩溃后恢复）
    try {
      const staleStates = await pool.query(
        `SELECT symbol, current_state, context FROM strategy_instances
         WHERE strategy_id = $1 AND current_state IN ('OPENING', 'SHORTING')`,
        [strategyId]
      );
      for (const row of staleStates.rows) {
        const ctx = row.context || {};
        const allocationAmount = parseFloat(ctx.allocationAmount || '0');
        if (allocationAmount > 0) {
          try {
            await capitalManager.releaseAllocation(strategyId, allocationAmount, row.symbol);
          } catch (relErr: any) {
            logger.error(`[STARTUP_CLEANUP] 释放资金失败 ${row.symbol}: ${relErr.message}`);
          }
        }
        await strategyInstance.updateState(row.symbol, 'IDLE');
        logger.warn(`[STARTUP_CLEANUP] 策略${strategyId} 标的${row.symbol}: 清理残留${row.current_state}状态，释放资金$${allocationAmount.toFixed(2)}`);
      }
    } catch (cleanupErr: any) {
      logger.error(`[STARTUP_CLEANUP] 策略${strategyId} 清理失败: ${cleanupErr.message}`);
    }

    // 根据策略类型确定执行间隔
    // - 期权策略（OPTION_INTRADAY_V1）：5秒，期权市场需要快速响应
    // - 其他策略：60秒（默认）
    // 注意：期权链数据有缓存，不会每次都请求API
    const isOptionStrategy = strategy.type === 'OPTION_INTRADAY_V1';

    // 根据策略类型确定执行间隔
    // - 期权策略（OPTION_INTRADAY_V1）：5秒，期权市场需要快速响应
    // - 其他策略：60秒（默认）
    // 注意：期权链数据有缓存，不会每次都请求API
    const intervalMs = isOptionStrategy ? 5 * 1000 : 60 * 1000;
    const intervalDesc = isOptionStrategy ? '5秒' : '1分钟';

    const intervalId = setInterval(async () => {
      try {
        await this.runStrategyCycle(strategyInstance, strategyId, strategy.symbol_pool_config);
      } catch (error: any) {
        logger.error(`策略 ${strategyId} 运行出错:`, error);
        await pool.query(
          'UPDATE strategies SET status = $1 WHERE id = $2',
          ['ERROR', strategyId]
        );
        this.stopStrategy(strategyId);
      }
    }, intervalMs);

    this.runningStrategies.set(strategyId, intervalId);

    // 启动订单监控任务
    // - 期权策略：5秒（与策略周期同步）
    // - 其他策略：30秒
    const orderMonitorIntervalMs = isOptionStrategy ? 5 * 1000 : 30 * 1000;
    const orderMonitorDesc = isOptionStrategy ? '5秒' : '30秒';
    const orderMonitorId = setInterval(async () => {
      try {
        await this.trackPendingOrders(strategyId);
      } catch (error: any) {
        logger.error(`策略 ${strategyId} 订单监控出错:`, error);
      }
    }, orderMonitorIntervalMs);

    this.orderMonitorIntervals.set(strategyId, orderMonitorId);

    // 260225 Iron Dome: 启动防御循环（60秒周期 — Shadow-Pricer + Reconciliation）
    if (isOptionStrategy) {
      const ironDomeId = setInterval(async () => {
        try {
          await this.runIronDomeCycle(strategyId);
        } catch (err: any) {
          logger.warn(`[IRON_DOME] 策略 ${strategyId} 防御循环异常: ${err?.message}`);
        }
      }, 60 * 1000); // 60秒 — 不需要5秒那么频繁，但足够捕捉归零和幽灵仓位
      this.ironDomeIntervals.set(strategyId, ironDomeId);
    }

    logger.log(`策略 ${strategy.name} (ID: ${strategyId}) 已启动（策略周期: ${intervalDesc}，订单监控: ${orderMonitorDesc}${isOptionStrategy ? '，Iron Dome: 60秒' : ''}）`, { dbWrite: false });

    // 立即执行一次策略周期
    try {
      await this.runStrategyCycle(strategyInstance, strategyId, strategy.symbol_pool_config);
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 初始运行出错:`, error);
    }
  }

  /**
   * 停止单个策略
   */
  async stopStrategy(strategyId: number): Promise<void> {
    const intervalId = this.runningStrategies.get(strategyId);
    if (intervalId) {
      clearInterval(intervalId);
      this.runningStrategies.delete(strategyId);
    }
    
    // 停止订单监控
    const orderMonitorId = this.orderMonitorIntervals?.get(strategyId);
    if (orderMonitorId) {
      clearInterval(orderMonitorId);
      this.orderMonitorIntervals.delete(strategyId);
    }

    // 停止 Iron Dome 防御循环
    const ironDomeId = this.ironDomeIntervals?.get(strategyId);
    if (ironDomeId) {
      clearInterval(ironDomeId);
      this.ironDomeIntervals.delete(strategyId);
    }

    logger.log(`策略 ${strategyId} 已停止`, { dbWrite: false });

    // 更新数据库状态
    await pool.query('UPDATE strategies SET status = $1 WHERE id = $2', ['STOPPED', strategyId]);
  }

  /**
   * 运行策略周期
   */
  private async runStrategyCycle(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbolPoolConfig: any
  ): Promise<void> {
    // 🔒 执行锁检查：防止并发执行（当执行时间超过间隔时）
    if (this.strategyExecutionLocks.get(strategyId)) {
      logger.debug(`策略 ${strategyId}: 上次执行尚未完成，跳过本次调度`);
      return;
    }
    this.strategyExecutionLocks.set(strategyId, true);

    try {
      await this.runStrategyCycleInternal(strategyInstance, strategyId, symbolPoolConfig);
    } finally {
      this.strategyExecutionLocks.set(strategyId, false);
    }
  }

  /**
   * 策略周期内部实现
   */
  private async runStrategyCycleInternal(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbolPoolConfig: any
  ): Promise<void> {
    // ✅ 交易日检查：非交易日不执行策略监控
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 1. 获取股票池（用于判断市场类型）
    const symbols = await stockSelector.getSymbolPool(symbolPoolConfig);
    
    if (!symbols || symbols.length === 0) {
      logger.log(`策略 ${strategyId}: 股票池为空，跳过本次运行`, { dbWrite: false });
      return;
    }

    // 2. 交易日和交易时段检查（根据标的池的市场类型）
    const markets = new Set(symbols.map((s: string) => getMarketFromSymbol(s)));
    
    // ✅ 优化：先检查交易时段（更精确），如果不在交易时段，直接返回，不需要检查交易日
    // 检查至少有一个市场当前在交易时段内
    let isInTradingSession = false;
    for (const market of markets) {
      try {
        const inSession = await tradingSessionService.isInTradingSession(market);
        if (inSession) {
          isInTradingSession = true;
          break;
        }
      } catch (error: any) {
        // 如果交易时段服务失败，降级到交易日检查
        logger.debug(`[策略调度器] ${market}市场交易时段检查失败，降级到交易日检查: ${error.message}`);
        isInTradingSession = false; // 继续检查交易日
        break;
      }
    }

    if (!isInTradingSession) {
      // 非交易时段，跳过策略执行（减少日志频率：每5分钟记录一次）
      // ✅ 优化：仅使用tradingSession检查，不再使用tradingDays二次校验
      // tradingSession已经通过Longbridge API获取当日交易时段，足够精确，无需二次校验
      // tradingDays无法获取未来数据，会导致不必要的限制
      const now = Date.now();
      const lastLogKey = `trading_session_skip_${strategyId}`;
      const lastLogTime = (this as any)[lastLogKey] || 0;
      if (now - lastLogTime > 5 * 60 * 1000) { // 5分钟
        logger.debug(`策略 ${strategyId}: 非交易时段，跳过本次运行`);
        (this as any)[lastLogKey] = now;
      }
      return;
    }

    // 期权策略：收盘前180分钟（1:00 PM ET）且无持仓时，跳过本周期（避免资源浪费）
    const isOptionStrategy = strategyInstance instanceof OptionIntradayStrategy;

    // H2 修复：策略级别每日重置（不依赖IDLE状态）
    if (isOptionStrategy) {
      const etFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      const todayET = etFormatter.format(new Date());
      const lastReset = this.lastDailyResetDate.get(strategyId);
      if (lastReset !== todayET) {
        // 扫描所有非IDLE状态的实例，重置其每日计数
        const holdingInstances = await pool.query(
          `SELECT symbol, current_state, context FROM strategy_instances
           WHERE strategy_id = $1 AND current_state NOT IN ('IDLE')`,
          [strategyId]
        );
        for (const row of holdingInstances.rows) {
          const ctx = row.context || {};
          const refTime = ctx.lastExitTime || ctx.circuitBreakerTime || ctx.entryTime;
          if (refTime) {
            const refDate = etFormatter.format(new Date(refTime));
            if (refDate !== todayET) {
              await strategyInstance.updateState(row.symbol, row.current_state, {
                dailyTradeCount: 0,
                dailyRealizedPnL: 0,
                consecutiveLosses: 0,
                lastTradeDirection: null,
                lastTradePnL: 0,
                circuitBreakerActive: false,
                circuitBreakerReason: null,
                circuitBreakerTime: null,
                tslpFailureCount: 0,
              });
            }
          }
        }
        this.lastDailyResetDate.set(strategyId, todayET);
        this.tslpFailureCount.set(strategyId, 0);
      }
    }

    if (isOptionStrategy) {
      try {
        const closeWindow = await getMarketCloseWindow({
          market: 'US',
          noNewEntryBeforeCloseMinutes: 180,
          forceCloseBeforeCloseMinutes: 30,
        });
        if (closeWindow && new Date() >= closeWindow.noNewEntryTimeUtc) {
          const activeResult = await pool.query(
            `SELECT COUNT(*) as cnt FROM strategy_instances
             WHERE strategy_id = $1 AND current_state IN ('HOLDING','OPENING','CLOSING')`,
            [strategyId]
          );
          if (parseInt(activeResult.rows[0].cnt) === 0) {
            // 限频日志：每5分钟记录一次
            const now = Date.now();
            const lastLogKey = `0dte_idle_skip_${strategyId}`;
            const lastLogTime = (this as any)[lastLogKey] || 0;
            if (now - lastLogTime > 5 * 60 * 1000) {
              logger.debug(`策略 ${strategyId}: 收盘前180分钟，已无持仓，跳过监控`);
              (this as any)[lastLogKey] = now;
            }
            return;
          }
          // 仍有持仓 → 继续执行（等待 0DTE TIME_STOP 触发平仓）
        }
      } catch {
        // 获取失败不阻塞
      }
    }

    // 期权策略：过滤资金不足的标的，将资金重新分配到可交易标的
    let effectiveSymbols = symbols;
    if (isOptionStrategy) {
      try {
        const availableCapital = await capitalManager.getAvailableCapital(strategyId);
        const totalCapital = await capitalManager.getTotalCapital();

        // 获取策略分配金额
        const stratResult = await pool.query(
          `SELECT ca.allocation_type, ca.allocation_value
           FROM strategies s LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
           WHERE s.id = $1`,
          [strategyId]
        );
        if (stratResult.rows.length > 0 && stratResult.rows[0].allocation_type) {
          const row = stratResult.rows[0];
          const allocatedAmount = row.allocation_type === 'PERCENTAGE'
            ? totalCapital * parseFloat(row.allocation_value.toString())
            : parseFloat(row.allocation_value.toString());

          const { effectiveSymbols: eff, excludedSymbols: exc } =
            await capitalManager.getEffectiveSymbolPool(strategyId, symbols, allocatedAmount);

          if (exc.length > 0) {
            // 节流日志：每5分钟记录一次
            const now = Date.now();
            const logKey = `excluded_symbols_${strategyId}`;
            const lastLog = (this as any)[logKey] || 0;
            if (now - lastLog > 5 * 60 * 1000) {
              logger.warn(`[资金过滤] 策略${strategyId}: 排除${exc.length}个资金不足标的: ${exc.join(', ')}，有效标的${eff.length}个`);
              (this as any)[logKey] = now;
            }
          }

          // 保留已有持仓的标的（即使被排除也要继续监控）
          const holdingResult = await pool.query(
            `SELECT DISTINCT symbol FROM strategy_instances
             WHERE strategy_id = $1 AND current_state IN ('HOLDING','OPENING','CLOSING')`,
            [strategyId]
          );
          const holdingSymbols = new Set(holdingResult.rows.map((r: any) => r.symbol));
          const excludedButHolding = exc.filter(s => holdingSymbols.has(s));
          effectiveSymbols = [...eff, ...excludedButHolding];
        }
      } catch {
        // 过滤失败不阻塞，使用全量标的池
      }
    }

    // 初始化执行汇总
    const summary: ExecutionSummary = {
      strategyId,
      startTime: Date.now(),
      totalTargets: 0,
      idle: [],
      holding: [],
      signals: [],
      errors: [],
      actions: [],
      other: []
    };

    summary.totalTargets = effectiveSymbols.length;

    // 3. 分批并行处理多个股票（避免连接池耗尽）
    // 每批处理10个标的，避免一次性占用过多数据库连接
    const BATCH_SIZE = 10;
    for (let i = 0; i < effectiveSymbols.length; i += BATCH_SIZE) {
      const batch = effectiveSymbols.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((symbol) => this.processSymbol(strategyInstance, strategyId, symbol, summary))
      );
      // 批次之间稍作延迟，避免数据库压力过大
      if (i + BATCH_SIZE < effectiveSymbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms延迟
      }
    }

    // 4. 输出汇总日志
    this.logExecutionSummary(summary);
  }

  /**
   * 输出执行汇总日志
   * 优化：根据PRD要求，实现日志聚合和降噪
   */
  private logExecutionSummary(summary: ExecutionSummary): void {
    const duration = Date.now() - summary.startTime;
    const hasActivity = summary.signals.length > 0 || summary.errors.length > 0 || summary.actions.length > 0;
    
    // 如果有活动（信号、错误、操作），输出详细汇总
    if (hasActivity) {
      logger.info(
        `策略 ${summary.strategyId} 执行完成: 耗时 ${duration}ms, ` +
        `扫描 ${summary.totalTargets} 个标的, ` +
        `⚠️ 信号 ${summary.signals.length}, ` +
        `❌ 错误 ${summary.errors.length}, ` +
        `⚡ 操作 ${summary.actions.length}, ` +
        `IDLE: ${summary.idle.length}, HOLDING: ${summary.holding.length}`,
        { 
          metadata: {
            strategyId: summary.strategyId,
            duration,
            totalTargets: summary.totalTargets,
            signals: summary.signals,
            errors: summary.errors,
            actions: summary.actions,
            counts: {
              idle: summary.idle.length,
              holding: summary.holding.length,
              other: summary.other.length
            }
          }
        }
      );
    } else {
      // 纯净模式（全无事）：只记录基本统计，不写入数据库
      logger.debug(
        `策略 ${summary.strategyId} 执行完成: 耗时 ${duration}ms, ` +
        `扫描 ${summary.totalTargets} 个标的 (IDLE: ${summary.idle.length}, HOLDING: ${summary.holding.length})`,
        {
          metadata: {
            strategyId: summary.strategyId,
            duration,
            totalTargets: summary.totalTargets,
            counts: {
              idle: summary.idle.length,
              holding: summary.holding.length,
              other: summary.other.length
            }
          },
          dbWrite: false
        }
      );
    }
  }

  /**
   * 追踪未成交订单，根据市场变化更新价格和状态
   * 修订：使用 todayOrders() API 获取订单，实时监控订单状态
   */
  private async trackPendingOrders(strategyId: number): Promise<void> {
    try {
      // ✅ 交易日检查：非交易日不执行订单监控
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // 获取策略的标的池来判断市场类型
      const strategyResult = await pool.query(
        `SELECT symbol_pool_config FROM strategies WHERE id = $1`,
        [strategyId]
      );
      
      if (strategyResult.rows.length > 0) {
        const symbolPoolConfig = strategyResult.rows[0].symbol_pool_config;
        const symbols = await stockSelector.getSymbolPool(symbolPoolConfig);
        
        if (symbols && symbols.length > 0) {
          const markets = new Set(symbols.map((s: string) => getMarketFromSymbol(s)));
          
          // ✅ 优化：先检查交易时段（更精确），如果不在交易时段，直接返回
          let isInTradingSession = false;
          for (const market of markets) {
            try {
              const inSession = await tradingSessionService.isInTradingSession(market);
              if (inSession) {
                isInTradingSession = true;
                break;
              }
            } catch (error: any) {
              // 如果交易时段服务失败，降级到交易日检查
              logger.debug(`[策略调度器] ${market}市场交易时段检查失败，降级到交易日检查: ${error.message}`);
              isInTradingSession = false; // 继续检查交易日
              break;
            }
          }

          if (!isInTradingSession) {
            // 非交易时段，跳过订单监控（减少日志频率：每5分钟记录一次）
            // ✅ 优化：仅使用tradingSession检查，不再使用tradingDays二次校验
            // tradingSession已经通过Longbridge API获取当日交易时段，足够精确，无需二次校验
            // tradingDays无法获取未来数据，会导致不必要的限制
            const now = Date.now();
            const lastLogKey = `order_monitor_skip_${strategyId}`;
            const lastLogTime = (this as any)[lastLogKey] || 0;
            if (now - lastLogTime > 5 * 60 * 1000) { // 5分钟
              logger.debug(`策略 ${strategyId}: 非交易时段，跳过订单监控`);
              (this as any)[lastLogKey] = now;
            }
            return;
          }
        }
      }

      // 1. 获取今日订单（使用统一缓存服务，避免频繁请求导致频率限制）
      const todayOrders = await todayOrdersCache.getTodayOrders(false);
      
      // 2. 查询策略的所有订单（买入和卖出，用于价格更新和状态同步）
      const strategyOrders = await pool.query(
        `SELECT eo.order_id, eo.symbol, eo.side, eo.price, eo.quantity, eo.created_at, eo.current_status, eo.fill_processed, eo.execution_stage
         FROM execution_orders eo
         WHERE eo.strategy_id = $1
         AND eo.created_at >= NOW() - INTERVAL '24 hours'
         AND (eo.fill_processed IS NOT TRUE)
         ORDER BY eo.created_at DESC
         LIMIT 40`,
        [strategyId]
      );

      if (strategyOrders.rows.length === 0) {
        return;
      }

      // 3. 先筛选出未成交的订单（基于API实时状态，不依赖数据库状态）
      const pendingStatuses = [
        'NotReported',
        'NewStatus',
        'WaitToNew',
        'PendingReplaceStatus',
        'WaitToReplace',
      ];
      
      // 严格排除所有已完成的订单状态
      const completedStatuses = [
        'FilledStatus',           // 已成交
        'PartialFilledStatus',    // 部分成交（虽然部分成交可能还需要更新，但已成交部分不能修改）
        'CanceledStatus',         // 已取消
        'PendingCancelStatus',    // 取消中
        'WaitToCancel',           // 等待取消
        'RejectedStatus',         // 已拒绝
        'ExpiredStatus',          // 已过期
      ];
      
      // 筛选出未成交的订单（完全基于API状态）
      const pendingOrders = strategyOrders.rows.filter((dbOrder: any) => {
        const apiOrder = todayOrders.find((o: any) => 
          (o.orderId || o.order_id) === dbOrder.order_id
        );
        
        if (!apiOrder) {
          return false;
        }
        
        const rawStatus = apiOrder.status;
        const status = normalizeOrderStatus(rawStatus);
        
        // 严格排除所有已完成的订单
        if (completedStatuses.includes(status)) {
          return false;
        }
        
        return pendingStatuses.includes(status);
      });

      // 4. 同步订单状态到数据库并更新策略实例状态（在筛选之后）
      const filledOrders: Array<{ orderId: string; symbol: string; avgPrice: number; filledQuantity: number }> = [];
      
      for (const dbOrder of strategyOrders.rows) {
        const apiOrder = todayOrders.find((o: any) => 
          (o.orderId || o.order_id) === dbOrder.order_id
        );
        
        if (apiOrder) {
          const status = normalizeOrderStatus(apiOrder.status);
          
          // 更新数据库状态
          let dbStatus = 'SUBMITTED';
          if (status === 'FilledStatus') {
            dbStatus = 'FILLED';
            // 记录已成交订单，后续更新策略实例状态
            const avgPrice = parseFloat(apiOrder.executedPrice?.toString() || apiOrder.executed_price?.toString() || '0');
            const filledQuantity = parseInt(apiOrder.executedQuantity?.toString() || apiOrder.executed_quantity?.toString() || '0');
            if (avgPrice > 0 && filledQuantity > 0) {
              filledOrders.push({
                orderId: dbOrder.order_id,
                symbol: dbOrder.symbol,
                avgPrice,
                filledQuantity,
              });
            }

            // ✅ 只有在状态发生变化时才更新信号状态（避免重复尝试匹配已处理的订单）
            if (dbOrder.current_status !== 'FILLED') {
              try {
                await basicExecutionService.updateSignalStatusByOrderId(dbOrder.order_id, 'EXECUTED');
              } catch (signalError: any) {
                logger.warn(`更新信号状态失败 (orderId: ${dbOrder.order_id}):`, signalError.message);
              }
            }
          } else if (status === 'PartialFilledStatus') {
            // V5: 部分成交不触发 fill 处理，等待最终 FilledStatus
            dbStatus = 'PARTIAL_FILLED';
            if (dbOrder.current_status !== 'PARTIAL_FILLED') {
              logger.warn(
                `[PARTIAL_FILL] 订单 ${dbOrder.order_id} (${dbOrder.symbol}): ` +
                `部分成交 qty=${apiOrder.executedQuantity || apiOrder.executed_quantity || '?'}，等待完全成交`
              );
            }
          } else if (status === 'CanceledStatus' || status === 'PendingCancelStatus' || status === 'WaitToCancel') {
            dbStatus = 'CANCELLED';
            // 只有在状态发生变化时才处理（避免重复处理）
            if (dbOrder.current_status !== 'CANCELLED') {
              await this.handleOrderCancelled(strategyId, dbOrder.symbol, dbOrder.order_id);
              
              // 更新信号状态为IGNORED（如果订单被取消）
              try {
                await basicExecutionService.updateSignalStatusByOrderId(dbOrder.order_id, 'IGNORED');
              } catch (signalError: any) {
                logger.warn(`更新信号状态失败 (orderId: ${dbOrder.order_id}):`, signalError.message);
              }
            }
          } else if (status === 'RejectedStatus') {
            dbStatus = 'FAILED';
            // 只有在状态发生变化时才处理（避免重复处理）
            if (dbOrder.current_status !== 'FAILED') {
              await this.handleOrderRejected(strategyId, dbOrder.symbol, dbOrder.order_id);
              
              // 更新信号状态为REJECTED（如果订单被拒绝）
              try {
                await basicExecutionService.updateSignalStatusByOrderId(dbOrder.order_id, 'REJECTED');
              } catch (signalError: any) {
                logger.warn(`更新信号状态失败 (orderId: ${dbOrder.order_id}):`, signalError.message);
              }
            }
          } else if (pendingStatuses.includes(status)) {
            dbStatus = 'NEW';
          }
          
          // 只有在状态发生变化时才更新数据库
          if (dbOrder.current_status !== dbStatus) {
            await pool.query(
              `UPDATE execution_orders 
               SET current_status = $1, updated_at = NOW()
               WHERE order_id = $2`,
              [dbStatus, dbOrder.order_id]
            );
          }
        }
      }

      // 5. 处理已成交订单，更新策略实例状态
      if (filledOrders.length > 0) {
        // 查询策略配置（一次性查询，避免重复查询）
        const strategyConfigResult = await pool.query(
          'SELECT type, config FROM strategies WHERE id = $1',
          [strategyId]
        );
        const strategyType = strategyConfigResult.rows[0]?.type || 'RECOMMENDATION_V1';
        const strategyConfig = strategyConfigResult.rows[0]?.config || {};
        const strategyInstance = this.createStrategyInstance(strategyType, strategyId, strategyConfig);
        
        // 用于跟踪已处理的订单，避免重复处理
        const processedOrders = new Set<string>();
        
        for (const dbOrder of strategyOrders.rows) {
          const apiOrder = todayOrders.find((o: any) => 
            (o.orderId || o.order_id) === dbOrder.order_id
          );
          
          if (!apiOrder) continue;
          
          const status = normalizeOrderStatus(apiOrder.status);
          const isBuy = dbOrder.side === 'BUY' || dbOrder.side === 'Buy' || dbOrder.side === 1;
          const isSell = dbOrder.side === 'SELL' || dbOrder.side === 'Sell' || dbOrder.side === 2;
          
          // 检查订单是否已处理：1) fill_processed 标记已完成，或 2) 在当前循环中已处理过
          if (status === 'FilledStatus' && !dbOrder.fill_processed && !processedOrders.has(dbOrder.order_id)) {
            // 标记为已处理，避免重复处理
            processedOrders.add(dbOrder.order_id);
            const avgPrice = parseFloat(apiOrder.executedPrice?.toString() || apiOrder.executed_price?.toString() || '0');
            const filledQuantity = parseInt(apiOrder.executedQuantity?.toString() || apiOrder.executed_quantity?.toString() || '0');
            
            if (avgPrice > 0 && filledQuantity > 0) {
              try {
                // Fix 4b+260225 Fix E: 立即标记 fill_processed + current_status，防止下个周期重复处理
                // 必须在 TSLPPCT 提交之前完成，避免 TSLPPCT 耗时导致重入
                await pool.query(
                  `UPDATE execution_orders SET current_status = 'FILLED', fill_processed = TRUE, updated_at = NOW() WHERE order_id = $1`,
                  [dbOrder.order_id]
                );

                // V6: 记录实际手续费，供 PnL 计算使用
                let currentOrderFees = 0;

                // 记录交易到数据库（如果之前没有记录）
                try {
                  // 获取订单详情和手续费
                  const { getTradeContext } = await import('../config/longport');
                  const tradeCtx = await getTradeContext();
                  const orderDetail = await tradeCtx.orderDetail(dbOrder.order_id);

                  // 计算手续费
                  const chargeDetail = (orderDetail as any).chargeDetail || (orderDetail as any).charge_detail;
                  const fees = chargeDetail && chargeDetail.total_amount
                    ? parseFloat(chargeDetail.total_amount.toString())
                    : 0;
                  currentOrderFees = fees;

                  // 记录交易
                  await basicExecutionService.recordTrade(
                    strategyId,
                    dbOrder.symbol,
                    isBuy ? 'BUY' : 'SELL',
                    orderDetail,
                    fees
                  );
                } catch (recordError: any) {
                  logger.warn(`记录交易失败 (${dbOrder.order_id}):`, recordError.message);
                  // 继续处理状态更新，不因记录失败而中断
                }
                
                if (isBuy) {
                  // 买入订单成交：更新状态为HOLDING
                  // 期权策略兼容：execution_orders.symbol 可能是期权symbol，但 strategy_instances.symbol 可能是 underlying
                  let instanceKeySymbol = dbOrder.symbol;
                  let context: any = {};
                  
                  // 尝试从 context 中匹配 tradedSymbol / intent.symbol
                  const mappingResult = await pool.query(
                    `SELECT symbol, context FROM strategy_instances
                     WHERE strategy_id = $1
                       AND (
                         context->>'tradedSymbol' = $2
                         OR context->'intent'->>'symbol' = $2
                       )
                     ORDER BY last_updated DESC
                     LIMIT 1`,
                    [strategyId, dbOrder.symbol]
                  );
                  
                  if (mappingResult.rows.length > 0) {
                    instanceKeySymbol = mappingResult.rows[0].symbol;
                    const ctx = mappingResult.rows[0].context;
                    try {
                      context = typeof ctx === 'string' ? JSON.parse(ctx) : (ctx || {});
                    } catch {
                      context = {};
                    }
                  } else {
                    const instanceResult = await pool.query(
                      `SELECT context FROM strategy_instances 
                       WHERE strategy_id = $1 AND symbol = $2`,
                      [strategyId, dbOrder.symbol]
                    );
                    if (instanceResult.rows.length > 0 && instanceResult.rows[0].context) {
                      try {
                        context = typeof instanceResult.rows[0].context === 'string' 
                          ? JSON.parse(instanceResult.rows[0].context)
                          : instanceResult.rows[0].context;
                      } catch {
                        context = {};
                      }
                    }
                  }
                  
                  // 期权策略：使用 allocationAmountOverride（包含完整成本：premium*multiplier*contracts+fees）
                  let allocationAmount: number | undefined = undefined;
                  const isOption = context.optionMeta?.assetClass === 'OPTION' || context.intent?.metadata?.assetClass === 'OPTION';

                  if (isOption) {
                    // 优先使用 intent 中的 allocationAmountOverride
                    if (context.intent?.metadata?.allocationAmountOverride) {
                      allocationAmount = parseFloat(String(context.intent.metadata.allocationAmountOverride));
                    } else if (context.allocationAmount) {
                      // 降级使用 context.allocationAmount
                      allocationAmount = parseFloat(String(context.allocationAmount));
                    } else {
                      // 最后降级：计算 premium * multiplier * contracts（缺少手续费）
                      const multiplier = context.optionMeta?.multiplier || context.intent?.metadata?.multiplier || 100;
                      allocationAmount = avgPrice * filledQuantity * multiplier;
                      logger.warn(
                        `策略 ${strategyId} 期权 ${dbOrder.symbol}: allocationAmountOverride缺失，使用fallback计算=${allocationAmount.toFixed(2)} USD（缺少手续费）`
                      );
                    }
                  }

                  // Fix 10: 资金差异修复 — 用实际成交价更新 allocationAmount
                  if (isOption && allocationAmount !== undefined && avgPrice > 0 && filledQuantity > 0) {
                    const multiplier = context.optionMeta?.multiplier || context.intent?.metadata?.multiplier || 100;
                    const actualCost = avgPrice * filledQuantity * multiplier;
                    // 仅当差异 > $1 时调整（避免浮点噪声）
                    if (Math.abs(actualCost - allocationAmount) > 1) {
                      const diff = actualCost - allocationAmount;
                      logger.info(
                        `[资金修正] ${instanceKeySymbol} 预估分配$${allocationAmount.toFixed(2)} -> ` +
                        `实际成本$${actualCost.toFixed(2)}，差额$${diff.toFixed(2)}`
                      );
                      if (diff < 0) {
                        // 实际成本更低，释放多余分配
                        await capitalManager.releaseAllocation(strategyId, Math.abs(diff), instanceKeySymbol);
                      }
                      // diff > 0 时不额外分配（requestAllocation 已预留，多出部分在卖出时自然平衡）
                      allocationAmount = actualCost;
                    }
                  }

                  // 检查是否已经是HOLDING状态（避免重复更新和日志）
                  const currentInstanceState = await strategyInstance.getCurrentState(instanceKeySymbol);
                  if (currentInstanceState === 'HOLDING') {
                    // 已经是HOLDING，只需确保DB状态标记为FILLED并标记fill_processed
                    await pool.query(
                      `UPDATE execution_orders SET current_status = 'FILLED', fill_processed = TRUE, updated_at = NOW() WHERE order_id = $1`,
                      [dbOrder.order_id]
                    );
                  } else {
                    await strategyInstance.updateState(instanceKeySymbol, 'HOLDING', {
                      entryPrice: avgPrice,
                      quantity: filledQuantity,
                      stopLoss: context.stopLoss,
                      takeProfit: context.takeProfit,
                      orderId: dbOrder.order_id,
                      tradedSymbol: context.tradedSymbol || (dbOrder.symbol !== instanceKeySymbol ? dbOrder.symbol : undefined),
                      optionMeta: context.optionMeta || (context.intent?.metadata ? context.intent.metadata : undefined),
                      allocationAmount,
                      entryFees: currentOrderFees,  // V6: 实际 BUY 端手续费
                    });

                    logger.log(`策略 ${strategyId} 标的 ${instanceKeySymbol} 买入订单已成交，更新状态为HOLDING，订单ID: ${dbOrder.order_id}`);

                    // === TSLPPCT 保护单提交 ===
                    // 期权买入成交后自动挂出跟踪止损保护单
                    const optMeta = context.optionMeta || context.intent?.metadata;
                    const isOptionAsset = optMeta?.assetClass === 'OPTION' || optMeta?.optionType;
                    if (isOptionAsset && !context.protectionOrderId) {
                      try {
                        const tradedSym = context.tradedSymbol || dbOrder.symbol;
                        const expDate = trailingStopProtectionService.extractOptionExpireDate(tradedSym, optMeta);
                        const is0DTE = (() => {
                          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
                          return expDate === today;
                        })();
                        let trailingPct = trailingStopProtectionService.getTrailingPercentForPhase({
                          phase: 'EARLY',
                          is0DTE,
                        });

                        // deviation 动态调整已删除 (260225二次审查 Fix A)
                        // TSLPPCT 是崩溃保护安全网，固定使用 getTrailingPercentForPhase 返回值
                        // 0DTE=45%, 非0DTE EARLY=60%。不因信号偏差收紧。

                        const tslpResult = await trailingStopProtectionService.submitProtection(
                          tradedSym,
                          filledQuantity,
                          trailingPct,
                          0.10,
                          expDate,
                          strategyId,
                        );
                        if (tslpResult.success && tslpResult.orderId) {
                          // 保存 protectionOrderId 到 context
                          await strategyInstance.updateState(instanceKeySymbol, 'HOLDING', {
                            protectionOrderId: tslpResult.orderId,
                            protectionTrailingPct: trailingPct,
                          });
                          logger.log(`策略 ${strategyId} 期权 ${tradedSym}: TSLPPCT保护单已提交 orderId=${tslpResult.orderId}, trailing=${trailingPct}%`);
                          // 260225 Iron Dome: TSLPPCT 成功，重置失败计数
                          await this.resetTslpFailure(strategyId);
                        } else {
                          logger.warn(`策略 ${strategyId} 期权 ${tradedSym}: TSLPPCT提交失败(${tslpResult.error})，降级到纯监控模式`);
                          // 260225 Iron Dome: 记录 TSLPPCT 失败
                          await this.recordTslpFailure(strategyId);

                          // C1 修复：将重试标记写入DB context（替代不可靠的setTimeout）
                          // 下一个HOLDING周期会检测此标记并重试
                          if (avgPrice > 0) {
                            const emergencyStopLoss = avgPrice * 0.5;
                            await strategyInstance.updateState(instanceKeySymbol, 'HOLDING', {
                              emergencyStopLoss,
                              tslpRetryPending: true,
                              tslpRetryParams: {
                                tradedSymbol: tradedSym,
                                quantity: filledQuantity,
                                trailingPct,
                                limitOffset: 0.10,
                                expireDate: expDate,
                              },
                              tslpRetryAfter: new Date(Date.now() + 30000).toISOString(),
                            });
                            logger.warn(`[TSLP_EMERGENCY] 策略${strategyId} ${tradedSym}: 设置紧急止损 $${emergencyStopLoss.toFixed(2)} + 30秒后DB重试`);
                          }
                        }

                      } catch (tslpErr: any) {
                        logger.warn(`策略 ${strategyId} 标的 ${instanceKeySymbol}: TSLPPCT提交异常(${tslpErr?.message})，降级到纯监控模式`);
                        // 260225 Iron Dome: 异常也计入失败
                        await this.recordTslpFailure(strategyId);

                        // P1-4: 异常时也设置紧急止损
                        if (avgPrice > 0) {
                          try {
                            const emergencyStopLoss = avgPrice * 0.5;
                            await strategyInstance.updateState(instanceKeySymbol, 'HOLDING', {
                              emergencyStopLoss,
                            });
                            logger.warn(`[TSLP_EMERGENCY] 策略${strategyId} ${instanceKeySymbol}: 异常后设置紧急止损 $${emergencyStopLoss.toFixed(2)}`);
                          } catch (eErr: any) {
                            logger.error(`[TSLP_EMERGENCY] 设置紧急止损失败: ${eErr.message}`);
                          }
                        }
                      }
                    }
                    // fill_processed 已在 Fix E 处提前标记，此处无需重复
                  }
                } else if (isSell) {
                  // 卖出订单成交：更新状态为IDLE，释放资金
                  let instanceKeySymbol = dbOrder.symbol;
                  let context: any = {};
                  const mappingResult = await pool.query(
                    `SELECT symbol, context FROM strategy_instances
                     WHERE strategy_id = $1
                       AND (
                         context->>'tradedSymbol' = $2
                         OR context->'intent'->>'symbol' = $2
                       )
                     ORDER BY last_updated DESC
                     LIMIT 1`,
                    [strategyId, dbOrder.symbol]
                  );
                  if (mappingResult.rows.length > 0) {
                    instanceKeySymbol = mappingResult.rows[0].symbol;
                    const ctx = mappingResult.rows[0].context;
                    try {
                      context = typeof ctx === 'string' ? JSON.parse(ctx) : (ctx || {});
                    } catch {
                      context = {};
                    }
                  }
                  
                  // 检测是否为 TSLPPCT 自动成交 (260225 Fix D: 用 protectionOrderId 匹配 + execution_stage 辅助)
                  const isTslpFill = Boolean(
                    (context.protectionOrderId && dbOrder.order_id === context.protectionOrderId) ||
                    (dbOrder.execution_stage === 1 && dbOrder.side === 'SELL')
                  );
                  if (isTslpFill) {
                    logger.log(`策略 ${strategyId} 标的 ${instanceKeySymbol}: 卖出订单为TSLPPCT自动触发成交 (orderId=${dbOrder.order_id}, protectionOrderId=${context.protectionOrderId})`);
                  }

                  // Fix 11: 递增 dailyTradeCount 供动态冷却期使用
                  const prevDailyTradeCount = context.dailyTradeCount ?? 0;

                  // Fix 12 + V6: 计算本笔交易 PnL 并追踪日内累计亏损
                  const sellEntryPrice = parseFloat(String(context.entryPrice || 0));
                  const sellQty = parseFloat(String(context.quantity || context.optionMeta?.quantity || 1));
                  const sellMultiplier = Number(context.optionMeta?.multiplier) || 100;
                  const isOptionAssetSell = context.optionMeta?.assetClass === 'OPTION';

                  // V6: 用实际手续费替代 sellEntryFees * 2 估算
                  const buyFees = parseFloat(String(context.entryFees || 0));
                  const sellFees = currentOrderFees;
                  // 总手续费: 优先用两端实际值，回退到已知一端 × 2
                  const totalFees = (buyFees > 0 && sellFees > 0)
                    ? buyFees + sellFees
                    : (buyFees > 0 ? buyFees * 2 : (sellFees > 0 ? sellFees * 2 : 0));

                  let tradePnL = 0;
                  if (sellEntryPrice > 0 && avgPrice > 0) {
                    if (isOptionAssetSell) {
                      tradePnL = (avgPrice - sellEntryPrice) * sellQty * sellMultiplier - totalFees;
                    } else {
                      tradePnL = (avgPrice - sellEntryPrice) * sellQty - totalFees;
                    }
                  }
                  tradePnL = Math.round(tradePnL * 100) / 100;

                  const rawPrevLosses = parseInt(String(context.consecutiveLosses ?? 0), 10);
                  const prevConsecutiveLosses = isNaN(rawPrevLosses) ? 0 : rawPrevLosses;
                  const newConsecutiveLosses = tradePnL < 0 ? prevConsecutiveLosses + 1 : 0;
                  const rawPrevPnL = parseFloat(String(context.dailyRealizedPnL ?? 0));
                  const prevDailyPnL = isNaN(rawPrevPnL) ? 0 : rawPrevPnL;
                  const newDailyPnL = Math.round((prevDailyPnL + tradePnL) * 100) / 100;

                  // 提取交易方向（CALL/PUT）
                  const tradeDirection = context.optionMeta?.optionDirection
                    || context.optionMeta?.optionType
                    || context.intent?.metadata?.optionDirection
                    || null;

                  // 260225 Fix C: 软件退出时取消 broker 端残留 TSLPPCT 保护单
                  if (context.protectionOrderId && !isTslpFill) {
                    try {
                      const cancelResult = await trailingStopProtectionService.cancelProtection(
                        context.protectionOrderId,
                        strategyId,
                        context.tradedSymbol || dbOrder.symbol,
                      );
                      if (cancelResult.alreadyFilled) {
                        logger.warn(`策略 ${strategyId} 标的 ${instanceKeySymbol}: TSLPPCT在软件退出前已触发成交！需要检查仓位一致性`);
                      }
                    } catch (cancelErr: any) {
                      logger.warn(`策略 ${strategyId} 标的 ${instanceKeySymbol}: 取消残留TSLPPCT失败: ${cancelErr?.message}`);
                    }
                  }

                  // 260225 Fix B: protectionOrderId 无条件清除（不再依赖 isTslpFill 条件分支）
                  await strategyInstance.updateState(instanceKeySymbol, 'IDLE', {
                    lastExitTime: new Date().toISOString(),
                    dailyTradeCount: prevDailyTradeCount + 1,
                    // 日内 PnL 追踪
                    dailyRealizedPnL: newDailyPnL,
                    consecutiveLosses: newConsecutiveLosses,
                    lastTradeDirection: tradeDirection,
                    lastTradePnL: tradePnL,
                    takeProfitOrderId: null,
                    protectionOrderId: null,
                    protectionTrailingPct: null,
                    exitReason: isTslpFill ? 'TSLPPCT_FILLED' : null,
                  });

                  if (tradePnL !== 0) {
                    logger.log(
                      `策略 ${strategyId} 标的 ${instanceKeySymbol}: 本笔PnL=$${tradePnL.toFixed(2)}, ` +
                      `日内累计=$${newDailyPnL.toFixed(2)}, 连亏=${newConsecutiveLosses}笔` +
                      (tradeDirection ? `, 方向=${tradeDirection}` : '')
                    );
                  }

                  // 策略级日内亏损熔断检查（跨标的聚合）
                  if (isOptionAssetSell && tradePnL < 0) {
                    try {
                      const strategyConfig = (strategyInstance as any)?.config || {};
                      const riskLimits = (strategyConfig as any)?.riskLimits || {};
                      const maxConsecLosses = riskLimits.maxConsecutiveLosses ?? 4;
                      // 动态熔断阈值：基于策略实际可用资金的百分比（默认30%）
                      const circuitBreakerPct = riskLimits.circuitBreakerPercent ?? 30;

                      // 聚合策略级日内 PnL（所有标的）
                      const pnlResult = await pool.query(
                        `SELECT COALESCE(SUM((context->>'dailyRealizedPnL')::numeric), 0) as total_pnl
                         FROM strategy_instances
                         WHERE strategy_id = $1
                           AND (context->>'dailyRealizedPnL') IS NOT NULL`,
                        [strategyId]
                      );
                      const strategyDailyPnL = parseFloat(pnlResult.rows[0]?.total_pnl || '0');

                      // 获取策略可用资金池（allocated - current_usage）作为动态阈值基准
                      let maxDailyLoss = riskLimits.maxDailyLoss ?? 300; // fallback 固定值
                      try {
                        const availableCapital = await capitalManager.getAvailableCapital(strategyId);
                        const totalAllocated = availableCapital + parseFloat(String(context.allocationAmount || 0));
                        if (totalAllocated > 0) {
                          maxDailyLoss = Math.round(totalAllocated * circuitBreakerPct / 100);
                          // 最低 $100 防止资金池很小时阈值太低
                          maxDailyLoss = Math.max(100, maxDailyLoss);
                        }
                      } catch (capErr: unknown) {
                        logger.warn(`策略 ${strategyId}: 获取可用资金失败，使用固定熔断阈值 $${maxDailyLoss}`);
                      }

                      const shouldBreak = strategyDailyPnL <= -maxDailyLoss || newConsecutiveLosses >= maxConsecLosses;
                      if (shouldBreak) {
                        const reason = strategyDailyPnL <= -maxDailyLoss
                          ? `日内累计亏损 $${Math.abs(strategyDailyPnL).toFixed(0)} >= 阈值 $${maxDailyLoss}`
                          : `连续亏损 ${newConsecutiveLosses} 笔 >= 阈值 ${maxConsecLosses}`;

                        logger.warn(`[CIRCUIT_BREAKER] 策略 ${strategyId} 标的 ${instanceKeySymbol}: ${reason}，暂停至收盘`);

                        // 对该策略所有标的设置熔断
                        await pool.query(
                          `UPDATE strategy_instances
                           SET context = context || $1::jsonb
                           WHERE strategy_id = $2`,
                          [
                            JSON.stringify({
                              circuitBreakerActive: true,
                              circuitBreakerReason: reason,
                              circuitBreakerTime: new Date().toISOString(),
                            }),
                            strategyId,
                          ]
                        );

                        // V3: 熔断后对所有 HOLDING 仓位收紧 TSLPPCT 保护
                        try {
                          const holdingInstances = await pool.query(
                            `SELECT symbol, context FROM strategy_instances
                             WHERE strategy_id = $1 AND current_state = 'HOLDING'`,
                            [strategyId]
                          );
                          for (const row of holdingInstances.rows) {
                            const hCtx = typeof row.context === 'string' ? JSON.parse(row.context) : (row.context || {});
                            const tradedSymbol = hCtx.tradedSymbol || row.symbol;
                            const protectionId = hCtx.protectionOrderId;
                            const qty = parseInt(String(hCtx.quantity || 1));

                            if (protectionId) {
                              try {
                                await trailingStopProtectionService.adjustProtection(
                                  protectionId, 15, 0.10, qty, strategyId, tradedSymbol
                                );
                                logger.warn(
                                  `[CIRCUIT_BREAKER] 策略 ${strategyId} 标的 ${row.symbol}: HOLDING仓位TSLPPCT已收紧至15%`
                                );
                              } catch (replaceErr: unknown) {
                                logger.warn(
                                  `[CIRCUIT_BREAKER] 策略 ${strategyId} 标的 ${row.symbol}: ` +
                                  `收紧TSLPPCT失败: ${replaceErr instanceof Error ? replaceErr.message : replaceErr}`
                                );
                              }
                            } else {
                              logger.warn(
                                `[CIRCUIT_BREAKER] 策略 ${strategyId} 标的 ${row.symbol}: ` +
                                `HOLDING仓位无保护单，熔断后无法收紧`
                              );
                            }
                          }
                        } catch (holdingErr: unknown) {
                          logger.warn(`策略 ${strategyId}: 熔断收紧HOLDING失败: ${holdingErr instanceof Error ? holdingErr.message : holdingErr}`);
                        }
                      }
                    } catch (cbErr: unknown) {
                      const cbMsg = cbErr instanceof Error ? cbErr.message : String(cbErr);
                      logger.warn(`策略 ${strategyId}: 熔断检查异常: ${cbMsg}`);
                    }
                  }

                  // Fix 8b 联动: 卖出成交后更新反向策略 kill switch
                  if (sellEntryPrice > 0 && avgPrice > 0) {
                    const pnlPct = ((avgPrice - sellEntryPrice) / sellEntryPrice) * 100;
                    const si = strategyInstance as any;
                    if (typeof si.updateReverseStrategyKillSwitch === 'function') {
                      si.updateReverseStrategyKillSwitch(pnlPct);
                    }
                  }

                  // 释放资金：
                  // - 对股票策略：历史实现使用"成交金额"释放（可能与allocatedAmount不一致，但沿用）
                  // - 对期权策略：必须优先用 allocationAmount（含 multiplier & fees），否则会少乘 multiplier
                  let releaseAmount = 0;
                  
                  const ctx = context || {};
                  try {
                    const isOption = ctx?.optionMeta?.assetClass === 'OPTION';

                    if (isOption) {
                      // 期权策略：优先使用保存的 allocationAmount（包含完整成本：premium*multiplier*contracts+fees）
                      if (ctx.allocationAmount) {
                        releaseAmount = parseFloat(ctx.allocationAmount.toString() || '0');
                        logger.log(
                          `策略 ${strategyId} 期权 ${instanceKeySymbol}: 资金释放 ${releaseAmount.toFixed(2)} USD（来自allocationAmount）`
                        );
                      } else {
                        // Fallback: 重新计算（不应该走到这里，记录警告）
                        const multiplier = parseInt(String(ctx?.optionMeta?.multiplier)) || 100;
                        logger.warn(
                          `策略 ${strategyId} 期权 ${instanceKeySymbol}: allocationAmount缺失，使用fallback计算（multiplier=${multiplier}）`
                        );

                        // 验证 multiplier 来源
                        if (!ctx?.optionMeta?.multiplier) {
                          logger.error(
                            `策略 ${strategyId} 期权 ${instanceKeySymbol}: optionMeta.multiplier缺失，使用默认值100可能不准确！`
                          );
                        }

                        if (ctx.entryPrice && ctx.quantity) {
                          // entryPrice is premium, quantity is contracts
                          releaseAmount = parseFloat(ctx.entryPrice.toString() || '0') *
                                         parseInt(ctx.quantity.toString() || '0') *
                                         multiplier;

                          // 添加手续费估算（如果有元数据）
                          if (ctx?.optionMeta?.estimatedFees) {
                            const fees = parseFloat(String(ctx.optionMeta.estimatedFees)) || 0;
                            releaseAmount += fees;
                            logger.log(
                              `策略 ${strategyId} 期权 ${instanceKeySymbol}: 添加手续费 ${fees.toFixed(2)} USD`
                            );
                          }
                        } else if (avgPrice > 0 && filledQuantity > 0) {
                          // last resort: sell fill amount * multiplier
                          releaseAmount = avgPrice * filledQuantity * multiplier;
                          logger.warn(
                            `策略 ${strategyId} 期权 ${instanceKeySymbol}: 使用成交价计算资金释放（可能不准确）`
                          );
                        }

                        logger.log(
                          `策略 ${strategyId} 期权 ${instanceKeySymbol}: Fallback计算释放资金 ${releaseAmount.toFixed(2)} USD`
                        );
                      }
                    } else {
                      if (avgPrice > 0 && filledQuantity > 0) {
                        releaseAmount = avgPrice * filledQuantity;
                        logger.log(
                          `策略 ${strategyId} 标的 ${instanceKeySymbol} 卖出订单已成交，` +
                          `使用实际成交金额释放资金: ${releaseAmount.toFixed(2)} ` +
                          `(成交价=${avgPrice.toFixed(2)}, 数量=${filledQuantity})`
                        );
                      } else if (ctx.allocationAmount) {
                        releaseAmount = parseFloat(ctx.allocationAmount.toString() || '0');
                      } else if (ctx.entryPrice && ctx.quantity) {
                        releaseAmount = parseFloat(ctx.entryPrice.toString() || '0') *
                                       parseInt(ctx.quantity.toString() || '0');
                      }
                    }
                  } catch (e) {
                    logger.error(`策略 ${strategyId} 标的 ${instanceKeySymbol} 解析context失败:`, e);
                  }
                  
                  if (releaseAmount > 0) {
                    await capitalManager.releaseAllocation(
                      strategyId,
                      releaseAmount,
                      instanceKeySymbol
                    );
                  }

                  // 检查是否所有持仓已平仓，自动重置已用资金（修复资金差异漂移）
                  try {
                    const activeCheck = await pool.query(
                      `SELECT COUNT(*) as cnt FROM strategy_instances
                       WHERE strategy_id = $1 AND current_state IN ('HOLDING','OPENING','CLOSING')`,
                      [strategyId]
                    );
                    if (parseInt(activeCheck.rows[0].cnt) === 0) {
                      await capitalManager.resetUsedAmount(strategyId);
                    }
                  } catch {
                    // 非关键操作，失败不阻塞
                  }

                  // 立即更新数据库状态为FILLED并标记fill_processed，防止重复处理
                  await pool.query(
                    `UPDATE execution_orders
                     SET current_status = 'FILLED', fill_processed = TRUE, updated_at = NOW()
                     WHERE order_id = $1`,
                    [dbOrder.order_id]
                  );
                }
              } catch (error: any) {
                logger.error(`更新已成交订单状态失败 (${dbOrder.order_id}):`, error);
                if (processedOrders) {
                  processedOrders.add(dbOrder.order_id);
                }
              }
            }
          }
        }
      }

      // 6. 如果没有待监控的订单，直接返回
      if (pendingOrders.length === 0) {
        return;
      }

      {
        const now = Date.now();
        const lastLogKey = `pending_orders_log_${strategyId}`;
        const lastLogTime = (this as any)[lastLogKey] || 0;
        if (now - lastLogTime > 5 * 60 * 1000) {
          logger.log(`策略 ${strategyId}: 监控 ${pendingOrders.length} 个未成交订单`, { dbWrite: false });
          (this as any)[lastLogKey] = now;
        }
      }

      // 7. 获取当前行情并评估是否需要调整订单价格
      const { getQuoteContext } = await import('../config/longport');
      const quoteCtx = await getQuoteContext();
      const symbols = pendingOrders.map((row: any) => row.symbol);
      const quotes = await quoteCtx.quote(symbols);

      const quoteMap = new Map<string, any>();
      for (const quote of quotes) {
        quoteMap.set(quote.symbol, quote);
      }

      // 处理每个订单
      for (const order of pendingOrders) {
        try {
          const apiOrder = todayOrders.find((o: any) => 
            (o.orderId || o.order_id) === order.order_id
          );
          
          if (!apiOrder) continue;
          
          const orderType = apiOrder.orderType || apiOrder.order_type;
          
          // 市价单不支持修改
          if (orderType === 'MO' || orderType === 2) {
            continue;
          }
          
          if (orderType === 'SLO') {
            continue;
          }
          
          const quote = quoteMap.get(order.symbol);
          if (!quote) continue;

          const currentPrice = parseFloat(quote.lastDone?.toString() || quote.last_done?.toString() || '0');
          const orderPrice = parseFloat(order.price);
          
          if (currentPrice <= 0) continue;

          // 计算价格差异百分比
          const priceDiff = Math.abs(currentPrice - orderPrice) / orderPrice;
          
          // 如果当前价格与订单价格差异超过2%，更新订单价格
          if (priceDiff > 0.02) {
            const newPrice = currentPrice * 1.01; // 比当前价格高1%，确保能成交
            
            // 格式化价格
            const { detectMarket } = await import('../utils/order-validation');
            const market = detectMarket(order.symbol);
            let formattedPrice: number;
            if (market === 'US') {
              formattedPrice = Math.round(newPrice * 100) / 100;
            } else if (market === 'HK') {
              formattedPrice = Math.round(newPrice * 1000) / 1000;
            } else {
              formattedPrice = Math.round(newPrice * 100) / 100;
            }

            // 调用SDK更新订单
            const { getTradeContext, Decimal } = await import('../config/longport');
            const tradeCtx = await getTradeContext();
            const orderQuantity = parseInt(order.quantity?.toString() || '0');
            
            if (orderQuantity <= 0) continue;
            
            await longportRateLimiter.execute(() =>
              // LongPort SDK typings are `any` in this repo; explicitly pin type to avoid `unknown` inference
              retryWithBackoff<any>(() =>
                tradeCtx.replaceOrder({
                  orderId: order.order_id,
                  // ⚠️ 修复：LongPort replaceOrder.quantity 需要 Decimal
                  quantity: new Decimal(orderQuantity.toString()),
                  price: new Decimal(formattedPrice.toString()),
                }) as any
              )
            );

            // 更新数据库
            await pool.query(
              `UPDATE execution_orders 
               SET price = $1, updated_at = NOW() 
               WHERE order_id = $2`,
              [formattedPrice, order.order_id]
            );
            
            logger.log(`策略 ${strategyId} 标的 ${order.symbol} 订单价格已更新: ${orderPrice.toFixed(2)} -> ${formattedPrice.toFixed(2)}`);
          }
        } catch (orderError: any) {
          const errorMessage = orderError.message || '';
          const errorCode = orderError.code || '';
          
          if (errorCode === '602012' || errorMessage.includes('602012') || errorMessage.includes('Order amendment is not supported')) {
            continue;
          }
          
          logger.warn(`策略 ${strategyId} 标的 ${order.symbol} 订单价格更新失败 (${order.order_id}): ${errorMessage}`);
        }
      }
    } catch (error: any) {
      logger.error(`追踪未成交订单失败 (策略 ${strategyId}):`, error);
    }
  }

  /**
   * 处理订单已取消的情况
   */
  private async handleOrderCancelled(strategyId: number, symbol: string, orderId: string): Promise<void> {
    try {
      const checkResult = await pool.query(
        `SELECT current_status FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (checkResult.rows.length === 0 || checkResult.rows[0].current_status === 'CANCELLED') {
        return;
      }
      
      const orderResult = await pool.query(
        `SELECT quantity, price FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        // C3 修复：优先使用 context.allocationAmount（期权含100x乘数），回退到 qty*price（股票）
        const instanceResult = await pool.query(
          'SELECT context FROM strategy_instances WHERE strategy_id = $1 AND symbol = $2',
          [strategyId, symbol]
        );
        const ctx = instanceResult.rows[0]?.context || {};
        const allocationAmount = parseFloat(ctx.allocationAmount || '0');
        const amount = allocationAmount > 0
          ? allocationAmount
          : parseFloat(order.quantity) * parseFloat(order.price);

        await capitalManager.releaseAllocation(strategyId, amount, symbol);

        const strategyConfigResult = await pool.query(
          'SELECT type, config FROM strategies WHERE id = $1',
          [strategyId]
        );
        const strategyType = strategyConfigResult.rows[0]?.type || 'RECOMMENDATION_V1';
        const strategyConfig = strategyConfigResult.rows[0]?.config || {};
        const strategyInstance = this.createStrategyInstance(strategyType, strategyId, strategyConfig);
        // 读取当前context获取之前的cancelCount（复用上面的instanceResult）
        const prevCancelCtx = ctx;
        const prevCancelCount = prevCancelCtx.cancelCount || 0;

        await strategyInstance.updateState(symbol, 'IDLE', {
          lastCancelTime: new Date().toISOString(),
          cancelCount: prevCancelCount + 1,
        });

        logger.log(`策略 ${strategyId} 标的 ${symbol} 订单已取消，已释放资金 ${amount.toFixed(2)}，订单ID: ${orderId}, cancelCount=${prevCancelCount + 1}`);
      }
    } catch (error: any) {
      logger.error(`处理订单取消失败 (${orderId}):`, error);
    }
  }

  /**
   * 处理订单被拒绝的情况
   */
  private async handleOrderRejected(strategyId: number, symbol: string, orderId: string): Promise<void> {
    try {
      const checkResult = await pool.query(
        `SELECT current_status FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (checkResult.rows.length === 0 || checkResult.rows[0].current_status === 'FAILED') {
        return;
      }
      
      const orderResult = await pool.query(
        `SELECT quantity, price FROM execution_orders WHERE order_id = $1`,
        [orderId]
      );
      
      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        // C3 修复：优先使用 context.allocationAmount（期权含100x乘数），回退到 qty*price（股票）
        const instanceResult = await pool.query(
          'SELECT context FROM strategy_instances WHERE strategy_id = $1 AND symbol = $2',
          [strategyId, symbol]
        );
        const ctx = instanceResult.rows[0]?.context || {};
        const allocationAmount = parseFloat(ctx.allocationAmount || '0');
        const amount = allocationAmount > 0
          ? allocationAmount
          : parseFloat(order.quantity) * parseFloat(order.price);

        await capitalManager.releaseAllocation(strategyId, amount, symbol);

        const strategyConfigResult = await pool.query(
          'SELECT type, config FROM strategies WHERE id = $1',
          [strategyId]
        );
        const strategyType = strategyConfigResult.rows[0]?.type || 'RECOMMENDATION_V1';
        const strategyConfig = strategyConfigResult.rows[0]?.config || {};
        const strategyInstance = this.createStrategyInstance(strategyType, strategyId, strategyConfig);
        // 读取当前context获取之前的cancelCount（复用上面的instanceResult）
        const prevRejectCtx = ctx;
        const prevRejectCancelCount = prevRejectCtx.cancelCount || 0;

        await strategyInstance.updateState(symbol, 'IDLE', {
          lastCancelTime: new Date().toISOString(),
          cancelCount: prevRejectCancelCount + 1,
        });

        logger.warn(`策略 ${strategyId} 标的 ${symbol} 订单被拒绝，已释放资金 ${amount.toFixed(2)}，订单ID: ${orderId}, cancelCount=${prevRejectCancelCount + 1}`);
      }
    } catch (error: any) {
      logger.error(`处理订单拒绝失败 (${orderId}):`, error);
    }
  }

  /**
   * 处理单个股票
   */
  private async processSymbol(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string,
    summary: ExecutionSummary
  ): Promise<void> {
    // P0-1: 提升 allocationResult 到 try 外，catch 中可访问
    let allocationResult: { approved: boolean; allocatedAmount: number; reason?: string } | null = null;
    try {
      // 检查当前状态
      const currentState = await strategyInstance.getCurrentState(symbol);
      const isOptionStrategy = strategyInstance instanceof OptionIntradayStrategy;
      const strategyConfig: any = (strategyInstance as any)?.config || {};

      // 根据状态进行不同处理
      if (currentState === 'HOLDING') {
        // 持仓状态：检查是否需要卖出（止盈/止损）
        // 传递 summary 给子方法，用于记录执行结果
        const actionResult = await this.processHoldingPosition(strategyInstance, strategyId, symbol);
        if (actionResult.actionTaken) {
          summary.actions.push(symbol);
        } else {
          summary.holding.push(symbol);
        }

        // ⚠️ 期权策略特殊处理：HOLDING状态下继续寻找新的交易机会
        // 因为期权策略可能需要同时持有多个合约（不同到期日、不同行权价）
        if (isOptionStrategy) {
          await this.processOptionNewSignalWhileHolding(strategyInstance, strategyId, symbol, strategyConfig, summary);
        }
        return;
      } else if (currentState === 'SHORT') {
        // ⚠️ 新增：卖空持仓状态：检查是否需要平仓（止盈/止损）
        const actionResult = await this.processShortPosition(strategyInstance, strategyId, symbol);
        if (actionResult.actionTaken) {
          summary.actions.push(symbol);
        } else {
          summary.holding.push(`${symbol}(SHORT)`);
        }
        return;
      } else if (currentState === 'CLOSING' || currentState === 'COVERING') {
        // C2 修复：CLOSING/COVERING 超时强制重置（15分钟）
        const closingStaleResult = await pool.query(
          `SELECT context FROM strategy_instances
           WHERE strategy_id = $1 AND symbol = $2 AND current_state = $3
             AND last_updated < NOW() - INTERVAL '15 minutes'`,
          [strategyId, symbol, currentState]
        );
        if (closingStaleResult.rows.length > 0) {
          const staleCtx = closingStaleResult.rows[0].context || {};
          const allocationAmount = parseFloat(staleCtx.allocationAmount || '0');
          if (allocationAmount > 0) {
            try {
              await capitalManager.releaseAllocation(strategyId, allocationAmount, symbol);
            } catch (releaseErr: any) {
              logger.error(`[${currentState}_TIMEOUT] 资金释放失败: ${releaseErr.message}`);
            }
          }
          await strategyInstance.updateState(symbol, 'IDLE');
          logger.warn(`[${currentState}_TIMEOUT] 策略${strategyId} 标的${symbol}: 超过15分钟，强制重置为IDLE，释放资金${allocationAmount}`);
          summary.errors.push(`${symbol}(${currentState}_TIMEOUT)`);
          return;
        }
        // 正常处理平仓中状态
        summary.other.push(`${symbol}(${currentState})`);
        if (currentState === 'CLOSING') {
          await this.processClosingPosition(strategyInstance, strategyId, symbol);
        } else {
          await this.processCoveringPosition(strategyInstance, strategyId, symbol);
        }
        return;
      } else if (currentState === 'OPENING' || currentState === 'SHORTING' || currentState === 'COOLDOWN') {
        // P0-2: OPENING/SHORTING 超时强制重置（15分钟）
        if (currentState === 'OPENING' || currentState === 'SHORTING') {
          const staleResult = await pool.query(
            `SELECT context FROM strategy_instances
             WHERE strategy_id = $1 AND symbol = $2 AND current_state = $3
               AND last_updated < NOW() - INTERVAL '15 minutes'`,
            [strategyId, symbol, currentState]
          );
          if (staleResult.rows.length > 0) {
            const staleCtx = staleResult.rows[0].context || {};
            const allocationAmount = parseFloat(staleCtx.allocationAmount || '0');
            if (allocationAmount > 0) {
              try {
                await capitalManager.releaseAllocation(strategyId, allocationAmount, symbol);
              } catch (releaseErr: any) {
                logger.error(`[${currentState}_TIMEOUT] 资金释放失败: ${releaseErr.message}`);
              }
            }
            await strategyInstance.updateState(symbol, 'IDLE');
            logger.warn(`[${currentState}_TIMEOUT] 策略${strategyId} 标的${symbol}: 超过15分钟，强制重置，释放资金${allocationAmount}`);
            summary.errors.push(`${symbol}(${currentState}_TIMEOUT)`);
            return;
          }
        }
        summary.other.push(`${symbol}(${currentState})`);
        return;
      } else if (currentState !== 'IDLE') {
        summary.other.push(`${symbol}(${currentState})`);
        return;
      }

      // IDLE 状态：处理买入逻辑
      // V4: 恢复 TSLP 失败计数（进程重启后首次进入）
      await this.restoreTslpFailureCount(strategyId);

      // 期权策略：收盘前N分钟不再开新仓（默认180分钟，可配置）
      if (isOptionStrategy) {
        const noNewEntryMins = Math.max(0, parseInt(String(strategyConfig?.tradeWindow?.noNewEntryBeforeCloseMinutes ?? 180), 10) || 180);
        const window = await getMarketCloseWindow({
          market: 'US',
          noNewEntryBeforeCloseMinutes: noNewEntryMins,
          forceCloseBeforeCloseMinutes: 30,
        });
        if (window) {
          const now = new Date();
          if (now >= window.noNewEntryTimeUtc) {
            summary.idle.push(`${symbol}(NO_NEW_ENTRY_WINDOW)`);
            return;
          }
        }
      }

      // 取消退避：最近被取消的标的暂不重试
      if (isOptionStrategy) {
        const instState = await stateManager.getInstanceState(strategyId, symbol);
        const cancelCtx = instState?.context;
        if (cancelCtx?.lastCancelTime) {
          const elapsed = Date.now() - new Date(cancelCtx.lastCancelTime).getTime();
          const cancelCount = cancelCtx.cancelCount || 1;
          const backoffMs = Math.min(30, 5 * Math.pow(2, cancelCount - 1)) * 60000;
          // cancelCount=1 → 5min, =2 → 10min, =3 → 20min, ≥4 → 30min(上限)
          if (elapsed < backoffMs) {
            summary.idle.push(`${symbol}(CANCEL_BACKOFF)`);
            return;
          }
        }

        // Fix 12a + V9: 新交易日检测 — 重置日内 PnL / 连亏计数 / 熔断状态
        // V9: 扩展重置条件 — lastExitTime 或 circuitBreakerTime 任一为前日即重置
        const resetReferenceTime = cancelCtx?.lastExitTime || cancelCtx?.circuitBreakerTime;
        if (resetReferenceTime) {
          const etFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric', month: '2-digit', day: '2-digit',
          });
          const refETDate = etFormatter.format(new Date(resetReferenceTime));
          const nowETDate = etFormatter.format(new Date());
          if (refETDate !== nowETDate) {
            await strategyInstance.updateState(symbol, 'IDLE', {
              dailyTradeCount: 0,
              dailyRealizedPnL: 0,
              consecutiveLosses: 0,
              lastTradeDirection: null,
              lastTradePnL: 0,
              circuitBreakerActive: false,
              circuitBreakerReason: null,
              circuitBreakerTime: null,
              tslpFailureCount: 0,  // V4: 新交易日重置 TSLP 失败计数
            });
            // V4: 同步重置内存计数
            this.tslpFailureCount.set(strategyId, 0);
            // 重新读取 context（已重置）
            const freshState = await stateManager.getInstanceState(strategyId, symbol);
            Object.assign(cancelCtx || {}, freshState?.context || {});
          }
        }

        // Fix 12b: 日内熔断检查 — 已熔断则直接跳过
        if (cancelCtx?.circuitBreakerActive) {
          summary.idle.push(`${symbol}(CIRCUIT_BREAKER:${cancelCtx.circuitBreakerReason || 'active'})`);
          return;
        }

        // Fix 11+12: LATE时段冷却期 — 优先感知连续亏损，否则沿用交易次数逻辑
        const dailyTradeCount = cancelCtx?.dailyTradeCount ?? 0;
        const consecLosses = cancelCtx?.consecutiveLosses ?? 0;
        const is0DTEContext = cancelCtx?.optionMeta?.expirationMode === '0DTE'
          || cancelCtx?.is0DTE === true;

        let cooldownMinutes: number;
        if (is0DTEContext) {
          if (consecLosses >= 3) {
            cooldownMinutes = 15;  // 3笔连亏：长冷却，等待趋势明确
          } else if (consecLosses === 2) {
            cooldownMinutes = 5;   // 2笔连亏：中等冷却
          } else if (consecLosses === 1) {
            cooldownMinutes = 3;   // 1笔亏损：短冷却
          } else {
            // 无连续亏损：沿用原有基于交易次数的逻辑
            if (dailyTradeCount <= 1) {
              cooldownMinutes = 0;
            } else if (dailyTradeCount <= 3) {
              cooldownMinutes = 1;
            } else {
              cooldownMinutes = 3;
            }
          }
        } else {
          cooldownMinutes = strategyConfig?.latePeriod?.cooldownMinutes ?? 3;
        }

        if (cancelCtx?.lastExitTime && cooldownMinutes > 0) {
          const exitElapsed = Date.now() - new Date(cancelCtx.lastExitTime).getTime();
          if (exitElapsed < cooldownMinutes * 60000) {
            const remainMin = Math.ceil((cooldownMinutes * 60000 - exitElapsed) / 60000);
            summary.idle.push(`${symbol}(COOLDOWN_${remainMin}m_trade#${dailyTradeCount}${consecLosses > 0 ? `_consLoss${consecLosses}` : ''})`);
            return;
          }
        }
      }

      // 检查是否已有持仓（避免重复买入）
      const hasPosition = isOptionStrategy
        ? await this.checkExistingOptionPositionForUnderlying(strategyId, symbol)
        : await this.checkExistingPosition(strategyId, symbol);
      if (hasPosition) {
        await this.syncPositionState(strategyInstance, strategyId, symbol);
        summary.actions.push(`${symbol}(SYNC_HOLDING)`);
        return;
      }

      // 检查是否有未成交的订单
      const hasPendingOrder = isOptionStrategy
        ? await this.checkPendingOptionOrderForUnderlying(strategyId, symbol)
        : await this.checkPendingOrder(strategyId, symbol);
      if (hasPendingOrder) {
        summary.idle.push(symbol); // 有未成交订单，视为 IDLE/PENDING，不在此处 log
        return;
      }

      // 生成信号（marketData 参数可选，策略内部会自行获取）
      const intent = await strategyInstance.generateSignal(symbol, undefined);

      if (!intent) {
        summary.idle.push(symbol); // 未生成信号，视为 IDLE
        return;
      }

      if (intent.action === 'HOLD') {
        summary.idle.push(symbol); // HOLD 信号，视为 IDLE
        return;
      }

      // 260225 Iron Dome Layer 3: TSLPPCT 连续失败 → 禁止开仓
      if (intent.action === 'BUY' && isOptionStrategy && this.isTslpBlocked(strategyId)) {
        logger.warn(
          `[IRON_DOME:TSLP_BLOCKED] 策略 ${strategyId} 标的 ${symbol}: ` +
          `TSLPPCT 连续失败 ${this.tslpFailureCount.get(strategyId)} 次，禁止新开仓。` +
          `没有保护单还想开仓？你是觉得亏得不够快吗？`
        );
        summary.idle.push(`${symbol}(TSLP_BLOCKED)`);
        return;
      }

      // Fix 12c: 信号方向抑制 — 连续同方向亏损后抑制同方向新信号
      if (intent.action === 'BUY' && isOptionStrategy) {
        const suppressState = await stateManager.getInstanceState(strategyId, symbol);
        const suppressCtx = suppressState?.context;
        const suppressConsecLosses = suppressCtx?.consecutiveLosses ?? 0;
        const suppressLastDir = suppressCtx?.lastTradeDirection;
        const intentDirection = (intent.metadata as any)?.optionDirection;

        if (suppressConsecLosses >= 2 && suppressLastDir && intentDirection && suppressLastDir === intentDirection) {
          logger.warn(
            `[SIGNAL_SUPPRESSED] 策略 ${strategyId} 标的 ${symbol}: ` +
            `信号方向 ${intentDirection} 与最近 ${suppressConsecLosses} 笔连亏方向一致，抑制信号`
          );
          summary.idle.push(`${symbol}(SIGNAL_SUPPRESSED_${intentDirection})`);
          return;
        }
      }

      // 记录信号日志（关键业务事件）
      logger.info(`策略 ${strategyId} 标的 ${symbol}: 生成信号 ${intent.action}, 价格=${intent.entryPrice?.toFixed(2) || 'N/A'}, 原因=${intent.reason?.substring(0, 50) || 'N/A'}`);
      summary.signals.push(symbol);

      // ⚠️ 修复：IDLE状态下支持SELL信号（做空操作）
      if (intent.action === 'SELL' && currentState === 'IDLE') {
        // IDLE状态 + SELL信号 = 做空（开仓）
        
        // 确保数量为负数（卖空订单）
        if (intent.quantity && intent.quantity > 0) {
          intent.quantity = -intent.quantity;  // 转换为负数
        } else if (!intent.quantity && intent.entryPrice) {
          // 如果没有指定数量，根据可用保证金计算
          try {
            const marginInfo = await shortValidationService.calculateShortMargin(
              symbol,
              -10,  // Temporary quantity for calculation
              intent.entryPrice
            );
            
            // Calculate max quantity based on available margin
            // Required margin per share = price * margin ratio (50%) + safety buffer (10%)
            const marginPerShare = intent.entryPrice * INITIAL_MARGIN_RATIO * (1 + MARGIN_SAFETY_BUFFER);
            const maxQuantity = Math.floor(marginInfo.availableMargin / marginPerShare);
            const estimatedQuantity = Math.max(1, Math.min(maxQuantity, DEFAULT_SHORT_QUANTITY_LIMIT));
            intent.quantity = -estimatedQuantity;  // 负数表示卖空
            
            logger.log(`[策略执行] 策略 ${strategyId} 标的 ${symbol}: 根据保证金计算做空数量=${estimatedQuantity}, 可用保证金=${marginInfo.availableMargin.toFixed(2)}`);
          } catch (error: any) {
            logger.warn(`[策略执行] 策略 ${strategyId} 标的 ${symbol}: 保证金计算失败，使用默认数量: ${error.message}`);
            const estimatedQuantity = 10;  // 临时默认值
            intent.quantity = -estimatedQuantity;
          }
        }
        
        // 验证数量（允许负数）
        if (!intent.quantity || intent.quantity === 0) {
          logger.warn(`[策略执行] 策略 ${strategyId} 标的 ${symbol}: 做空数量无效`);
          summary.errors.push(`${symbol}(INVALID_SHORT_QUANTITY)`);
          return;
        }

        // ⚠️ 完善错误处理：综合验证卖空操作
        const shortValidation = await shortValidationService.validateShortOperation(
          symbol,
          intent.quantity,
          intent.entryPrice || 0,
          strategyId
        );

        if (!shortValidation.valid) {
          logger.warn(`[策略执行] 策略 ${strategyId} 标的 ${symbol}: 卖空验证失败 - ${shortValidation.error}`);
          summary.errors.push(`${symbol}(SHORT_VALIDATION_FAILED:${shortValidation.error})`);
          
          // Log validation failure (with error handling)
          try {
            await pool.query(
              `INSERT INTO validation_failure_logs (
                strategy_id,
                symbol,
                failure_type,
                reason,
                timestamp
              ) VALUES ($1, $2, $3, $4, NOW())`,
              [
                strategyId,
                symbol,
                'SHORT_VALIDATION_FAILED',
                shortValidation.error || 'Unknown validation failure',
              ]
            );
          } catch (dbError: unknown) {
            logger.error(`[策略执行] 记录验证失败日志失败:`, dbError);
            // 不阻塞主流程，只记录错误
          }
          return;
        }

        if (shortValidation.warning) {
          logger.warn(`[策略执行] 策略 ${strategyId} 标的 ${symbol}: 卖空警告 - ${shortValidation.warning}`);
        }

        logger.log(`[策略执行] 策略 ${strategyId} 标的 ${symbol}: IDLE状态下执行做空操作，数量=${intent.quantity}, 价格=${intent.entryPrice?.toFixed(2)}`);
        
        // 执行做空操作（使用executeSellIntent，但数量为负数）
        // 注意：executeSellIntent需要支持负数数量
        const shortIntent: TradingIntent = {
          ...intent,
          quantity: intent.quantity,  // 负数
          entryPrice: intent.entryPrice,  // 做空价格
        };
        
        const executionResult = await basicExecutionService.executeSellIntent(shortIntent, strategyId);
        
        if (executionResult.submitted && executionResult.orderId) {
          // 更新状态为 SHORTING（卖空中）
          await strategyInstance.updateState(symbol, 'SHORTING', {
            intent: shortIntent,
            orderId: executionResult.orderId,
          });
          this.markOrderSubmitted(strategyId, symbol, 'SELL', executionResult.orderId);
          summary.actions.push(`${symbol}(SHORT_SUBMITTED)`);
        }
        
        if (executionResult.success) {
          // 卖空订单成交后，状态更新为 SHORT
          const shortContext = {
            entryPrice: executionResult.avgPrice || intent.entryPrice,
            quantity: intent.quantity,  // 负数
            entryTime: new Date().toISOString(),
            originalStopLoss: intent.stopLoss,
            originalTakeProfit: intent.takeProfit,
            currentStopLoss: intent.stopLoss,
            currentTakeProfit: intent.takeProfit,
            orderId: executionResult.orderId,
          };
          
          await strategyInstance.updateState(symbol, 'SHORT', shortContext);
          summary.actions.push(`${symbol}(SHORT_FILLED)`);
        } else {
          summary.errors.push(`${symbol}(SHORT_FAILED:${executionResult.error})`);
        }
        
        return;
      }

      // 验证策略执行是否安全（防止高买低卖、重复下单等）
      const validation = await this.validateStrategyExecution(strategyId, symbol, intent);
      if (!validation.valid) {
        logger.warn(
          `[策略执行验证] 策略 ${strategyId} 标的 ${symbol} 执行被阻止: ${validation.reason}`
        );
        summary.errors.push(`${symbol}(VALIDATION_FAILED)`);
        return;
      }

      // 如果是买入信号，执行交易
      if (intent.action === 'BUY') {
        const availableCapital = await capitalManager.getAvailableCapital(strategyId);
        
        if (availableCapital <= 0) {
          logger.info(`策略 ${strategyId} 标的 ${symbol}: 可用资金不足 (${availableCapital.toFixed(2)})，跳过买入`);
          summary.errors.push(`${symbol}(NO_CAPITAL)`);
          return;
        }

        // 计算数量
        if (!intent.quantity && intent.entryPrice) {
          const maxPositionPerSymbol = await capitalManager.getMaxPositionPerSymbol(strategyId);
          const maxAmountForThisSymbol = Math.min(availableCapital, maxPositionPerSymbol);
          const maxAffordableQuantity = Math.floor(maxAmountForThisSymbol / intent.entryPrice);
          intent.quantity = Math.max(1, maxAffordableQuantity);
        }

        // ⚠️ 修复：数量验证允许负数（卖空订单数量为负数）
        // 对于买入操作，数量必须为正数
        if (!intent.quantity || intent.quantity === 0) {
          summary.errors.push(`${symbol}(INVALID_QUANTITY)`);
          return;
        }
        
        // 买入操作的数量必须是正数
        if (intent.quantity < 0) {
          logger.warn(`[策略执行] 策略 ${strategyId} 标的 ${symbol}: 买入操作数量不能为负数 (${intent.quantity})`);
          summary.errors.push(`${symbol}(INVALID_QUANTITY_NEGATIVE)`);
          return;
        }

        logger.info(`策略 ${strategyId} 标的 ${symbol}: 准备买入，数量=${intent.quantity}, 价格=${intent.entryPrice?.toFixed(2)}`);

        // 申请资金（期权：使用 premium*multiplier*contracts + fees 的覆盖值）
        const allocationAmountOverride = (intent.metadata as any)?.allocationAmountOverride;
        const requestedAmount = typeof allocationAmountOverride === 'number' && allocationAmountOverride > 0
          ? allocationAmountOverride
          : intent.quantity * (intent.entryPrice || 0);
        allocationResult = await capitalManager.requestAllocation({
          strategyId,
          amount: requestedAmount,
          symbol,
        });

        if (!allocationResult.approved) {
          logger.info(`策略 ${strategyId} 标的 ${symbol}: 资金申请被拒绝 - ${allocationResult.reason || '未知原因'}`);
          summary.errors.push(`${symbol}(CAPITAL_REJECTED)`);
          return;
        }

        // 更新状态为 OPENING
        await strategyInstance.updateState(symbol, 'OPENING', {
          intent,
          allocationAmount: allocationResult.allocatedAmount,
        });

        // 执行买入
        const executionResult = await basicExecutionService.executeBuyIntent(intent, strategyId);

        if (executionResult.submitted && executionResult.orderId) {
          this.markOrderSubmitted(strategyId, symbol, 'BUY', executionResult.orderId);
          summary.actions.push(`${symbol}(BUY_SUBMITTED)`);
        }

        if (executionResult.success) {
          // 获取当前市场环境（用于保存到上下文）
          const marketEnv = await dynamicPositionManager.getCurrentMarketEnvironment(symbol);
          
          let originalATR: number | undefined;
          try {
            const recommendation = await tradingRecommendationService.calculateRecommendation(symbol);
            originalATR = recommendation.atr;
          } catch (error: any) {
            // 忽略
          }

          const holdingContext = {
            entryPrice: executionResult.avgPrice,
            quantity: executionResult.filledQuantity,
            entryTime: new Date().toISOString(),
            originalStopLoss: intent.stopLoss,
            originalTakeProfit: intent.takeProfit,
            currentStopLoss: intent.stopLoss,
            currentTakeProfit: intent.takeProfit,
            entryMarketEnv: marketEnv.marketEnv,
            entryMarketStrength: marketEnv.marketStrength,
            previousMarketEnv: marketEnv.marketEnv,
            previousMarketStrength: marketEnv.marketStrength,
            originalATR: originalATR,
            currentATR: originalATR,
            adjustmentHistory: [],
            orderId: executionResult.orderId,
            allocationAmount: allocationResult.allocatedAmount,
            // 期权策略：记录实际交易的期权symbol与必要字段（用于持仓监控/强平）
            tradedSymbol: isOptionStrategy ? intent.symbol : undefined,
            optionMeta: isOptionStrategy ? (intent.metadata || {}) : undefined,
          };
          
          await strategyInstance.updateState(symbol, 'HOLDING', holdingContext);
          logger.log(`策略 ${strategyId} 标的 ${symbol} 买入成功，订单ID: ${executionResult.orderId}`);

          summary.actions.push(`${symbol}(BUY_FILLED)`);
        } else if (executionResult.submitted && executionResult.orderId) {
          // 订单已提交但未成交，保持 OPENING
          logger.log(`策略 ${strategyId} 标的 ${symbol} 订单已提交，等待成交`);
        } else {
          // 失败
          await capitalManager.releaseAllocation(
            strategyId,
            allocationResult.allocatedAmount,
            symbol
          );
          await strategyInstance.updateState(symbol, 'IDLE');
          logger.error(`策略 ${strategyId} 标的 ${symbol} 买入失败: ${executionResult.error}`);
          summary.errors.push(`${symbol}(BUY_FAILED)`);
        }
      }
    } catch (error: any) {
      // 增强错误日志：显示完整的错误信息和堆栈
      const errorMessage = error?.message || String(error);
      const errorStack = error?.stack || '';
      logger.error(`策略 ${strategyId} 处理标的 ${symbol} 出错: ${errorMessage}`);
      if (errorStack) {
        logger.error(`错误堆栈: ${errorStack}`);
      }
      summary.errors.push(`${symbol}(EXCEPTION:${errorMessage.substring(0, 50)})`);

      // P0-1: 异常后释放已分配资金
      if (allocationResult?.approved) {
        try {
          await capitalManager.releaseAllocation(strategyId, allocationResult.allocatedAmount, symbol);
          await strategyInstance.updateState(symbol, 'IDLE');
          logger.warn(`[CAPITAL_SAFETY] 策略${strategyId} 标的${symbol}: 异常后释放资金 ${allocationResult.allocatedAmount}`);
        } catch (releaseErr: any) {
          logger.error(`[CRITICAL] 资金释放失败! 策略${strategyId} 标的${symbol} 金额${allocationResult.allocatedAmount}: ${releaseErr.message}`);
        }
      }
    }
  }

  // ... (getCachedPositions, checkExistingPosition 等辅助方法保持不变)
  /**
   * 获取持仓缓存（批量查询，避免频率限制）
   */
  private async getCachedPositions(): Promise<any[]> {
    const cacheKey = 'all_positions';
    const cached = this.positionCache.get(cacheKey);
    const now = Date.now();

    // 如果缓存有效，直接返回
    if (cached && (now - cached.timestamp) < this.POSITION_CACHE_TTL) {
      return cached.positions;
    }

    // 缓存过期或不存在，重新查询
    try {
      const { getTradeContext } = await import('../config/longport');
      const tradeCtx = await getTradeContext();
      const positions = await tradeCtx.stockPositions();
      
      let allPositions: any[] = [];
      
      if (positions && typeof positions === 'object') {
        if (positions.channels && Array.isArray(positions.channels)) {
          for (const channel of positions.channels) {
            if (channel.positions && Array.isArray(channel.positions)) {
              allPositions.push(...channel.positions);
            }
          }
        }
      }

      // 更新缓存
      this.positionCache.set(cacheKey, {
        positions: allPositions,
        timestamp: now,
      });

      return allPositions;
    } catch (sdkError: any) {
      // 如果查询失败，尝试使用缓存（即使过期）
      if (cached) {
      return cached.positions;
      }
      return [];
    }
  }

  /**
   * 检查是否已有持仓
   */
  private async checkExistingPosition(strategyId: number, symbol: string): Promise<boolean> {
    try {
      // 检查策略实例状态
      const instanceResult = await pool.query(
        `SELECT current_state FROM strategy_instances 
         WHERE strategy_id = $1 AND symbol = $2 AND current_state = 'HOLDING'`,
        [strategyId, symbol]
      );

      if (instanceResult.rows.length > 0) {
        return true;
      }

      // ⚠️ 修复：检查实际持仓（支持负数持仓）
      const allPositions = await this.getCachedPositions();
      
      for (const pos of allPositions) {
        if (pos.symbol === symbol) {
          const quantity = parseInt(pos.quantity?.toString() || '0');
          if (quantity !== 0) {
            // 有持仓（正数=做多，负数=卖空）
            return true;
          }
        }
      }

      return false;
    } catch (error: any) {
      logger.error(`检查持仓失败 (${symbol}):`, error);
      return false; // 出错时返回false，允许继续执行
    }
  }

  /**
   * 期权策略：检查“某个underlying”是否已有期权持仓（用前缀+期权代码规则匹配）。
   * 目的：避免用underlying作为key时，漏检真实的期权symbol持仓。
   */
  private async checkExistingOptionPositionForUnderlying(strategyId: number, underlyingSymbol: string): Promise<boolean> {
    try {
      // 1) 若实例已是HOLDING，直接认为有持仓（上下文里会包含 tradedSymbol）
      const instanceResult = await pool.query(
        `SELECT current_state FROM strategy_instances 
         WHERE strategy_id = $1 AND symbol = $2 AND current_state = 'HOLDING'`,
        [strategyId, underlyingSymbol]
      );
      if (instanceResult.rows.length > 0) return true;

      // 2) 检查真实持仓：寻找符合期权格式且前缀匹配的symbol
      const allPositions = await this.getCachedPositions();
      const prefixes = getOptionPrefixesForUnderlying(underlyingSymbol).map((p) => p.toUpperCase());

      for (const pos of allPositions) {
        const posSymbol = String(pos.symbol || pos.stock_name || '').toUpperCase();
        const qty = parseInt(pos.quantity?.toString() || '0');
        if (qty === 0) continue;
        if (!posSymbol.endsWith('.US')) continue;
        if (!isLikelyOptionSymbol(posSymbol)) continue;
        if (prefixes.some((p) => posSymbol.startsWith(p))) {
          return true;
        }
      }

      return false;
    } catch (error: any) {
      logger.error(`检查期权持仓失败 (${underlyingSymbol}):`, error);
      return false;
    }
  }

  /**
   * 期权策略：检查该策略下是否存在“属于某个underlying”的未成交买入订单。
   * 只检查本策略的 execution_orders，避免被其它策略/手动交易干扰。
   */
  private async checkPendingOptionOrderForUnderlying(strategyId: number, underlyingSymbol: string): Promise<boolean> {
    try {
      const prefixes = getOptionPrefixesForUnderlying(underlyingSymbol).map((p) => p.toUpperCase());

      const pending = await pool.query(
        `SELECT symbol, current_status
         FROM execution_orders
         WHERE strategy_id = $1
           AND side IN ('BUY', 'Buy', '1')
           AND current_status IN ('SUBMITTED', 'NEW', 'PARTIALLY_FILLED')
           AND created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY created_at DESC
         LIMIT 50`,
        [strategyId]
      );

      for (const row of pending.rows) {
        const sym = String(row.symbol || '').toUpperCase();
        if (!sym.endsWith('.US')) continue;
        if (!isLikelyOptionSymbol(sym)) continue;
        if (prefixes.some((p) => sym.startsWith(p))) return true;
      }

      return false;
    } catch (error: any) {
      logger.error(`检查期权未成交订单失败 (${underlyingSymbol}):`, error);
      return false;
    }
  }


  // normalizeOrderStatus: 已移至 utils/order-status.ts (统一版本)
  // 旧的私有方法存在错误的数字映射（5=WaitToNew 应为 5=FilledStatus 等），已删除

  /**
   * 检查是否有未成交的订单
   */
  private async checkPendingOrder(_strategyId: number, symbol: string): Promise<boolean> {
    try {
      const todayOrders = await todayOrdersCache.getTodayOrders();
      const pendingStatuses = [
        'NotReported',
        'NewStatus',
        'WaitToNew',
        'PartialFilledStatus',
        'PendingReplaceStatus',
        'WaitToReplace',
        'ReplacedNotReported',
        'ProtectedNotReported',
        'VarietiesNotReported',
      ];
      
      for (const order of todayOrders) {
        const orderSymbol = order.symbol || order.stock_name;
        const orderSide = order.side;
        const isBuy = orderSide === 'Buy' || orderSide === 1 || orderSide === 'BUY' || orderSide === 'buy';
        
        if (orderSymbol === symbol && isBuy) {
          const status = normalizeOrderStatus(order.status);
          if (pendingStatuses.includes(status)) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error: any) {
      logger.error(`检查未成交订单失败 (${symbol}):`, error);
      return false;
    }
  }

  /**
   * 记录卖出信号到数据库
   * 用于订单-信号关联追踪，确保 SELL 订单也有对应的信号记录
   * @returns signal_id 返回信号ID，用于关联订单
   */
  private async logSellSignal(
    strategyId: number,
    symbol: string,
    price: number,
    reason: string,
    metadata?: Record<string, any>
  ): Promise<number> {
    const result = await pool.query(
      `INSERT INTO strategy_signals
       (strategy_id, symbol, signal_type, price, reason, metadata, status)
       VALUES ($1, $2, 'SELL', $3, $4, $5, 'PENDING')
       RETURNING id`,
      [
        strategyId,
        symbol,
        price,
        reason,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
    return result.rows[0].id;
  }

  /**
   * 处理持仓状态：检查止盈/止损
   * 修改：返回处理结果，以便上层做日志聚合
   */
  private async processHoldingPosition(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<{ actionTaken: boolean }> {
    try {
      const isOptionStrategy = strategyInstance instanceof OptionIntradayStrategy;
      const strategyConfig: any = (strategyInstance as any)?.config || {};

      // 1. 获取策略实例上下文（包含入场价、止损、止盈）
      const instanceResult = await pool.query(
        `SELECT context FROM strategy_instances 
         WHERE strategy_id = $1 AND symbol = $2`,
        [strategyId, symbol]
      );

      if (instanceResult.rows.length === 0) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 持仓状态但无上下文，重置为IDLE`);
        await strategyInstance.updateState(symbol, 'IDLE');
        return { actionTaken: true };
      }

      let context: any = {};
      try {
        const contextData = instanceResult.rows[0].context;
        if (!contextData) {
          // ⚠️ 修复：持仓状态但 context 为空时，尝试从订单历史恢复（减少空context告警）
          logger.warn(`策略 ${strategyId} 标的 ${symbol}: 持仓状态但context为空，尝试从订单历史恢复`);
          try {
            const lastBuy = await pool.query(
              `SELECT order_id, price, quantity, created_at
               FROM execution_orders
               WHERE strategy_id = $1
                 AND symbol = $2
                 AND current_status = 'FILLED'
                 AND side IN ('BUY', 'Buy', '1')
               ORDER BY created_at DESC
               LIMIT 1`,
              [strategyId, symbol]
            );
            if (lastBuy.rows.length > 0) {
              const row = lastBuy.rows[0];
              const recovered = {
                entryPrice: parseFloat(row.price?.toString() || '0') || undefined,
                quantity: Math.abs(parseInt(row.quantity?.toString() || '0', 10) || 0) || undefined,
                entryTime: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
                orderId: row.order_id,
              };
              if (recovered.entryPrice && recovered.quantity) {
                await strategyInstance.updateState(symbol, 'HOLDING', recovered);
                context = recovered;
                logger.log(`策略 ${strategyId} 标的 ${symbol}: 已从订单历史恢复context (orderId=${row.order_id})`);
              } else {
                throw new Error('Recovered context missing entryPrice/quantity');
              }
            } else {
              // 无订单历史，重置状态，避免持续告警
              await strategyInstance.updateState(symbol, 'IDLE');
              logger.warn(`策略 ${strategyId} 标的 ${symbol}: 持仓状态但context为空，且无成交订单历史，已重置为IDLE`);
              return { actionTaken: true };
            }
          } catch (recoverError: any) {
            logger.warn(`策略 ${strategyId} 标的 ${symbol}: 恢复context失败，已重置为IDLE: ${recoverError?.message || recoverError}`);
            await strategyInstance.updateState(symbol, 'IDLE');
            return { actionTaken: true };
          }
        } else {
          context = typeof contextData === 'string' 
            ? JSON.parse(contextData)
            : contextData;
        }
      } catch (e) {
        logger.error(`策略 ${strategyId} 标的 ${symbol}: 解析上下文失败`, e);
        return { actionTaken: false };
      }

      const entryPrice = typeof context.entryPrice === 'number' ? context.entryPrice : parseFloat(String(context.entryPrice));
      let stopLoss = context.stopLoss ? (typeof context.stopLoss === 'number' ? context.stopLoss : parseFloat(String(context.stopLoss))) : undefined;
      let takeProfit = context.takeProfit ? (typeof context.takeProfit === 'number' ? context.takeProfit : parseFloat(String(context.takeProfit))) : undefined;
      const quantity = typeof context.quantity === 'number' ? context.quantity : parseInt(String(context.quantity), 10);
      const effectiveSymbol: string = context.tradedSymbol || symbol; // options are monitored/traded on the option symbol

      if (!entryPrice || isNaN(entryPrice) || !quantity || isNaN(quantity)) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 持仓状态但缺少入场价或数量 (entryPrice=${context.entryPrice}, quantity=${context.quantity})`);
        return { actionTaken: false };
      }

      // 调试日志：显示期权策略的 context 关键字段
      if (isOptionStrategy) {
        const optMeta = context.optionMeta || {};
        logger.debug(
          `策略 ${strategyId} 期权 ${effectiveSymbol}: context检查 | ` +
          `entryPrice=${entryPrice} quantity=${quantity} | ` +
          `optionMeta.optionId=${optMeta.optionId || 'N/A'} | ` +
          `optionMeta.underlyingStockId=${optMeta.underlyingStockId || 'N/A'}`
        );
      }

      // 2. 获取当前价格
      let currentPrice = 0;
      let priceSource = '';
      let optionMidPrice = 0; // bid/ask中间价，0DTE退出服务使用

      // 期权策略：使用统一的长桥期权行情服务（含缓存 + fallback）
      if (isOptionStrategy) {
        const optionMeta = context.optionMeta || {};
        const priceResult = await longportOptionQuoteService.getOptionPrice(effectiveSymbol, {
          optionId: optionMeta.optionId || optionMeta.option_id,
          underlyingStockId: optionMeta.underlyingStockId || optionMeta.underlying_stock_id,
          marketType: optionMeta.marketType || optionMeta.market_type || 2,
        });
        if (priceResult && priceResult.price > 0) {
          currentPrice = priceResult.price;
          priceSource = priceResult.source;
          // 捕获mid价格供0DTE退出使用
          if (priceResult.bid > 0 && priceResult.ask > 0) {
            optionMidPrice = (priceResult.bid + priceResult.ask) / 2;
          }
        }
      }

      // 非期权策略或期权服务未返回价格：LongPort实时行情API
      if (currentPrice <= 0 && !isOptionStrategy) {
        try {
          const { getQuoteContext } = await import('../config/longport');
          const quoteCtx = await getQuoteContext();
          const quotes = await quoteCtx.quote([effectiveSymbol]);
          if (quotes && quotes.length > 0) {
            const q = quotes[0];
            let price = parseFloat(q.lastDone?.toString() || q.last_done?.toString() || '0');
            let src = 'longport-lastDone';
            if (price <= 0) {
              const bid = parseFloat(q.bidPrice?.toString() || '0');
              const ask = parseFloat(q.askPrice?.toString() || '0');
              if (bid > 0 && ask > 0) {
                price = (bid + ask) / 2;
                src = 'longport-mid';
              } else if (ask > 0) {
                price = ask;
                src = 'longport-ask';
              } else if (bid > 0) {
                price = bid;
                src = 'longport-bid';
              }
            }
            if (price > 0) {
              currentPrice = price;
              priceSource = src;
            }
          }
        } catch (error: any) {
          logger.warn(`策略 ${strategyId} 标的 ${effectiveSymbol}: LongPort行情获取失败: ${error.message}`);
        }
      }

      // 额外备用层：持仓缓存数据
      if (currentPrice <= 0) {
        try {
          const allPositions = await this.getCachedPositions();
          const position = allPositions.find((pos: any) => {
            const posSymbol = pos.symbol || pos.stock_name;
            return posSymbol === effectiveSymbol;
          });
          if (position) {
            const price = parseFloat(position.lastPrice?.toString() || position.currentPrice?.toString() || '0');
            if (price > 0) {
              currentPrice = price;
              priceSource = 'position_cache';
            }
          }
        } catch (error: any) {
          logger.warn(`策略 ${strategyId} 标的 ${effectiveSymbol}: 持仓缓存获取失败: ${error.message}`);
        }
      }

      // 第四层：Fallback - 从期权symbol解析信息，通过期权链API获取价格
      if (currentPrice <= 0 && isOptionStrategy) {
        try {
          const { parseOptionSymbol } = await import('../utils/options-symbol');
          const { getOptionChain, getStockIdBySymbol, getOptionStrikeDates } = await import('./futunn-option-chain.service');

          const parsed = parseOptionSymbol(effectiveSymbol);
          if (parsed) {
            logger.log(
              `策略 ${strategyId} 期权 ${effectiveSymbol}: optionMeta缺失，尝试从symbol解析 | ` +
              `underlying=${parsed.underlying} expiry=${parsed.expirationDate} ` +
              `type=${parsed.optionType} strike=${parsed.strikePrice}`
            );

            // 获取标的股票ID
            const underlyingSymbol = `${parsed.underlying}.${parsed.market}`;
            const stockId = await getStockIdBySymbol(underlyingSymbol);

            if (stockId) {
              // 获取到期日列表，找到对应的 strikeDate（时间戳）
              const strikeDatesResult = await getOptionStrikeDates(stockId);
              if (strikeDatesResult && strikeDatesResult.strikeDates.length > 0) {
                // 找到匹配的到期日
                const targetDate = new Date(parsed.expirationDate);
                const matchingStrikeDate = strikeDatesResult.strikeDates.find((sd: any) => {
                  const sdDate = new Date(sd.strikeDate * 1000);
                  return (
                    sdDate.getFullYear() === targetDate.getFullYear() &&
                    sdDate.getMonth() === targetDate.getMonth() &&
                    sdDate.getDate() === targetDate.getDate()
                  );
                });

                if (matchingStrikeDate) {
                  // 获取期权链
                  const chain = await getOptionChain(stockId, matchingStrikeDate.strikeDate);

                  if (chain && chain.length > 0) {
                    // 在期权链中查找匹配的期权
                    const isCall = parsed.optionType === 'CALL';
                    let matchedOptionId: string | null = null;

                    for (const item of chain) {
                      const opt = isCall ? item.callOption : item.putOption;
                      if (opt) {
                        const strikePrice = parseFloat(opt.strikePrice) || 0;
                        if (Math.abs(strikePrice - parsed.strikePrice) < 0.01) {
                          matchedOptionId = opt.optionId;
                          break;
                        }
                      }
                    }

                    if (matchedOptionId) {
                      // 使用 getOptionDetail 获取价格
                      const marketType = parsed.market === 'US' ? 2 : 1;
                      const detail = await getOptionDetail(matchedOptionId, stockId, marketType);

                      if (detail) {
                        const bid = detail.priceBid || 0;
                        const ask = detail.priceAsk || 0;
                        const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : detail.price || 0;
                        currentPrice = mid || bid || detail.price || 0;
                        priceSource = 'futunn_chain_fallback';

                        // 缓存价格
                        if (currentPrice > 0) {
                          const optionPriceCacheService = (await import('./option-price-cache.service')).default;
                          optionPriceCacheService.set(effectiveSymbol, {
                            price: currentPrice,
                            bid,
                            ask,
                            mid,
                            timestamp: Date.now(),
                            underlyingPrice: detail.underlyingPrice || 0,
                            source: 'futunn',
                          });

                          // 补全 optionMeta（用于后续监控）
                          context.optionMeta = {
                            ...context.optionMeta,
                            optionId: matchedOptionId,
                            underlyingStockId: stockId,
                            marketType,
                            strikePrice: parsed.strikePrice,
                            optionType: parsed.optionType,
                            expirationDate: parsed.expirationDate,
                          };

                          // 更新数据库中的 context
                          await strategyInstance.updateState(symbol, 'HOLDING', context);

                          logger.log(
                            `策略 ${strategyId} 期权 ${effectiveSymbol}: fallback成功获取价格 $${currentPrice.toFixed(2)} | ` +
                            `已补全optionMeta (optionId=${matchedOptionId})`
                          );
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (error: any) {
          logger.warn(`策略 ${strategyId} 期权 ${effectiveSymbol}: fallback价格获取失败: ${error.message}`);
        }
      }

      if (currentPrice <= 0) {
        // 期权策略：当所有价格获取方式失败时，检查是否需要紧急平仓
        // 0DTE期权在收盘时会归零，必须在收盘前卖出
        if (isOptionStrategy && entryPrice > 0 && quantity > 0) {
          try {
            const closeWindow = await getMarketCloseWindow({
              market: 'US',
              noNewEntryBeforeCloseMinutes: 60,
              forceCloseBeforeCloseMinutes: 30,
            });
            const now = new Date();
            if (closeWindow && now >= closeWindow.forceCloseTimeUtc) {
              // 收盘前30分钟内，价格获取全部失败 → 紧急市价单平仓
              logger.error(
                `策略 ${strategyId} 期权 ${effectiveSymbol}: ⚠️ 收盘前紧急平仓 - 所有价格获取失败但临近收盘，使用市价单避免归零`
              );

              // 检查可用持仓
              const positionCheck = await this.checkAvailablePosition(strategyId, effectiveSymbol);
              const sellQty = positionCheck.availableQuantity !== undefined
                ? Math.min(quantity, positionCheck.availableQuantity)
                : quantity;
              if (sellQty > 0 && !positionCheck.hasPending) {
                await strategyInstance.updateState(symbol, 'CLOSING', {
                  ...context,
                  exitReason: 'EMERGENCY_CLOSE',
                  exitReasonDetail: '价格获取失败+临近收盘，紧急市价单平仓',
                });

                const emergencySellIntent = {
                  action: 'SELL' as const,
                  symbol: effectiveSymbol,
                  entryPrice: entryPrice,
                  sellPrice: entryPrice * 0.5, // 使用入场价一半作为参考价（市价单不依赖此值）
                  quantity: sellQty,
                  reason: '紧急平仓: 价格获取失败+临近收盘',
                  metadata: {
                    assetClass: 'OPTION',
                    exitAction: 'EMERGENCY_CLOSE',
                    forceClose: true,
                  },
                };

                const result = await basicExecutionService.executeSellIntent(emergencySellIntent, strategyId);
                if (result.success || result.submitted) {
                  return { actionTaken: true };
                }
                // 卖出失败，回滚状态
                await strategyInstance.updateState(symbol, 'HOLDING', context);
              }
            }
          } catch (emergencyError: any) {
            logger.error(`策略 ${strategyId} 期权 ${effectiveSymbol}: 紧急平仓检查失败: ${emergencyError.message}`);
          }
        }

        // 价格获取全部失败时，检查期权是否已过期 → 自动清理
        if (isOptionStrategy) {
          let isExpiredOption = false;
          try {
            const optMeta = context.optionMeta || context.intent?.metadata || {};
            const strikeDateVal = optMeta.strikeDate || context.strikeDate;
            if (strikeDateVal) {
              const sdStr = String(strikeDateVal);
              let dateStr = sdStr;
              if (sdStr.length !== 8) {
                const d = new Date(parseInt(sdStr, 10) * 1000);
                if (!isNaN(d.getTime())) {
                  dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
                }
              }
              const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
              isExpiredOption = dateStr < todayStr;
            }
            if (!isExpiredOption && effectiveSymbol) {
              const core = effectiveSymbol.replace(/\.(US|HK)$/i, '');
              const match = core.match(/[A-Z]+(\d{6})[CP]/);
              if (match) {
                const yymmdd = match[1];
                const yy = parseInt(yymmdd.substring(0, 2), 10);
                const mm = yymmdd.substring(2, 4);
                const dd = yymmdd.substring(4, 6);
                const fullYear = yy >= 50 ? 1900 + yy : 2000 + yy;
                const dateStr = `${fullYear}${mm}${dd}`;
                const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
                isExpiredOption = dateStr < todayStr;
              }
            }
          } catch { /* 解析失败不影响 */ }

          if (isExpiredOption) {
            // 已过期期权：核对券商持仓后自动清理
            const positionCheck = await this.checkAvailablePosition(strategyId, effectiveSymbol);
            if (!positionCheck.hasPending &&
                (positionCheck.availableQuantity === undefined || positionCheck.availableQuantity <= 0)) {
              logger.warn(
                `策略 ${strategyId} 期权 ${effectiveSymbol}: 已过期+价格获取失败+券商无持仓，自动转为IDLE`
              );
              await strategyInstance.updateState(symbol, 'IDLE', {
                ...context,
                autoClosedReason: 'option_expired_no_price',
                autoClosedAt: new Date().toISOString(),
                previousState: 'HOLDING',
              });
              return { actionTaken: true };
            }
            logger.warn(
              `策略 ${strategyId} 期权 ${effectiveSymbol}: 已过期+价格获取失败，但券商仍报告持仓(qty=${positionCheck.availableQuantity})，继续监控`
            );
          }
        }

        logger.warn(
          `策略 ${strategyId} 标的 ${effectiveSymbol}: 所有价格获取方式均失败，无法进行止盈止损检查 | ` +
          `context.optionMeta: ${JSON.stringify(context.optionMeta || {})} | ` +
          `isOptionStrategy: ${isOptionStrategy}`
        );
        return { actionTaken: false };
      }

      // P1-4: 检查紧急止损（TSLP保护单失败时的安全网）
      if (context.emergencyStopLoss && currentPrice > 0 && currentPrice <= context.emergencyStopLoss) {
        logger.error(
          `[TSLP_EMERGENCY] 策略${strategyId} ${effectiveSymbol}: 触发紧急止损! ` +
          `当前价=$${currentPrice.toFixed(2)} <= 紧急止损=$${context.emergencyStopLoss.toFixed(2)}`
        );
        // 触发紧急平仓
        const posCheck = await this.checkAvailablePosition(strategyId, effectiveSymbol);
        const sellQty = posCheck.availableQuantity !== undefined
          ? Math.min(quantity, posCheck.availableQuantity)
          : quantity;
        if (sellQty > 0 && !posCheck.hasPending) {
          await strategyInstance.updateState(symbol, 'CLOSING', {
            ...context,
            exitReason: 'EMERGENCY_STOP_LOSS',
            exitReasonDetail: `TSLP失败紧急止损触发: 价格${currentPrice.toFixed(2)} <= ${context.emergencyStopLoss.toFixed(2)}`,
          });
          const emergencySellIntent = {
            action: 'SELL' as const,
            symbol: effectiveSymbol,
            entryPrice: entryPrice,
            sellPrice: currentPrice,
            quantity: sellQty,
            reason: 'TSLP紧急止损',
            metadata: {
              assetClass: isOptionStrategy ? 'OPTION' : 'STOCK',
              exitAction: 'EMERGENCY_STOP_LOSS',
              forceClose: true,
            },
          };
          const sellResult = await basicExecutionService.executeSellIntent(emergencySellIntent, strategyId);
          if (sellResult.success || sellResult.submitted) {
            return { actionTaken: true };
          }
          // 卖出失败，回滚状态
          await strategyInstance.updateState(symbol, 'HOLDING', context);
        }
      }

      // ========== 期权策略：使用动态止盈止损服务 ==========
      if (isOptionStrategy) {
        return await this.processOptionDynamicExit(
          strategyInstance,
          strategyId,
          symbol,
          effectiveSymbol,
          context,
          currentPrice,
          entryPrice,
          quantity,
          strategyConfig,
          optionMidPrice
        );
      }

      // ========== 股票策略：使用原有止盈止损逻辑 ==========
      // 收盘前强制平仓检查（股票策略通常不需要）
      let forceCloseNow = false;

      // 3. 检查默认止盈/止损设置
      // 股票策略：使用原有比例（止盈10%，止损5%）
      let defaultStopLoss = stopLoss;
      let defaultTakeProfit = takeProfit;
      let needsUpdate = false;

      // 获取止盈止损比例（股票策略）
      const stopLossPercent = 0.05;   // 股票默认5%止损
      const takeProfitPercent = 0.10; // 股票默认10%止盈

      if (!defaultStopLoss && entryPrice > 0) {
        defaultStopLoss = entryPrice * (1 - stopLossPercent);
        needsUpdate = true;
      }
      if (!defaultTakeProfit && entryPrice > 0) {
        defaultTakeProfit = entryPrice * (1 + takeProfitPercent);
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        const updatedContext = {
          ...context,
          stopLoss: defaultStopLoss,
          takeProfit: defaultTakeProfit,
          originalStopLoss: context.originalStopLoss || defaultStopLoss,
          originalTakeProfit: context.originalTakeProfit || defaultTakeProfit,
          currentStopLoss: context.currentStopLoss || defaultStopLoss,
          currentTakeProfit: context.currentTakeProfit || defaultTakeProfit,
        };
        await strategyInstance.updateState(symbol, 'HOLDING', updatedContext);
        context = updatedContext;
        stopLoss = defaultStopLoss;
        takeProfit = defaultTakeProfit;
        logger.debug(`策略 ${strategyId} 标的 ${symbol}: 设置默认止盈止损`);
      }

      // 4. 获取完整的持仓上下文
      const positionContext = await dynamicPositionManager.getPositionContext(
        strategyId,
        symbol,
        context
      );

      // 5. 获取当前市场环境
      const marketEnv = await dynamicPositionManager.getCurrentMarketEnvironment(symbol);

      // 6. 检查固定止盈/止损
      const currentStopLoss = positionContext.currentStopLoss || stopLoss;
      const currentTakeProfit = positionContext.currentTakeProfit || takeProfit;

      let shouldSell = false;
      let exitReason = '';
      let exitPrice = currentPrice;
      let actionTaken = needsUpdate; // 如果更新了止盈止损，算作有动作

      if (forceCloseNow) {
        shouldSell = true;
        exitReason = 'FORCED_CLOSE_BEFORE_MARKET_CLOSE';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 收盘前强制平仓 (交易标的=${effectiveSymbol}, 当前价=${currentPrice.toFixed(2)})`);
      } else if (currentStopLoss && currentPrice <= currentStopLoss) {
        shouldSell = true;
        exitReason = 'STOP_LOSS';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 触发止损 (当前价=${currentPrice.toFixed(2)}, 止损价=${currentStopLoss.toFixed(2)})`);
      } else if (currentTakeProfit && currentPrice >= currentTakeProfit) {
        shouldSell = true;
        exitReason = 'TAKE_PROFIT';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 触发止盈 (当前价=${currentPrice.toFixed(2)}, 止盈价=${currentTakeProfit.toFixed(2)})`);
      } else {
        // 动态调整
        const adjustmentResult = await dynamicPositionManager.adjustStopLossTakeProfit(
          positionContext,
          currentPrice,
          marketEnv.marketEnv,
          marketEnv.marketStrength,
          symbol
        );

        if (adjustmentResult.shouldSell) {
          shouldSell = true;
          exitReason = adjustmentResult.exitReason || 'DYNAMIC_ADJUSTMENT';
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 动态调整建议卖出 - ${exitReason}`);
        }

        const stopLossChanged = adjustmentResult.context.currentStopLoss !== undefined &&
          adjustmentResult.context.currentStopLoss !== positionContext.currentStopLoss;
        const takeProfitChanged = adjustmentResult.context.currentTakeProfit !== undefined &&
          adjustmentResult.context.currentTakeProfit !== positionContext.currentTakeProfit;
        
        if (stopLossChanged || takeProfitChanged) {
          await strategyInstance.updateState(symbol, 'HOLDING', adjustmentResult.context);
          logger.debug(`策略 ${strategyId} 标的 ${symbol}: 动态调整止盈/止损`);
          actionTaken = true;
        }
      }

      // 7. 执行卖出
      if (shouldSell) {
        // ... (检查可用持仓逻辑不变)
        const positionCheck = await this.checkAvailablePosition(strategyId, effectiveSymbol);
        if (positionCheck.hasPending) return { actionTaken };
        
        if (positionCheck.availableQuantity !== undefined && quantity > positionCheck.availableQuantity) {
          logger.error(`策略 ${strategyId} 标的 ${symbol}: 卖出数量不足`);
          return { actionTaken };
        }

        const dbCheckResult = await pool.query(
          `SELECT eo.order_id FROM execution_orders eo WHERE strategy_id = $1 AND symbol = $2 AND side IN ('SELL', 'Sell', '2') AND current_status IN ('SUBMITTED', 'NEW', 'PARTIALLY_FILLED') AND eo.created_at >= NOW() - INTERVAL '1 hour'`,
          [strategyId, effectiveSymbol]
        );
        
        if (dbCheckResult.rows.length > 0) return { actionTaken };

        await strategyInstance.updateState(symbol, 'CLOSING', {
          ...context,
          exitReason,
          exitPrice,
        });

        // 获取最新价格并卖出
        let latestPrice = currentPrice;
        // ... (获取最新价格逻辑简化)

        // ✅ 先记录卖出信号，确保订单-信号关联
        const sellSignalId = await this.logSellSignal(
          strategyId,
          effectiveSymbol,
          latestPrice,
          `自动卖出: ${exitReason}`,
          { ...context.metadata, exitReason, forceClose: forceCloseNow }
        );

        const sellIntent = {
          action: 'SELL' as const,
          symbol: effectiveSymbol,
          entryPrice: context.entryPrice || latestPrice,
          sellPrice: latestPrice,
          quantity: quantity,
          reason: `自动卖出: ${exitReason}`,
          metadata: {
            ...context.metadata,
            forceClose: forceCloseNow, // 标记是否为强制平仓（期权盘中最后30分钟）
            exitReason,
            signalId: sellSignalId, // ✅ 传递信号ID，用于订单关联
          },
        };

        logger.log(`策略 ${strategyId} 标的 ${symbol}: 执行卖出 - 原因=${exitReason} (交易标的=${effectiveSymbol}, signalId=${sellSignalId})`);
        const executionResult = await basicExecutionService.executeSellIntent(sellIntent, strategyId);

        if (executionResult.submitted && executionResult.orderId) {
          this.markOrderSubmitted(strategyId, symbol, 'SELL', executionResult.orderId);
        }

        if (executionResult.success || executionResult.submitted) {
          actionTaken = true;
        } else {
          await strategyInstance.updateState(symbol, 'HOLDING', context);
          logger.error(`策略 ${strategyId} 标的 ${symbol} 卖出失败: ${executionResult.error}`);
        }
      }

      return { actionTaken };
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理持仓状态失败 (${symbol}):`, error);
      return { actionTaken: false };
    }
  }

  /**
   * 期权策略专用：动态止盈止损检查
   *
   * 基于时间衰减 + 波动率 + 价格位置的三维动态调整
   * - 时间维度：随着到期临近，收紧止盈、放宽止损容忍度
   * - 波动率：IV变化影响止盈止损比例
   * - 移动止损：盈利达到一定比例后，止损上移至保本
   * - 手续费：所有盈亏计算都包含手续费
   */
  private async processOptionDynamicExit(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string,
    effectiveSymbol: string,
    context: any,
    currentPrice: number,
    entryPrice: number,
    quantity: number,
    strategyConfig: any,
    optionMidPrice: number = 0
  ): Promise<{ actionTaken: boolean }> {
    try {
      // 0. TSLPPCT 保护单状态检查：如果券商保护单已触发成交，直接转 IDLE
      if (context.protectionOrderId) {
        try {
          const tslpStatus = await trailingStopProtectionService.checkProtectionStatus(context.protectionOrderId);
          if (tslpStatus === 'filled') {
            logger.log(
              `策略 ${strategyId} 期权 ${effectiveSymbol}: TSLPPCT保护单已触发成交(${context.protectionOrderId})，券商已平仓，更新状态为IDLE`
            );
            await strategyInstance.updateState(symbol, 'IDLE', {
              ...context,
              lastExitTime: new Date().toISOString(),
              exitReason: 'TSLPPCT_FILLED',
              exitReasonDetail: `TSLPPCT保护单${context.protectionOrderId}已触发`,
              protectionOrderId: undefined,
              protectionTrailingPct: undefined,
            });
            // 释放资金
            if (context.allocationAmount) {
              await capitalManager.releaseAllocation(strategyId, parseFloat(String(context.allocationAmount)), symbol);
            }
            return { actionTaken: true };
          }
          if (tslpStatus === 'cancelled' || tslpStatus === 'expired') {
            logger.debug(`策略 ${strategyId} 期权 ${effectiveSymbol}: TSLPPCT已${tslpStatus}，清除protectionOrderId`);
            await strategyInstance.updateState(symbol, 'HOLDING', {
              ...context,
              protectionOrderId: undefined,
              protectionTrailingPct: undefined,
            });
            // 更新 local context 以供后续逻辑使用
            context.protectionOrderId = undefined;
            context.protectionTrailingPct = undefined;
          }
        } catch (tslpCheckErr: any) {
          logger.debug(`策略 ${strategyId} 期权 ${effectiveSymbol}: TSLPPCT状态查询异常(${tslpCheckErr?.message})，继续软件监控`);
        }
      }

      // C1 修复：检查DB中的TSLP重试标记
      if (context.tslpRetryPending && context.tslpRetryAfter) {
        const retryAfter = new Date(context.tslpRetryAfter).getTime();
        if (Date.now() >= retryAfter) {
          try {
            const params = context.tslpRetryParams;
            if (params) {
              const retryResult = await trailingStopProtectionService.submitProtection(
                params.tradedSymbol, params.quantity, params.trailingPct,
                params.limitOffset, params.expireDate, strategyId,
              );
              if (retryResult.success && retryResult.orderId) {
                await strategyInstance.updateState(symbol, 'HOLDING', {
                  protectionOrderId: retryResult.orderId,
                  protectionTrailingPct: params.trailingPct,
                  emergencyStopLoss: undefined,
                  tslpRetryPending: undefined,
                  tslpRetryParams: undefined,
                  tslpRetryAfter: undefined,
                });
                logger.log(`[TSLP_RETRY] 策略${strategyId} ${params.tradedSymbol}: DB重试成功 orderId=${retryResult.orderId}`);
                await this.resetTslpFailure(strategyId);
              } else {
                // 重试失败，清除重试标记，保持紧急止损
                await strategyInstance.updateState(symbol, 'HOLDING', {
                  tslpRetryPending: undefined,
                  tslpRetryParams: undefined,
                  tslpRetryAfter: undefined,
                });
                logger.warn(`[TSLP_RETRY] 策略${strategyId} ${params.tradedSymbol}: DB重试仍失败(${retryResult.error})，保持紧急止损`);
              }
            }
          } catch (retryErr: any) {
            await strategyInstance.updateState(symbol, 'HOLDING', {
              tslpRetryPending: undefined,
              tslpRetryParams: undefined,
              tslpRetryAfter: undefined,
            });
            logger.warn(`[TSLP_RETRY] 策略${strategyId}: DB重试异常: ${retryErr.message}`);
          }
        }
      }

      const optionDynamicExitService = (await import('./option-dynamic-exit.service')).default;

      // 1. 从 context 获取期权元数据
      const optionMeta = context.optionMeta || context.intent?.metadata || {};
      const multiplier = Number(optionMeta.multiplier) || 100;
      const entryTime = context.entryTime ? new Date(context.entryTime) : new Date();

      // 2. 获取手续费信息
      // 入场手续费：从 context 中获取（如果有），否则估算
      let entryFees = parseFloat(String(optionMeta.estimatedFees || optionMeta.entryFees || 0));
      if (entryFees <= 0) {
        entryFees = optionDynamicExitService.calculateFees(quantity);
      }
      const estimatedExitFees = optionDynamicExitService.calculateFees(quantity);

      // 3. 确定策略类型（买方/卖方）
      // 简化：假设当前都是买方策略（做多期权）
      const strategySide = 'BUYER' as const;

      // 4. 获取当前IV（如果可用）- 优先使用 LongPort optionQuote
      let currentIV = 0;
      let currentDelta = 0;
      let timeValue = 0;
      const optionId = optionMeta.optionId || optionMeta.option_id;
      const underlyingStockId = optionMeta.underlyingStockId || optionMeta.underlying_stock_id;
      const marketType = optionMeta.marketType || optionMeta.market_type || 2;

      // 主源：LongPort optionQuote（含 IV）
      try {
        const optQuote = await longportOptionQuoteService.getOptionQuote(effectiveSymbol);
        if (optQuote && optQuote.iv > 0) {
          currentIV = optQuote.iv;
          logger.debug(`策略 ${strategyId} 期权 ${effectiveSymbol}: LongPort optionQuote IV=${currentIV.toFixed(2)}`);
        }
      } catch {
        // 忽略错误，降级到富途
      }

      // 备用：富途 getOptionDetail（含 IV + Delta + timeValue）
      if ((currentIV <= 0 || currentDelta === 0) && optionId && underlyingStockId) {
        try {
          const detail = await getOptionDetail(String(optionId), String(underlyingStockId), Number(marketType));
          if (detail && detail.option) {
            if (currentIV <= 0) {
              currentIV = detail.option.impliedVolatility || 0;
            }
            currentDelta = detail.option.greeks?.hpDelta || detail.option.greeks?.delta || 0;
            timeValue = detail.option.timeValue || 0;
          }
        } catch {
          // 忽略错误，使用默认值
        }
      }

      // 5. 判断是否为 0DTE（末日期权）
      // strikeDate 格式兼容：
      // - 新数据: YYYYMMDD numeric (20260204, length=8)
      // - 旧数据: Unix 时间戳秒 (1738627200, length=10)
      let is0DTE = false;
      try {
        // 方法1: 从 optionMeta.strikeDate 判断
        const strikeDateVal = optionMeta.strikeDate || context.strikeDate;
        if (strikeDateVal) {
          const sdStr = String(strikeDateVal);
          // 转为 YYYYMMDD 格式
          let dateStr = sdStr;
          if (sdStr.length !== 8) {
            // 可能是时间戳（秒级），转为 YYYYMMDD
            const d = new Date(parseInt(sdStr, 10) * 1000);
            if (!isNaN(d.getTime())) {
              dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
            }
          }
          const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
          is0DTE = dateStr === todayStr;
        }
        // 方法2: 从 effectiveSymbol 解析到期日 (如 AAPL260210C100000.US)
        if (!is0DTE && effectiveSymbol) {
          const core = effectiveSymbol.replace(/\.(US|HK)$/i, '');
          const match = core.match(/[A-Z]+(\d{6})[CP]/);
          if (match) {
            const yymmdd = match[1]; // e.g. "260210"
            const yy = parseInt(yymmdd.substring(0, 2), 10);
            const mm = yymmdd.substring(2, 4);
            const dd = yymmdd.substring(4, 6);
            const fullYear = yy >= 50 ? 1900 + yy : 2000 + yy;
            const dateStr = `${fullYear}${mm}${dd}`;
            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
            is0DTE = dateStr === todayStr;
          }
        }
      } catch {
        // 解析失败，默认非 0DTE
      }

      // 5.5 检测期权是否已过期（到期日 < 今天），过期则直接核对券商持仓并清理
      let isExpired = false;
      try {
        const strikeDateVal = optionMeta.strikeDate || context.strikeDate;
        if (strikeDateVal) {
          const sdStr = String(strikeDateVal);
          let dateStr = sdStr;
          if (sdStr.length !== 8) {
            const d = new Date(parseInt(sdStr, 10) * 1000);
            if (!isNaN(d.getTime())) {
              dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
            }
          }
          const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
          isExpired = dateStr < todayStr;
        }
        if (!isExpired && effectiveSymbol) {
          const core = effectiveSymbol.replace(/\.(US|HK)$/i, '');
          const match = core.match(/[A-Z]+(\d{6})[CP]/);
          if (match) {
            const yymmdd = match[1];
            const yy = parseInt(yymmdd.substring(0, 2), 10);
            const mm = yymmdd.substring(2, 4);
            const dd = yymmdd.substring(4, 6);
            const fullYear = yy >= 50 ? 1900 + yy : 2000 + yy;
            const dateStr = `${fullYear}${mm}${dd}`;
            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
            isExpired = dateStr < todayStr;
          }
        }
      } catch { /* 解析失败不影响流程 */ }

      if (isExpired) {
        logger.warn(
          `策略 ${strategyId} 期权 ${effectiveSymbol}: 期权已过期，检查券商持仓并清理`
        );
        const positionCheck = await this.checkAvailablePosition(strategyId, effectiveSymbol);
        if (!positionCheck.hasPending &&
            (positionCheck.availableQuantity === undefined || positionCheck.availableQuantity <= 0)) {
          logger.warn(
            `策略 ${strategyId} 期权 ${effectiveSymbol}: 已过期且券商无持仓，自动转为IDLE`
          );
          await strategyInstance.updateState(symbol, 'IDLE', {
            ...context,
            autoClosedReason: 'option_expired',
            autoClosedAt: new Date().toISOString(),
            previousState: 'HOLDING',
          });
          return { actionTaken: true };
        }
        logger.warn(
          `策略 ${strategyId} 期权 ${effectiveSymbol}: 已过期但券商仍报告持仓(qty=${positionCheck.availableQuantity})，继续监控`
        );
      }

      // 6. 解析期权方向 & 标的，获取 VWAP 数据（Phase 2 结构确认/时间止损）
      let optionDirection: 'CALL' | 'PUT' | undefined;
      let resolvedUnderlyingSymbol: string | undefined;
      let entryUnderlyingPrice: number | undefined;
      let vwapData: { vwap: number; rangePct: number; recentKlines: { open: number; high: number; low: number; close: number; volume: number; timestamp: number }[] } | null = null;
      let timeStopMinutes: number | undefined;

      try {
        // 6a. 解析期权方向
        const metaOptionType = optionMeta.optionType || optionMeta.option_type;
        if (metaOptionType === 'CALL' || metaOptionType === 'PUT') {
          optionDirection = metaOptionType;
        } else if (effectiveSymbol) {
          // 从 symbol 解析：AAPL260210C100000.US → C = CALL
          const core = effectiveSymbol.replace(/\.(US|HK)$/i, '');
          const cpMatch = core.match(/[A-Z]+\d{6}([CP])/);
          if (cpMatch) {
            optionDirection = cpMatch[1] === 'C' ? 'CALL' : 'PUT';
          }
        }

        // 6b. 解析标的 symbol
        resolvedUnderlyingSymbol = context.underlyingSymbol || optionMeta.underlyingSymbol;
        if (!resolvedUnderlyingSymbol && effectiveSymbol) {
          const core = effectiveSymbol.replace(/\.(US|HK)$/i, '');
          const ulMatch = core.match(/^([A-Z]+)\d{6}[CP]/);
          const market = effectiveSymbol.endsWith('.HK') ? 'HK' : 'US';
          if (ulMatch) {
            resolvedUnderlyingSymbol = `${ulMatch[1]}.${market}`;
          }
        }

        // 6c. 入场时标的价格（从 optionMeta 或 context）
        entryUnderlyingPrice = parseFloat(String(optionMeta.underlyingPrice || context.entryUnderlyingPrice || 0)) || undefined;

        // 6d. 获取 VWAP 数据（仅在有标的 symbol 时）
        if (resolvedUnderlyingSymbol) {
          vwapData = await marketDataService.getIntradayVWAP(resolvedUnderlyingSymbol);
          // 时间止损已禁用（回测#87分析：13笔触发全部亏损，0%胜率，贡献72%总亏损）
          // 现有多重保障（0DTE兜底-25%、移动止损、止盈、收盘强平）已覆盖所有场景
          // 保留 vwapData 获取用于其他用途（rangePct 用于追踪止盈动态化），仅不计算 timeStopMinutes
        }
      } catch (vwapErr: unknown) {
        // VWAP 获取失败不影响核心止盈止损逻辑
        const errMsg = vwapErr instanceof Error ? vwapErr.message : String(vwapErr);
        logger.debug(`策略 ${strategyId} 期权 ${effectiveSymbol}: VWAP数据获取失败，跳过结构退出: ${errMsg}`);
      }

      // 7. 构建持仓上下文
      const marketCloseTime = optionDynamicExitService.getMarketCloseTime();
      const positionCtx = {
        entryPrice: Number(entryPrice) || 0,
        currentPrice: Number(currentPrice) || 0,
        quantity: Number(quantity) || 0,
        multiplier: Number(multiplier) || 100,
        entryTime,
        marketCloseTime,
        strategySide,
        entryIV: (() => {
          let iv = optionMeta.impliedVolatility || currentIV;
          // 兜底：旧数据可能是小数制 (0.35)，归一化为百分比制 (35.0)
          if (iv > 0 && iv < 5) iv = iv * 100;
          return iv;
        })(),
        currentIV,
        currentDelta,
        timeValue,
        entryFees,
        estimatedExitFees,
        is0DTE,
        midPrice: optionMidPrice > 0 ? optionMidPrice : undefined,
        // Phase 2: 结构确认 & 时间止损数据
        optionDirection,
        vwap: vwapData?.vwap,
        recentKlines: vwapData?.recentKlines,
        entryUnderlyingPrice,
        timeStopMinutes,
        rangePct: vwapData?.rangePct,
        peakPnLPercent: context.peakPnLPercent || 0,
      };

      // 7. 检查是否应该平仓（传入用户配置的止盈止损比例）
      const exitRulesOverride = strategyConfig?.exitRules ? {
        takeProfitPercent: parseFloat(String(strategyConfig.exitRules.takeProfitPercent || 0)) || undefined,
        stopLossPercent: parseFloat(String(strategyConfig.exitRules.stopLossPercent || 0)) || undefined,
      } : undefined;
      const exitCondition = optionDynamicExitService.checkExitCondition(positionCtx, undefined, exitRulesOverride);

      if (exitCondition) {
        // 触发平仓条件
        const { action, reason, pnl, exitTag } = exitCondition;

        logger.log(
          `策略 ${strategyId} 期权 ${effectiveSymbol}: 动态止盈止损触发 ` +
          `[${action}]${exitTag ? `[${exitTag}]` : ''} ${reason} | ${optionDynamicExitService.formatPnLInfo(pnl, positionCtx)}` +
          (is0DTE ? ` | midPrice=${optionMidPrice > 0 ? optionMidPrice.toFixed(4) : 'N/A'}` : '') +
          (vwapData ? ` | vwap=${vwapData.vwap.toFixed(2)} rangePct=${vwapData.rangePct.toFixed(2)}%` : '') +
          (timeStopMinutes ? ` | T=${timeStopMinutes}min` : '') +
          (optionDirection ? ` | dir=${optionDirection}` : '')
        );

        // 检查可用持仓
        const positionCheck = await this.checkAvailablePosition(strategyId, effectiveSymbol);
        if (positionCheck.hasPending) {
          return { actionTaken: false };
        }

        if (positionCheck.availableQuantity !== undefined && positionCheck.availableQuantity <= 0) {
          logger.warn(
            `策略 ${strategyId} 期权 ${effectiveSymbol}: 券商报告无持仓，自动转为IDLE`
          );
          await strategyInstance.updateState(symbol, 'IDLE', {
            ...context,
            autoClosedReason: 'broker_position_zero',
            autoClosedAt: new Date().toISOString(),
            previousState: 'HOLDING',
          });
          return { actionTaken: true };
        }

        // 使用实际可用持仓数量（DB记录可能与券商不一致，以券商为准）
        let sellQuantity = quantity;
        if (positionCheck.availableQuantity !== undefined && quantity > positionCheck.availableQuantity) {
          logger.warn(
            `策略 ${strategyId} 期权 ${effectiveSymbol}: DB数量(${quantity})>实际持仓(${positionCheck.availableQuantity})，以实际持仓为准`
          );
          sellQuantity = positionCheck.availableQuantity;
        }

        // 检查是否已有待处理的卖出订单
        const dbCheckResult = await pool.query(
          `SELECT eo.order_id FROM execution_orders eo
           WHERE strategy_id = $1 AND symbol = $2
           AND side IN ('SELL', 'Sell', '2')
           AND current_status IN ('SUBMITTED', 'NEW', 'PARTIALLY_FILLED')
           AND eo.created_at >= NOW() - INTERVAL '1 hour'`,
          [strategyId, effectiveSymbol]
        );

        if (dbCheckResult.rows.length > 0) {
          return { actionTaken: false };
        }

        // 竞态保护：再次确认实例仍是 HOLDING（trade-push 可能已将状态设为 IDLE）
        const preCloseState = await strategyInstance.getCurrentState(symbol);
        if (preCloseState !== 'HOLDING') {
          logger.log(`策略 ${strategyId} 期权 ${effectiveSymbol}: 平仓前检测到状态已变为 ${preCloseState}，跳过卖出`);
          return { actionTaken: true };
        }

        // === TSLPPCT 取消：软件退出前先取消券商保护单 ===
        if (context.protectionOrderId) {
          try {
            const cancelResult = await trailingStopProtectionService.cancelProtection(
              context.protectionOrderId,
              strategyId,
              effectiveSymbol,
            );
            if (cancelResult.alreadyFilled) {
              // 券商保护单已触发成交！跳过软件卖出，直接转 IDLE
              logger.log(
                `策略 ${strategyId} 期权 ${effectiveSymbol}: TSLPPCT已触发成交，跳过软件卖出`
              );
              await strategyInstance.updateState(symbol, 'IDLE', {
                ...context,
                lastExitTime: new Date().toISOString(),
                exitReason: 'TSLPPCT_FILLED',
                exitReasonDetail: `软件退出时发现TSLPPCT(${context.protectionOrderId})已成交`,
                protectionOrderId: undefined,
                protectionTrailingPct: undefined,
              });
              if (context.allocationAmount) {
                await capitalManager.releaseAllocation(strategyId, parseFloat(String(context.allocationAmount)), symbol);
              }
              return { actionTaken: true };
            }
            // 取消成功或失败都继续软件卖出（broker position check at checkAvailablePosition provides safety）
          } catch (cancelErr: any) {
            logger.warn(
              `策略 ${strategyId} 期权 ${effectiveSymbol}: TSLPPCT取消异常(${cancelErr?.message})，继续软件卖出`
            );
          }
        }

        // 更新状态为 CLOSING
        await strategyInstance.updateState(symbol, 'CLOSING', {
          ...context,
          exitReason: action,
          exitReasonDetail: reason,
          exitPrice: currentPrice,
          exitPnL: pnl.netPnL,
          exitPnLPercent: pnl.grossPnLPercent, // Fix 9: 使用 grossPnLPercent 避免 NaN
          totalFees: pnl.totalFees,
        });

        // 执行卖出
        // ⚠️ 期权止盈止损统一使用市价单（快进快出），避免限价单无法成交导致亏损扩大
        // ✅ 先记录卖出信号，确保订单-信号关联
        const sellSignalId = await this.logSellSignal(
          strategyId,
          effectiveSymbol,
          currentPrice,
          `[${action}] ${reason}`,
          {
            assetClass: 'OPTION',
            exitAction: action,
            netPnL: pnl.netPnL,
            netPnLPercent: pnl.grossPnLPercent, // Fix 9: 使用 grossPnLPercent 避免 NaN
            totalFees: pnl.totalFees,
          }
        );
        logger.log(`策略 ${strategyId} 期权 ${effectiveSymbol}: 执行卖出 - ${action} (signalId=${sellSignalId})`);

        const sellIntent = {
          action: 'SELL' as const,
          symbol: effectiveSymbol,
          entryPrice: entryPrice,
          sellPrice: currentPrice,
          quantity: sellQuantity,
          reason: `[${action}] ${reason}`,
          metadata: {
            assetClass: 'OPTION',
            exitAction: action,
            netPnL: pnl.netPnL,
            netPnLPercent: pnl.grossPnLPercent, // Fix 9: 使用 grossPnLPercent 避免 NaN
            totalFees: pnl.totalFees,
            // 设置 forceClose=true 使用市价单，确保快速成交
            forceClose: true,
            signalId: sellSignalId, // ✅ 传递信号ID，用于订单关联
          },
        };

        const executionResult = await basicExecutionService.executeSellIntent(sellIntent, strategyId);

        if (executionResult.success || executionResult.submitted) {
          return { actionTaken: true };
        } else {
          await strategyInstance.updateState(symbol, 'HOLDING', context);
          logger.error(`策略 ${strategyId} 期权 ${effectiveSymbol} 卖出失败: ${executionResult.error}`);
          return { actionTaken: false };
        }
      }

      // 7. 未触发平仓，定期核对券商持仓（每5分钟一次）
      const lastBrokerCheck = context.lastBrokerCheckTime
        ? new Date(context.lastBrokerCheckTime).getTime() : 0;
      const brokerCheckInterval = 5 * 60 * 1000; // 5分钟
      if (Date.now() - lastBrokerCheck > brokerCheckInterval) {
        const positionCheck = await this.checkAvailablePosition(strategyId, effectiveSymbol);
        if (!positionCheck.hasPending &&
            positionCheck.availableQuantity !== undefined &&
            positionCheck.availableQuantity <= 0) {
          logger.warn(
            `策略 ${strategyId} 期权 ${effectiveSymbol}: 定期核对发现券商无持仓，自动转为IDLE`
          );
          await strategyInstance.updateState(symbol, 'IDLE', {
            ...context,
            autoClosedReason: 'broker_position_zero_periodic',
            autoClosedAt: new Date().toISOString(),
            previousState: 'HOLDING',
          });
          return { actionTaken: true };
        }
        // 更新核对时间
        context.lastBrokerCheckTime = new Date().toISOString();
      }

      // 8. 更新追踪信息
      // 记录当前最高盈利（用于移动止损，使用 grossPnLPercent 避免 NaN）
      const currentPnL = optionDynamicExitService.calculatePnL(positionCtx);
      const dynamicParams = optionDynamicExitService.getDynamicExitParams(positionCtx, exitRulesOverride);
      const peakPnLPercent = context.peakPnLPercent || 0;

      // 输出持仓监控状态日志（使用毛盈亏避免 T+1 手续费数据不完整导致 NaN）
      const pnlSign = currentPnL.grossPnLPercent >= 0 ? '+' : '';
      logger.log(
        `📊 [${strategyId}] ${effectiveSymbol} 持仓监控: ` +
        `入场$${entryPrice.toFixed(2)} → 当前$${currentPrice.toFixed(2)} | ` +
        `盈亏 ${pnlSign}${currentPnL.grossPnLPercent.toFixed(1)}% ($${currentPnL.grossPnL.toFixed(2)}) | ` +
        `止盈=${dynamicParams.takeProfitPercent}% 止损=${dynamicParams.stopLossPercent}% | ` +
        `${dynamicParams.adjustmentReason}`
      );

      if (currentPnL.grossPnLPercent > peakPnLPercent) {
        // 更新峰值盈利
        await strategyInstance.updateState(symbol, 'HOLDING', {
          ...context,
          peakPnLPercent: currentPnL.grossPnLPercent,
          peakPrice: currentPrice,
          lastCheckTime: new Date().toISOString(),
        });
        return { actionTaken: true };
      }

      return { actionTaken: false };
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 期权动态止盈止损处理失败 (${symbol}):`, error);
      return { actionTaken: false };
    }
  }

  /**
   * 期权策略专用：HOLDING状态下继续寻找新的交易机会
   * 允许期权策略同时持有多个合约（不同到期日、不同行权价、不同方向）
   */
  private async processOptionNewSignalWhileHolding(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string,
    strategyConfig: any,
    summary: ExecutionSummary
  ): Promise<void> {
    // P0-1: 提升 allocationResult 和 newContractSymbol 到 try 外，catch 中可访问
    let allocationResult: { approved: boolean; allocatedAmount: number; reason?: string } | null = null;
    let newContractSymbol: string = symbol;
    try {
      // P0-3: 熔断检查 — 禁止在熔断状态下开新仓
      const cbState = await stateManager.getInstanceState(strategyId, symbol);
      const cbCtx = cbState?.context || {};
      if (cbCtx.circuitBreakerActive) {
        return;
      }
      if (this.isTslpBlocked(strategyId)) {
        return;
      }

      // 1. 检查是否在交易窗口内
      const noNewEntryMins = Math.max(0, parseInt(String(strategyConfig?.tradeWindow?.noNewEntryBeforeCloseMinutes ?? 120), 10) || 120);
      const window = await getMarketCloseWindow({
        market: 'US',
        noNewEntryBeforeCloseMinutes: noNewEntryMins,
        forceCloseBeforeCloseMinutes: 30,
      });
      if (window) {
        const now = new Date();
        if (now >= window.noNewEntryTimeUtc) {
          // 不在交易窗口内，不寻找新机会
          return;
        }
      }

      // 2. 检查是否还有可用资金
      const availableCapital = await capitalManager.getAvailableCapital(strategyId);
      if (availableCapital <= 0) {
        // 没有可用资金，不寻找新机会
        return;
      }

      // 3. 获取当前持有或正在买入的期权合约列表（HOLDING + OPENING + CLOSING 都算已占用）
      const currentPositionsResult = await pool.query(
        `SELECT DISTINCT
           COALESCE((context->>'tradedSymbol')::text, symbol) as traded_symbol,
           current_state,
           (context->>'quantity')::int as quantity
         FROM strategy_instances
         WHERE strategy_id = $1
           AND current_state IN ('HOLDING', 'OPENING', 'CLOSING')
           AND context->>'tradedSymbol' IS NOT NULL`,
        [strategyId]
      );
      const heldContracts = new Set(
        currentPositionsResult.rows.map((r: any) => r.traded_symbol)
      );

      // 4. 检查是否有未成交的订单
      const hasPendingOrder = await this.checkPendingOptionOrderForUnderlying(strategyId, symbol);
      if (hasPendingOrder) {
        // 有未成交订单，等待处理完成
        return;
      }

      // 5. 生成新的交易信号
      const intent = await strategyInstance.generateSignal(symbol, undefined);

      if (!intent || intent.action === 'HOLD') {
        // 没有新信号
        return;
      }

      // 6. 检查新信号的合约是否已经持有
      const optionMeta = intent.metadata as any;
      newContractSymbol = optionMeta?.optionSymbol || intent.symbol;
      if (newContractSymbol && heldContracts.has(newContractSymbol)) {
        // 已经持有这个合约，不重复买入
        return;
      }

      // 7. 计算该标的剩余可用预算（多仓模式需扣除已持仓占用）
      let remainingBudget = availableCapital;
      try {
        const maxPerSymbol = await capitalManager.getMaxPositionPerSymbol(strategyId);
        // 查询该underlying已占用的资金
        const prefixes = getOptionPrefixesForUnderlying(symbol);
        const usedResult = await pool.query(
          `SELECT COALESCE((context->>'tradedSymbol')::text, symbol) as traded_symbol,
                  COALESCE((context->>'allocationAmount')::numeric, 0) as allocation_amount
           FROM strategy_instances
           WHERE strategy_id = $1 AND current_state IN ('HOLDING', 'OPENING')`,
          [strategyId]
        );
        let usedForSymbol = 0;
        for (const row of usedResult.rows) {
          const tradedSym = String(row.traded_symbol || '').toUpperCase();
          if (!isLikelyOptionSymbol(tradedSym)) continue;
          if (prefixes.some((p: string) => tradedSym.toUpperCase().startsWith(p.toUpperCase()))) {
            usedForSymbol += parseFloat(row.allocation_amount || '0');
          }
        }
        remainingBudget = Math.min(availableCapital, Math.max(0, maxPerSymbol - usedForSymbol));
        logger.debug(
          `策略 ${strategyId} 标的 ${symbol}: (多仓模式) 单标的上限=${maxPerSymbol.toFixed(2)}, 已用=${usedForSymbol.toFixed(2)}, 剩余预算=${remainingBudget.toFixed(2)}`
        );
      } catch (budgetErr: any) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 计算剩余预算失败: ${budgetErr.message}`);
      }

      if (remainingBudget <= 0) {
        // 无剩余预算，不需要生成信号
        return;
      }

      // 8. 记录信号并执行
      logger.info(`策略 ${strategyId} 标的 ${symbol}: (多仓模式) 生成新信号 ${intent.action}, 合约=${newContractSymbol}, 价格=${intent.entryPrice?.toFixed(2) || 'N/A'}`);
      summary.signals.push(`${symbol}(NEW_CONTRACT)`);

      // 执行订单（BUY 信号）
      if (intent.action === 'BUY') {
        // 根据剩余预算重新计算合约数（策略生成信号时不知道已占用金额）
        const premium = intent.entryPrice || 0;
        if (premium > 0 && intent.quantity) {
          const meta = intent.metadata as any;
          const feeModel = meta?.feeModel;
          let fittedContracts = intent.quantity;
          for (let n = intent.quantity; n >= 1; n--) {
            const est = estimateOptionOrderTotalCost({ premium, contracts: n, feeModel });
            if (est.totalCost <= remainingBudget) {
              fittedContracts = n;
              break;
            }
            if (n === 1) {
              // 即使1张也超预算
              logger.info(
                `策略 ${strategyId} 标的 ${symbol}: (多仓模式) 剩余预算${remainingBudget.toFixed(2)}不足以购买1张合约(需${est.totalCost.toFixed(2)})`
              );
              return;
            }
          }
          if (fittedContracts !== intent.quantity) {
            logger.info(
              `策略 ${strategyId} 标的 ${symbol}: (多仓模式) 合约数调整 ${intent.quantity} → ${fittedContracts}（剩余预算=${remainingBudget.toFixed(2)}）`
            );
            intent.quantity = fittedContracts;
            // 重新计算 allocationAmountOverride
            const newEst = estimateOptionOrderTotalCost({ premium, contracts: fittedContracts, feeModel });
            if (meta) {
              meta.allocationAmountOverride = newEst.totalCost;
              meta.estimatedCost = newEst.totalCost;
            }
          }
        }

        // 申请资金
        const allocationAmountOverride = (intent.metadata as any)?.allocationAmountOverride;
        const requestedAmount = typeof allocationAmountOverride === 'number' && allocationAmountOverride > 0
          ? allocationAmountOverride
          : intent.quantity! * (intent.entryPrice || 0);

        allocationResult = await capitalManager.requestAllocation({
          strategyId,
          amount: requestedAmount,
          symbol: newContractSymbol,
        });

        if (!allocationResult.approved) {
          logger.info(`策略 ${strategyId} 标的 ${symbol}: (多仓模式) 资金申请被拒绝 - ${allocationResult.reason}`);
          return;
        }

        // 更新状态为 OPENING（使用期权合约symbol作为key，允许多仓）
        await strategyInstance.updateState(newContractSymbol, 'OPENING', {
          intent,
          allocationAmount: allocationResult.allocatedAmount,
          underlyingSymbol: symbol, // 记录标的symbol用于后续映射
        });

        // 执行买入
        const executionResult = await basicExecutionService.executeBuyIntent(intent, strategyId);

        if (executionResult.success || executionResult.submitted) {
          summary.actions.push(`${symbol}(NEW_POSITION)`);
        } else {
          // 失败，释放资金
          await capitalManager.releaseAllocation(strategyId, allocationResult.allocatedAmount, newContractSymbol);
          await strategyInstance.updateState(newContractSymbol, 'IDLE');
        }
      }
    } catch (error: any) {
      // 不中断主流程，仅记录错误
      logger.warn(`策略 ${strategyId} 标的 ${symbol}: 多仓模式处理失败: ${error.message}`);

      // P0-1: 异常后释放已分配资金（多仓路径）
      if (allocationResult?.approved) {
        try {
          await capitalManager.releaseAllocation(strategyId, allocationResult.allocatedAmount, newContractSymbol);
          await strategyInstance.updateState(newContractSymbol, 'IDLE');
          logger.warn(`[CAPITAL_SAFETY] 多仓路径异常后释放资金: 策略${strategyId} 合约${newContractSymbol} 金额${allocationResult.allocatedAmount}`);
        } catch (releaseErr: any) {
          logger.error(`[CRITICAL] 多仓资金释放失败: ${releaseErr.message}`);
        }
      }
    }
  }

  // ... (其他方法保持不变)
  private async processClosingPosition(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    try {
      // 期权策略兼容：平仓订单与真实持仓在 tradedSymbol 上
      let effectiveSymbol = symbol;
      try {
        const instanceResult = await pool.query(
          `SELECT context FROM strategy_instances WHERE strategy_id = $1 AND symbol = $2`,
          [strategyId, symbol]
        );
        if (instanceResult.rows.length > 0 && instanceResult.rows[0].context) {
          const ctx = typeof instanceResult.rows[0].context === 'string'
            ? JSON.parse(instanceResult.rows[0].context)
            : instanceResult.rows[0].context;
          if (ctx?.tradedSymbol) {
            effectiveSymbol = ctx.tradedSymbol;
          }
        }
      } catch {
        // ignore
      }

      const hasPendingSellOrder = await this.checkPendingSellOrder(strategyId, effectiveSymbol);
      
      if (!hasPendingSellOrder) {
        const hasPosition = await this.checkExistingPosition(strategyId, effectiveSymbol);
        if (!hasPosition) {
          await strategyInstance.updateState(symbol, 'IDLE');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 平仓完成，更新状态为IDLE`);
        } else {
          await strategyInstance.updateState(symbol, 'HOLDING');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 仍有持仓，恢复HOLDING状态`);
        }
      }
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理平仓状态失败 (${symbol}):`, error);
    }
  }

  /**
   * ⚠️ 新增：处理卖空持仓状态
   * 检查是否需要平仓（止盈/止损）
   */
  private async processShortPosition(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<{ actionTaken: boolean }> {
    try {
      // 1. 获取策略实例上下文
      const instanceResult = await pool.query(
        `SELECT context FROM strategy_instances 
         WHERE strategy_id = $1 AND symbol = $2`,
        [strategyId, symbol]
      );

      if (instanceResult.rows.length === 0) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 卖空持仓状态但无上下文，重置为IDLE`);
        await strategyInstance.updateState(symbol, 'IDLE');
        return { actionTaken: true };
      }

      let context: any = {};
      try {
        const contextData = instanceResult.rows[0].context;
        if (!contextData) {
          // ⚠️ 修复：卖空持仓状态但 context 为空时，尝试从订单历史恢复（减少空context告警）
          logger.warn(`策略 ${strategyId} 标的 ${symbol}: 卖空持仓状态但context为空，尝试从订单历史恢复`);
          try {
            const lastShort = await pool.query(
              `SELECT order_id, price, quantity, created_at
               FROM execution_orders
               WHERE strategy_id = $1
                 AND symbol = $2
                 AND current_status = 'FILLED'
                 AND side IN ('SELL', 'Sell', '2')
               ORDER BY created_at DESC
               LIMIT 1`,
              [strategyId, symbol]
            );
            if (lastShort.rows.length > 0) {
              const row = lastShort.rows[0];
              const qty = parseInt(row.quantity?.toString() || '0', 10) || 0;
              const recovered = {
                entryPrice: parseFloat(row.price?.toString() || '0') || undefined,
                // 卖空语义：quantity 需要为负数
                quantity: qty !== 0 ? (qty < 0 ? qty : -Math.abs(qty)) : undefined,
                entryTime: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
                orderId: row.order_id,
              };
              if (recovered.entryPrice && recovered.quantity) {
                await strategyInstance.updateState(symbol, 'SHORT', recovered);
                context = recovered;
                logger.log(`策略 ${strategyId} 标的 ${symbol}: 已从订单历史恢复卖空context (orderId=${row.order_id})`);
              } else {
                throw new Error('Recovered short context missing entryPrice/quantity');
              }
            } else {
              await strategyInstance.updateState(symbol, 'IDLE');
              logger.warn(`策略 ${strategyId} 标的 ${symbol}: 卖空持仓状态但context为空，且无成交订单历史，已重置为IDLE`);
              return { actionTaken: true };
            }
          } catch (recoverError: any) {
            logger.warn(`策略 ${strategyId} 标的 ${symbol}: 恢复卖空context失败，已重置为IDLE: ${recoverError?.message || recoverError}`);
            await strategyInstance.updateState(symbol, 'IDLE');
            return { actionTaken: true };
          }
        } else {
          context = typeof contextData === 'string' 
            ? JSON.parse(contextData)
            : contextData;
        }
      } catch (e) {
        logger.error(`策略 ${strategyId} 标的 ${symbol}: 解析上下文失败`, e);
        return { actionTaken: false };
      }

      const entryPrice = context.entryPrice;  // 卖空价格
      let stopLoss = context.stopLoss || context.currentStopLoss;  // 止损（价格上涨）
      let takeProfit = context.takeProfit || context.currentTakeProfit;  // 止盈（价格下跌）
      const quantity = context.quantity;  // 负数

      if (!entryPrice || !quantity) {
        logger.warn(`策略 ${strategyId} 标的 ${symbol}: 卖空持仓状态但缺少入场价或数量`);
        return { actionTaken: false };
      }

      // 2. 获取当前价格
      let currentPrice = 0;
      try {
        const { getQuoteContext } = await import('../config/longport');
        const quoteCtx = await getQuoteContext();
        const quotes = await quoteCtx.quote([symbol]);
        if (quotes && quotes.length > 0) {
          const price = parseFloat(quotes[0].lastDone?.toString() || quotes[0].last_done?.toString() || '0');
          if (price > 0) currentPrice = price;
        }
      } catch (error: any) {
        // 忽略错误
      }

      if (currentPrice <= 0) {
        return { actionTaken: false };
      }

      // 3. 检查默认止盈/止损设置（卖空：价格上涨=止损，价格下跌=止盈）
      let defaultStopLoss = stopLoss;
      let defaultTakeProfit = takeProfit;
      let needsUpdate = false;
      
      if (!defaultStopLoss && entryPrice > 0) {
        defaultStopLoss = entryPrice * 1.03;  // 止损+3%（价格上涨）
        needsUpdate = true;
      }
      if (!defaultTakeProfit && entryPrice > 0) {
        defaultTakeProfit = entryPrice * 0.97;  // 止盈-3%（价格下跌）
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        const updatedContext = {
          ...context,
          stopLoss: defaultStopLoss,
          takeProfit: defaultTakeProfit,
          originalStopLoss: context.originalStopLoss || defaultStopLoss,
          originalTakeProfit: context.originalTakeProfit || defaultTakeProfit,
          currentStopLoss: context.currentStopLoss || defaultStopLoss,
          currentTakeProfit: context.currentTakeProfit || defaultTakeProfit,
        };
        await strategyInstance.updateState(symbol, 'SHORT', updatedContext);
        context = updatedContext;
        stopLoss = defaultStopLoss;
        takeProfit = defaultTakeProfit;
      }

      // 4. 检查止盈/止损（卖空：价格上涨触发止损，价格下跌触发止盈）
      const currentStopLoss = context.currentStopLoss || stopLoss;
      const currentTakeProfit = context.currentTakeProfit || takeProfit;

      let shouldCover = false;
      let exitReason = '';
      let exitPrice = currentPrice;
      let actionTaken = needsUpdate;

      if (currentStopLoss && currentPrice >= currentStopLoss) {
        shouldCover = true;
        exitReason = 'STOP_LOSS';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 卖空触发止损 (当前价=${currentPrice.toFixed(2)}, 止损价=${currentStopLoss.toFixed(2)})`);
      } else if (currentTakeProfit && currentPrice <= currentTakeProfit) {
        shouldCover = true;
        exitReason = 'TAKE_PROFIT';
        logger.log(`策略 ${strategyId} 标的 ${symbol}: 卖空触发止盈 (当前价=${currentPrice.toFixed(2)}, 止盈价=${currentTakeProfit.toFixed(2)})`);
      }

      // 5. 执行平仓（买入平仓）
      if (shouldCover) {
        const absQuantity = Math.abs(quantity);
        
        // 验证平仓操作
        const coverValidation = await shortValidationService.validateCoverOperation(
          symbol,
          absQuantity,
          quantity,
          strategyId
        );

        if (!coverValidation.valid) {
          logger.warn(`策略 ${strategyId} 标的 ${symbol}: 平仓验证失败 - ${coverValidation.error}`);
          return { actionTaken };
        }

        await strategyInstance.updateState(symbol, 'COVERING', {
          ...context,
          exitReason,
          exitPrice,
        });

        const coverIntent = {
          action: 'BUY' as const,
          symbol,
          entryPrice: currentPrice,
          quantity: absQuantity,  // 正数
          reason: `自动平仓: ${exitReason}`,
        };

        logger.log(`策略 ${strategyId} 标的 ${symbol}: 执行平仓 - 原因=${exitReason}`);
        const executionResult = await basicExecutionService.executeBuyIntent(coverIntent, strategyId);

        if (executionResult.submitted && executionResult.orderId) {
          this.markOrderSubmitted(strategyId, symbol, 'BUY', executionResult.orderId);
        }

        if (executionResult.success || executionResult.submitted) {
          actionTaken = true;
        } else {
          await strategyInstance.updateState(symbol, 'SHORT', context);
          logger.error(`策略 ${strategyId} 标的 ${symbol} 平仓失败: ${executionResult.error}`);
        }
      }

      return { actionTaken };
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理卖空持仓状态失败 (${symbol}):`, error);
      return { actionTaken: false };
    }
  }

  /**
   * ⚠️ 新增：处理平仓中状态（卖空平仓）
   */
  private async processCoveringPosition(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    try {
      const hasPendingBuyOrder = await this.checkPendingBuyOrder(strategyId, symbol);
      
      if (!hasPendingBuyOrder) {
        const allPositions = await this.getCachedPositions();
        const position = allPositions.find((pos: any) => {
          const posSymbol = pos.symbol || pos.stock_name;
          return posSymbol === symbol;
        });
        
        const currentQuantity = position ? parseInt(position.quantity?.toString() || '0') : 0;
        
        if (currentQuantity === 0) {
          // 平仓完成
          await strategyInstance.updateState(symbol, 'IDLE');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 平仓完成，更新状态为IDLE`);
        } else if (currentQuantity < 0) {
          // 仍有卖空持仓
          await strategyInstance.updateState(symbol, 'SHORT');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 仍有卖空持仓，恢复SHORT状态`);
        } else {
          // 转为做多持仓（不应该发生，但处理一下）
          await strategyInstance.updateState(symbol, 'HOLDING');
          logger.log(`策略 ${strategyId} 标的 ${symbol}: 转为做多持仓，更新状态为HOLDING`);
        }
      }
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 处理平仓中状态失败 (${symbol}):`, error);
    }
  }

  /**
   * 检查是否有未成交的买入订单
   */
  private async checkPendingBuyOrder(strategyId: number, symbol: string, forceRefresh: boolean = false): Promise<boolean> {
    try {
      const todayOrders = await todayOrdersCache.getTodayOrders(forceRefresh);
      const pendingStatuses = [
        'NotReported', 'NewStatus', 'WaitToNew', 'PartialFilledStatus',
        'PendingReplaceStatus', 'WaitToReplace', 'ReplacedNotReported',
        'ProtectedNotReported', 'VarietiesNotReported',
      ];
      
      for (const order of todayOrders) {
        const orderSymbol = order.symbol || order.stock_name;
        const orderSide = order.side;
        const isBuy = orderSide === 'Buy' || orderSide === 1 || orderSide === 'BUY' || orderSide === 'buy';
        
        if (orderSymbol === symbol && isBuy) {
          const status = normalizeOrderStatus(order.status);
          if (pendingStatuses.includes(status)) return true;
        }
      }
      return false;
    } catch (error: any) {
      return true;
    }
  }

  private async syncPositionState(
    strategyInstance: StrategyBase,
    strategyId: number,
    symbol: string
  ): Promise<void> {
    // ... (保持不变，只是减少日志)
    try {
      const currentState = await strategyInstance.getCurrentState(symbol);
      if (currentState !== 'IDLE') return;

      const allPositions = await this.getCachedPositions();

      // 期权策略：symbol 是 underlying，真实持仓是期权symbol
      if (strategyInstance instanceof OptionIntradayStrategy) {
        const prefixes = getOptionPrefixesForUnderlying(symbol).map((p) => p.toUpperCase());
        const optionPos = allPositions.find((pos: any) => {
          const posSymbol = String(pos.symbol || pos.stock_name || '').toUpperCase();
          const qty = parseInt(pos.quantity?.toString() || '0');
          return qty !== 0 && posSymbol.endsWith('.US') && isLikelyOptionSymbol(posSymbol) && prefixes.some((p) => posSymbol.startsWith(p));
        });

        if (!optionPos) return;

        const qty = parseInt(optionPos.quantity?.toString() || '0');
        if (qty === 0) return;

        const costPrice = parseFloat(optionPos.costPrice?.toString() || optionPos.cost_price?.toString() || optionPos.avgPrice?.toString() || '0');
        const entryPrice = costPrice > 0 ? costPrice : 0;
        const tradedSymbol = String(optionPos.symbol || optionPos.stock_name || '');

        // 期权持仓：尝试从历史订单中恢复完整的 allocationAmount
        // 如果无法恢复，使用 premium * contracts * multiplier（注意：缺少手续费）
        const multiplier = 100; // 标准美股期权
        let allocationAmount: number | undefined = undefined;

        if (entryPrice > 0) {
          // 尝试从近期已成交订单中查找匹配的期权买入订单，获取完整成本
          try {
            const todayOrders = await todayOrdersCache.getTodayOrders();
            const matchedOrder = todayOrders.find((ord: any) => {
              const orderSymbol = String(ord.symbol || ord.stock_code || '').toUpperCase();
              const orderSide = ord.side || ord.order_side || '';
              const isBuy = orderSide === 'Buy' || orderSide === 1 || orderSide === 'BUY' || orderSide === 'buy';
              return orderSymbol === tradedSymbol.toUpperCase() && isBuy;
            });

            if (matchedOrder) {
              // 如果找到匹配订单，尝试从元数据中恢复 allocationAmount
              const metadata = typeof matchedOrder.metadata === 'string'
                ? JSON.parse(matchedOrder.metadata)
                : (matchedOrder.metadata || {});
              if (metadata.allocationAmountOverride) {
                allocationAmount = parseFloat(String(metadata.allocationAmountOverride));
                logger.log(
                  `策略 ${strategyId} 期权 ${tradedSymbol}: 从历史订单恢复 allocationAmount=${allocationAmount.toFixed(2)} USD`
                );
              }
            }
          } catch (error: any) {
            logger.warn(`策略 ${strategyId} 期权 ${tradedSymbol}: 无法从历史订单恢复 allocationAmount: ${error.message}`);
          }

          // Fallback: 使用 premium * contracts * multiplier（缺少手续费，但总比没有好）
          if (!allocationAmount) {
            allocationAmount = qty * entryPrice * multiplier;
            logger.warn(
              `策略 ${strategyId} 期权 ${tradedSymbol}: 使用fallback计算 allocationAmount=${allocationAmount.toFixed(2)} USD（缺少手续费）`
            );
          }
        }

        // 尝试保留已有的 entryTime（避免 IDLE→HOLDING 反复重置导致止损冷静期永不过期）
        let preservedEntryTime: string | undefined;
        try {
          const existingState = await stateManager.getInstanceState(strategyId, symbol);
          const existingCtx = existingState?.context;
          if (existingCtx?.entryTime) {
            preservedEntryTime = existingCtx.entryTime;
          }
        } catch { /* ignore */ }

        await strategyInstance.updateState(symbol, 'HOLDING', {
          entryPrice,
          quantity: qty,
          entryTime: preservedEntryTime || new Date().toISOString(),
          tradedSymbol,
          // 期权默认不设置止盈止损，避免与强平逻辑冲突；仍保留字段兼容
          originalStopLoss: undefined,
          originalTakeProfit: undefined,
          currentStopLoss: undefined,
          currentTakeProfit: undefined,
          allocationAmount,
          // 保存期权元数据（用于后续资金释放）
          optionMeta: {
            assetClass: 'OPTION',
            multiplier,
            // 注意：手续费信息在状态同步时无法获取，需要在开仓时保存
          },
        });
        logger.info(`策略 ${strategyId} 标的 ${symbol}: 状态同步 - 从IDLE更新为HOLDING（期权持仓，交易标的=${tradedSymbol}, 数量=${qty}）`);
        return;
      }

      const actualPosition = allPositions.find((pos: any) => {
        const posSymbol = pos.symbol || pos.stock_name;
        return posSymbol === symbol;
      });

      if (!actualPosition) return;

      const quantity = parseInt(actualPosition.quantity?.toString() || '0');
      
      // ⚠️ 修复：支持负数持仓（卖空持仓）
      if (quantity === 0) return;

      let costPrice = parseFloat(actualPosition.costPrice?.toString() || actualPosition.cost_price?.toString() || '0');
      
      if (costPrice <= 0) {
        try {
          const { getQuoteContext } = await import('../config/longport');
          const quoteCtx = await getQuoteContext();
          const quotes = await quoteCtx.quote([symbol]);
          if (quotes && quotes.length > 0) {
            costPrice = parseFloat(quotes[0].lastDone?.toString() || quotes[0].last_done?.toString() || '0');
          }
        } catch (error) {
          costPrice = 0;
        }
      }

      // 尝试保留已有的 entryTime（避免状态振荡重置止损冷静期）
      let preservedEntryTimeForSync: string | undefined;
      try {
        const existingState = await stateManager.getInstanceState(strategyId, symbol);
        const existingCtx = existingState?.context;
        if (existingCtx?.entryTime) {
          preservedEntryTimeForSync = existingCtx.entryTime;
        }
      } catch { /* ignore */ }

      // ⚠️ 修复：根据持仓数量判断状态类型
      if (quantity > 0) {
        // 做多持仓：同步到 HOLDING 状态
        const updatedContext = {
          entryPrice: actualPosition?.costPrice || actualPosition?.avgPrice || costPrice,
          quantity: quantity,
          entryTime: preservedEntryTimeForSync || new Date().toISOString(),
          originalStopLoss: costPrice * 0.95,  // 默认止损-5%
          originalTakeProfit: costPrice * 1.10,  // 默认止盈+10%
          currentStopLoss: costPrice * 0.95,
          currentTakeProfit: costPrice * 1.10,
          allocationAmount: quantity * costPrice,
        };

        await strategyInstance.updateState(symbol, 'HOLDING', updatedContext);
        logger.info(`策略 ${strategyId} 标的 ${symbol}: 状态同步 - 从IDLE更新为HOLDING（做多持仓，数量=${quantity}）`);
      } else if (quantity < 0) {
        // 卖空持仓：同步到 SHORT 状态
        const absQuantity = Math.abs(quantity);
        const updatedContext = {
          entryPrice: actualPosition?.costPrice || actualPosition?.avgPrice || costPrice,  // 卖空价格
          quantity: quantity,  // 负数
          entryTime: preservedEntryTimeForSync || new Date().toISOString(),
          originalStopLoss: costPrice * 1.03,  // 默认止损+3%（价格上涨）
          originalTakeProfit: costPrice * 0.97,  // 默认止盈-3%（价格下跌）
          currentStopLoss: costPrice * 1.03,
          currentTakeProfit: costPrice * 0.97,
        };

        await strategyInstance.updateState(symbol, 'SHORT', updatedContext);
        logger.info(`策略 ${strategyId} 标的 ${symbol}: 状态同步 - 从IDLE更新为SHORT（卖空持仓，数量=${quantity}）`);
      }
    } catch (error: any) {
      logger.error(`策略 ${strategyId} 同步持仓状态失败 (${symbol}):`, error);
    }
  }

  // ... (checkPendingSellOrder, checkAvailablePosition, validateStrategyExecution, markOrderSubmitted, createStrategyInstance 保持不变)
  private async checkPendingSellOrder(_strategyId: number, symbol: string, forceRefresh: boolean = false): Promise<boolean> {
    // ... (保持不变)
    try {
      const todayOrders = await todayOrdersCache.getTodayOrders(forceRefresh);
      const pendingStatuses = [
        'NotReported', 'NewStatus', 'WaitToNew', 'PartialFilledStatus',
        'PendingReplaceStatus', 'WaitToReplace', 'ReplacedNotReported',
        'ProtectedNotReported', 'VarietiesNotReported',
      ];
      
      for (const order of todayOrders) {
        const orderSymbol = order.symbol || order.stock_name;
        const orderSide = order.side;
        const isSell = orderSide === 'Sell' || orderSide === 2 || orderSide === 'SELL' || orderSide === 'sell';
        
        if (orderSymbol === symbol && isSell) {
          const status = normalizeOrderStatus(order.status);
          if (pendingStatuses.includes(status)) return true;
        }
      }
      return false;
    } catch (error: any) {
      return true;
    }
  }
  
  private async checkAvailablePosition(strategyId: number, symbol: string): Promise<{
    hasPending: boolean;
    availableQuantity?: number;
    actualQuantity?: number;
    pendingQuantity?: number;
  }> {
    try {
      const hasPending = await this.checkPendingSellOrder(strategyId, symbol, false);
      const positionInfo = await basicExecutionService.calculateAvailablePosition(symbol);
      return {
        hasPending,
        availableQuantity: positionInfo.availableQuantity,
        actualQuantity: positionInfo.actualQuantity,
        pendingQuantity: positionInfo.pendingQuantity
      };
    } catch (error: any) {
      return { hasPending: true, availableQuantity: 0 };
    }
  }

  private async validateStrategyExecution(
    strategyId: number,
    symbol: string,
    intent: { action: string; price?: number; quantity?: number; entryPrice?: number }
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      const instanceResult = await pool.query(
        `SELECT symbol, current_state, context FROM strategy_instances WHERE strategy_id = $1 AND symbol = $2`,
        [strategyId, symbol]
      );
      
      if (instanceResult.rows.length > 0) {
        const instance = instanceResult.rows[0];
        const context = instance.context
          ? (typeof instance.context === 'string' ? JSON.parse(instance.context) : instance.context)
          : {};
        
        if (intent.action === 'SELL' && instance.current_state === 'HOLDING') {
          const buyPrice = context.buyPrice || context.entryPrice;
          const sellPrice = intent.price || intent.entryPrice;
          if (buyPrice && sellPrice && sellPrice < buyPrice * 0.95) {
            return { valid: false, reason: `卖出价格低于买入价格超过5%，疑似高买低卖` };
          }
        }
        
        if (intent.action === 'BUY' && instance.current_state === 'HOLDING') {
          return { valid: false, reason: `标的 ${symbol} 已有持仓，不允许重复买入` };
        }
      }
      
      const hasPendingOrder = await this.checkPendingOrder(strategyId, symbol);
      if (hasPendingOrder) {
        orderPreventionMetrics.recordDuplicateOrderPrevented('pending');
        orderPreventionMetrics.recordOrderRejected('duplicate');
        return { valid: false, reason: `标的 ${symbol} 已有未成交订单` };
      }
      
      if (intent.action === 'SELL' && intent.quantity) {
        const positionValidation = await basicExecutionService.validateSellPosition(symbol, intent.quantity, strategyId);
        if (!positionValidation.valid) {
          return { valid: false, reason: positionValidation.reason || '持仓验证失败' };
        }
      }
      
      const cacheKey = `${strategyId}:${symbol}:${intent.action}`;
      const cached = this.orderSubmissionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.ORDER_CACHE_TTL) {
        orderPreventionMetrics.recordDuplicateOrderPrevented('cache');
        orderPreventionMetrics.recordOrderRejected('duplicate');
        return { valid: false, reason: `最近60秒内已提交过 ${intent.action} 订单` };
      }
      
      return { valid: true };
    } catch (error: any) {
      return { valid: false, reason: `验证过程出错: ${error.message}` };
    }
  }

  private markOrderSubmitted(strategyId: number, symbol: string, action: string, orderId?: string): void {
    const cacheKey = `${strategyId}:${symbol}:${action}`;
    this.orderSubmissionCache.set(cacheKey, { timestamp: Date.now(), orderId });
    if (this.orderSubmissionCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of this.orderSubmissionCache.entries()) {
        if (now - value.timestamp > this.ORDER_CACHE_TTL) {
          this.orderSubmissionCache.delete(key);
        }
      }
    }
  }

  // =========================================================================
  // 260225 Iron Dome: 三层准自动化防御
  // =========================================================================

  /**
   * Iron Dome 主循环（60秒周期）
   * Layer 1: Shadow-Pricer — 0DTE 仓位影子定价，检测归零风险
   * Layer 2: Reconciliation — 账实核对，检测 broker 端幽灵平仓
   */
  private async runIronDomeCycle(strategyId: number): Promise<void> {
    // 获取该策略所有 HOLDING 状态的实例
    const holdingResult = await pool.query(
      `SELECT symbol, context FROM strategy_instances
       WHERE strategy_id = $1 AND current_state = 'HOLDING'`,
      [strategyId]
    );

    if (holdingResult.rows.length === 0) return;

    // === Layer 1: Shadow-Pricer ===
    await this.shadowPricerCheck(strategyId, holdingResult.rows);

    // === Layer 2: Reconciliation ===
    await this.reconciliationCheck(strategyId, holdingResult.rows);
  }

  /**
   * Shadow-Pricer: 影子定价器
   *
   * 不依赖 SELL 订单，直接用 mark price 与 entry price 对比。
   * 如果期权残值 < 入场价的 10%（亏损 90%+），触发虚拟熔断。
   * 解决: "0DTE 到期归零不触发熔断"的盲区。
   */
  private async shadowPricerCheck(
    strategyId: number,
    holdingRows: Array<{ symbol: string; context: any }>
  ): Promise<void> {
    for (const row of holdingRows) {
      try {
        const ctx = typeof row.context === 'string' ? JSON.parse(row.context) : (row.context || {});
        const optMeta = ctx.optionMeta;
        if (!optMeta) continue; // 非期权仓位，跳过

        const tradedSymbol = ctx.tradedSymbol;
        if (!tradedSymbol) continue;

        const entryPrice = parseFloat(String(ctx.entryPrice || 0));
        if (entryPrice <= 0) continue;

        // 检查是否 0DTE
        const expDate = trailingStopProtectionService.extractOptionExpireDate(tradedSymbol, optMeta);
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const is0DTE = expDate === today;
        if (!is0DTE) continue; // 只对 0DTE 启用 shadow pricer

        // 获取当前 mark price（使用 broker 持仓数据，不额外调 API）
        const allPositions = await this.getCachedPositions();
        const pos = allPositions.find((p: any) => {
          const sym = p.symbol || p.stock_code;
          return sym === tradedSymbol;
        });

        if (!pos) {
          // DB 说 HOLDING 但 broker 无持仓 → Layer 2 会处理
          continue;
        }

        const currentPrice = parseFloat(
          (pos.currentPrice || pos.current_price || pos.lastPrice || pos.last_price || '0').toString()
        );
        if (currentPrice <= 0) continue;

        // 核心判断：残值 < 入场价 * 10% → 亏损 90%+ → 虚拟熔断
        const shadowPnLPct = ((currentPrice - entryPrice) / entryPrice) * 100;

        if (currentPrice < entryPrice * 0.10) {
          logger.warn(
            `[IRON_DOME:SHADOW_PRICER] 策略 ${strategyId} 标的 ${row.symbol}: ` +
            `0DTE 期权 ${tradedSymbol} 残值 $${currentPrice.toFixed(2)} < 入场 $${entryPrice.toFixed(2)} 的 10%! ` +
            `虚拟亏损 ${shadowPnLPct.toFixed(1)}%。触发虚拟熔断！`
          );

          // 虚拟 PnL 写入，触发熔断
          const quantity = parseFloat(String(ctx.quantity || 1));
          const multiplier = Number(optMeta.multiplier) || 100;
          const virtualLoss = Math.round((currentPrice - entryPrice) * quantity * multiplier * 100) / 100;

          // 直接激活全策略熔断
          await pool.query(
            `UPDATE strategy_instances
             SET context = context || $1::jsonb
             WHERE strategy_id = $2`,
            [
              JSON.stringify({
                circuitBreakerActive: true,
                circuitBreakerReason: `SHADOW_PRICER: ${tradedSymbol} 残值${currentPrice.toFixed(2)}(亏损${Math.abs(shadowPnLPct).toFixed(0)}%)`,
                circuitBreakerTime: new Date().toISOString(),
              }),
              strategyId,
            ]
          );

          logger.warn(
            `[IRON_DOME:CIRCUIT_BREAKER] 策略 ${strategyId}: Shadow-Pricer 触发全策略熔断! ` +
            `虚拟亏损 $${Math.abs(virtualLoss).toFixed(2)}。` +
            `别装死了，你的 0DTE 期权快归零了！立即检查仓位！`
          );
        } else if (currentPrice < entryPrice * 0.30) {
          // 亏损 70%+ 预警（不触发熔断，但记录警告）
          logger.warn(
            `[IRON_DOME:SHADOW_PRICER] 策略 ${strategyId} 标的 ${row.symbol}: ` +
            `0DTE 期权 ${tradedSymbol} 当前 $${currentPrice.toFixed(2)} (亏损 ${Math.abs(shadowPnLPct).toFixed(0)}%)，接近归零阈值`
          );
        }
      } catch (spErr: any) {
        logger.warn(`[IRON_DOME:SHADOW_PRICER] 策略 ${strategyId} 标的 ${row.symbol} 检查异常: ${spErr?.message}`);
      }
    }
  }

  /**
   * Reconciliation Loop: 账实核对
   *
   * 对比 broker 实际持仓 vs DB strategy_instances HOLDING 状态。
   * 如果 DB 说 HOLDING 但 broker 持仓为零，标记 BROKER_TERMINATED + 全策略熔断。
   * 解决: "Broker 强平逻辑脱钩"的盲区。
   */
  private async reconciliationCheck(
    strategyId: number,
    holdingRows: Array<{ symbol: string; context: any }>
  ): Promise<void> {
    if (holdingRows.length === 0) return;

    let allPositions: any[];
    try {
      allPositions = await this.getCachedPositions();
    } catch {
      return; // API 失败不阻塞
    }

    for (const row of holdingRows) {
      try {
        const ctx = typeof row.context === 'string' ? JSON.parse(row.context) : (row.context || {});
        const tradedSymbol = ctx.tradedSymbol;
        if (!tradedSymbol) continue;

        // 在 broker 持仓中查找
        const pos = allPositions.find((p: any) => {
          const sym = p.symbol || p.stock_code;
          return sym === tradedSymbol;
        });

        const brokerQty = pos
          ? parseInt((pos.quantity || pos.available_quantity || pos.availableQuantity || '0').toString(), 10)
          : 0;

        if (brokerQty <= 0) {
          // DB 说 HOLDING 但 broker 持仓为零 → 幽灵仓位！
          const entryPrice = parseFloat(String(ctx.entryPrice || 0));
          const dbQty = parseInt(String(ctx.quantity || 0), 10);

          logger.warn(
            `[IRON_DOME:RECONCILIATION] 策略 ${strategyId} 标的 ${row.symbol}: ` +
            `DB状态=HOLDING (${tradedSymbol}, qty=${dbQty}, entry=$${entryPrice.toFixed(2)}) ` +
            `但 broker 持仓为零! 仓位已被 broker 强平或到期归零。` +
            `系统要你命的时候都不会提前通知你！`
          );

          // 标记为 BROKER_TERMINATED 并释放资金
          const allocationAmount = parseFloat(String(ctx.allocationAmount || 0));
          await stateManager.updateState(strategyId, row.symbol, 'IDLE', {
            exitReason: 'BROKER_TERMINATED',
            protectionOrderId: null,
            protectionTrailingPct: null,
            takeProfitOrderId: null,
            lastExitTime: new Date().toISOString(),
            // 记录虚拟 PnL = -100%（最坏情况估算）
            lastTradePnL: allocationAmount > 0 ? -allocationAmount : 0,
            dailyRealizedPnL: (parseFloat(String(ctx.dailyRealizedPnL ?? 0)) + (allocationAmount > 0 ? -allocationAmount : 0)),
            consecutiveLosses: (parseInt(String(ctx.consecutiveLosses ?? 0)) + 1),
            dailyTradeCount: (parseInt(String(ctx.dailyTradeCount ?? 0)) + 1),
          });

          // 释放资金分配
          if (allocationAmount > 0) {
            try {
              await capitalManager.releaseAllocation(strategyId, allocationAmount, row.symbol);
            } catch (relErr: any) {
              logger.warn(`[IRON_DOME] 策略 ${strategyId} 释放资金失败: ${relErr?.message}`);
            }
          }

          // 触发全策略熔断
          await pool.query(
            `UPDATE strategy_instances
             SET context = context || $1::jsonb
             WHERE strategy_id = $2`,
            [
              JSON.stringify({
                circuitBreakerActive: true,
                circuitBreakerReason: `BROKER_TERMINATED: ${tradedSymbol} 券商端持仓归零`,
                circuitBreakerTime: new Date().toISOString(),
              }),
              strategyId,
            ]
          );

          logger.warn(
            `[IRON_DOME:CIRCUIT_BREAKER] 策略 ${strategyId}: 账实不符触发全策略熔断! ` +
            `${tradedSymbol} 已标记 BROKER_TERMINATED。资金已释放。` +
            `券商把你仓位剁了，快去检查数据库和交易记录！`
          );
        }
      } catch (rcErr: any) {
        logger.warn(`[IRON_DOME:RECONCILIATION] 策略 ${strategyId} 标的 ${row.symbol} 核对异常: ${rcErr?.message}`);
      }
    }
  }

  /**
   * TSLPPCT 失败计数: 记录失败并检查是否应禁止开仓 (V4: 持久化到 DB)
   */
  async recordTslpFailure(strategyId: number): Promise<void> {
    const count = (this.tslpFailureCount.get(strategyId) || 0) + 1;
    this.tslpFailureCount.set(strategyId, count);
    // V4: 同步写入 DB，进程重启后可恢复
    try {
      await pool.query(
        `UPDATE strategy_instances
         SET context = context || $1::jsonb
         WHERE strategy_id = $2`,
        [JSON.stringify({ tslpFailureCount: count }), strategyId]
      );
    } catch (dbErr: unknown) {
      logger.warn(`[IRON_DOME:TSLP_COUNTER] 策略 ${strategyId}: DB写入失败: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
    }
    logger.warn(
      `[IRON_DOME:TSLP_COUNTER] 策略 ${strategyId}: TSLPPCT 累计失败 ${count} 次` +
      (count >= this.TSLP_FAILURE_THRESHOLD
        ? `，已达阈值 ${this.TSLP_FAILURE_THRESHOLD}，禁止新开仓`
        : ``)
    );
  }

  async resetTslpFailure(strategyId: number): Promise<void> {
    this.tslpFailureCount.set(strategyId, 0);
    try {
      await pool.query(
        `UPDATE strategy_instances
         SET context = context || '{"tslpFailureCount": 0}'::jsonb
         WHERE strategy_id = $1`,
        [strategyId]
      );
    } catch (dbErr: unknown) {
      logger.warn(`[IRON_DOME:TSLP_COUNTER] 策略 ${strategyId}: 重置DB写入失败: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
    }
  }

  isTslpBlocked(strategyId: number): boolean {
    return (this.tslpFailureCount.get(strategyId) || 0) >= this.TSLP_FAILURE_THRESHOLD;
  }

  /**
   * V4: 从 DB 恢复 TSLP 失败计数（进程重启后首次遇到策略时调用）
   */
  async restoreTslpFailureCount(strategyId: number): Promise<void> {
    if (this.tslpFailureCount.has(strategyId)) return; // 已恢复
    try {
      const result = await pool.query(
        `SELECT MAX((context->>'tslpFailureCount')::int) as count
         FROM strategy_instances WHERE strategy_id = $1`,
        [strategyId]
      );
      const count = result.rows[0]?.count || 0;
      this.tslpFailureCount.set(strategyId, count);
      if (count > 0) {
        logger.warn(`[IRON_DOME:TSLP_RESTORE] 策略 ${strategyId}: 从DB恢复TSLP失败计数=${count}`);
      }
    } catch (dbErr: unknown) {
      this.tslpFailureCount.set(strategyId, 0);
      logger.warn(`[IRON_DOME:TSLP_RESTORE] 策略 ${strategyId}: DB恢复失败: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
    }
  }

  private createStrategyInstance(strategyType: string, strategyId: number, config: any): StrategyBase {
    switch (strategyType) {
      case 'RECOMMENDATION_V1':
        return new RecommendationStrategy(strategyId, config);
      case 'OPTION_INTRADAY_V1':
        return new OptionIntradayStrategy(strategyId, config);
      default:
        throw new Error(`未知的策略类型: ${strategyType}`);
    }
  }
}

// 导出单例
export default new StrategyScheduler();
