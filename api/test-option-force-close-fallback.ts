/**
 * 测试期权强制平仓的市价单+限价单fallback机制
 *
 * 测试场景：
 * 1. 持有深度虚值期权（流动性差）
 * 2. 触发强制平仓逻辑
 * 3. 验证市价单被拒后自动fallback到限价单
 */

import { config } from 'dotenv';
import path from 'path';

// 加载环境变量
config({ path: path.resolve(__dirname, '../.env') });

import basicExecutionService from './src/services/basic-execution.service';
import { logger } from './src/utils/logger';

interface TestCase {
  name: string;
  symbol: string;
  currentPrice: number;
  expectedFirstAttempt: 'MO';
  expectedFallbackType?: 'LO';
  expectedFallbackPrice?: number;
}

async function testForceCloseFallback() {
  logger.log('========================================');
  logger.log('期权强制平仓Fallback机制测试');
  logger.log('========================================\n');

  const testCases: TestCase[] = [
    {
      name: '深度虚值期权（流动性极差）',
      symbol: 'QQQ260130P395000.US',
      currentPrice: 0.05,
      expectedFirstAttempt: 'MO',
      expectedFallbackType: 'LO',
      expectedFallbackPrice: 0.01, // formattedPrice < 0.1 时使用 $0.01
    },
    {
      name: '轻度虚值期权（流动性一般）',
      symbol: 'QQQ260130P620000.US',
      currentPrice: 0.50,
      expectedFirstAttempt: 'MO',
      expectedFallbackType: 'LO',
      expectedFallbackPrice: 0.05, // 0.50 * 0.1 = 0.05
    },
    {
      name: 'ATM期权（流动性好）',
      symbol: 'QQQ260130P629000.US',
      currentPrice: 2.50,
      expectedFirstAttempt: 'MO',
      // 可能不需要fallback，市价单可能成功
    },
  ];

  for (const testCase of testCases) {
    logger.log(`\n📋 测试场景: ${testCase.name}`);
    logger.log(`   标的: ${testCase.symbol}`);
    logger.log(`   当前价: $${testCase.currentPrice.toFixed(2)}`);
    logger.log(`   预期第一次尝试: ${testCase.expectedFirstAttempt}`);
    if (testCase.expectedFallbackType) {
      logger.log(`   预期Fallback类型: ${testCase.expectedFallbackType}`);
      logger.log(`   预期Fallback价格: $${testCase.expectedFallbackPrice?.toFixed(2)}`);
    }
    logger.log('');

    try {
      // 模拟强制平仓的TradingIntent
      const intent: any = {
        action: 'SELL',
        symbol: testCase.symbol,
        entryPrice: testCase.currentPrice,
        quantity: 1,
        reason: '期权强制平仓测试',
        metadata: {
          assetClass: 'OPTION',
          forceClose: true,
          underlyingSymbol: 'QQQ',
          optionType: 'PUT',
        },
      };

      // 执行订单（这会触发市价单+fallback逻辑）
      logger.log('🔄 执行强制平仓订单...\n');

      const result = await basicExecutionService.executeSellIntent(intent, 1);

      if (result.success) {
        logger.log(`✅ 订单执行成功！`);
        logger.log(`   订单ID: ${result.orderId}`);
        logger.log(`   查看上面的日志了解详细执行过程`);
      } else {
        logger.log(`❌ 订单执行失败`);
        logger.log(`   错误: ${result.error}`);
      }
    } catch (error: any) {
      logger.error(`测试执行异常: ${error.message}`);
    }

    logger.log('\n----------------------------------------\n');
  }

  logger.log('\n========================================');
  logger.log('测试完成');
  logger.log('========================================\n');
}

// 运行测试
testForceCloseFallback()
  .then(() => {
    logger.log('✅ 所有测试完成');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(`测试失败: ${error.message}`);
    process.exit(1);
  });
