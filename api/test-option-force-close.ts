/**
 * 测试期权策略的盘中强制平仓功能
 *
 * 场景：模拟策略调度器在盘中最后30分钟检测到期权持仓，发起强制平仓
 * 注意：期权只能在盘中交易（09:30-16:00 ET）
 *
 * 使用已有的AMZN持仓作为测试标的
 */

import { config } from 'dotenv';
import path from 'path';

// 加载环境变量
const envPath = path.resolve(__dirname, '.env');
const result = config({ path: envPath });
if (result.parsed) {
  console.log(`成功加载.env文件: ${envPath}`);
} else {
  console.warn('未找到.env文件或加载失败');
}

import orderSubmissionService from './src/services/order-submission.service';
import { getTradeContext } from './src/config/longport';

// 测试配置
const TEST_REAL_SUBMIT = process.env.TEST_REAL_SUBMIT === 'true' || true; // 真实提交测试
const TEST_SYMBOL_FILTER = 'AMZN'; // 只测试AMZN持仓
const TEST_SIMULATE_OPTION = true; // 模拟期权持仓进行测试

interface TestResult {
  step: string;
  status: 'success' | 'error' | 'skip';
  message: string;
  data?: any;
}

const testResults: TestResult[] = [];

function logResult(result: TestResult) {
  testResults.push(result);
  const icon = result.status === 'success' ? '✅' : result.status === 'error' ? '❌' : '⏭️';
  console.log(`\n${icon} [${result.step}] ${result.message}`);
  if (result.data) {
    console.log('   数据:', JSON.stringify(result.data, null, 2));
  }
}

async function testStep1_GetPositions() {
  console.log('\n' + '='.repeat(80));
  console.log('步骤1: 获取当前持仓');
  console.log('='.repeat(80));

  try {
    // 使用LongPort SDK直接获取持仓
    const ctx = await getTradeContext();
    const stockPositions = await ctx.stockPositions();

    if (!stockPositions || stockPositions.channels.length === 0) {
      logResult({
        step: '步骤1',
        status: 'error',
        message: '未找到任何持仓',
      });
      return null;
    }

    // 提取所有持仓
    const allPositions: any[] = [];
    for (const channel of stockPositions.channels) {
      for (const pos of channel.positions) {
        allPositions.push({
          symbol: pos.symbol,
          quantity: parseInt(pos.quantity),
          cost_price: parseFloat(pos.costPrice),
          market_price: parseFloat(pos.price || pos.costPrice),
        });
      }
    }

    console.log(`\n  ✓ 找到 ${allPositions.length} 个持仓`);

    // 过滤AMZN持仓
    const amznPositions = allPositions.filter(p => p.symbol.includes(TEST_SYMBOL_FILTER));

    if (amznPositions.length === 0) {
      logResult({
        step: '步骤1',
        status: 'error',
        message: `未找到${TEST_SYMBOL_FILTER}相关持仓`,
        data: {
          allSymbols: allPositions.map(p => p.symbol),
        },
      });
      return null;
    }

    console.log(`\n  ✓ 找到 ${amznPositions.length} 个${TEST_SYMBOL_FILTER}持仓:`);
    amznPositions.forEach(p => {
      console.log(`    - ${p.symbol}: ${p.quantity}张, 成本$${p.cost_price}, 当前价$${p.market_price}`);
    });

    // 如果启用模拟期权持仓测试，添加一个虚拟的期权持仓
    if (TEST_SIMULATE_OPTION) {
      console.log(`\n  ⚠️  模拟测试模式：添加虚拟期权持仓`);
      const simulatedOption = {
        symbol: 'QQQ260130P395000.US', // 使用刚才买入的真实期权（今天到期）
        quantity: 1,
        cost_price: 0.01,
        market_price: 0.01,
      };
      amznPositions.push(simulatedOption);
      console.log(`    - ${simulatedOption.symbol}: ${simulatedOption.quantity}张, 成本$${simulatedOption.cost_price}, 当前价$${simulatedOption.market_price} [模拟]`);
    }

    logResult({
      step: '步骤1',
      status: 'success',
      message: `获取持仓成功，找到${amznPositions.length}个持仓（含${TEST_SIMULATE_OPTION ? '1个模拟期权' : '0个期权'}）`,
      data: amznPositions.map(p => ({
        symbol: p.symbol,
        quantity: p.quantity,
        cost_price: p.cost_price,
        market_price: p.market_price,
      })),
    });

    return amznPositions;
  } catch (error: any) {
    logResult({
      step: '步骤1',
      status: 'error',
      message: `获取持仓失败: ${error.message}`,
    });
    throw error;
  }
}

