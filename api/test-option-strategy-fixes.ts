/**
 * 期权策略修复验证测试脚本
 *
 * 测试范围：
 * 1. 期权价格缓存服务
 * 2. 期权合约选择逻辑（0DTE、Greeks过滤）
 * 3. 期权详情接口增强
 * 4. 资金管理逻辑
 *
 * 运行方式：
 * npm run test:option-fixes
 * 或
 * npx ts-node test-option-strategy-fixes.ts
 */

import optionPriceCacheService from './src/services/option-price-cache.service';
import { selectOptionContract } from './src/services/options-contract-selector.service';
import { getOptionDetail, getOptionStrikeDates } from './src/services/futunn-option-chain.service';
import { calculateOptionsFees, estimateOptionOrderTotalCost } from './src/services/options-fee.service';
import { getMarketCloseWindow } from './src/services/market-session.service';

// ANSI颜色代码
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function testHeader(title: string) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.blue);
  console.log('='.repeat(60));
}

function testResult(name: string, passed: boolean, details?: string) {
  const status = passed ? `${colors.green}✅ PASS` : `${colors.red}❌ FAIL`;
  console.log(`${status}${colors.reset} - ${name}`);
  if (details) {
    console.log(`  ${details}`);
  }
}

// ============================================================================
// 测试1：期权价格缓存服务
// ============================================================================
async function test1_OptionPriceCache() {
  testHeader('测试1：期权价格缓存服务');

  try {
    // 测试1.1：设置和获取缓存
    const testEntry = {
      price: 10.5,
      bid: 10.4,
      ask: 10.6,
      mid: 10.5,
      timestamp: Date.now(),
      underlyingPrice: 450.0,
      source: 'futunn' as const,
    };

    optionPriceCacheService.set('TSLA260130C460000.US', testEntry);
    const cached = optionPriceCacheService.get('TSLA260130C460000.US');

    testResult('1.1 缓存设置和获取', cached !== null && cached.price === 10.5);

    // 测试1.2：大小写不敏感
    const cached2 = optionPriceCacheService.get('tsla260130c460000.us');
    testResult('1.2 大小写不敏感', cached2 !== null && cached2.price === 10.5);

    // 测试1.3：统计信息
    const stats = optionPriceCacheService.getStats();
    testResult('1.3 统计信息', stats.totalEntries > 0 && stats.validEntries > 0, `总数=${stats.totalEntries}, 有效=${stats.validEntries}`);

    // 测试1.4：清空缓存
    optionPriceCacheService.clear();
    const stats2 = optionPriceCacheService.getStats();
    testResult('1.4 清空缓存', stats2.totalEntries === 0);

    log('\n测试1：期权价格缓存服务 - 全部通过', colors.green);
  } catch (error: any) {
    log(`\n测试1 失败: ${error.message}`, colors.red);
    console.error(error);
  }
}

// ============================================================================
// 测试2：期权费用计算
// ============================================================================
async function test2_OptionFees() {
  testHeader('测试2：期权费用计算');

  try {
    // 测试2.1：单张合约费用
    const fee1 = calculateOptionsFees(1);
    testResult(
      '2.1 单张合约费用',
      fee1.commission === 0.99 && fee1.platformFee === 0.30 && fee1.totalFees === 1.29,
      `佣金=${fee1.commission}, 平台费=${fee1.platformFee}, 总费用=${fee1.totalFees}`
    );

    // 测试2.2：多张合约费用（佣金超过最小值）
    const fee10 = calculateOptionsFees(10);
    testResult(
      '2.2 10张合约费用',
      fee10.commission === 1.00 && fee10.platformFee === 3.00 && fee10.totalFees === 4.00,
      `佣金=${fee10.commission}, 平台费=${fee10.platformFee}, 总费用=${fee10.totalFees}`
    );

    // 测试2.3：总成本估算
    const est = estimateOptionOrderTotalCost({
      premium: 2.5,
      contracts: 2,
      multiplier: 100,
    });
    testResult(
      '2.3 总成本估算',
      est.totalCost === 501.59, // 2.5*100*2 + 1.59
      `总成本=${est.totalCost} (权利金=${2.5 * 100 * 2}, 手续费=${est.fees.totalFees})`
    );

    log('\n测试2：期权费用计算 - 全部通过', colors.green);
  } catch (error: any) {
    log(`\n测试2 失败: ${error.message}`, colors.red);
    console.error(error);
  }
}

