/**
 * 富途API频率限制测试脚本
 *
 * 测试各个API的调用频率限制，为缓存策略提供依据
 *
 * 运行方式: npx tsx test-api-rate-limit.ts
 */

import {
  getOptionStrikeDates,
  getOptionChain,
  getOptionDetail,
  getStockIdBySymbol,
  getUnderlyingStockQuote,
} from './src/services/futunn-option-chain.service';

// 测试结果接口
interface TestResult {
  api: string;
  totalCalls: number;
  successCount: number;
  failCount: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  errors: string[];
  rateLimit?: string;
}

// 延迟函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 测试单个API的频率限制
async function testApiRateLimit(
  apiName: string,
  apiCall: () => Promise<any>,
  callsPerBurst: number = 10,
  delayBetweenCalls: number = 100, // 毫秒
): Promise<TestResult> {
  const result: TestResult = {
    api: apiName,
    totalCalls: callsPerBurst,
    successCount: 0,
    failCount: 0,
    avgResponseTime: 0,
    minResponseTime: Infinity,
    maxResponseTime: 0,
    errors: [],
  };

  const responseTimes: number[] = [];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`测试 API: ${apiName}`);
  console.log(`计划调用次数: ${callsPerBurst}, 间隔: ${delayBetweenCalls}ms`);
  console.log(`${'='.repeat(60)}`);

  for (let i = 0; i < callsPerBurst; i++) {
    const startTime = Date.now();

    try {
      await apiCall();
      const elapsed = Date.now() - startTime;
      responseTimes.push(elapsed);
      result.successCount++;
      console.log(`  [${i + 1}/${callsPerBurst}] ✓ 成功 (${elapsed}ms)`);
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      result.failCount++;
      const errorMsg = error.message || String(error);
      result.errors.push(errorMsg);
      console.log(`  [${i + 1}/${callsPerBurst}] ✗ 失败 (${elapsed}ms): ${errorMsg.substring(0, 100)}`);

      // 如果遇到频率限制错误，记录并可能需要增加等待时间
      if (errorMsg.includes('rate') || errorMsg.includes('limit') || errorMsg.includes('429')) {
        result.rateLimit = `在第${i + 1}次调用时触发频率限制`;
        console.log(`  ⚠️ 检测到频率限制，等待5秒...`);
        await delay(5000);
      }
    }

    // 调用间隔
    if (i < callsPerBurst - 1) {
      await delay(delayBetweenCalls);
    }
  }

  // 计算统计
  if (responseTimes.length > 0) {
    result.avgResponseTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
    result.minResponseTime = Math.min(...responseTimes);
    result.maxResponseTime = Math.max(...responseTimes);
  }

  return result;
}

// 测试不同间隔下的成功率
async function testWithDifferentIntervals(
  apiName: string,
  apiCall: () => Promise<any>,
  intervals: number[] = [0, 100, 200, 500, 1000],
  callsPerTest: number = 5,
): Promise<void> {
  console.log(`\n${'#'.repeat(70)}`);
  console.log(`# 测试 ${apiName} 在不同间隔下的表现`);
  console.log(`${'#'.repeat(70)}`);

  for (const interval of intervals) {
    console.log(`\n--- 间隔: ${interval}ms ---`);
    const result = await testApiRateLimit(apiName, apiCall, callsPerTest, interval);
    console.log(`结果: 成功${result.successCount}/${result.totalCalls}, 平均响应${result.avgResponseTime}ms`);

    // 每组测试后等待一下
    await delay(2000);
  }
}

