# 日志降噪优化 - 减少数据库写入

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-19
- **问题类型**：性能优化
- **优先级**：P1

---

## 1. 问题描述

### 1.1 问题现象
虽然实现了日志聚合机制，但每次策略执行仍然写入大量日志到数据库：
- 策略汇总日志：1条 ✅
- 信号生成日志：9条 ❌（应该不写入数据库）
- 其他详细信息日志：多条 ❌（应该不写入数据库）

**实际效果**：每次策略执行写入 10+ 条日志，而不是预期的 1 条。

### 1.2 根本原因
根据PRD要求，日志应该分为两类：
1. **关键操作日志**：需要写入数据库（买入成功、卖出、止损止盈触发等）
2. **详细信息日志**：只输出到控制台，不写入数据库（信号生成、准备买入、资金不足等）

但当前实现中，所有日志都使用 `logger.log()`，导致全部写入数据库。

---

## 2. 优化方案

### 2.1 优化策略
将日志分为两类：
- **保留写入数据库**：关键操作（买入成功、卖出、止损止盈触发、订单成交等）
- **改为只输出到控制台**：详细信息（信号生成、准备买入、资金不足、状态同步等）

### 2.2 优化内容

#### 修改1：信号生成日志
**位置**：`processSymbol` 方法（第853行）

**修改前**：
```typescript
logger.log(`策略 ${strategyId} 标的 ${symbol}: 生成信号...`);
```

**修改后**：
```typescript
console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 生成信号...`);
```

**原因**：信号信息已在汇总日志的 `signals` 数组中，无需单独写入数据库。

#### 修改2：资金不足日志
**位置**：`processSymbol` 方法（第887行）

**修改前**：
```typescript
logger.log(`策略 ${strategyId} 标的 ${symbol}: 可用资金不足...`);
```

**修改后**：
```typescript
console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 可用资金不足...`);
```

**原因**：错误信息已在汇总日志的 `errors` 数组中，无需单独写入数据库。

#### 修改3：准备买入日志
**位置**：`processSymbol` 方法（第905行）

**修改前**：
```typescript
logger.log(`策略 ${strategyId} 标的 ${symbol}: 准备买入...`);
```

**修改后**：
```typescript
console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 准备买入...`);
```

**原因**：操作信息已在汇总日志的 `actions` 数组中，无需单独写入数据库。

#### 修改4：资金申请被拒绝日志
**位置**：`processSymbol` 方法（第915行）

**修改前**：
```typescript
logger.log(`策略 ${strategyId} 标的 ${symbol}: 资金申请被拒绝...`);
```

**修改后**：
```typescript
console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 资金申请被拒绝...`);
```

**原因**：错误信息已在汇总日志的 `errors` 数组中，无需单独写入数据库。

#### 修改5：设置默认止盈止损日志
**位置**：`processHoldingPosition` 方法（第1313行）

**修改前**：
```typescript
logger.log(`策略 ${strategyId} 标的 ${symbol}: 设置默认止盈止损`);
```

**修改后**：
```typescript
console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 设置默认止盈止损`);
```

**原因**：操作信息已在汇总日志的 `actions` 数组中，无需单独写入数据库。

#### 修改6：动态调整止盈/止损日志
**位置**：`processHoldingPosition` 方法（第1363行）

**修改前**：
```typescript
logger.log(`策略 ${strategyId} 标的 ${symbol}: 动态调整止盈/止损`);
```

**修改后**：
```typescript
console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 动态调整止盈/止损`);
```

**原因**：操作信息已在汇总日志的 `actions` 数组中，无需单独写入数据库。

#### 修改7：状态同步日志
**位置**：`syncPositionState` 方法（第1490行）

**修改前**：
```typescript
logger.log(`策略 ${strategyId} 标的 ${symbol}: 状态同步 - 从IDLE更新为HOLDING`);
```

**修改后**：
```typescript
console.log(`[${new Date().toISOString()}] 策略 ${strategyId} 标的 ${symbol}: 状态同步 - 从IDLE更新为HOLDING`);
```

**原因**：操作信息已在汇总日志的 `actions` 数组中，无需单独写入数据库。

---

## 3. 保留写入数据库的日志

以下关键操作日志**保留写入数据库**（使用 `logger.log()`）：

1. ✅ **买入订单已成交**（第531行）
2. ✅ **订单价格已更新**（第686行）
3. ✅ **订单已取消**（第738行）
4. ✅ **买入成功**（第966行）
5. ✅ **订单已提交**（第970行）
6. ✅ **触发止损**（第1335行）
7. ✅ **触发止盈**（第1339行）
8. ✅ **动态调整建议卖出**（第1353行）
9. ✅ **执行卖出**（第1405行）
10. ✅ **平仓完成**（第1440行）
11. ✅ **恢复HOLDING状态**（第1443行）

**原因**：这些是关键操作，需要持久化记录，便于后续分析和审计。

---

## 4. 优化效果

### 4.1 优化前
- **每次策略执行写入日志**：10+ 条
  - 策略汇总：1条
  - 信号生成：9条（每个标的1条）
  - 其他详细信息：多条

### 4.2 优化后
- **每次策略执行写入日志**：1-2 条
  - 策略汇总：1条（必需）
  - 关键操作：0-1条（仅在发生关键操作时写入）

### 4.3 预期效果
- ✅ **数据库写入减少**：从 10+ 条减少到 1-2 条（减少 80-90%）
- ✅ **控制台可见性**：所有详细信息仍然输出到控制台，便于实时监控
- ✅ **数据库存储优化**：大幅减少数据库存储空间和查询压力

---

## 5. 验证方法

### 5.1 验证步骤
1. **重启服务**：`npm run dev`
2. **等待策略执行**：等待策略执行一个周期（1分钟）
3. **查询数据库**：
   ```sql
   SELECT id, timestamp, level, module, message
   FROM system_logs 
   WHERE module = 'Strategy.Scheduler' 
   AND timestamp > NOW() - INTERVAL '2 minutes'
   ORDER BY timestamp DESC;
   ```

### 5.2 预期结果
- ✅ 应该只看到 1 条策略汇总日志
- ✅ 如果发生关键操作（买入成功、卖出等），会有额外的关键操作日志
- ✅ 不应该看到信号生成、准备买入等详细信息日志

---

## 6. 相关文件

- `api/src/services/strategy-scheduler.service.ts` - 策略调度器服务（已修改）
- `docs/features/251219-LOG_AGGREGATION_PRD.md` - 日志聚合PRD文档

---

## 7. 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-19 | 优化日志降噪，减少数据库写入 | AI Engineer |