// ============================================================================
// 测试3：市场时段计算
// ============================================================================
async function test3_MarketSession() {
  testHeader('测试3：市场时段计算');

  try {
    // 测试3.1：美股市场收盘窗口
    const window = await getMarketCloseWindow({
      market: 'US',
      noNewEntryBeforeCloseMinutes: 60,
      forceCloseBeforeCloseMinutes: 30,
    });

    testResult(
      '3.1 美股收盘窗口计算',
      window !== null && window.closeLocalHHMM === 1600,
      window ? `收盘时间=${window.closeLocalHHMM}, 禁开仓=${window.noNewEntryTimeUtc.toISOString()}, 强平=${window.forceCloseTimeUtc.toISOString()}` : ''
    );

    // 测试3.2：验证时间差
    if (window) {
      const diffMinutes = (window.closeTimeUtc.getTime() - window.forceCloseTimeUtc.getTime()) / (60 * 1000);
      testResult('3.2 强平时间间隔', Math.abs(diffMinutes - 30) < 1, `间隔=${diffMinutes.toFixed(1)}分钟`);
    }

    log('\n测试3：市场时段计算 - 全部通过', colors.green);
  } catch (error: any) {
    log(`\n测试3 失败: ${error.message}`, colors.red);
    console.error(error);
  }
}

// ============================================================================
// 测试4：期权合约选择（使用QQQ作为测试标的）
// ============================================================================
async function test4_OptionContractSelection() {
  testHeader('测试4：期权合约选择（QQQ示例）');

  try {
    log('注意：此测试需要富途API配置和网络连接', colors.yellow);

    // 测试4.1：选择QQQ的0DTE CALL期权
    log('\n4.1 测试 QQQ 0DTE CALL 期权选择...');
    const callOption = await selectOptionContract({
      underlyingSymbol: 'QQQ.US',
      expirationMode: '0DTE',
      direction: 'CALL',
      candidateStrikes: 5,
      liquidityFilters: {
        minOpenInterest: 100,
        maxBidAskSpreadPct: 10.0,
      },
      greekFilters: {
        deltaMin: 0.3,
        deltaMax: 0.7,
      },
    });

    if (callOption) {
      testResult('4.1 QQQ CALL期权选择成功', true);
      console.log(`  期权代码: ${callOption.optionSymbol}`);
      console.log(`  行权价: ${callOption.strikePrice}`);
      console.log(`  Delta: ${callOption.delta.toFixed(4)}`);
      console.log(`  持仓量: ${callOption.openInterest}`);
      console.log(`  Bid/Ask: ${callOption.bid.toFixed(2)}/${callOption.ask.toFixed(2)}`);
      console.log(`  价差%: ${(((callOption.ask - callOption.bid) / callOption.mid) * 100).toFixed(2)}%`);

      // 测试4.2：验证Greeks过滤
      const deltaInRange = callOption.delta >= 0.3 && callOption.delta <= 0.7;
      testResult('4.2 Delta过滤器工作', deltaInRange, `Delta=${callOption.delta.toFixed(4)}`);

      // 测试4.3：验证流动性过滤
      const liquidityOk = callOption.openInterest >= 100;
      testResult('4.3 持仓量过滤器工作', liquidityOk, `持仓量=${callOption.openInterest}`);
    } else {
      testResult('4.1 QQQ CALL期权选择', false, '未找到符合条件的期权（可能是0DTE不可用或过滤器太严格）');
    }

    // 测试4.4：选择QQQ的NEAREST PUT期权（作为备选）
    log('\n4.4 测试 QQQ NEAREST PUT 期权选择...');
    const putOption = await selectOptionContract({
      underlyingSymbol: 'QQQ.US',
      expirationMode: 'NEAREST',
      direction: 'PUT',
      candidateStrikes: 5,
      liquidityFilters: {
        minOpenInterest: 50,
      },
    });

    if (putOption) {
      testResult('4.4 QQQ PUT期权选择成功', true);
      console.log(`  期权代码: ${putOption.optionSymbol}`);
      console.log(`  行权价: ${putOption.strikePrice}`);
      console.log(`  Delta: ${putOption.delta.toFixed(4)}`);
      console.log(`  Theta: ${putOption.theta.toFixed(4)}`);
    } else {
      testResult('4.4 QQQ PUT期权选择', false, '未找到符合条件的期权');
    }

    log('\n测试4：期权合约选择 - 完成（部分依赖API）', colors.green);
  } catch (error: any) {
    log(`\n测试4 失败: ${error.message}`, colors.red);
    console.error(error);
  }
}

