# 量化交易策略优化总结

**最后更新**: 2025-12-02  
**状态**: ✅ 已完成

## 📋 优化概述

本文档总结了量化交易策略系统的所有优化工作，包括卖出监控、订单追踪、状态同步、订单修改逻辑修复等关键改进。

## 🎯 优化时间线

### 2025-12-02: 订单修改逻辑修复 ✅

**问题**: 已成交订单（`FilledStatus`）仍然被尝试修改，导致错误码602012

**根本原因**:
1. SDK返回的状态可能是数字格式（如 `5`），而不是字符串 `FilledStatus`
2. `getTodayOrders` 直接使用SDK原始数据，没有经过 `mapOrderData` 处理
3. `mapOrderData` 函数会根据 `executedQuantity` 自动修正状态，但未被使用

**解决方案**:
1. **导出 `mapOrderData` 函数**：在 `orders.ts` 中将 `mapOrderData` 改为 `export function`
2. **在 `getTodayOrders` 中使用 `mapOrderData`**：确保所有订单数据都经过状态修正
3. **方案二：完全基于API状态筛选**：
   - 移除数据库状态过滤，查询所有订单
   - 先筛选出未成交订单（基于API实时状态）
   - 后同步订单状态到数据库

**关键代码**:
```typescript
// 使用 mapOrderData 处理订单数据，确保状态正确
const { mapOrderData } = await import('../routes/orders');
const mappedOrders = Array.isArray(rawOrders) 
  ? rawOrders.map((order: any) => mapOrderData(order))
  : [];
```

**效果**:
- ✅ 已成交订单不再进入价格更新流程
- ✅ 不再出现 `602012` 错误
- ✅ 订单状态自动修正（根据 `executedQuantity`）

### 2025-12-02: 日志优化 ✅

**优化内容**:
1. **降低日志级别**：将常规流程日志从 `log` 改为 `debug`
   - 持仓监控详细日志
   - 状态检查日志
   - 未生成信号日志
   - 资金申请通过日志

2. **移除冗余日志**：
   - 移除"通过筛选"日志（已有汇总）
   - 移除"价格更新前状态检查"日志
   - 移除"没有需要监控的未成交订单"日志

3. **简化日志内容**：
   - 已完成订单：简化状态信息
   - 买入订单已成交：移除订单ID
   - 准备买入：使用更简洁的格式

**保留的关键日志**（`log` 级别）:
- 策略启动/停止
- 买入/卖出订单已成交
- 资金申请被拒绝
- 订单价格更新成功
- 生成交易信号

### 2025-12-02: 卖出监控完善 ✅

**问题**:
- 原代码只监控买入订单，没有处理卖出订单
- `processSymbol` 方法只处理 `IDLE` 状态，没有处理 `HOLDING` 状态的持仓
- 没有检查止盈/止损触发条件

**解决方案**:

**1. 扩展 `processSymbol` 方法**
- 添加对 `HOLDING` 状态的处理：检查止盈/止损
- 添加对 `CLOSING` 状态的处理：检查卖出订单状态

**2. 新增 `processHoldingPosition` 方法**
- 获取持仓上下文（入场价、止损、止盈、数量）
- 获取当前价格
- 检查止盈/止损触发条件
- 检查策略生成的卖出信号
- 执行卖出操作

**3. 新增 `processClosingPosition` 方法**
- 检查是否有未成交的卖出订单
- 如果没有未成交订单，检查实际持仓
- 根据持仓情况更新状态（IDLE 或 HOLDING）

**4. 扩展订单追踪**
- 查询所有订单（买入和卖出），不再限制 `side = 'BUY'`
- 处理卖出订单成交：更新状态为 `IDLE`，释放资金分配

### 2025-12-02: 状态同步功能 ✅

**问题**: 状态是 `IDLE` 但实际有持仓，导致持仓监控不工作