// 主测试函数
async function main() {
  console.log('富途API频率限制测试');
  console.log('='.repeat(70));
  console.log(`测试时间: ${new Date().toISOString()}`);
  console.log('');

  const results: TestResult[] = [];

  // 先获取stockId
  console.log('准备测试数据...');
  const stockId = await getStockIdBySymbol('QQQ.US');
  if (!stockId) {
    console.error('无法获取QQQ的stockId，测试中止');
    return;
  }
  console.log(`QQQ stockId: ${stockId}`);

  // 获取到期日期（用于后续测试）
  const strikeDatesResp = await getOptionStrikeDates(stockId);
  if (!strikeDatesResp || !strikeDatesResp.strikeDates || strikeDatesResp.strikeDates.length === 0) {
    console.error('无法获取期权到期日期，测试中止');
    return;
  }
  const strikeDate = strikeDatesResp.strikeDates[0].strikeDate;
  console.log(`使用到期日期: ${strikeDate}`);

  // 获取期权链（用于后续测试）
  const chain = await getOptionChain(stockId, strikeDate);
  if (!chain || chain.length === 0) {
    console.error('无法获取期权链，测试中止');
    return;
  }
  const optionId = chain[0].callOption?.optionId || chain[0].putOption?.optionId;
  console.log(`使用期权ID: ${optionId}`);
  console.log('');

  // 等待一下，避免预热请求影响测试
  await delay(3000);

  // 1. 测试 getStockIdBySymbol (搜索API)
  console.log('\n\n========== 测试1: 股票搜索API (getStockIdBySymbol) ==========');
  results.push(await testApiRateLimit(
    'getStockIdBySymbol',
    () => getStockIdBySymbol('AAPL.US'),
    10,
    200, // 200ms间隔
  ));
  await delay(3000);

  // 2. 测试 getOptionStrikeDates (期权到期日期API)
  console.log('\n\n========== 测试2: 期权到期日期API (getOptionStrikeDates) ==========');
  results.push(await testApiRateLimit(
    'getOptionStrikeDates',
    () => getOptionStrikeDates(stockId),
    10,
    200,
  ));
  await delay(3000);

  // 3. 测试 getOptionChain (期权链API)
  console.log('\n\n========== 测试3: 期权链API (getOptionChain) ==========');
  results.push(await testApiRateLimit(
    'getOptionChain',
    () => getOptionChain(stockId, strikeDate),
    10,
    200,
  ));
  await delay(3000);

  // 4. 测试 getOptionDetail (期权详情API)
  console.log('\n\n========== 测试4: 期权详情API (getOptionDetail) ==========');
  if (optionId) {
    results.push(await testApiRateLimit(
      'getOptionDetail',
      () => getOptionDetail(optionId, stockId, 2),
      10,
      200,
    ));
  }
  await delay(3000);

  // 5. 测试 getUnderlyingStockQuote (正股行情API)
  console.log('\n\n========== 测试5: 正股行情API (getUnderlyingStockQuote) ==========');
  results.push(await testApiRateLimit(
    'getUnderlyingStockQuote',
    () => getUnderlyingStockQuote(stockId),
    10,
    200,
  ));

  // 6. 压力测试 - 以更快的速度调用
  console.log('\n\n========== 测试6: 压力测试 (50ms间隔) ==========');
  await delay(5000); // 先等待一下
  results.push(await testApiRateLimit(
    'getOptionStrikeDates (压力测试)',
    () => getOptionStrikeDates(stockId),
    20,
    50, // 50ms间隔
  ));

  // 7. 极限测试 - 无间隔连续调用
  console.log('\n\n========== 测试7: 极限测试 (无间隔) ==========');
  await delay(5000);
  results.push(await testApiRateLimit(
    'getOptionStrikeDates (极限测试)',
    () => getOptionStrikeDates(stockId),
    10,
    0, // 无间隔
  ));

  // 输出汇总结果
  console.log('\n\n');
  console.log('█'.repeat(70));
  console.log('█ 测试结果汇总');
  console.log('█'.repeat(70));
  console.log('');

  console.log('| API名称 | 成功/总数 | 成功率 | 平均响应 | 最小响应 | 最大响应 | 频率限制 |');
  console.log('|---------|-----------|--------|----------|----------|----------|----------|');

  for (const r of results) {
    const successRate = ((r.successCount / r.totalCalls) * 100).toFixed(1);
    console.log(
      `| ${r.api.substring(0, 30).padEnd(30)} | ${r.successCount}/${r.totalCalls} | ${successRate}% | ${r.avgResponseTime}ms | ${r.minResponseTime === Infinity ? 'N/A' : r.minResponseTime + 'ms'} | ${r.maxResponseTime}ms | ${r.rateLimit || '无'} |`
    );
  }

  // 建议
  console.log('\n');
  console.log('█ 缓存建议');
  console.log('█'.repeat(70));

  const allSuccess = results.every(r => r.successCount === r.totalCalls);
  const pressureTestSuccess = results.find(r => r.api.includes('压力测试'))?.successCount === 20;
  const extremeTestSuccess = results.find(r => r.api.includes('极限测试'))?.successCount === 10;

  if (extremeTestSuccess) {
    console.log('✓ 无间隔连续调用测试通过，API没有严格的频率限制');
    console.log('  建议：可以将缓存时间设置为 5-10 秒');
  } else if (pressureTestSuccess) {
    console.log('✓ 50ms间隔测试通过');
    console.log('  建议：可以将缓存时间设置为 10-15 秒');
  } else if (allSuccess) {
    console.log('✓ 200ms间隔测试通过');
    console.log('  建议：可以将缓存时间设置为 15-30 秒');
  } else {
    console.log('✗ 部分测试失败，可能存在频率限制');
    console.log('  建议：保持较长的缓存时间 (30-60 秒)');
  }

  console.log('\n测试完成!');
}

// 运行测试
main().catch(console.error);