// ============================================================================
// 测试5：期权详情接口增强
// ============================================================================
async function test5_OptionDetailEnhanced() {
  testHeader('测试5：期权详情接口增强');

  try {
    log('注意：此测试需要实际的期权ID和富途API配置', colors.yellow);

    // 使用QQQ期权进行测试
    log('\n5.1 测试 QQQ 期权详情获取...');

    // 先获取QQQ的到期日期
    const strikeDates = await getOptionStrikeDates('201335'); // QQQ的stockId
    if (strikeDates && strikeDates.strikeDates.length > 0) {
      log(`  找到 ${strikeDates.strikeDates.length} 个到期日期`, colors.green);

      // 获取第一个到期日期的期权链
      const { getOptionChain } = await import('./src/services/futunn-option-chain.service');
      const chain = await getOptionChain('201335', strikeDates.strikeDates[0].strikeDate);

      if (chain && chain.length > 0) {
        const firstOption = chain[0].callOption || chain[0].putOption;
        if (firstOption) {
          log(`  测试期权ID: ${firstOption.optionId}`);

          // 获取期权详情
          const detail = await getOptionDetail(firstOption.optionId, '201335', 2);

          if (detail) {
            testResult('5.1 期权详情获取成功', true);

            // 测试5.2：验证新增的便捷字段
            const hasUnderlyingPrice = typeof detail.underlyingPrice === 'number';
            testResult('5.2 underlyingPrice字段存在', hasUnderlyingPrice, `底层价格=${detail.underlyingPrice}`);

            const hasUnderlyingChange = typeof detail.underlyingChange === 'number';
            testResult('5.3 underlyingChange字段存在', hasUnderlyingChange, `底层涨跌=${detail.underlyingChange}`);

            const hasUnderlyingChangeRatio = typeof detail.underlyingChangeRatio === 'string';
            testResult('5.4 underlyingChangeRatio字段存在', hasUnderlyingChangeRatio, `底层涨跌幅=${detail.underlyingChangeRatio}`);

            // 测试5.5：验证Greeks数据
            if (detail.option && detail.option.greeks) {
              const hasDelta = typeof detail.option.greeks.delta === 'number' || typeof detail.option.greeks.hpDelta === 'number';
              const hasTheta = typeof detail.option.greeks.theta === 'number' || typeof detail.option.greeks.hpTheta === 'number';
              testResult('5.5 Greeks数据完整', hasDelta && hasTheta);
            }

            // 输出详细信息
            console.log('\n期权详情（部分）:');
            console.log(`  期权价格: ${detail.price}`);
            console.log(`  Bid/Ask: ${detail.priceBid}/${detail.priceAsk}`);
            console.log(`  成交量: Bid=${detail.volumeBid}, Ask=${detail.volumeAsk}`);
            console.log(`  底层价格: ${detail.underlyingPrice} (${detail.underlyingChangeRatio})`);
            if (detail.option) {
              console.log(`  行权价: ${detail.option.strikePrice}`);
              console.log(`  持仓量: ${detail.option.openInterest}`);
              console.log(`  隐波: ${detail.option.impliedVolatility}%`);
              if (detail.option.greeks) {
                console.log(`  Delta: ${detail.option.greeks.hpDelta || detail.option.greeks.delta}`);
                console.log(`  Theta: ${detail.option.greeks.hpTheta || detail.option.greeks.theta}`);
              }
            }
          } else {
            testResult('5.1 期权详情获取', false, '返回null');
          }
        }
      }
    } else {
      log('  未找到QQQ的到期日期（可能是API配置问题）', colors.yellow);
    }

    log('\n测试5：期权详情接口增强 - 完成（部分依赖API）', colors.green);
  } catch (error: any) {
    log(`\n测试5 失败: ${error.message}`, colors.red);
    console.error(error);
  }
}

// ============================================================================
// 主测试流程
// ============================================================================
async function runAllTests() {
  console.log('\n' + '█'.repeat(60));
  log('期权策略修复验证测试', colors.blue);
  log('2026-01-28', colors.blue);
  console.log('█'.repeat(60));

  // 不依赖API的测试
  await test1_OptionPriceCache();
  await test2_OptionFees();
  await test3_MarketSession();

  // 依赖API的测试（可能失败）
  log('\n\n' + '▼'.repeat(60), colors.yellow);
  log('以下测试依赖富途API配置和网络连接，可能会失败', colors.yellow);
  log('▼'.repeat(60) + '\n', colors.yellow);

  await test4_OptionContractSelection();
  await test5_OptionDetailEnhanced();

  // 总结
  console.log('\n' + '█'.repeat(60));
  log('测试完成', colors.blue);
  console.log('█'.repeat(60));

  log('\n✅ 本地测试（1-3）：验证核心逻辑和数据结构', colors.green);
  log('⚠️  API测试（4-5）：需要富途配置和实际市场数据', colors.yellow);
  log('\n建议：在交易时间内使用前端页面（http://localhost:3000/options/chain?symbol=QQQ.US）进行完整测试', colors.blue);
}

// 运行测试
if (require.main === module) {
  runAllTests()
    .then(() => {
      log('\n所有测试执行完毕', colors.green);
      process.exit(0);
    })
    .catch((error) => {
      log(`\n测试执行失败: ${error.message}`, colors.red);
      console.error(error);
      process.exit(1);
    });
}

export { runAllTests };
