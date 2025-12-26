/**
 * 交易推送服务 unsubscribe 功能手动测试脚本
 * 
 * 使用方法：
 * npm run tsx scripts/test-trade-push-unsubscribe.ts
 */

import tradePushService from '../src/services/trade-push.service';

async function testUnsubscribe() {
  console.log('=== 交易推送服务 unsubscribe 功能测试 ===\n');

  // 测试1：检查初始状态
  console.log('测试1：检查初始状态');
  console.log(`isActive(): ${tradePushService.isActive()}`);
  console.log(`预期: false\n`);

  // 测试2：初始化服务
  console.log('测试2：初始化服务');
  try {
    await tradePushService.initialize();
    console.log(`isActive(): ${tradePushService.isActive()}`);
    console.log(`预期: true (如果SDK支持) 或 false (如果SDK不支持)\n`);
  } catch (error: any) {
    console.error(`初始化失败: ${error.message}\n`);
  }

  // 测试3：未订阅时调用 unsubscribe（幂等性测试）
  console.log('测试3：未订阅时调用 unsubscribe（幂等性测试）');
  (tradePushService as any).isSubscribed = false;
  try {
    await tradePushService.unsubscribe();
    console.log(`✅ 成功：未订阅时调用 unsubscribe 没有抛出错误`);
    console.log(`isActive(): ${tradePushService.isActive()}`);
    console.log(`预期: false\n`);
  } catch (error: any) {
    console.error(`❌ 失败: ${error.message}\n`);
  }

  // 测试4：已订阅时调用 unsubscribe
  if (tradePushService.isActive()) {
    console.log('测试4：已订阅时调用 unsubscribe');
    try {
      await tradePushService.unsubscribe();
      console.log(`✅ 成功：取消订阅完成`);
      console.log(`isActive(): ${tradePushService.isActive()}`);
      console.log(`预期: false\n`);
    } catch (error: any) {
      console.error(`❌ 失败: ${error.message}\n`);
    }
  } else {
    console.log('测试4：跳过（服务未激活）\n');
  }

  // 测试5：重复调用 unsubscribe（幂等性测试）
  console.log('测试5：重复调用 unsubscribe（幂等性测试）');
  try {
    await tradePushService.unsubscribe();
    await tradePushService.unsubscribe();
    await tradePushService.unsubscribe();
    console.log(`✅ 成功：重复调用 unsubscribe 没有抛出错误`);
    console.log(`isActive(): ${tradePushService.isActive()}`);
    console.log(`预期: false\n`);
  } catch (error: any) {
    console.error(`❌ 失败: ${error.message}\n`);
  }

  // 测试6：检查 tradeContext 状态
  console.log('测试6：检查 tradeContext 状态');
  const tradeContext = (tradePushService as any).tradeContext;
  if (tradeContext) {
    console.log(`✅ tradeContext 存在`);
    console.log(`unsubscribe 方法: ${tradeContext.unsubscribe ? '存在' : '不存在'}`);
    console.log(`clearOnOrderChanged 方法: ${tradeContext.clearOnOrderChanged ? '存在' : '不存在'}`);
    console.log(`setOnOrderChanged 方法: ${tradeContext.setOnOrderChanged ? '存在' : '不存在'}\n`);
  } else {
    console.log(`⚠️ tradeContext 不存在（可能初始化失败）\n`);
  }

  console.log('=== 测试完成 ===');
}

// 运行测试
testUnsubscribe().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});





