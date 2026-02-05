/**
 * 测试期权决策日志功能
 *
 * 此脚本用于测试：
 * 1. 决策日志服务基本功能
 * 2. 交易时间判断
 * 3. 数据库写入
 */

import { isTradingHours, isPreMarketHours } from './src/utils/trading-hours';

console.log('=== 测试交易时间判断 ===');
console.log('当前是否交易时间:', isTradingHours());
console.log('当前是否盘前时间:', isPreMarketHours());
console.log('是否应该写入数据库:', isTradingHours() || isPreMarketHours());

// 模拟不同时间的测试
const testTimes = [
  { desc: '美东9:30（开盘）', date: new Date('2026-02-05T14:30:00Z') }, // UTC时间 = 美东9:30
  { desc: '美东12:00（盘中）', date: new Date('2026-02-05T17:00:00Z') },
  { desc: '美东16:00（收盘）', date: new Date('2026-02-05T21:00:00Z') },
  { desc: '美东20:00（盘后）', date: new Date('2026-02-06T01:00:00Z') },
  { desc: '美东8:00（盘前）', date: new Date('2026-02-05T13:00:00Z') },
];

console.log('\n=== 测试不同时间点 ===');
testTimes.forEach(({ desc, date }) => {
  const trading = isTradingHours(date);
  const preMarket = isPreMarketHours(date);
  const shouldLog = trading || preMarket;
  console.log(`${desc}: 交易=${trading}, 盘前=${preMarket}, 写入=${shouldLog}`);
});

console.log('\n✅ 交易时间判断测试完成');
console.log('\n注意：实际数据库写入需要在运行的服务中测试');
console.log('建议：检查 option_strategy_decision_logs 表是否成功创建');
