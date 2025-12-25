/**
 * 运行订单提交 Decimal 类型修复测试的脚本
 * 使用方法: node scripts/run-decimal-test.js
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('🧪 开始运行订单提交 Decimal 类型修复测试...\n');

try {
  // 切换到 API 目录
  const apiDir = path.resolve(__dirname, '..');
  process.chdir(apiDir);
  
  console.log(`📁 工作目录: ${apiDir}\n`);
  
  // 运行测试
  console.log('▶️  执行测试命令: npm test -- order-submission-decimal.test.ts\n');
  
  execSync('npm test -- order-submission-decimal.test.ts', {
    stdio: 'inherit',
    cwd: apiDir,
  });
  
  console.log('\n✅ 测试执行完成！');
} catch (error) {
  console.error('\n❌ 测试执行失败:', error.message);
  console.log('\n💡 提示:');
  console.log('1. 确保已安装依赖: npm install');
  console.log('2. 确保测试文件存在: src/__tests__/order-submission-decimal.test.ts');
  console.log('3. 手动运行: cd trading-system/api && npm test -- order-submission-decimal.test.ts');
  process.exit(1);
}


