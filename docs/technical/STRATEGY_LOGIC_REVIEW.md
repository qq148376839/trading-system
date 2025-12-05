# 策略逻辑审查

**最后更新**: 2025-12-02

## 📋 概述

本文档详细说明量化交易策略的完整逻辑流程，包括状态管理、订单追踪、持仓监控等核心功能。

## 🔄 策略状态流转

### 状态定义

| 状态 | 说明 | 处理逻辑 |
|------|------|----------|
| `IDLE` | 空闲状态 | 生成买入信号，提交买入订单 |
| `OPENING` | 买入中 | 监控买入订单状态，成交后转为 `HOLDING` |
| `HOLDING` | 持仓中 | 检查止盈/止损，触发卖出条件时转为 `CLOSING` |
| `CLOSING` | 卖出中 | 监控卖出订单状态，成交后转为 `IDLE` |
| `COOLDOWN` | 冷却期 | 暂未使用 |

### 状态流转图

```
IDLE → OPENING → HOLDING → CLOSING → IDLE
         ↓          ↓          ↓
      (买入)    (持仓监控)  (卖出监控)
```

## 🎯 核心流程

### 1. 策略周期执行 (`runStrategyCycle`)

**触发时机**: 每分钟执行一次（可配置）

**执行流程**:
1. 获取策略配置和股票池
2. 遍历每个标的，调用 `processSymbol` 处理
3. 订单追踪由独立的定时器处理（每30秒）

### 2. 标的处理 (`processSymbol`)

**处理逻辑**:

```typescript
if (currentState === 'IDLE') {
  // 检查是否有实际持仓
  if (hasPosition) {
    // 同步状态为 HOLDING
    await syncPositionState(...);
    return;
  }
  
  // 检查是否有未成交订单
  if (hasPendingOrder) {
    return; // 跳过处理
  }
  
  // 生成买入信号
  const signal = await generateSignal(...);
  if (signal === 'BUY') {
    // 申请资金并提交买入订单
    await executeBuyIntent(...);
  }
}

if (currentState === 'HOLDING') {
  // 持仓监控：检查止盈/止损
  await processHoldingPosition(...);
}

if (currentState === 'CLOSING') {
  // 平仓监控：检查卖出订单状态
  await processClosingPosition(...);
}

if (currentState === 'OPENING') {
  // 跳过处理，由订单追踪处理
  return;
}
```

### 3. 持仓监控 (`processHoldingPosition`)

**执行流程**:
1. 获取持仓上下文（入场价、止损、止盈、数量）
2. 获取当前价格
3. 检查触发条件：
   - 止损触发：`currentPrice <= stopLoss`
   - 止盈触发：`currentPrice >= takeProfit`
   - 策略信号：生成 `SELL` 信号
4. 如果触发卖出条件，执行卖出操作

**关键代码**:
```typescript
// 检查止盈/止损
if (stopLoss && currentPrice <= stopLoss) {
  shouldSell = true;
  exitReason = 'STOP_LOSS';
} else if (takeProfit && currentPrice >= takeProfit) {
  shouldSell = true;
  exitReason = 'TAKE_PROFIT';
}

// 检查策略信号
const signal = await strategyInstance.generateSignal(...);
if (signal === 'SELL') {
  shouldSell = true;
  exitReason = 'STRATEGY_SIGNAL';
}

// 执行卖出
if (shouldSell) {
  await executeSellIntent(...);
}
```

### 4. 订单追踪 (`trackPendingOrders`)

**执行时机**: 每30秒执行一次（独立定时器）

**执行流程**:
1. **获取今日订单**：使用 `getTodayOrders(false)` 获取（使用60秒缓存）
2. **查询数据库订单**：查询所有订单（不限制状态）
3. **先筛选出未成交订单**（基于API实时状态）：
   - 严格排除所有已完成的订单（`FilledStatus`, `CanceledStatus`, `RejectedStatus` 等）
   - 只包含未成交的订单状态（`NotReported`, `NewStatus`, `WaitToNew` 等）
4. **同步订单状态到数据库**（在筛选之后）
5. **处理已成交订单**：更新策略实例状态，记录交易
6. **更新订单价格**（如果需要）：价格差异超过2%时自动更新