async function testStep2_SubmitCloseOrders(positions: any[]) {
  console.log('\n' + '='.repeat(80));
  console.log('步骤2: 提交强制平仓订单');
  console.log('='.repeat(80));

  const results: any[] = [];

  for (const position of positions) {
    console.log(`\n  处理持仓: ${position.symbol} (${position.quantity}张)`);

    try {
      // 2.1 判断是否为期权（symbol包含日期和CP标识）
      const isOption = /[0-9]{6}[CP][0-9]+/.test(position.symbol);

      console.log(`  ✓ 持仓类型: ${isOption ? '期权' : '股票'}`);

      // 2.2 提交卖出订单
      // 对于期权：使用市价单，确保100%成交（末日期权流动性差）
      // 对于股票：使用限价单，保护价格
      let orderParams: any;

      if (isOption) {
        // 期权：市价单
        orderParams = {
          symbol: position.symbol,
          side: 'Sell' as const,
          order_type: 'MO' as const, // Market Order
          submitted_quantity: String(Math.abs(position.quantity)),
          outside_rth: 'RTH_ONLY' as const,
          time_in_force: 'Day' as const,
          remark: `盘中强制平仓（市价单） - ${position.symbol}`,
        };
        console.log(`  ✓ 使用市价单（Market Order）确保成交`);
      } else {
        // 股票：限价单（95%市价）
        const closePrice = position.market_price || position.cost_price;
        const limitPrice = (closePrice * 0.95).toFixed(2);

        orderParams = {
          symbol: position.symbol,
          side: 'Sell' as const,
          order_type: 'LO' as const, // Limit Order
          submitted_quantity: String(Math.abs(position.quantity)),
          submitted_price: limitPrice,
          outside_rth: 'RTH_ONLY' as const,
          time_in_force: 'Day' as const,
          remark: `盘中强制平仓（限价单） - ${position.symbol}`,
        };
        console.log(`  ✓ 使用限价单: $${limitPrice} (市价: $${closePrice})`);
      }

      console.log('\n  订单参数:');
      console.log(JSON.stringify(orderParams, null, 2));

      if (TEST_REAL_SUBMIT) {
        console.log('\n  🚀 提交真实订单...');

        const submitResult = await orderSubmissionService.submitOrder(orderParams);

        if (!submitResult.success) {
          const errorMsg = typeof submitResult.error === 'string'
            ? submitResult.error
            : submitResult.error?.message || '订单提交失败';
          throw new Error(errorMsg);
        }

        console.log(`  ✓ 订单提交成功: ${submitResult.orderId}`);

        results.push({
          symbol: position.symbol,
          orderId: submitResult.orderId,
          quantity: orderParams.submitted_quantity,
          price: orderParams.submitted_price,
          status: 'success',
        });
      } else {
        console.log('\n  ℹ️  DRY RUN 模式（不提交真实订单）');

        results.push({
          symbol: position.symbol,
          orderId: 'DRY_RUN',
          quantity: orderParams.submitted_quantity,
          price: orderParams.submitted_price,
          status: 'dry_run',
        });
      }
    } catch (error: any) {
      console.error(`  ❌ 平仓失败: ${error.message}`);

      results.push({
        symbol: position.symbol,
        status: 'error',
        error: error.message,
      });
    }
  }

  // 统计结果
  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  logResult({
    step: '步骤2',
    status: errorCount === 0 ? 'success' : 'error',
    message: `提交平仓订单完成: ${successCount}成功, ${errorCount}失败`,
    data: results,
  });

  return results;
}

async function main() {
  console.log('========================================');
  console.log('期权策略盘中强制平仓测试');
  console.log('========================================');
  console.log(`测试标的: ${TEST_SYMBOL_FILTER}`);
  console.log(`真实提交: ${TEST_REAL_SUBMIT ? '是 ⚠️' : '否'}`);
  console.log('场景说明: 盘中最后30分钟强制平仓（期权只能盘中交易）');
  console.log('========================================\n');

  try {
    // 步骤1: 获取持仓
    const positions = await testStep1_GetPositions();
    if (!positions || positions.length === 0) {
      console.log('\n❌ 测试终止：未找到测试持仓\n');
      return;
    }

    // 步骤2: 提交平仓订单
    await testStep2_SubmitCloseOrders(positions);

    // 测试总结
    console.log('\n' + '='.repeat(80));
    console.log('测试总结');
    console.log('='.repeat(80));

    const successCount = testResults.filter(r => r.status === 'success').length;
    const errorCount = testResults.filter(r => r.status === 'error').length;
    const skipCount = testResults.filter(r => r.status === 'skip').length;

    console.log(`\n总步骤数: ${testResults.length}`);
    console.log(`✅ 成功: ${successCount}`);
    console.log(`❌ 失败: ${errorCount}`);
    console.log(`⏭️  跳过: ${skipCount}`);

    if (errorCount === 0) {
      console.log('\n🎉 强制平仓测试完全成功！\n');
      console.log('关键发现:');
      console.log('✅ 1. 持仓获取正常');
      console.log('✅ 2. 平仓订单参数正确');
      console.log('✅ 3. 订单提交成功');
    } else {
      console.log('\n⚠️  测试发现问题，请检查失败步骤\n');
    }

    console.log('='.repeat(80) + '\n');
  } catch (error: any) {
    console.error('\n测试异常:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  console.log('测试完成！');
  process.exit(0);
}

main();
