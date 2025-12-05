# 增强日志补丁说明

## 目的

为 `account-balance-sync.service.ts` 添加详细的日志输出，便于定位资金使用差异问题。

## 修改内容

### 1. 添加Symbol标准化函数

在 `AccountBalanceSyncService` 类中添加：

```typescript
/**
 * 标准化Symbol格式
 * 确保symbol格式一致，便于匹配
 */
private normalizeSymbol(symbol: string): string {
  if (!symbol) return symbol;
  
  // 如果symbol不包含市场后缀，添加.US（美股默认）
  if (!symbol.includes('.')) {
    return `${symbol}.US`;
  }
  
  return symbol.toUpperCase();
}
```

### 2. 增强持仓数据日志

在构建 `positionMap` 后添加：

```typescript
// 3. 获取实际持仓（从 SDK）
const positions = await tradeCtx.stockPositions();
const positionMap = new Map<string, number>();

if (positions && positions.positions) {
  logger.debug(`[账户余额同步] 获取到 ${positions.positions.length} 个实际持仓`);
  
  for (const pos of positions.positions) {
    const symbol = pos.symbol;
    const quantity = parseInt(pos.quantity?.toString() || '0');
    const price = parseFloat(pos.currentPrice?.toString() || '0');
    const positionValue = quantity * price;
    
    if (positionValue > 0) {
      // 存储原始格式
      positionMap.set(symbol, positionValue);
      
      // 同时存储标准化格式（如果不同）
      const normalizedSymbol = this.normalizeSymbol(symbol);
      if (normalizedSymbol !== symbol) {
        positionMap.set(normalizedSymbol, positionValue);
        logger.debug(`[账户余额同步] Symbol格式转换: ${symbol} -> ${normalizedSymbol}, 价值=${positionValue.toFixed(2)}`);
      }
    }
  }
  
  logger.debug(`[账户余额同步] positionMap构建完成，共 ${positionMap.size} 个条目`);
  logger.debug(`[账户余额同步] positionMap keys: ${Array.from(positionMap.keys()).join(', ')}`);
} else {
  logger.warn('[账户余额同步] 实际持仓数据为空或格式异常');
  logger.debug(`[账户余额同步] positions数据: ${JSON.stringify(positions)}`);
}
```

### 3. 增强策略资金使用计算日志

在计算 `actualUsage` 时添加：

```typescript
// 计算策略实际使用的资金（从持仓）
let actualUsage = 0;
const strategyPositions = await pool.query(`
  SELECT symbol FROM strategy_instances 
  WHERE strategy_id = $1 AND current_state = 'HOLDING'
`, [strategy.strategy_id]);

logger.debug(
  `[账户余额同步] 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
  `资金使用计算开始:`
);
logger.debug(`  - HOLDING状态标的数量: ${strategyPositions.rows.length}`);
logger.debug(`  - positionMap大小: ${positionMap.size}`);

if (strategyPositions.rows.length > 0) {
  logger.debug(`  - HOLDING状态标的列表: ${strategyPositions.rows.map((r: any) => r.symbol).join(', ')}`);
}

for (const instance of strategyPositions.rows) {
  const originalSymbol = instance.symbol;
  const normalizedSymbol = this.normalizeSymbol(originalSymbol);
  
  // 尝试多种格式匹配
  let positionValue = positionMap.get(originalSymbol) || 0;
  if (positionValue === 0 && normalizedSymbol !== originalSymbol) {
    positionValue = positionMap.get(normalizedSymbol) || 0;
  }
  
  if (positionValue === 0) {
    logger.warn(
      `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${originalSymbol} ` +
      `状态为HOLDING但实际持仓中未找到匹配（尝试了 ${originalSymbol} 和 ${normalizedSymbol}）`
    );
  } else {
    logger.debug(
      `[账户余额同步] 策略 ${strategy.strategy_name} 标的 ${originalSymbol}: ` +
      `匹配成功，持仓价值=${positionValue.toFixed(2)}`
    );
  }
  
  actualUsage += positionValue;
}

