/**
 * 测试 quote-token 计算
 * 使用浏览器请求的参数验证计算是否正确
 */

const crypto = require('crypto');

/**
 * 生成quote-token（与代码中一致）
 */
function generateQuoteToken(params) {
  // 使用JSON.stringify生成token（不是urlencode）
  const dataStr = JSON.stringify(params);
  
  console.log('1. JSON.stringify 结果:', dataStr);
  
  // HMAC-SHA512加密
  const hmac = crypto.createHmac('sha512', 'quote_web');
  hmac.update(dataStr);
  const hmacResult = hmac.digest('hex');
  
  console.log('2. HMAC-SHA512 结果:', hmacResult);
  
  // 取前10位
  const firstSlice = hmacResult.substring(0, 10);
  console.log('3. 前10位:', firstSlice);
  
  // SHA256哈希
  const sha256 = crypto.createHash('sha256');
  sha256.update(firstSlice);
  const sha256Result = sha256.digest('hex');
  
  console.log('4. SHA256 结果:', sha256Result);
  
  // 取前10位作为token
  const token = sha256Result.substring(0, 10);
  console.log('5. 最终 token:', token);
  
  return token;
}

// 从浏览器请求中提取的参数
// URL: stockId=200002&marketType=2&type=2&marketCode=11&instrumentType=6&subInstrumentType=6001&_=1764339070127
// 期望的 quote-token: bec6a5688a

console.log('=== 测试浏览器请求参数 ===\n');

// 注意：参数的顺序很重要！需要按照浏览器请求的顺序
const params1 = {
  stockId: '200002',
  marketType: '2',
  type: '2',
  marketCode: '11',
  instrumentType: '6',
  subInstrumentType: '6001',
  _: '1764339070127'
};

console.log('参数对象:', JSON.stringify(params1, null, 2));
console.log('\n--- 计算过程 ---\n');

const token1 = generateQuoteToken(params1);

console.log('\n=== 结果对比 ===');
console.log('期望的 token: bec6a5688a');
console.log('计算的 token:', token1);
console.log('是否匹配:', token1 === 'bec6a5688a' ? '✅ 是' : '❌ 否');

// 尝试不同的参数顺序
console.log('\n\n=== 测试不同参数顺序 ===\n');

const params2 = {
  _: '1764339070127',
  instrumentType: '6',
  marketCode: '11',
  marketType: '2',
  stockId: '200002',
  subInstrumentType: '6001',
  type: '2'
};

console.log('参数对象（不同顺序）:', JSON.stringify(params2, null, 2));
console.log('\n--- 计算过程 ---\n');

const token2 = generateQuoteToken(params2);

console.log('\n=== 结果对比 ===');
console.log('期望的 token: bec6a5688a');
console.log('计算的 token:', token2);
console.log('是否匹配:', token2 === 'bec6a5688a' ? '✅ 是' : '❌ 否');

// 测试数字类型 vs 字符串类型
console.log('\n\n=== 测试参数类型（数字 vs 字符串）===\n');

const params3 = {
  stockId: 200002,
  marketType: 2,
  type: 2,
  marketCode: 11,
  instrumentType: 6,
  subInstrumentType: 6001,
  _: 1764339070127
};

console.log('参数对象（数字类型）:', JSON.stringify(params3, null, 2));
console.log('\n--- 计算过程 ---\n');

const token3 = generateQuoteToken(params3);

console.log('\n=== 结果对比 ===');
console.log('期望的 token: bec6a5688a');
console.log('计算的 token:', token3);
console.log('是否匹配:', token3 === 'bec6a5688a' ? '✅ 是' : '❌ 否');

