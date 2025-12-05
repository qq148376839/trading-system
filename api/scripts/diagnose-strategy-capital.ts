/**
 * 诊断策略资金配置脚本
 * 用于检查策略的资金分配配置是否正确
 */

import pool from '../src/config/database';
import capitalManager from '../src/services/capital-manager.service';

async function diagnoseStrategy(strategyId: number) {
  console.log(`\n========== 诊断策略 ${strategyId} 的资金配置 ==========\n`);

  try {
    // 1. 查询策略基本信息
    const strategyResult = await pool.query(
      `SELECT s.id, s.name, s.type, s.capital_allocation_id, s.status,
              ca.id as allocation_id, ca.name as allocation_name,
              ca.allocation_type, ca.allocation_value, ca.current_usage
       FROM strategies s
       LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
       WHERE s.id = $1`,
      [strategyId]
    );

    if (strategyResult.rows.length === 0) {
      console.error(`❌ 策略 ${strategyId} 不存在`);
      return;
    }

    const strategy = strategyResult.rows[0];
    console.log('📋 策略基本信息:');
    console.log(`   策略ID: ${strategy.id}`);
    console.log(`   策略名称: ${strategy.name}`);
    console.log(`   策略类型: ${strategy.type}`);
    console.log(`   策略状态: ${strategy.status}`);
    console.log(`   资金分配ID: ${strategy.capital_allocation_id || '❌ 未配置'}`);

    // 2. 检查资金分配配置
    if (!strategy.capital_allocation_id) {
      console.log('\n⚠️  问题: 策略未配置资金分配账户');
      console.log('   解决方案: 需要为策略分配一个资金分配账户');
      console.log('   可以使用 API: POST /api/quant/capital/allocations 创建资金分配账户');
      console.log('   然后使用 API: PUT /api/quant/strategies/:id 更新策略的 capital_allocation_id');
      return;
    }

    if (!strategy.allocation_id) {
      console.log('\n⚠️  问题: 资金分配账户不存在');
      console.log(`   配置的 capital_allocation_id: ${strategy.capital_allocation_id}`);
      console.log('   解决方案: 检查资金分配账户是否被删除，或重新创建并关联');
      return;
    }

    console.log('\n💰 资金分配配置:');
    console.log(`   分配账户ID: ${strategy.allocation_id}`);
    console.log(`   分配账户名称: ${strategy.allocation_name}`);
    console.log(`   分配类型: ${strategy.allocation_type}`);
    console.log(`   分配值: ${strategy.allocation_value}`);
    console.log(`   当前使用: ${strategy.current_usage || 0}`);

    // 3. 获取账户总资金
    console.log('\n💵 账户资金信息:');
    const totalCapital = await capitalManager.getTotalCapital();
    console.log(`   账户总资金: $${totalCapital.toFixed(2)}`);

    // 4. 计算策略可用资金
    console.log('\n📊 策略可用资金计算:');
    let allocatedAmount = 0;
    if (strategy.allocation_type === 'PERCENTAGE') {
      allocatedAmount = totalCapital * parseFloat(strategy.allocation_value.toString());
      console.log(`   分配金额 = 总资金 × ${(parseFloat(strategy.allocation_value.toString()) * 100).toFixed(2)}%`);
      console.log(`   = $${totalCapital.toFixed(2)} × ${parseFloat(strategy.allocation_value.toString())}`);
      console.log(`   = $${allocatedAmount.toFixed(2)}`);
    } else {
      allocatedAmount = parseFloat(strategy.allocation_value.toString());
      console.log(`   分配金额 = $${allocatedAmount.toFixed(2)} (固定金额)`);
    }

    const currentUsage = parseFloat(strategy.current_usage || '0');
    const availableAmount = Math.max(0, allocatedAmount - currentUsage);
    
    console.log(`   已使用: $${currentUsage.toFixed(2)}`);
    console.log(`   可用资金: $${availableAmount.toFixed(2)}`);

    // 5. 使用 getAvailableCapital 方法验证
    console.log('\n🔍 验证 getAvailableCapital 方法:');
    const availableCapital = await capitalManager.getAvailableCapital(strategyId);
    console.log(`   返回结果: $${availableCapital.toFixed(2)}`);

    if (availableAmount !== availableCapital) {
      console.warn(`   ⚠️  计算结果不一致！`);
    } else {
      console.log(`   ✅ 计算结果一致`);
    }

    // 6. 总结
    console.log('\n========== 诊断总结 ==========');
    if (availableCapital <= 0) {
      console.log('❌ 策略可用资金为 0，无法进行交易');
      if (allocatedAmount <= 0) {
        console.log('   原因: 分配金额为 0 或负数');
      } else if (currentUsage >= allocatedAmount) {
        console.log('   原因: 已使用资金已达到或超过分配金额');
        console.log(`   建议: 检查是否有未释放的资金占用，或增加分配金额`);
      }
    } else {
      console.log(`✅ 策略可用资金正常: $${availableCapital.toFixed(2)}`);
    }

  } catch (error: any) {
    console.error('诊断失败:', error);
  } finally {
    await pool.end();
  }
}

// 从命令行参数获取策略ID
const strategyId = process.argv[2] ? parseInt(process.argv[2]) : 3;
diagnoseStrategy(strategyId).catch(console.error);


