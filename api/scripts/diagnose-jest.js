/**
 * Jest 诊断脚本
 * 帮助排查为什么 Jest 没有输出
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Jest 诊断工具\n');
console.log('==========================================\n');

// 1. 检查 Jest 是否安装
console.log('1. 检查 Jest 安装...');
try {
  const jestPath = require.resolve('jest');
  console.log(`   ✅ Jest 已安装: ${jestPath}`);
} catch (e) {
  console.log('   ❌ Jest 未安装，请运行: npm install');
  process.exit(1);
}

// 2. 检查 ts-jest 是否安装
console.log('\n2. 检查 ts-jest 安装...');
try {
  const tsJestPath = require.resolve('ts-jest');
  console.log(`   ✅ ts-jest 已安装: ${tsJestPath}`);
} catch (e) {
  console.log('   ❌ ts-jest 未安装，请运行: npm install ts-jest --save-dev');
  process.exit(1);
}

// 3. 检查 jest.config.js
console.log('\n3. 检查 Jest 配置...');
const jestConfigPath = path.join(__dirname, '..', 'jest.config.js');
if (fs.existsSync(jestConfigPath)) {
  console.log(`   ✅ jest.config.js 存在`);
  const config = require(jestConfigPath);
  console.log(`   - preset: ${config.preset}`);
  console.log(`   - testMatch: ${JSON.stringify(config.testMatch)}`);
  console.log(`   - roots: ${JSON.stringify(config.roots)}`);
} else {
  console.log('   ❌ jest.config.js 不存在');
}

// 4. 检查测试文件
console.log('\n4. 检查测试文件...');
const testDir = path.join(__dirname, '..', 'src', '__tests__');
if (fs.existsSync(testDir)) {
  console.log(`   ✅ 测试目录存在: ${testDir}`);
  const files = fs.readdirSync(testDir);
  const testFiles = files.filter(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'));
  console.log(`   - 找到 ${testFiles.length} 个测试文件:`);
  testFiles.forEach(file => {
    const filePath = path.join(testDir, file);
    const stats = fs.statSync(filePath);
    console.log(`     • ${file} (${stats.size} bytes)`);
  });
} else {
  console.log(`   ❌ 测试目录不存在: ${testDir}`);
}

// 5. 检查特定测试文件
console.log('\n5. 检查特定测试文件...');
const testFiles = [
  'decimal-type-verification.test.ts',
  'order-submission-decimal-simple.test.ts',
  'order-submission-decimal.test.ts',
];

testFiles.forEach(file => {
  const filePath = path.join(testDir, file);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`   ✅ ${file} 存在 (${stats.size} bytes)`);
    
    // 检查文件内容是否有语法错误
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('jest.mock')) {
        console.log(`      - 包含 jest.mock`);
      }
      if (content.includes('describe')) {
        console.log(`      - 包含 describe`);
      }
      if (content.includes('it(')) {
        const itCount = (content.match(/it\(/g) || []).length;
        console.log(`      - 包含 ${itCount} 个测试用例`);
      }
    } catch (e) {
      console.log(`      ⚠️  读取文件时出错: ${e.message}`);
    }
  } else {
    console.log(`   ❌ ${file} 不存在`);
  }
});

// 6. 尝试运行 Jest
console.log('\n6. 尝试运行 Jest...');
console.log('   运行命令: npx jest --version');
const { execSync } = require('child_process');
try {
  const version = execSync('npx jest --version', { encoding: 'utf8', cwd: path.join(__dirname, '..') });
  console.log(`   ✅ Jest 版本: ${version.trim()}`);
} catch (e) {
  console.log(`   ❌ 无法运行 Jest: ${e.message}`);
}

// 7. 建议
console.log('\n==========================================');
console.log('💡 建议:');
console.log('1. 尝试运行最简单的测试:');
console.log('   npm test -- decimal-type-verification.test.ts');
console.log('');
console.log('2. 如果还是没有输出，尝试:');
console.log('   npx jest src/__tests__/decimal-type-verification.test.ts --no-cache');
console.log('');
console.log('3. 检查是否有其他进程占用:');
console.log('   任务管理器 -> 查找 node.exe 进程');
console.log('');
console.log('4. 尝试清理缓存:');
console.log('   npx jest --clearCache');
console.log('==========================================\n');


