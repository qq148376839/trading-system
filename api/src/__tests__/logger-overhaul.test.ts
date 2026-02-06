/**
 * 日志系统重构测试
 * 测试级别门控、节流、摘要、向后兼容性
 */

// Mock dependencies before importing modules
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
    getTraceId: jest.fn().mockReturnValue('test-trace-id'),
    generateTraceId: jest.fn().mockReturnValue('generated-trace-id'),
  },
}));

// We need to test log.service.ts internals, so import after mocks
describe('日志系统重构', () => {
  // ======================== LogService 节流测试 ========================
  describe('LogService - 节流机制', () => {
    let LogServiceClass: any;
    let logService: any;

    beforeEach(() => {
      jest.resetModules();
      // Re-mock after resetModules
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
          getTraceId: jest.fn().mockReturnValue('test-trace-id'),
          generateTraceId: jest.fn().mockReturnValue('generated-trace-id'),
        },
      }));

      // Import fresh instance
      const module = require('../services/log.service');
      logService = module.default;
    });

    afterEach(() => {
      if (logService && logService.stop) {
        logService.stop();
      }
    });

    it('DEBUG 日志默认不入队列', () => {
      logService.debug('TestModule', '这是一条调试日志');
      const queue = logService.getQueue();
      expect(queue.length).toBe(0);
    });

    it('INFO 日志入队列', () => {
      logService.info('TestModule', '这是一条信息日志');
      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('INFO');
      expect(queue[0].message).toBe('这是一条信息日志');
    });

    it('WARN 日志入队列', () => {
      logService.warn('TestModule', '这是一条警告日志');
      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('WARNING');
    });

    it('ERROR 日志入队列', () => {
      logService.error('TestModule', '这是一条错误日志');
      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].level).toBe('ERROR');
    });

    it('ERROR 日志不被节流', () => {
      // 同一条 ERROR 消息发送多次，全部应入队
      for (let i = 0; i < 5; i++) {
        logService.error('TestModule', '重复的错误消息');
      }
      const queue = logService.getQueue();
      expect(queue.length).toBe(5);
    });

    it('INFO 日志被节流 - 相同消息只入队一次', () => {
      // 发送相同模板的消息多次（数字不同但模板相同）
      for (let i = 0; i < 10; i++) {
        logService.info('TestModule', `SPY.US 使用中间价: bid=${(5.2 + i * 0.01).toFixed(2)}, ask=${(5.3 + i * 0.01).toFixed(2)}`);
      }
      const queue = logService.getQueue();
      // 只有第一条入队（节流窗口内）
      expect(queue.length).toBe(1);
      expect(queue[0].message).toContain('SPY.US');
    });

    it('WARN 日志被节流', () => {
      for (let i = 0; i < 5; i++) {
        logService.warn('TestModule', `警告: 价格 ${100 + i} 超出范围`);
      }
      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
    });

    it('不同模块的相同消息不互相节流', () => {
      logService.info('ModuleA', '操作完成: 成功处理 100 条记录');
      logService.info('ModuleB', '操作完成: 成功处理 100 条记录');
      const queue = logService.getQueue();
      expect(queue.length).toBe(2);
    });

    it('不同模板的消息不互相节流', () => {
      logService.info('TestModule', '价格更新: 100.50');
      logService.info('TestModule', '订单提交: 数量 10');
      const queue = logService.getQueue();
      expect(queue.length).toBe(2);
    });

    it('extraData 正确传递', () => {
      logService.info('TestModule', '测试消息', { key: 'value', count: 42 });
      const queue = logService.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].extraData).toEqual({ key: 'value', count: 42 });
    });
  });

  // ======================== Logger 级别门控测试 ========================
  describe('Logger - 级别门控与选项提取', () => {
    let logger: any;
    let mockLogService: any;

    beforeEach(() => {
      jest.resetModules();
      // Mock logService
      mockLogService = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
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

      // Spy on console methods
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'info').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'debug').mockImplementation(() => {});

      const loggerModule = require('../utils/logger');
      logger = loggerModule.logger;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('logger.debug() 输出到控制台', () => {
      logger.debug('调试消息');
      expect(console.debug).toHaveBeenCalled();
    });

    it('logger.debug() 调用 logService.debug()（由 logService 内部门控）', () => {
      logger.debug('调试消息');
      expect(mockLogService.debug).toHaveBeenCalled();
    });

    it('logger.info() 调用 logService.info()', () => {
      logger.info('信息消息');
      expect(console.info).toHaveBeenCalled();
      expect(mockLogService.info).toHaveBeenCalled();
    });

    it('logger.info() 使用 dbWrite:false 跳过入库', () => {
      logger.info('不入库的消息', { dbWrite: false });
      expect(console.info).toHaveBeenCalled();
      expect(mockLogService.info).not.toHaveBeenCalled();
    });

    it('logger.info() 带普通对象参数不影响入库', () => {
      logger.info('普通消息', { key: 'value' });
      expect(mockLogService.info).toHaveBeenCalled();
    });

    it('logger.info() 带 dbWrite:false 和其他属性，其他属性保留', () => {
      logger.info('混合消息', { key: 'value', dbWrite: false });
      expect(console.info).toHaveBeenCalled();
      // dbWrite:false 导致不调用 logService
      expect(mockLogService.info).not.toHaveBeenCalled();
    });

    it('logger.warn() 调用 logService.warn()', () => {
      logger.warn('警告消息');
      expect(console.warn).toHaveBeenCalled();
      expect(mockLogService.warn).toHaveBeenCalled();
    });

    it('logger.error() 调用 logService.error()', () => {
      logger.error('错误消息');
      expect(console.error).toHaveBeenCalled();
      expect(mockLogService.error).toHaveBeenCalled();
    });

    it('logger.console() 仅输出到控制台', () => {
      logger.console('纯控制台消息');
      expect(console.log).toHaveBeenCalled();
      expect(mockLogService.info).not.toHaveBeenCalled();
      expect(mockLogService.debug).not.toHaveBeenCalled();
    });

    it('logger.log() 使用 dbWrite:false 跳过入库', () => {
      logger.log('不入库的log', { dbWrite: false });
      expect(console.log).toHaveBeenCalled();
      expect(mockLogService.info).not.toHaveBeenCalled();
    });
  });

  // ======================== LogDigestService 测试 ========================
  describe('LogDigestService - 摘要聚合', () => {
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

      const digestModule = require('../services/log-digest.service');
      logDigestService = digestModule.default;
    });

    afterEach(() => {
      if (logDigestService && logDigestService.stop) {
        logDigestService.stop();
      }
    });

    it('record() 注册数据点后 stop() 触发 flush', () => {
      logDigestService.record('test_metric', 10.5, { symbol: 'AAPL.US' });
      logDigestService.record('test_metric', 20.3, { symbol: 'AAPL.US' });
      logDigestService.record('test_metric', 15.0, { symbol: 'SPY.US' });

      // stop() 会触发 flush
      logDigestService.stop();

      expect(mockLogService.info).toHaveBeenCalled();
      const call = mockLogService.info.mock.calls[0];
      expect(call[0]).toBe('Log.Digest');
      expect(call[1]).toContain('[摘要] test_metric');
      expect(call[1]).toContain('count=3');

      const extraData = call[2];
      expect(extraData.digest).toBe(true);
      expect(extraData.metricName).toBe('test_metric');
      expect(extraData.count).toBe(3);
      expect(extraData.min).toBeCloseTo(10.5, 1);
      expect(extraData.max).toBeCloseTo(20.3, 1);
      expect(extraData.avg).toBeCloseTo(15.2667, 1);
      expect(extraData.labels.symbol['AAPL.US']).toBe(2);
      expect(extraData.labels.symbol['SPY.US']).toBe(1);
    });

    it('不同指标名分别聚合', () => {
      logDigestService.record('metric_a', 10);
      logDigestService.record('metric_b', 20);

      logDigestService.stop();

      // 应该有两次 info 调用（两个指标各一条摘要）
      expect(mockLogService.info).toHaveBeenCalledTimes(2);

      const calls = mockLogService.info.mock.calls;
      const names = calls.map((c: any[]) => c[2]?.metricName);
      expect(names).toContain('metric_a');
      expect(names).toContain('metric_b');
    });

    it('无数据时不产生日志', () => {
      logDigestService.stop();
      expect(mockLogService.info).not.toHaveBeenCalled();
    });

    it('flush 后清空数据，第二次不产生日志', () => {
      logDigestService.record('test', 1);
      logDigestService.stop();

      expect(mockLogService.info).toHaveBeenCalledTimes(1);
      mockLogService.info.mockClear();

      // 第二次 stop 不应再写日志（已清空）
      logDigestService.stop();
      expect(mockLogService.info).not.toHaveBeenCalled();
    });
  });

  // ======================== 向后兼容测试 ========================
  describe('向后兼容性', () => {
    let logger: any;
    let mockLogService: any;

    beforeEach(() => {
      jest.resetModules();
      mockLogService = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
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

      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'info').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'debug').mockImplementation(() => {});

      const loggerModule = require('../utils/logger');
      logger = loggerModule.logger;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('logger.info("msg", { key: "value" }) 向后兼容', () => {
      // 现有调用方式不受影响 — { key: 'value' } 不含 dbWrite
      logger.info('测试', { key: 'value' });
      expect(mockLogService.info).toHaveBeenCalled();
    });

    it('logger.log("msg") 向后兼容', () => {
      logger.log('简单消息');
      expect(console.log).toHaveBeenCalled();
      expect(mockLogService.info).toHaveBeenCalled();
    });

    it('logger.error("msg", error) 向后兼容', () => {
      const err = new Error('test error');
      logger.error('出错了', err);
      expect(console.error).toHaveBeenCalled();
      expect(mockLogService.error).toHaveBeenCalled();
    });

    it('无参数调用不崩溃', () => {
      expect(() => logger.log()).not.toThrow();
      expect(() => logger.info()).not.toThrow();
      expect(() => logger.warn()).not.toThrow();
      expect(() => logger.error()).not.toThrow();
      expect(() => logger.debug()).not.toThrow();
      expect(() => logger.console()).not.toThrow();
    });
  });

  // ======================== infraLogger 测试 ========================
  describe('infraLogger', () => {
    let infraLogger: any;

    beforeEach(() => {
      jest.resetModules();
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'debug').mockImplementation(() => {});

      const module = require('../utils/infra-logger');
      infraLogger = module.infraLogger;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('info 输出到 console.log', () => {
      infraLogger.info('测试信息');
      expect(console.log).toHaveBeenCalled();
      const msg = (console.log as jest.Mock).mock.calls[0][0];
      expect(msg).toContain('[INFRA]');
      expect(msg).toContain('测试信息');
    });

    it('warn 输出到 console.warn', () => {
      infraLogger.warn('测试警告');
      expect(console.warn).toHaveBeenCalled();
      const msg = (console.warn as jest.Mock).mock.calls[0][0];
      expect(msg).toContain('[INFRA]');
    });

    it('error 输出到 console.error', () => {
      infraLogger.error('测试错误');
      expect(console.error).toHaveBeenCalled();
    });

    it('debug 输出到 console.debug', () => {
      infraLogger.debug('测试调试');
      expect(console.debug).toHaveBeenCalled();
    });

    it('输出包含时间戳格式', () => {
      infraLogger.info('时间戳测试');
      const msg = (console.log as jest.Mock).mock.calls[0][0];
      // 时间戳格式: [YYYY-MM-DD HH:MM:SS.mmm]
      expect(msg).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });
  });
});
