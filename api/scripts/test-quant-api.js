/**
 * 量化交易 API 测试工具
 * 用于测试 Phase 1 的所有量化交易 API 端点
 */

const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3001';
const API_PREFIX = '/api/quant';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ ${message}`, 'cyan');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

// 测试结果统计
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
};

// 测试辅助函数
async function testAPI(name, method, url, data = null, expectedStatus = 200) {
  try {
    logInfo(`Testing: ${name}`);
    const config = {
      method,
      url: `${BASE_URL}${url}`,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);

    if (response.status === expectedStatus) {
      logSuccess(`${name} - Status: ${response.status}`);
      results.passed++;
      return { success: true, data: response.data };
    } else {
      logError(`${name} - Expected status ${expectedStatus}, got ${response.status}`);
      results.failed++;
      return { success: false, error: `Status mismatch: ${response.status}` };
    }
  } catch (error) {
    if (error.response) {
      if (error.response.status === expectedStatus) {
        logSuccess(`${name} - Status: ${error.response.status} (expected error)`);
        results.passed++;
        return { success: true, data: error.response.data };
      } else {
        logError(`${name} - Status: ${error.response.status}, Message: ${error.response.data?.error?.message || error.message}`);
        results.failed++;
        return { success: false, error: error.response.data };
      }
    } else {
      logError(`${name} - Network error: ${error.message}`);
      results.failed++;
      return { success: false, error: error.message };
    }
  }
}

// 测试用例
async function runTests() {
  log('\n=== 量化交易 API 测试工具 ===\n', 'blue');
  log(`Base URL: ${BASE_URL}\n`, 'cyan');

  // ==================== 资金管理 API ====================
  log('\n--- 资金管理 API ---\n', 'yellow');

  // 1. 获取资金分配列表
  await testAPI('GET /capital/allocations', 'GET', `${API_PREFIX}/capital/allocations`);

  // 2. 创建资金分配账户
  const createAllocationResult = await testAPI(
    'POST /capital/allocations',
    'POST',
    `${API_PREFIX}/capital/allocations`,
    {
      name: 'TEST_STRATEGY_A',
      parentId: null,
      allocationType: 'PERCENTAGE',
      allocationValue: 0.3,
    }
  );

  let allocationId = null;
  if (createAllocationResult.success && createAllocationResult.data?.data?.id) {
    allocationId = createAllocationResult.data.data.id;
    logInfo(`Created allocation ID: ${allocationId}`);
  }

  // 3. 获取资金使用情况
  await testAPI('GET /capital/usage', 'GET', `${API_PREFIX}/capital/usage`);

  // 4. 手动触发余额同步
  await testAPI('POST /capital/sync-balance', 'POST', `${API_PREFIX}/capital/sync-balance`);

  // 5. 查询余额差异
  await testAPI('GET /capital/balance-discrepancies', 'GET', `${API_PREFIX}/capital/balance-discrepancies`);

  // ==================== 选股器 API ====================
  log('\n--- 选股器 API ---\n', 'yellow');

  // 1. 获取黑名单列表
  await testAPI('GET /stock-selector/blacklist', 'GET', `${API_PREFIX}/stock-selector/blacklist`);

  // 2. 添加股票到黑名单
  await testAPI(
    'POST /stock-selector/blacklist',
    'POST',
    `${API_PREFIX}/stock-selector/blacklist`,
    {
      symbol: 'TEST.US',
      reason: 'Test blacklist entry',
    }
  );

  // 3. 从黑名单移除股票
  await testAPI('DELETE /stock-selector/blacklist/TEST.US', 'DELETE', `${API_PREFIX}/stock-selector/blacklist/TEST.US`);

  // ==================== 策略管理 API ====================
  log('\n--- 策略管理 API ---\n', 'yellow');

  // 1. 获取策略列表
  await testAPI('GET /strategies', 'GET', `${API_PREFIX}/strategies`);

  // 2. 创建策略
  const createStrategyResult = await testAPI(
    'POST /strategies',
    'POST',
    `${API_PREFIX}/strategies`,
    {
      name: 'Test Recommendation Strategy',
      type: 'RECOMMENDATION_V1',
      capitalAllocationId: allocationId,
      symbolPoolConfig: {
        mode: 'STATIC',
        symbols: ['AAPL.US', 'MSFT.US'],
      },
      config: {
        atrPeriod: 14,
        atrMultiplier: 2.0,
        riskRewardRatio: 1.5,
      },
    }
  );

  let strategyId = null;
  if (createStrategyResult.success && createStrategyResult.data?.data?.id) {
    strategyId = createStrategyResult.data.data.id;
    logInfo(`Created strategy ID: ${strategyId}`);
  }

  // 3. 获取策略详情
  if (strategyId) {
    await testAPI('GET /strategies/:id', 'GET', `${API_PREFIX}/strategies/${strategyId}`);
  }

  // 4. 启动策略（可选，需要谨慎）
  if (strategyId && process.env.TEST_START_STRATEGY === 'true') {
    logWarning('Starting strategy (TEST_START_STRATEGY=true)...');
    await testAPI('POST /strategies/:id/start', 'POST', `${API_PREFIX}/strategies/${strategyId}/start`);
  } else {
    logInfo('Skipping strategy start (set TEST_START_STRATEGY=true to enable)');
    results.skipped++;
  }

  // 5. 获取策略实例状态
  if (strategyId) {
    await testAPI('GET /strategies/:id/instances', 'GET', `${API_PREFIX}/strategies/${strategyId}/instances`);
  }

  // 6. 停止策略
  if (strategyId && process.env.TEST_START_STRATEGY === 'true') {
    await testAPI('POST /strategies/:id/stop', 'POST', `${API_PREFIX}/strategies/${strategyId}/stop`);
  }

  // ==================== 信号日志 API ====================
  log('\n--- 信号日志 API ---\n', 'yellow');

  // 1. 获取信号日志
  await testAPI('GET /signals', 'GET', `${API_PREFIX}/signals?limit=10`);

  // 2. 按策略ID获取信号
  if (strategyId) {
    await testAPI('GET /signals?strategyId=:id', 'GET', `${API_PREFIX}/signals?strategyId=${strategyId}&limit=10`);
  }

  // ==================== 交易记录 API ====================
  log('\n--- 交易记录 API ---\n', 'yellow');

  // 1. 获取交易记录
  await testAPI('GET /trades', 'GET', `${API_PREFIX}/trades?limit=10`);

  // 2. 按策略ID获取交易记录
  if (strategyId) {
    await testAPI('GET /trades?strategyId=:id', 'GET', `${API_PREFIX}/trades?strategyId=${strategyId}&limit=10`);
  }

  // ==================== 测试总结 ====================
  log('\n=== 测试总结 ===\n', 'blue');
  logSuccess(`通过: ${results.passed}`);
  logError(`失败: ${results.failed}`);
  logWarning(`跳过: ${results.skipped}`);
  logInfo(`总计: ${results.passed + results.failed + results.skipped}`);

  if (results.failed === 0) {
    log('\n✓ 所有测试通过！\n', 'green');
    process.exit(0);
  } else {
    log('\n✗ 部分测试失败\n', 'red');
    process.exit(1);
  }
}

// 运行测试
runTests().catch((error) => {
  logError(`测试执行失败: ${error.message}`);
  console.error(error);
  process.exit(1);
});

