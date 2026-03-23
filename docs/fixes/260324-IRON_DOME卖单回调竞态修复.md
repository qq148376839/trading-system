# IRON_DOME + 卖单回调竞态条件修复（dailyRealizedPnL 重复计算）

**日期**: 2026-03-24
**类型**: Bug Fix（P0 资金安全）
**文件**: `api/src/services/strategy-scheduler.service.ts`

## 问题描述

`reconciliationCheck`（IRON_DOME）与卖单回调之间存在竞态条件：

1. 系统提交卖单 → broker 瞬间成交（持仓归零）
2. 监控循环在卖单回调处理前运行
3. IRON_DOME 检测到"HOLDING + broker 持仓 = 0" → 将 `-allocationAmount` 写入 `dailyRealizedPnL`
4. 卖单回调触发，读取被污染的 `dailyRealizedPnL`，叠加实际 `tradePnL`
5. **结果**: `-allocationAmount` 和 `tradePnL` 双重计算 → PnL 膨胀约 10 倍

**影响**: 熔断器在 ~$4023 触发，而实际亏损仅 ~$406。

## 根因分析

IRON_DOME（`reconciliationCheck`）写入 state：
```typescript
await stateManager.updateState(strategyId, row.symbol, 'IDLE', {
  ...POSITION_EXIT_CLEANUP,
  exitReason: 'BROKER_TERMINATED',
  lastTradePnL: -allocationAmount,              // 最坏情况估算
  dailyRealizedPnL: existing + (-allocationAmount), // 污染累计 PnL
  consecutiveLosses: existing + 1,
  dailyTradeCount: existing + 1,
});
```

卖单回调随后读取此 context，在已污染的 `dailyRealizedPnL` 上再加 `tradePnL`。

## 修复方案

在卖出回调中（context 加载后、PnL 计算前），检测 IRON_DOME 是否已抢先处理：

```typescript
const currentState = await strategyInstance.getCurrentState(instanceKeySymbol);
if (currentState === 'IDLE' && context.exitReason === 'BROKER_TERMINATED') {
  const ironDomePnL = Number(context.lastTradePnL || 0);
  if (ironDomePnL < 0) {
    // 撤销 IRON_DOME 的估算贡献
    context.dailyRealizedPnL -= ironDomePnL;
    context.dailyTradeCount -= 1;
    context.consecutiveLosses -= 1;
  }
}
```

**检测条件**:
- `currentState === 'IDLE'`: IRON_DOME 已将实例转为 IDLE（正常流程中卖单回调先到时仍为 HOLDING）
- `exitReason === 'BROKER_TERMINATED'`: IRON_DOME 专属标记

**安全性**:
- 正常流程（卖单回调先到）不受影响 — 实例仍为 HOLDING，条件不满足
- 仅在竞态发生时触发修正

## 验证方法

1. 部署后观察交易日志中 `IRON_DOME竞态修正` 日志
2. 比对 `dailyRealizedPnL` 与实际 signal `netPnL` 之和
3. 验证熔断器在正确 PnL 水平触发