**关键优化**:
- 使用 `mapOrderData` 处理订单数据，确保状态正确（根据 `executedQuantity` 自动修正）
- 完全基于API实时状态筛选，不依赖数据库状态
- 先筛选后同步，避免状态滞后问题

### 5. 状态同步 (`syncPositionState`)

**触发时机**: 检测到有实际持仓但状态是 `IDLE` 时

**执行流程**:
1. 获取实际持仓信息（成本价、数量）
2. 计算默认止盈/止损（如果没有）：
   - 止损：成本价 × 0.95（-5%）
   - 止盈：成本价 × 1.10（+10%）
3. 更新策略实例状态为 `HOLDING`
4. 保存上下文（入场价、止损、止盈、数量）

## 💰 资金管理

### 资金分配流程

1. **获取可用资金** (`getAvailableCapital`)
   - 计算策略总资金
   - 扣除已分配资金
   - 返回可用资金

2. **申请资金** (`requestAllocation`)
   - 检查标的级限制（每个标的的最大持仓金额）
   - 检查可用资金是否充足
   - 分配资金并记录

3. **释放资金** (`releaseAllocation`)
   - 卖出订单成交时释放资金
   - 订单取消/拒绝时释放资金

### 标的级限制

**计算方式**:
```typescript
maxPositionPerSymbol = totalStrategyCapital / symbolPoolSize
```

**应用场景**:
- 计算买入数量时，使用 `Math.min(availableCapital, maxPositionPerSymbol)`
- 确保每个标的的持仓不超过限制

## 📊 订单管理

### 订单状态

| 状态 | 说明 | 处理方式 |
|------|------|----------|
| `NotReported` | 待提交 | 监控，不修改价格 |
| `NewStatus` | 已委托 | 监控，价格差异>2%时更新 |
| `WaitToNew` | 已提待报 | 监控，价格差异>2%时更新 |
| `FilledStatus` | 已成交 | 排除，更新策略状态 |
| `PartialFilledStatus` | 部分成交 | 排除（已成交部分不能修改） |
| `CanceledStatus` | 已取消 | 排除，释放资金 |
| `RejectedStatus` | 已拒绝 | 排除，释放资金 |

### 订单价格更新

**触发条件**:
- 订单状态为未成交（`NewStatus`, `WaitToNew` 等）
- 订单类型支持修改（限价单 `LO`，不支持市价单 `MO`）
- 当前价格与订单价格差异超过2%

**更新逻辑**:
```typescript
const priceDiff = Math.abs(currentPrice - orderPrice) / orderPrice;
if (priceDiff > 0.02) {
  const newPrice = currentPrice * 1.01; // 比当前价格高1%，确保能成交
  await replaceOrder({ orderId, quantity, price: newPrice });
}
```

## 🔍 关键优化点

### 1. 订单状态修正

**问题**: SDK返回的状态可能是数字格式（如 `5`），而不是字符串 `FilledStatus`

**解决**: 使用 `mapOrderData` 处理订单数据，根据 `executedQuantity` 自动修正状态

```typescript
if (executedQty > 0) {
  if (executedQty >= quantity) {
    status = 'FilledStatus';
  } else {
    status = 'PartialFilledStatus';
  }
}
```

### 2. 基于API状态筛选

**问题**: 数据库状态可能滞后，导致已成交订单进入价格更新流程

**解决**: 完全基于API实时状态筛选，先筛选后同步

### 3. 状态同步

**问题**: 状态是 `IDLE` 但实际有持仓，导致持仓监控不工作

**解决**: 自动同步实际持仓到策略实例状态

### 4. 日志优化

**问题**: 日志噪音太大，可读性差

**解决**: 降低常规流程日志级别，只保留关键信息

## 📚 相关文档

- [策略优化总结](STRATEGY_OPTIMIZATION_SUMMARY.md) - 所有策略优化的完整总结
- [订单修改逻辑审查](ORDER_MODIFICATION_LOGIC_REVIEW.md) - 订单修改逻辑修复详情
- [代码地图](../../CODE_MAP.md) - 项目文件结构和调用关系

---

**最后更新**: 2025-12-02