**解决方案**:
- 添加 `syncPositionState` 方法
- 当检测到有实际持仓但状态是 `IDLE` 时，自动同步状态为 `HOLDING`
- 从实际持仓中获取成本价、数量等信息
- 如果没有止盈/止损，使用默认值（止损：-5%，止盈：+10%）

### 2025-12-02: 交易记录管理完善 ✅

**问题**:
- `recordTrade` 方法只在订单立即成交时调用
- 如果订单在后续追踪中才成交，交易记录可能没有被记录

**解决方案**:
- 将 `recordTrade` 改为公开方法
- 在订单追踪中记录交易：当发现订单已成交时，获取订单详情和手续费，调用 `recordTrade` 方法

## 📊 状态流转图

### 完整流程
```
IDLE → OPENING → HOLDING → CLOSING → IDLE
         ↓          ↓          ↓
      (买入)    (持仓监控)  (卖出监控)
```

### 状态说明

| 状态 | 说明 | 处理逻辑 |
|------|------|----------|
| `IDLE` | 空闲状态 | 生成买入信号，提交买入订单 |
| `OPENING` | 买入中 | 监控买入订单状态，成交后转为 `HOLDING` |
| `HOLDING` | 持仓中 | 检查止盈/止损，触发卖出条件时转为 `CLOSING` |
| `CLOSING` | 卖出中 | 监控卖出订单状态，成交后转为 `IDLE` |
| `COOLDOWN` | 冷却期 | 暂未使用 |

## 🔄 完整流程

### 买入流程
1. **IDLE 状态** → 生成买入信号 → 申请资金 → 提交买入订单
2. **OPENING 状态** → 订单追踪监控 → 订单成交 → **HOLDING 状态**

### 持仓监控流程
1. **HOLDING 状态** → 检查当前价格
2. 触发条件检查：
   - 止损触发：`currentPrice <= stopLoss` → 执行卖出
   - 止盈触发：`currentPrice >= takeProfit` → 执行卖出
   - 策略信号：生成 `SELL` 信号 → 执行卖出
3. 执行卖出 → **CLOSING 状态**

### 卖出流程
1. **CLOSING 状态** → 订单追踪监控 → 订单成交 → **IDLE 状态**
2. 释放资金分配

## 🛠️ 技术实现

### 关键文件

1. **`api/src/services/strategy-scheduler.service.ts`**
   - `processSymbol`: 状态分支处理
   - `processHoldingPosition`: 持仓监控
   - `processClosingPosition`: 平仓状态处理
   - `trackPendingOrders`: 订单追踪（买入和卖出）
   - `syncPositionState`: 状态同步
   - `getTodayOrders`: 使用 `mapOrderData` 处理订单数据

2. **`api/src/services/basic-execution.service.ts`**
   - `recordTrade`: 改为公开方法，供订单追踪调用

3. **`api/src/routes/orders.ts`**
   - `mapOrderData`: 导出函数，根据 `executedQuantity` 自动修正订单状态

### 关键代码片段

#### 订单数据状态修正
```typescript
// mapOrderData 函数中的智能状态修正
if (executedQty > 0) {
  if (executedQty >= quantity) {
    // 全部成交
    if (status !== 'FilledStatus' && status !== 'PartialFilledStatus') {
      status = 'FilledStatus';
    }
  } else {
    // 部分成交
    if (status !== 'FilledStatus' && status !== 'PartialFilledStatus') {
      status = 'PartialFilledStatus';
    }
  }
}
```

#### 基于API状态筛选
```typescript
// 先筛选出未成交的订单（基于API实时状态）
const pendingOrders = strategyOrders.rows.filter((dbOrder: any) => {
  const apiOrder = todayOrders.find(...);
  const status = normalizeOrderStatus(apiOrder.status);
  
  // 严格排除所有已完成的订单
  if (completedStatuses.includes(status)) {
    return false;
  }
  
  // 只包含未成交的订单状态
  return pendingStatuses.includes(status);
});
```

