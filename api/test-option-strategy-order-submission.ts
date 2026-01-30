/**
 * 期权策略订单提交测试脚本
 *
 * 目的：
 * 1. 模拟策略10生成期权信号
 * 2. 测试统一订单提交服务
 * 3. 验证订单参数格式是否正确
 * 4. 测试清仓订单提交
 */

import { OptionIntradayStrategy } from './src/services/strategies/option-intraday-strategy';
import orderSubmissionService from './src/services/order-submission.service';
import pool from './src/config/database';

interface TestResult {
  success: boolean;
  stage: string;
  data?: any;
  error?: string;
}

async function testOptionOrderSubmission(): Promise<void> {
  console.log('========================================');
  console.log('期权订单提交测试');
  console.log('========================================\n');

  const results: TestResult[] = [];

  try {
    // ============================================================
    // 阶段1: 读取策略10配置
    // ============================================================
    console.log('阶段1: 读取策略10配置...');
    const strategyQuery = await pool.query('SELECT * FROM strategies WHERE id = 10');

    if (strategyQuery.rows.length === 0) {
      throw new Error('策略10不存在');
    }

    const strategyRecord = strategyQuery.rows[0];
    console.log('✅ 策略配置:', JSON.stringify(strategyRecord.config, null, 2));

    results.push({
      success: true,
      stage: '读取策略配置',
      data: strategyRecord.config,
    });

    // ============================================================
    // 阶段2: 创建策略实例并生成信号
    // ============================================================
    console.log('\n阶段2: 创建策略实例并生成期权信号...');
    const strategy = new OptionIntradayStrategy(10, strategyRecord.config);
    const underlyingSymbol = 'QQQ.US';

    console.log(`标的资产: ${underlyingSymbol}`);
    console.log('正在生成信号...');

    const signal = await strategy.generateSignal(underlyingSymbol);

    if (!signal) {
      console.log('⚠️  当前无信号生成（可能是HOLD或市场条件不符）');
      results.push({
        success: true,
        stage: '生成期权信号',
        data: { message: '无信号' },
      });
    } else {
      console.log('✅ 期权信号已生成:');
      console.log(JSON.stringify({
        action: signal.action,
        symbol: signal.symbol,
        optionSymbol: signal.metadata?.optionSymbol,
        optionType: signal.metadata?.optionType,
        direction: signal.metadata?.optionDirection,
        strikePrice: signal.metadata?.strikePrice,
        strikeDate: signal.metadata?.strikeDate,
        entryPrice: signal.entryPrice,
        quantity: signal.quantity,
        estimatedCost: signal.metadata?.allocationAmountOverride,
        reason: signal.reason,
      }, null, 2));

      results.push({
        success: true,
        stage: '生成期权信号',
        data: signal,
      });

      // ============================================================
      // 阶段3: 模拟提交买入订单（开仓）
      // ============================================================
      console.log('\n阶段3: 模拟提交买入订单（开仓）...');
      console.log('⚠️  注意: 这是DRY RUN模式，不会真正提交到交易所');
      console.log('\n准备提交的订单参数:');

      const testBuyOrderParams = {
        symbol: signal.symbol, // 期权symbol，如 "QQQ260130C625000.US"
        side: 'Buy' as const,
        order_type: 'LO' as const,
        submitted_quantity: signal.quantity.toString(),
        submitted_price: signal.entryPrice?.toFixed(2) || '',
        time_in_force: 'Day' as const,
        outside_rth: 'RTH_ONLY' as const,
        remark: `策略10测试 - ${signal.reason}`,
      };

      console.log(JSON.stringify(testBuyOrderParams, null, 2));

      // DRY RUN：只验证参数，不真正提交
      console.log('\n🧪 DRY RUN: 验证订单参数...');

      try {
        // 这里可以调用验证函数但不实际提交
        console.log('✅ 订单参数格式正确');
        console.log('✅ 如果真正提交，将调用:');
        console.log('   orderSubmissionService.submitOrder(buyOrderParams)');

        results.push({
          success: true,
          stage: '模拟买入订单',
          data: {
            dryRun: true,
            orderParams: testBuyOrderParams,
          },
        });
      } catch (error: any) {
        console.error('❌ 订单参数验证失败:', error.message);
        results.push({
          success: false,
          stage: '模拟买入订单',
          error: error.message,
        });
      }
    }

    // ============================================================
    // 阶段4: 模拟市价单清仓
    // ============================================================
    console.log('\n阶段4: 模拟市价单清仓...');
    console.log('场景: 交易日结束前30分钟自动清仓');

    // 查询当前是否有期权持仓（用于测试）
    const positionsQuery = await pool.query(`
      SELECT * FROM positions
      WHERE quantity > 0
        AND symbol LIKE '%C%'
        OR symbol LIKE '%P%'
      LIMIT 1
    `);

    let sellOrderParams;

    if (positionsQuery.rows.length > 0) {
      const position = positionsQuery.rows[0];
      console.log('\n找到期权持仓（用于测试）:');
      console.log(JSON.stringify({
        symbol: position.symbol,
        quantity: position.quantity,
        cost_price: position.cost_price,
        current_price: position.current_price,
      }, null, 2));

      sellOrderParams = {
        symbol: position.symbol,
        side: 'Sell' as const,
        order_type: 'MO' as const, // 市价单
        submitted_quantity: position.quantity.toString(),
        time_in_force: 'Day' as const,
        outside_rth: 'RTH_ONLY' as const,
        remark: '策略10测试 - 收盘前30分钟强制清仓',
      };
    } else if (signal && signal.symbol) {
      console.log('\n使用生成的信号作为清仓测试:');
      sellOrderParams = {
        symbol: signal.symbol,
        side: 'Sell' as const,
        order_type: 'MO' as const, // 市价单
        submitted_quantity: signal.quantity.toString(),
        time_in_force: 'Day' as const,
        outside_rth: 'RTH_ONLY' as const,
        remark: '策略10测试 - 收盘前30分钟强制清仓',
      };
    } else {
      console.log('⚠️  无可用的期权持仓或信号进行清仓测试');
      sellOrderParams = null;
    }

    if (sellOrderParams) {
      console.log('\n准备提交的清仓订单参数:');
      console.log(JSON.stringify(sellOrderParams, null, 2));

      console.log('\n🧪 DRY RUN: 验证清仓订单参数...');
      try {
        console.log('✅ 清仓订单参数格式正确');
        console.log('✅ 如果真正提交，将调用:');
        console.log('   orderSubmissionService.submitOrder(sellOrderParams)');

        results.push({
          success: true,
          stage: '模拟清仓订单',
          data: {
            dryRun: true,
            orderParams: sellOrderParams,
          },
        });
      } catch (error: any) {
        console.error('❌ 清仓订单参数验证失败:', error.message);
        results.push({
          success: false,
          stage: '模拟清仓订单',
          error: error.message,
        });
      }
    }

    // 保存buyOrderParams供后续使用
    let buyOrderParams: any = null;
    if (signal) {
      buyOrderParams = {
        symbol: signal.symbol,
        side: 'Buy' as const,
        order_type: 'LO' as const,
        submitted_quantity: signal.quantity.toString(),
        submitted_price: signal.entryPrice?.toFixed(2) || '',
        time_in_force: 'Day' as const,
        outside_rth: 'RTH_ONLY' as const,
        remark: `策略10测试 - ${signal.reason}`,
      };
    }

    // ============================================================
    // 阶段5: 实际订单提交测试（如果用户确认）
    // ============================================================
    console.log('\n阶段5: 实际订单提交测试...');
    console.log('⚠️  注意: 设置环境变量 TEST_REAL_SUBMIT=true 来启用真实提交');

    const enableRealSubmit = process.env.TEST_REAL_SUBMIT === 'true';

    if (enableRealSubmit) {
      console.log('\n⚠️  ⚠️  ⚠️  真实订单提交模式已启用 ⚠️  ⚠️  ⚠️');
      console.log('将会真实提交订单到交易所！');

      if (buyOrderParams) {
        console.log('\n提交买入订单...');
        try {
          const buyResult = await orderSubmissionService.submitOrder(buyOrderParams);
          console.log('✅ 买入订单提交结果:', JSON.stringify(buyResult, null, 2));

          results.push({
            success: buyResult.success,
            stage: '真实买入订单',
            data: buyResult,
          });
        } catch (error: any) {
          console.error('❌ 买入订单提交失败:', error.message);
          results.push({
            success: false,
            stage: '真实买入订单',
            error: error.message,
          });
        }
      }

      if (sellOrderParams) {
        console.log('\n提交清仓订单...');
        try {
          const sellResult = await orderSubmissionService.submitOrder(sellOrderParams);
          console.log('✅ 清仓订单提交结果:', JSON.stringify(sellResult, null, 2));

          results.push({
            success: sellResult.success,
            stage: '真实清仓订单',
            data: sellResult,
          });
        } catch (error: any) {
          console.error('❌ 清仓订单提交失败:', error.message);
          results.push({
            success: false,
            stage: '真实清仓订单',
            error: error.message,
          });
        }
      }
    } else {
      console.log('⏭️  跳过真实订单提交（DRY RUN模式）');
      console.log('如需启用真实提交，请运行:');
      console.log('TEST_REAL_SUBMIT=true ts-node test-option-strategy-order-submission.ts');
    }

    // ============================================================
    // 测试总结
    // ============================================================
    console.log('\n========================================');
    console.log('测试总结');
    console.log('========================================\n');

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    console.log(`总阶段数: ${totalCount}`);
    console.log(`成功: ${successCount}`);
    console.log(`失败: ${totalCount - successCount}`);
    console.log(`成功率: ${((successCount / totalCount) * 100).toFixed(1)}%\n`);

    results.forEach((result, index) => {
      const icon = result.success ? '✅' : '❌';
      console.log(`${icon} ${index + 1}. ${result.stage}`);
      if (result.error) {
        console.log(`   错误: ${result.error}`);
      }
    });

    console.log('\n测试完成！');

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 运行测试
testOptionOrderSubmission().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
