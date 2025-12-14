# 状态同步和资金自动修复功能

**添加时间**: 2025-12-05  
**功能状态**: ✅ **已实现**

---

## 🎯 功能说明

### 问题背景

从日志分析发现：
- 数据库中有9个HOLDING状态的标的，但实际持仓只有3个
- 7个标的（COIN.US, ROKU.US, TEM.US, PLTR.US, HOOD.US, CRSP.US, SHOP.US）状态为HOLDING但实际持仓中不存在
- 资金使用差异：记录值 25145.17，实际值 8111.33，差异 17033.84

**根本原因**: 这些标的已经被卖出，但数据库状态没有更新，资金没有释放。

### 解决方案

在账户余额同步时，自动检测并修复状态不一致：
1. **检测状态不一致**: 如果数据库状态为HOLDING但实际持仓不存在
2. **更新状态**: 将状态从HOLDING更新为IDLE
3. **释放资金**: 从context中获取allocationAmount，释放对应的资金

---

## ✅ 实现内容

### 1. 状态不一致检测

在计算实际使用值时，记录所有状态为HOLDING但实际持仓不存在的标的：

```typescript
const symbolsToFix: Array<{ symbol: string; context: any }> = [];

for (const instance of strategyPositions.rows) {
  // ... 匹配逻辑 ...
  
  if (positionValue === 0) {
    // 记录需要修复的标的
    const instanceDetail = await pool.query(
      `SELECT context FROM strategy_instances 
       WHERE strategy_id = $1 AND symbol = $2`,
      [strategy.strategy_id, originalSymbol]
    );
    
    let context: any = {};
    // 解析context...
    
    symbolsToFix.push({ symbol: originalSymbol, context });
  }
}
```

### 2. 自动修复逻辑

遍历需要修复的标的，执行修复：

```typescript
for (const { symbol, context } of symbolsToFix) {
  // 1. 更新状态为IDLE
  await stateManager.updateState(strategy.strategy_id, symbol, 'IDLE');
  
  // 2. 释放资金（如果有allocationAmount记录）
  if (context && context.allocationAmount) {
    const allocationAmount = parseFloat(context.allocationAmount.toString() || '0');
    if (allocationAmount > 0) {
      await capitalManager.releaseAllocation(
        strategy.strategy_id,
        allocationAmount,
        symbol
      );
    }
  }
}
```

### 3. 日志输出

修复过程中会输出详细的日志：

```
[WARN] [账户余额同步] 策略 ark投资 (ID: 5) 发现 7 个状态不一致的标的，开始自动修复...
[LOG] [账户余额同步] 策略 ark投资 标的 COIN.US: 状态已从HOLDING更新为IDLE（实际持仓不存在）
[LOG] [账户余额同步] 策略 ark投资 标的 COIN.US: 已释放资金 4922.28
```

---

## 📊 预期效果

### 修复前
```
[WARN] 策略 ark投资 (ID: 5) 资金使用差异: 记录值 25145.17, 实际值 8111.33, 差异 17033.84
[WARN] [账户余额同步] 策略 ark投资 标的 COIN.US 状态为HOLDING但实际持仓中未找到匹配
```

### 修复后（预期）
```
[WARN] [账户余额同步] 策略 ark投资 (ID: 5) 发现 7 个状态不一致的标的，开始自动修复...
[LOG] [账户余额同步] 策略 ark投资 标的 COIN.US: 状态已从HOLDING更新为IDLE（实际持仓不存在）
[LOG] [账户余额同步] 策略 ark投资 标的 COIN.US: 已释放资金 4922.28
...
[LOG] 账户余额同步完成: 总资金 105249.71 USD
```

下次同步时，资金使用差异应该会显著减少或消失。

---

## 🔍 修复流程

### 完整流程

1. **账户余额同步触发**（每5分钟）
2. **获取实际持仓数据**（从Longbridge SDK）
3. **查询数据库非IDLE状态标的**（HOLDING, OPENING, CLOSING）
4. **查询未成交订单**（用于判断OPENING/CLOSING状态是否合理）
5. **匹配实际持仓**
6. **检测状态不一致**：
   - HOLDING但实际持仓不存在
   - OPENING但实际持仓不存在且无未成交订单
   - CLOSING但实际持仓不存在且无未成交订单
7. **自动修复**：
   - 更新状态为IDLE
   - 释放资金（如果有allocationAmount）
8. **记录日志和统计**

### 修复条件

标的会被自动修复的条件（满足以下任一情况）：
- ✅ 数据库状态为 `HOLDING` 且实际持仓不存在
- ✅ 数据库状态为 `OPENING` 且实际持仓不存在且无未成交订单
- ✅ 数据库状态为 `CLOSING` 且实际持仓不存在且无未成交订单
- ✅ 尝试了原始symbol和标准化symbol都未匹配

### 资金释放条件

资金会被自动释放的条件：
- ✅ 标的状态已更新为IDLE
- ✅ context中存在 `allocationAmount` 字段
- ✅ `allocationAmount > 0`

---

## ⚠️ 注意事项

### 1. Context中必须有allocationAmount

如果context中没有 `allocationAmount`，资金无法自动释放，需要手动处理。

**建议**: 确保在买入时，context中保存了 `allocationAmount`。

### 2. 修复是自动的但需要时间

修复会在下次账户余额同步时执行（默认5分钟间隔）。

**建议**: 如果需要立即修复，可以手动触发账户余额同步。

### 3. 修复可能失败

如果修复过程中出现错误（如数据库连接失败、资金释放失败等），会记录错误日志但不会中断同步流程。

**建议**: 监控日志，及时发现和处理修复失败的情况。

---

## 🧪 测试建议

### 测试场景1: 正常修复

1. 手动将某个标的的状态设置为HOLDING
2. 确保该标的在实际持仓中不存在
3. 等待账户余额同步（或手动触发）
4. 验证状态已更新为IDLE
5. 验证资金已释放

### 测试场景2: 缺少allocationAmount

1. 手动将某个标的的状态设置为HOLDING
2. 清除context中的allocationAmount
3. 等待账户余额同步
4. 验证状态已更新为IDLE
5. 验证日志中有警告（缺少allocationAmount）

### 测试场景3: 修复失败处理

1. 模拟数据库连接失败
2. 验证修复失败时不会中断同步流程
3. 验证错误日志正确记录

---

## 📝 相关文件

- `api/src/services/account-balance-sync.service.ts` - 账户余额同步服务（已修改）
- `api/src/services/state-manager.service.ts` - 状态管理服务（已使用）
- `api/src/services/capital-manager.service.ts` - 资金管理服务（已使用）

---

## ✅ 验证清单

- [x] 状态不一致检测逻辑已实现
- [x] 自动修复逻辑已实现
- [x] 资金释放逻辑已实现
- [x] 日志输出已完善
- [x] 错误处理已实现
- [ ] 功能测试（需要重新部署后验证）
- [ ] 验证修复后的资金使用差异是否减少

---

## 📌 下一步行动

1. **立即行动**:
   - ✅ 代码已实现
   - ⏳ 重新部署服务
   - ⏳ 观察日志输出，验证修复效果

2. **短期优化**:
   - 添加修复统计（修复了多少标的，释放了多少资金）
   - 添加修复历史记录
   - 优化修复性能（批量更新）

3. **长期优化**:
   - 实现预防机制（避免状态不一致）
   - 添加修复报告（定期生成修复报告）
   - 完善监控告警

---

**功能完成时间**: 2025-12-05  
**开发人员**: AI Assistant  
**版本**: 1.0