#### 持仓监控
```typescript
// 检查止盈/止损
if (stopLoss && currentPrice <= stopLoss) {
  shouldSell = true;
  exitReason = 'STOP_LOSS';
} else if (takeProfit && currentPrice >= takeProfit) {
  shouldSell = true;
  exitReason = 'TAKE_PROFIT';
}
```

## ✅ 验证要点

### 买入监控
- ✅ 买入订单提交后，状态更新为 `OPENING`
- ✅ 订单追踪检测到成交后，状态更新为 `HOLDING`
- ✅ 交易记录被正确记录到 `auto_trades` 表

### 持仓监控
- ✅ `HOLDING` 状态的标的会被检查止盈/止损
- ✅ 触发止损时，自动执行卖出
- ✅ 触发止盈时，自动执行卖出
- ✅ 策略生成卖出信号时，自动执行卖出

### 卖出监控
- ✅ 卖出订单提交后，状态更新为 `CLOSING`
- ✅ 订单追踪检测到成交后，状态更新为 `IDLE`
- ✅ 资金分配被正确释放
- ✅ 交易记录被正确更新（平仓记录）

### 订单修改逻辑
- ✅ 已成交订单不再进入价格更新流程
- ✅ 不再出现 `602012` 错误
- ✅ 订单状态自动修正（根据 `executedQuantity`）

### 状态同步
- ✅ 有实际持仓但状态是 `IDLE` 时，自动同步为 `HOLDING`
- ✅ 从实际持仓中获取成本价、数量等信息
- ✅ 自动设置默认止盈/止损

## 🔍 诊断方法

### 使用监控状态API

**API**: `GET /api/quant/strategies/:id/monitoring-status`

**返回数据示例**:
```json
{
  "success": true,
  "data": {
    "strategy": {
      "id": 3,
      "name": "测试策略",
      "type": "RECOMMENDATION_V1",
      "status": "RUNNING"
    },
    "instances": [
      {
        "symbol": "AAPL.US",
        "state": "HOLDING",
        "entryPrice": 150.00,
        "stopLoss": 145.00,
        "takeProfit": 160.00,
        "quantity": 10,
        "currentPrice": 155.00,
        "pnl": 50.00,
        "pnlPercent": 3.33,
        "hasActualPosition": true,
        "actualPositionQuantity": 10,
        "pendingBuyOrders": 0,
        "pendingSellOrders": 0
      }
    ],
    "summary": {
      "total": 5,
      "idle": 2,
      "opening": 0,
      "holding": 3,
      "closing": 0
    }
  }
}
```

### 日志关键词

搜索以下关键词来确认功能是否正常：

- ✅ `持仓监控 - 检查止盈/止损` - 持仓监控已执行
- ✅ `买入订单已成交，状态更新为HOLDING` - 买入成交
- ✅ `卖出订单已成交，状态更新为IDLE` - 卖出成交
- ✅ `已完成（FilledStatus），已排除` - 订单筛选正常
- ⚠️ `持仓状态但无上下文` - 上下文缺失
- ⚠️ `无法获取当前价格` - 价格获取失败

## 🚀 后续优化建议

1. **实时价格监控**
   - 考虑使用 WebSocket 实时推送价格，而不是每分钟轮询
   - 减少 API 调用频率

2. **部分成交处理**
   - 当前只处理完全成交的情况
   - 可以添加部分成交的处理逻辑

3. **冷却期管理**
   - 卖出后可以设置冷却期，避免立即重新买入
   - 当前 `COOLDOWN` 状态已定义但未使用

4. **策略信号优化**
   - 持仓状态下，策略可以生成更精确的卖出信号
   - 考虑添加持仓时间、收益率等因素

## 📚 相关文档

- [代码地图](../CODE_MAP.md) - 项目文件结构和调用关系
- [策略逻辑审查](251202-STRATEGY_LOGIC_REVIEW.md) - 策略详细逻辑说明
- [订单修改逻辑审查](251212-ORDER_MODIFICATION_LOGIC_REVIEW.md) - 订单修改逻辑修复详情

---

**优化完成时间**: 2025-12-02


