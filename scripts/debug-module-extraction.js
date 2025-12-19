/**
 * 调试模块名称提取逻辑
 * 模拟 logger.log 的调用栈提取过程
 */

// 模拟调用栈（实际格式）
const mockStack = `
Error
    at Object.log (D:\\Python脚本\\trading-system\\api\\src\\utils\\logger.ts:213:13)
    at StrategyScheduler.processSymbol (D:\\Python脚本\\trading-system\\api\\src\\services\\strategy-scheduler.service.ts:904:25)
    at async StrategyScheduler.runStrategyCycle (D:\\Python脚本\\trading-system\\api\\src\\services\\strategy-scheduler.service.ts:789:15)
    at async Timeout._onTimeout (D:\\Python脚本\\trading-system\\api\\src\\services\\strategy-scheduler.service.ts:125:27)
`;

function extractModuleName(stack) {
  if (!stack) {
    return 'Unknown';
  }

  const stackLines = stack.split('\n');
  console.log('调用栈行数:', stackLines.length);
  console.log('');

  // 跳过前3行（Error、logger.log/info/warn/error/debug）
  for (let i = 3; i < stackLines.length; i++) {
    const line = stackLines[i];
    console.log(`第 ${i} 行: ${line.trim()}`);
    
    // 匹配格式：at functionName (file:line:column)
    const match = line.match(/at\s+.+\s+\((.+):(\d+):(\d+)\)/);
    if (match) {
      const filePath = match[1];
      console.log(`  匹配到文件路径: ${filePath}`);
      
      // 排除node_modules和logger.ts本身
      if (!filePath.includes('node_modules') && !filePath.includes('logger.ts')) {
        console.log(`  ✅ 使用此文件路径提取模块名称`);
        return filePath;
      } else {
        console.log(`  ❌ 跳过（包含 node_modules 或 logger.ts）`);
      }
    } else {
      console.log(`  ❌ 未匹配到文件路径`);
    }
    console.log('');
  }

  return 'Unknown';
}

console.log('🔍 调试模块名称提取逻辑\n');
console.log('模拟调用栈:');
console.log(mockStack);
console.log('='.repeat(60));
console.log('');

const result = extractModuleName(mockStack);
console.log('='.repeat(60));
console.log(`提取的文件路径: ${result}`);