logger.debug(
  `[账户余额同步] 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
  `实际使用值: ${actualUsage.toFixed(2)}`
);
```

### 4. 增强差异检测日志

在检测到差异时添加：

```typescript
// 对比数据库记录的使用量
const recordedUsage = parseFloat(strategy.current_usage?.toString() || '0');
const difference = Math.abs(actualUsage - recordedUsage);

// 如果差异超过 1%（或 $10），记录为差异
const threshold = Math.max(expectedAllocation * 0.01, 10);

logger.debug(
  `[账户余额同步] 策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) ` +
  `资金使用对比:`
);
logger.debug(`  - 记录值: ${recordedUsage.toFixed(2)}`);
logger.debug(`  - 实际值: ${actualUsage.toFixed(2)}`);
logger.debug(`  - 差异: ${difference.toFixed(2)}`);
logger.debug(`  - 阈值: ${threshold.toFixed(2)}`);

if (difference > threshold) {
  discrepancies.push({
    strategyId: strategy.strategy_id,
    expected: recordedUsage,
    actual: actualUsage,
    difference,
  });

  logger.warn(
    `策略 ${strategy.strategy_name} (ID: ${strategy.strategy_id}) 资金使用差异: ` +
    `记录值 ${recordedUsage.toFixed(2)}, 实际值 ${actualUsage.toFixed(2)}, ` +
    `差异 ${difference.toFixed(2)}`
  );
  
  // 输出详细的诊断信息
  logger.warn(
    `[诊断信息] ` +
    `HOLDING状态标的: ${strategyPositions.rows.map((r: any) => r.symbol).join(', ') || '无'}, ` +
    `positionMap keys: ${Array.from(positionMap.keys()).join(', ') || '无'}`
  );
}
```

### 5. 添加资金释放日志

在 `capital-manager.service.ts` 的 `releaseAllocation` 方法中添加：

```typescript
async releaseAllocation(strategyId: number, amount: number, _symbol?: string): Promise<void> {
  const strategyResult = await pool.query(
    `SELECT ca.id as allocation_id, ca.current_usage, ca.name as allocation_name
     FROM strategies s
     LEFT JOIN capital_allocations ca ON s.capital_allocation_id = ca.id
     WHERE s.id = $1`,
    [strategyId]
  );

  if (strategyResult.rows.length === 0 || !strategyResult.rows[0].allocation_id) {
    throw new Error(`策略 ${strategyId} 不存在或未配置资金分配账户`);
  }

  const allocationId = strategyResult.rows[0].allocation_id;
  const beforeUsage = parseFloat(strategyResult.rows[0].current_usage?.toString() || '0');
  const allocationName = strategyResult.rows[0].allocation_name || '未知';

  logger.debug(
    `[资金释放] 策略 ${strategyId}, 标的 ${_symbol || 'N/A'}, ` +
    `释放金额=${amount.toFixed(2)}, 释放前current_usage=${beforeUsage.toFixed(2)}`
  );

  const updateResult = await pool.query(
    `UPDATE capital_allocations 
     SET current_usage = GREATEST(0, current_usage - $1), updated_at = NOW()
     WHERE id = $2
     RETURNING current_usage`,
    [amount, allocationId]
  );

  if (updateResult.rows.length > 0) {
    const afterUsage = parseFloat(updateResult.rows[0].current_usage?.toString() || '0');
    logger.debug(
      `[资金释放] 策略 ${strategyId}, 分配账户 ${allocationName} (ID: ${allocationId}), ` +
      `释放后current_usage=${afterUsage.toFixed(2)}`
    );
  } else {
    logger.error(`[资金释放] 策略 ${strategyId} 资金释放失败，更新结果为空`);
  }
}
```

## 使用方法

1. 将上述代码片段添加到对应的文件中
2. 确保日志级别设置为 `DEBUG` 以查看详细日志
3. 重新运行账户余额同步，观察日志输出
4. 根据日志输出定位问题根因

## 预期日志输出示例

```
[DEBUG] [账户余额同步] 获取到 9 个实际持仓
[DEBUG] [账户余额同步] Symbol格式转换: SHOP -> SHOP.US, 价值=486.93
[DEBUG] [账户余额同步] positionMap构建完成，共 18 个条目
[DEBUG] [账户余额同步] positionMap keys: SHOP, SHOP.US, ROKU, ROKU.US, ...
[DEBUG] [账户余额同步] 策略 ark投资 (ID: 5) 资金使用计算开始:
[DEBUG]   - HOLDING状态标的数量: 9
[DEBUG]   - positionMap大小: 18
[DEBUG]   - HOLDING状态标的列表: SHOP.US, ROKU.US, PLTR.US, ...
[DEBUG] [账户余额同步] 策略 ark投资 标的 SHOP.US: 匹配成功，持仓价值=486.93
[DEBUG] [账户余额同步] 策略 ark投资 (ID: 5) 实际使用值: 25145.17
[DEBUG] [账户余额同步] 策略 ark投资 (ID: 5) 资金使用对比:
[DEBUG]   - 记录值: 25145.17
[DEBUG]   - 实际值: 25145.17
[DEBUG]   - 差异: 0.00
[DEBUG]   - 阈值: 251.45
```

## 注意事项

1. 日志级别需要设置为 `DEBUG` 才能看到详细日志
2. 如果日志输出过多，可以只针对有差异的策略输出详细日志
3. 建议在生产环境中使用日志聚合工具（如ELK）来管理大量日志

