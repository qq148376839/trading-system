/**
 * 日志系统模拟测试
 * 模拟期权策略完整生命周期，验证各阶段日志的 DB 写入行为
 *
 * 测试目标：
 *   1. 各级别日志是否正确写入/跳过 DB
 *   2. 节流机制是否生效（高频重复消息）
 *   3. 摘要聚合是否正确（metric 数据点）
 *   4. 数据展示是否准确（字段完整性）
 */

// ==================== Mock 依赖 ====================
jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    on: jest.fn(),
    end: jest.fn(),
  },
}));

jest.mock('../utils/trace-context', () => ({
  __esModule: true,
  default: {
    getTraceId: jest.fn().mockReturnValue('trace-sim-001'),
    generateTraceId: jest.fn().mockReturnValue('trace-gen-001'),
  },
}));

describe('期权策略日志模拟测试', () => {
  let logService: any;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../config/database', () => ({
      __esModule: true,
      default: {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        on: jest.fn(),
        end: jest.fn(),
      },
    }));
    jest.mock('../utils/trace-context', () => ({
      __esModule: true,
      default: {
        getTraceId: jest.fn().mockReturnValue('trace-sim-001'),
        generateTraceId: jest.fn().mockReturnValue('trace-gen-001'),
      },
    }));
    logService = require('../services/log.service').default;
  });

  afterEach(() => {
    if (logService?.stop) logService.stop();
  });

  // ============================================================
  // 测试 1: 完整期权策略周期 — 各阶段日志写入验证
  // ============================================================
  describe('阶段 1: 策略调度器触发', () => {
    it('策略启动 INFO 应入库', () => {
      logService.info('Strategy.Scheduler', '策略已启动（策略周期: 5秒，订单监控: 5秒）', {
        strategyId: 'option-intraday-001',
        interval: 5000,
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('INFO');
      expect(queue[0].module).toBe('Strategy.Scheduler');
      expect(queue[0].message).toContain('策略已启动');
      expect(queue[0].extraData).toEqual({
        strategyId: 'option-intraday-001',
        interval: 5000,
      });
    });

    it('非交易时段 DEBUG 不应入库', () => {
      logService.debug('Strategy.Scheduler', '非交易时段，跳过本次运行');

      const queue = logService.getQueue();
      expect(queue.length).toBe(0);
    });

    it('策略执行完成 INFO 应入库，含统计数据', () => {
      logService.info('Strategy.Scheduler', '策略执行完成: 耗时120ms, 扫描3个标的, 信号1, 错误0, 操作1', {
        duration: 120,
        scanned: 3,
        signals: 1,
        errors: 0,
        actions: 1,
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].extraData.duration).toBe(120);
      expect(queue[0].extraData.signals).toBe(1);
    });
  });

  describe('阶段 2: 期权信号生成', () => {
    it('交易窗口跳过 DEBUG 不入库', () => {
      logService.debug('Strategy.Option', '[SPY.US] 收盘前30分钟不开新仓，跳过信号生成');
      expect(logService.getQueue().length).toBe(0);
    });

    it('期权推荐分析 DEBUG 不入库', () => {
      logService.debug('Strategy.Option', '[期权推荐] SPY.US: CALL, confidence=0.75, marketScore=62, intradayScore=71, finalScore=68, riskLevel=MODERATE', {
        symbol: 'SPY.US',
        direction: 'CALL',
        confidence: 0.75,
        marketScore: 62,
        intradayScore: 71,
        finalScore: 68,
        riskLevel: 'MODERATE',
      });
      expect(logService.getQueue().length).toBe(0);
    });

    it('EXTREME 风险等级 WARN 必入库', () => {
      logService.warn('Strategy.Option', '[SPY.US跳过] 风险等级EXTREME，不生成信号');

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('WARNING');
      expect(queue[0].message).toContain('EXTREME');
    });

    it('无合适合约 WARN 入库', () => {
      logService.warn('Strategy.Option', '[SPY.US无合约] 未找到合适的期权合约 (CALL, aggressive)', {
        symbol: 'SPY.US',
        direction: 'CALL',
        mode: 'aggressive',
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('WARNING');
      expect(queue[0].extraData.direction).toBe('CALL');
    });

    it('获取可用资金失败 WARN 入库', () => {
      logService.warn('Strategy.Option', '[SPY.US] 获取可用资金失败: Connection timeout, 使用默认1张合约');

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('WARNING');
    });

    it('资金/仓位 DEBUG 不入库', () => {
      logService.debug('Strategy.Option', '[SPY.US资金] 可用资金=5000, 单标的上限=2000, 预算=2000');
      logService.debug('Strategy.Option', '[SPY.US仓位] 预算=2000, 权利金=3.50, 计算合约数=5');
      expect(logService.getQueue().length).toBe(0);
    });

    it('信号生成成功 INFO 入库，含完整交易参数', () => {
      logService.info('Strategy.Option', '[SPY.US/MOMENTUM] CALL SPY250207C00600000 | 合约=5, 权利金=$3.50, 预估成本=$1750', {
        symbol: 'SPY.US',
        strategy: 'MOMENTUM',
        direction: 'CALL',
        optionSymbol: 'SPY250207C00600000',
        contracts: 5,
        premium: 3.50,
        estimatedCost: 1750,
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('INFO');
      expect(queue[0].extraData.contracts).toBe(5);
      expect(queue[0].extraData.premium).toBe(3.50);
      expect(queue[0].extraData.optionSymbol).toBe('SPY250207C00600000');
    });

    it('策略执行失败 ERROR 必入库', () => {
      logService.error('Strategy.Option', '[SPY.US策略执行失败]: Network timeout after 10000ms', {
        symbol: 'SPY.US',
        error: 'Network timeout after 10000ms',
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('ERROR');
    });
  });

  describe('阶段 3: 合约筛选', () => {
    it('期权日期/期权链 DEBUG 不入库', () => {
      logService.debug('Option.Chain', '[SPY.US期权日期] 可用日期=12个, 今日=2026-02-06');
      logService.debug('Option.Chain', '[SPY.US选择] 0DTE期权 | 到期=2026-02-06, 剩余=0天');
      logService.debug('Option.Chain', '[SPY.US期权链] CALL合约=45个, PUT合约=43个 | 行权价范围=[550-650]');
      expect(logService.getQueue().length).toBe(0);
    });

    it('0DTE不可用降级 WARN 入库', () => {
      logService.warn('Option.Chain', '[SPY.US降级] 0DTE不可用，使用最近期权 | 最近=2026-02-07, 剩余=1天');
      expect(logService.getQueue().length).toBe(1);
      expect(logService.getQueue()[0].level).toBe('WARNING');
    });

    it('Greeks 过滤 DEBUG 不入库', () => {
      logService.debug('Option.Chain', '[期权 OPT001] Delta=0.15 不在范围 [0.25, 0.60]，跳过');
      logService.debug('Option.Chain', '[期权 OPT002] 持仓量 50 < 100，跳过');
      logService.debug('Option.Chain', '[期权 OPT003] 价差 8.5% > 5%，跳过');
      expect(logService.getQueue().length).toBe(0);
    });

    it('筛选结果 INFO 入库', () => {
      logService.info('Option.Chain', '[SPY.US筛选后] 通过=3个 | 持仓量≥100, 价差≤5%, |Delta|∈[0.25, 0.60]', {
        symbol: 'SPY.US',
        passed: 3,
        minOI: 100,
        maxSpread: '5%',
        deltaRange: [0.25, 0.60],
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].extraData.passed).toBe(3);
    });

    it('无候选合约 WARN 入库', () => {
      logService.warn('Option.Chain', '[SPY.US无候选] 所有筛选后无合约剩余');
      expect(logService.getQueue().length).toBe(1);
    });
  });

  describe('阶段 4: 价格获取', () => {
    it('缓存/中间价 DEBUG 不入库', () => {
      logService.debug('Execution.Basic', 'SPY250207C00600000 使用缓存价格: 3.50');
      logService.debug('Execution.Basic', 'SPY250207C00600000 使用富途中间价: bid=3.40, ask=3.60, mid=3.50');
      logService.debug('Execution.Basic', 'SPY250207C00600000 富途API获取价格成功: 3.50 (source: futunn-mid)');
      expect(logService.getQueue().length).toBe(0);
    });

    it('价格获取失败 WARN 入库', () => {
      logService.warn('Execution.Basic', 'SPY250207C00600000 富途API获取期权价格失败: ETIMEDOUT', {
        symbol: 'SPY250207C00600000',
        error: 'ETIMEDOUT',
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('WARNING');
    });

    it('所有价格字段无效 WARN 入库', () => {
      logService.warn('Execution.Basic', 'SPY.US 所有价格字段均无效', {
        symbol: 'SPY.US',
        bid: null,
        ask: null,
        last: null,
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
    });
  });

  describe('阶段 5: 订单执行', () => {
    it('买入意图 INFO 入库，含完整参数', () => {
      logService.info('Execution.Basic', '策略option-intraday-001 执行买入意图: 标的=SPY250207C00600000, 数量=5, 买入价=3.50, 市场价格=3.52, 原因=MOMENTUM信号', {
        strategyId: 'option-intraday-001',
        symbol: 'SPY250207C00600000',
        quantity: 5,
        price: 3.50,
        marketPrice: 3.52,
        reason: 'MOMENTUM信号',
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('INFO');
      expect(queue[0].extraData.quantity).toBe(5);
      expect(queue[0].extraData.price).toBe(3.50);
    });

    it('价格验证失败 ERROR 必入库', () => {
      logService.error('Execution.Basic', '策略option-intraday-001 标的SPY250207C00600000: 价格验证失败 - 价格超出合理范围', {
        strategyId: 'option-intraday-001',
        symbol: 'SPY250207C00600000',
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('ERROR');
    });

    it('价格偏差 WARN 入库', () => {
      logService.warn('Execution.Basic', '策略option-intraday-001 标的SPY250207C00600000: 价格偏差较大: 3.50 vs 4.20 (偏差20.0%)', {
        strategyId: 'option-intraday-001',
        intendedPrice: 3.50,
        marketPrice: 4.20,
        deviation: 20.0,
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('WARNING');
      expect(queue[0].extraData.deviation).toBe(20.0);
    });

    it('订单提交成功 INFO 入库', () => {
      logService.info('Execution.Basic', '策略option-intraday-001 订单提交成功，订单ID: ORD-20260206-001', {
        strategyId: 'option-intraday-001',
        orderId: 'ORD-20260206-001',
        symbol: 'SPY250207C00600000',
        side: 'Buy',
        quantity: 5,
        price: 3.50,
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].extraData.orderId).toBe('ORD-20260206-001');
    });

    it('市价单被拒绝回退限价单 WARN 入库', () => {
      logService.warn('Execution.Basic', '策略option-intraday-001 标的SPY250207C00600000: 市价单被拒绝（流动性不足），fallback到极低价限价单');
      logService.info('Execution.Basic', '策略option-intraday-001 标的SPY250207C00600000: 使用极低价限价单 $0.01（原价 $3.50）', {
        fallbackPrice: 0.01,
        originalPrice: 3.50,
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(2);
      expect(queue[0].level).toBe('WARNING');
      expect(queue[1].level).toBe('INFO');
      expect(queue[1].extraData.fallbackPrice).toBe(0.01);
    });

    it('提交订单失败 ERROR 入库', () => {
      logService.error('Execution.Basic', '策略option-intraday-001 提交订单失败 (SPY250207C00600000): Insufficient buying power', {
        strategyId: 'option-intraday-001',
        symbol: 'SPY250207C00600000',
        error: 'Insufficient buying power',
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('ERROR');
    });
  });

  describe('阶段 6: 订单监控', () => {
    it('订单成交 INFO 入库', () => {
      logService.info('Strategy.Scheduler', '策略option-intraday-001 标的SPY250207C00600000 买入订单已成交，更新状态为HOLDING，订单ID: ORD-20260206-001', {
        strategyId: 'option-intraday-001',
        symbol: 'SPY250207C00600000',
        orderId: 'ORD-20260206-001',
        newState: 'HOLDING',
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].extraData.newState).toBe('HOLDING');
    });

    it('资金释放 INFO 入库', () => {
      logService.info('Strategy.Scheduler', '策略option-intraday-001 期权SPY250207C00600000: 资金释放 1750 USD（来自allocationAmount）', {
        released: 1750,
        source: 'allocationAmount',
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].extraData.released).toBe(1750);
    });

    it('订单取消 INFO 入库', () => {
      logService.info('Strategy.Scheduler', '策略option-intraday-001 标的SPY250207C00600000 订单已取消，已释放资金 1750，订单ID: ORD-20260206-001');

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
    });

    it('订单被拒绝 WARN 入库', () => {
      logService.warn('Strategy.Scheduler', '策略option-intraday-001 标的SPY250207C00600000 订单被拒绝，已释放资金 1750，订单ID: ORD-20260206-001', {
        orderId: 'ORD-20260206-001',
        released: 1750,
      });

      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('WARNING');
    });
  });

  // ============================================================
  // 测试 2: 节流机制 — 高频重复消息
  // ============================================================
  describe('节流机制验证', () => {
    it('高频价格获取日志被节流（同一模板只入队1次）', () => {
      // 模拟 200 次/分钟 的价格获取（不同数字但同模板）
      const symbols = ['SPY.US', 'QQQ.US', 'AAPL.US'];
      for (let i = 0; i < 50; i++) {
        for (const sym of symbols) {
          logService.info(
            'Execution.Basic',
            `${sym} 使用中间价: bid=${(5.2 + i * 0.01).toFixed(2)}, ask=${(5.3 + i * 0.01).toFixed(2)}`
          );
        }
      }

      const queue = logService.getQueue();
      // 3个 symbol × 1次 = 3 条（每个模板首次入队1条）
      // 节流模板: "Execution.Basic::_SYM_ 使用中间价: bid=_NUM_, ask=_NUM_"
      // 所有 symbol 会被替换为 _SYM_，所以只有 1 个模板 key -> 只有 1 条
      expect(queue.length).toBe(1);
    });

    it('不同模块的相同模板消息分别入队', () => {
      logService.info('ModuleA', '处理完成: 耗时 120ms, 记录 50 条');
      logService.info('ModuleB', '处理完成: 耗时 200ms, 记录 80 条');

      const queue = logService.getQueue();
      expect(queue.length).toBe(2);
    });

    it('ERROR 级别不被节流', () => {
      for (let i = 0; i < 10; i++) {
        logService.error('Execution.Basic', `订单提交失败 (SPY250207C00600000): Error code ${1000 + i}`);
      }

      const queue = logService.getQueue();
      expect(queue.length).toBe(10);
    });

    it('不同模板的 INFO 消息各自独立入队', () => {
      logService.info('Strategy.Scheduler', '策略执行完成: 耗时120ms, 扫描3个标的');
      logService.info('Strategy.Scheduler', '策略option-intraday-001 订单提交成功，订单ID: ORD-001');
      logService.info('Strategy.Scheduler', '策略option-intraday-001 标的SPY 买入订单已成交');

      const queue = logService.getQueue();
      expect(queue.length).toBe(3);
    });

    it('WARN 级别也被节流', () => {
      for (let i = 0; i < 20; i++) {
        logService.warn('Execution.Basic', `SPY250207C00600000 富途API获取期权价格失败: timeout ${i}ms`);
      }

      const queue = logService.getQueue();
      // 同一模板，只入队 1 条
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('WARNING');
    });
  });

  // ============================================================
  // 测试 3: 摘要聚合 — metric 数据点
  // ============================================================
  describe('摘要聚合验证', () => {
    let logDigestService: any;
    let mockLogService: any;

    beforeEach(() => {
      jest.resetModules();
      mockLogService = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        getQueue: jest.fn().mockReturnValue([]),
        stop: jest.fn(),
      };
      jest.mock('../services/log.service', () => ({
        __esModule: true,
        default: mockLogService,
      }));
      jest.mock('../config/database', () => ({
        __esModule: true,
        default: {
          query: jest.fn().mockResolvedValue({ rows: [] }),
          on: jest.fn(),
          end: jest.fn(),
        },
      }));
      logDigestService = require('../services/log-digest.service').default;
    });

    afterEach(() => {
      logDigestService?.stop();
    });

    it('价格获取指标聚合正确', () => {
      // 模拟 price_fetch 指标
      const prices = [3.50, 3.52, 3.48, 3.55, 3.45, 3.60, 3.40, 3.51, 3.49, 3.53];
      for (const p of prices) {
        logDigestService.record('price_fetch', p, { symbol: 'SPY250207C00600000', source: 'futunn' });
      }

      logDigestService.stop();

      expect(mockLogService.info).toHaveBeenCalledTimes(1);
      const [module, message, extraData] = mockLogService.info.mock.calls[0];

      expect(module).toBe('Log.Digest');
      expect(message).toContain('[摘要] price_fetch');
      expect(message).toContain('count=10');

      expect(extraData.digest).toBe(true);
      expect(extraData.metricName).toBe('price_fetch');
      expect(extraData.count).toBe(10);
      expect(extraData.min).toBeCloseTo(3.40, 2);
      expect(extraData.max).toBeCloseTo(3.60, 2);
      expect(extraData.avg).toBeCloseTo(3.503, 1);
      expect(extraData.labels.symbol['SPY250207C00600000']).toBe(10);
      expect(extraData.labels.source['futunn']).toBe(10);
    });

    it('合约筛选指标聚合正确', () => {
      // 模拟 contract_filter 指标
      logDigestService.record('contract_filter', 45, { symbol: 'SPY.US' }); // 候选数
      logDigestService.record('contract_filter', 12, { symbol: 'SPY.US' }); // 过滤后
      logDigestService.record('contract_filter', 38, { symbol: 'QQQ.US' });
      logDigestService.record('contract_filter', 8, { symbol: 'QQQ.US' });

      logDigestService.stop();

      const [, , extraData] = mockLogService.info.mock.calls[0];
      expect(extraData.count).toBe(4);
      expect(extraData.min).toBeCloseTo(8, 0);
      expect(extraData.max).toBeCloseTo(45, 0);
      expect(extraData.labels.symbol['SPY.US']).toBe(2);
      expect(extraData.labels.symbol['QQQ.US']).toBe(2);
    });

    it('信号评估指标聚合正确', () => {
      // 模拟 signal_evaluation 指标
      logDigestService.record('signal_evaluation', 1, { action: 'BUY_CALL', symbol: 'SPY.US' });
      logDigestService.record('signal_evaluation', 1, { action: 'BUY_PUT', symbol: 'QQQ.US' });
      logDigestService.record('signal_evaluation', 0, { action: 'HOLD', symbol: 'AAPL.US' });
      logDigestService.record('signal_evaluation', 0, { action: 'HOLD', symbol: 'MSFT.US' });
      logDigestService.record('signal_evaluation', 0, { action: 'HOLD', symbol: 'TSLA.US' });

      logDigestService.stop();

      const [, message, extraData] = mockLogService.info.mock.calls[0];
      expect(message).toContain('count=5');
      expect(extraData.labels.action['HOLD']).toBe(3);
      expect(extraData.labels.action['BUY_CALL']).toBe(1);
      expect(extraData.labels.action['BUY_PUT']).toBe(1);
    });

    it('多种指标分别聚合', () => {
      logDigestService.record('price_fetch', 3.50, { symbol: 'SPY.US' });
      logDigestService.record('contract_filter', 45, { symbol: 'SPY.US' });
      logDigestService.record('market_data_fetch', 120, { status: 'success' });

      logDigestService.stop();

      expect(mockLogService.info).toHaveBeenCalledTimes(3);
      const names = mockLogService.info.mock.calls.map((c: any[]) => c[2].metricName);
      expect(names).toContain('price_fetch');
      expect(names).toContain('contract_filter');
      expect(names).toContain('market_data_fetch');
    });
  });

  // ============================================================
  // 测试 4: DB 写入数据完整性验证
  // ============================================================
  describe('DB 写入数据完整性', () => {
    let localLogService: any;

    beforeEach(() => {
      jest.resetModules();
      // 必须 unmock log.service —— 前面 Digest 区块把它替换成了 fake 对象
      jest.unmock('../services/log.service');
      jest.mock('../config/database', () => ({
        __esModule: true,
        default: { query: jest.fn().mockResolvedValue({ rows: [] }), on: jest.fn(), end: jest.fn() },
      }));
      jest.mock('../utils/trace-context', () => ({
        __esModule: true,
        default: { getTraceId: jest.fn().mockReturnValue('trace-sim-001'), generateTraceId: jest.fn().mockReturnValue('trace-gen-001') },
      }));
      localLogService = require('../services/log.service').default;
    });

    afterEach(() => {
      localLogService?.stop();
    });

    it('LogEntry 字段完整（timestamp, level, module, message, traceId, extraData）', () => {
      // 确认 logService 是新实例
      expect(localLogService.getQueue().length).toBe(0);

      localLogService.info('Strategy.Option', '[SPY.US/MOMENTUM] CALL SPY250207C00600000', {
        contracts: 5,
        premium: 3.50,
      });

      const queue = localLogService.getQueue();
      // INFO should enter queue
      expect(queue.length).toBeGreaterThanOrEqual(1);

      const entry = queue[0];
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.level).toBe('INFO');
      expect(entry.module).toBe('Strategy.Option');
      expect(entry.message).toBe('[SPY.US/MOMENTUM] CALL SPY250207C00600000');
      expect(entry.traceId).toBeDefined();
      expect(entry.extraData).toEqual({ contracts: 5, premium: 3.50 });
    });

    it('ERROR 条目的 extraData 包含错误详情', () => {
      localLogService.error('Execution.Basic', '提交订单失败: Insufficient buying power', {
        symbol: 'SPY250207C00600000',
        error: 'Insufficient buying power',
        side: 'Buy',
        quantity: 5,
      });

      const queue = localLogService.getQueue();
      expect(queue.length).toBeGreaterThanOrEqual(1);
      const entry = queue[queue.length - 1]; // ERROR always enters, take the last
      expect(entry.level).toBe('ERROR');
      expect(entry.extraData.error).toBe('Insufficient buying power');
      expect(entry.extraData.side).toBe('Buy');
      expect(entry.extraData.quantity).toBe(5);
    });

    it('节流汇总条目格式正确', () => {
      // 写入多条相同模板消息，然后 stop 触发汇总
      for (let i = 0; i < 10; i++) {
        localLogService.info('MarketData', `获取SPY.US行情成功: price=${(600 + i * 0.1).toFixed(2)}`);
      }

      // stop 触发 flushAllThrottled
      localLogService.stop();

      const queue = localLogService.getQueue();
      // 第 1 条是原始消息，最后还应有 1 条汇总
      const summaryEntry = queue.find((e: any) => e.message.includes('[节流]'));
      expect(summaryEntry).toBeDefined();
      expect(summaryEntry.message).toContain('重复');
      expect(summaryEntry.message).toContain('次');
      expect(summaryEntry.extraData.throttled).toBe(true);
      expect(summaryEntry.extraData.repeatCount).toBe(10);
      expect(summaryEntry.extraData.windowSeconds).toBe(30);
    });
  });

  // ============================================================
  // 测试 5: 完整周期端到端模拟
  // ============================================================
  describe('完整期权交易周期 — 端到端', () => {
    let localLogService: any;

    beforeEach(() => {
      jest.resetModules();
      // 必须 unmock log.service —— 前面 Digest 区块把它替换成了 fake 对象
      jest.unmock('../services/log.service');
      jest.mock('../config/database', () => ({
        __esModule: true,
        default: { query: jest.fn().mockResolvedValue({ rows: [] }), on: jest.fn(), end: jest.fn() },
      }));
      jest.mock('../utils/trace-context', () => ({
        __esModule: true,
        default: { getTraceId: jest.fn().mockReturnValue('trace-sim-001'), generateTraceId: jest.fn().mockReturnValue('trace-gen-001') },
      }));
      localLogService = require('../services/log.service').default;
    });

    afterEach(() => {
      localLogService?.stop();
    });

    it('一个成功的期权交易周期，DB 队列只包含关键业务事件', () => {
      // --- 阶段1: 策略调度 ---
      localLogService.debug('Strategy.Scheduler', '开始执行策略周期');
      // -> 不入库

      // --- 阶段2: 信号评估 ---
      localLogService.debug('Strategy.Option', '[SPY.US] 评估期权推荐: CALL, confidence=0.75');
      localLogService.debug('Strategy.Option', '[SPY.US] 策略MOMENTUM条件满足');
      // -> 不入库

      // --- 阶段3: 合约筛选 ---
      localLogService.debug('Option.Chain', '[SPY.US期权链] CALL合约=45个');
      localLogService.debug('Option.Chain', '[期权 OPT001] Delta=0.35, 通过');
      localLogService.debug('Option.Chain', '[期权 OPT002] Delta=0.15, 跳过');
      localLogService.info('Option.Chain', '[SPY.US筛选后] 通过=3个', { passed: 3 });
      // -> 1条入库 (筛选结果)

      // --- 阶段4: 价格获取 ---
      localLogService.debug('Execution.Basic', 'SPY250207C00600000 富途API获取价格: 3.50');
      // -> 不入库

      // --- 阶段5: 信号生成 ---
      localLogService.info('Strategy.Option', '[SPY.US/MOMENTUM] CALL SPY250207C00600000 | 合约=5, 权利金=$3.50', {
        contracts: 5,
        premium: 3.50,
      });
      // -> 1条入库 (信号)

      // --- 阶段6: 订单提交 ---
      localLogService.info('Execution.Basic', '策略option-001 执行买入: SPY250207C00600000, 数量=5, 价格=3.50', {
        quantity: 5,
        price: 3.50,
      });
      localLogService.info('Execution.Basic', '策略option-001 订单提交成功，订单ID: ORD-001', {
        orderId: 'ORD-001',
      });
      // -> 2条入库 (买入意图 + 订单成功)

      // --- 阶段7: 订单成交 ---
      localLogService.info('Strategy.Scheduler', '策略option-001 标的SPY250207C00600000 买入订单已成交', {
        orderId: 'ORD-001',
        newState: 'HOLDING',
      });
      // -> 1条入库 (成交)

      // --- 策略执行完成 ---
      localLogService.info('Strategy.Scheduler', '策略执行完成: 耗时250ms, 扫描3个标的, 信号1, 操作1', {
        duration: 250,
        scanned: 3,
        signals: 1,
        actions: 1,
      });
      // -> 1条入库 (周期统计)

      const queue = localLogService.getQueue();
      // 应该有 6 条 INFO 在队列中，0 条 DEBUG
      const infoEntries = queue.filter((e: any) => e.level === 'INFO');
      const debugEntries = queue.filter((e: any) => e.level === 'DEBUG');

      expect(debugEntries.length).toBe(0);
      expect(infoEntries.length).toBe(6);

      // 验证关键事件顺序
      expect(infoEntries[0].message).toContain('筛选后');
      expect(infoEntries[1].message).toContain('MOMENTUM');
      expect(infoEntries[2].message).toContain('执行买入');
      expect(infoEntries[3].message).toContain('订单提交成功');
      expect(infoEntries[4].message).toContain('订单已成交');
      expect(infoEntries[5].message).toContain('策略执行完成');
    });

    it('一个失败的期权交易周期，ERROR/WARN 全部入库', () => {
      // 策略评估 - DEBUG 不入库
      localLogService.debug('Strategy.Option', '[SPY.US] 评估期权推荐');

      // 风险警告 - WARN 入库
      localLogService.warn('Strategy.Option', '[SPY.US] 风险等级HIGH，降低仓位');

      // 合约筛选无结果 - WARN 入库
      localLogService.warn('Option.Chain', '[SPY.US无候选] 所有筛选后无合约剩余');

      // 策略执行错误 - ERROR 入库
      localLogService.error('Strategy.Option', '[SPY.US策略执行失败]: No valid contracts available');

      const queue = localLogService.getQueue();
      expect(queue.length).toBe(3); // 1 WARN + 1 WARN + 1 ERROR
      expect(queue.filter((e: any) => e.level === 'WARNING').length).toBe(2);
      expect(queue.filter((e: any) => e.level === 'ERROR').length).toBe(1);
      expect(queue.filter((e: any) => e.level === 'DEBUG').length).toBe(0);
    });
  });
});
