# dailyRealizedPnL 竞态修复 + 4/1 交易观察

**日期**: 2026-04-01
**状态**: 竞态修复已部署，NVDA 过早卖出问题待讨论

---

## 1. dailyRealizedPnL 竞态修复

### 根因

`processOptionDynamicExit` 检测退出条件后调用 `checkAvailablePosition()`。当 MIT 保护单已在券商端成交（broker 报告 0 持仓），`broker_position_zero` 路径抢先触发，将 `-allocatedAmount` 写入 `dailyRealizedPnL`。

随后订单回调正常触发，但读取的 `context.dailyRealizedPnL` 已被污染为 `-allocatedAmount`，叠加 `tradePnL` 后：

```
最终 dailyRealizedPnL = -(allocatedAmount) + tradePnL  // 错误
正确 dailyRealizedPnL = prevDailyPnL + tradePnL
```

### 4/1 实盘数据佐证

| 标的 | dailyRealizedPnL（错误） | lastTradePnL（回调值） | 推算 allocatedAmount | 验证 |
|------|--------------------------|----------------------|---------------------|------|
| SPY | -956.25 | 7 | ~$963 | -963+7=-956 ✓ |
| TSLA | -801.65 | 60 | ~$862 | -862+60=-802 ✓ |
| NVDA | -1,098 | -168 | ~$930 | -930+(-168)=-1098 ✓ |
| QQQ | -846.44 | -846.44 | ~$846 | 回调未覆盖 ✓ |

### 修复方案

在两处 `broker_position_zero` 路径（L4448 退出触发 + L4607 定期核对）增加前置检查：

1. MIT 保护单存在（`protectionOrderId` / `takeProfitOrderId`）→ 不进入 broker_position_zero，等待回调
2. 近 5 分钟有卖出订单 → 同上
3. 回调已处理（state 不再是 HOLDING）→ 直接返回
4. 仅无任何卖出机制时才使用 `-allocatedAmount` 保守估计

**修改文件**: `api/src/services/strategy-scheduler.service.ts`
**提交**: `f54ebf2`

### 验证方式

下个交易日观察日志：
- 应出现 `等待回调处理PnL` 日志
- `dailyRealizedPnL` 不再出现 ≈ -allocatedAmount 的错误值
- `lastTradePnL` 与 `dailyRealizedPnL` 增量一致

---

## 2. 4/1 交易观察 — NVDA 过早卖出问题（待讨论）

### 现象

4/1 当日 NVDA CALL 交易（市场大涨日）出现过早卖出，未能捕获完整涨幅。

### 需要讨论的问题

1. **退出时机**: NVDA CALL 在盈利初期被退出，未等到更大涨幅。具体退出路径（止损/阶梯锁利/时间止损/MIT 触发）需要从日志确认
2. **阶梯锁利是否过紧**: Phase 1 刚收窄了 profitLockSteps floors（+1 收紧），需要评估是否对 NVDA 这类波动大的标的过于激进
3. **maxHoldMinutes=15 的影响**: 新增的 15 分钟时间止损是否过早切断了盈利方向的持仓
4. **标的差异化**: NVDA/TSLA 等高波动标的是否需要更宽松的退出参数（相比 SPY/QQQ 等指数标的）

### 下一步

- 下次会话拉取 4/1 NVDA 的完整 option_trade_analysis + K线数据
- 确认具体退出路径和时间点
- 对比 "实际卖出价 vs 当日最高价" 计算利润捕获率
- 基于数据决定是否需要调整参数

---

## 3. Phase 1 修复清单状态

| 修复项 | 状态 | 提交 |
|--------|------|------|
| stopLossPercent 30→20 | ✅ 已部署 | `0c44266` |
| maxHoldMinutes=15 | ✅ 已部署 | `0c44266` |
| profitLockSteps 收窄 | ✅ 已部署 | `0c44266` |
| maxDailyTradesPerUnderlying=1 | ✅ 已部署 | `0c44266` |
| minEntryPrice=1.00 | ✅ 已部署 | `0c44266` |
| dailyPnL 竞态修复 | ✅ 已部署 | `f54ebf2` |
| NVDA 过早卖出分析 | ⏳ 待讨论 | — |
