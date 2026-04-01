# dailyRealizedPnL 竞态修复 + 4/1 交易观察

**日期**: 2026-04-01
**状态**: 竞态修复已部署，NVDA 过早卖出已分析（待决定改进方案）

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

## 2. 4/1 NVDA 过早卖出 — 根因分析

### 交易数据

| 字段 | 值 |
|------|-----|
| 合约 | NVDA260401C175000.US (0DTE CALL, strike $175) |
| 入场 | 10:18:58 AM ET, 6 contracts @ $1.55 (signal $1.57, fill $1.55) |
| 退出 | 10:34:25 AM ET, 6 contracts @ $1.27 |
| 持仓时间 | 15 min 27 sec |
| **退出原因** | **TIME_STOP** (maxHoldMinutes=15) |
| 亏损 | -$179.82 (-18.7%) |
| 入场参数 | delta=0.711, regime=MOMENTUM/HIGH, score=10.0 |

### 入场时退出规则

```
maxHoldMinutes: 15          ← 触发退出
stopLossPercent: 20%        ← 未触发（差1.3%）
takeProfitPercent: 40%      ← 未触发
profitLockSteps: [4/6, 7/10, 11/15, 16/20, 21/25, 27/30]  ← 从未盈利，未触发
```

### NVDA 股价走势 (4/1)

```
前收:  $174.40
开盘:  $176.00  (+0.9%)
入场:  ~$176    (10:18 AM) → 期权内在价值 ≈ $1.00, 时间价值 ≈ $0.55
低点:  $174.76  (盘中某时) → 期权跌至 $1.27（内在≈$0, 纯时间价值）
退出:  ~$175.5  (10:34 AM) → TIME_STOP 触发
高点:  $177.12  (此后) → 内在价值 $2.12
收盘:  $176.82  → 内在价值 $1.82
```

### 错失利润计算

| 场景 | 期权价格 | 6合约价值 | PnL |
|------|---------|----------|-----|
| 实际退出 (TIME_STOP) | $1.27 | $762 | **-$168** |
| 持有到日高 ($177.12) | ~$2.12 | $1,272 | **+$342** |
| 持有到收盘 ($176.82) | ~$1.82 | $1,092 | **+$162** |

**错失利润**: 实际 vs 日高 ≈ **$510**（从 -$168 翻转为 +$342）

### 根因：TIME_STOP 与 STOP_LOSS 职责冲突

TIME_STOP 在持仓亏损时抢先触发，抢了 STOP_LOSS 的工作：

```
时间线:
10:18 → 入场 $1.55
10:20 → NVDA 开始下跌
10:30 → 期权 ~$1.27 (亏损 18.7%)
10:34 → TIME_STOP 触发 (15min到期)  ← 如果再跌2%就是STOP_LOSS的事
10:45 → NVDA 反弹
11:00 → 期权回到 $1.55 (回本)
11:xx → NVDA 冲高 $177.12, 期权 ~$2.12 (+37%)
```

核心矛盾：**TIME_STOP 被设计为防止 theta 衰减侵蚀利润，但此时持仓在亏损，根本没有利润需要保护。**

### 对比：当日其他 3 笔交易均使用 TRAILING_STOP 退出

| 标的 | 入场→退出 | 持仓时间 | 退出方式 | PnL |
|------|----------|---------|---------|-----|
| QQQ C583 | $2.11→$2.43 | 7.5 min | TRAILING_STOP | +$118 |
| TSLA C380 | $1.43→$1.48 | 1.3 min | TRAILING_STOP | +$45 |
| SPY C657 | $1.37→$1.38 | 4.4 min | TRAILING_STOP | -$3 |
| **NVDA C175** | **$1.55→$1.27** | **15.5 min** | **TIME_STOP** | **-$180** |

只有 NVDA 被 TIME_STOP 杀死。其他 3 笔都在 15 分钟内被 TRAILING_STOP 正常处理。

### 改进建议（待讨论）

#### 方案 A：TIME_STOP 仅在盈利/持平时触发（推荐）

```typescript
// 当前逻辑
if (holdMinutes >= maxHoldMinutes) → 退出

// 改进逻辑
if (holdMinutes >= maxHoldMinutes && currentPnLPercent >= -5%) → 退出
// 亏损超过5%时，交给 STOP_LOSS 处理
```

**优点**: 最小改动，解耦 TIME_STOP 和 STOP_LOSS 的职责
**风险**: 如果 STOP_LOSS 也没触发（夹在 -5%~-20% 之间），持仓可能拖太久

#### 方案 B：基于 delta 调整 maxHoldMinutes

```
delta > 0.6 (ITM/ATM): maxHoldMinutes = 25  ← 更像股票，theta衰减慢
delta 0.3~0.6 (OTM):   maxHoldMinutes = 15  ← 当前值
delta < 0.3 (深OTM):    maxHoldMinutes = 10  ← theta杀伤力大
```

**优点**: 基于期权特性动态调整，更精确
**风险**: 增加复杂度

#### 方案 C：盈利延时机制

```
基础 maxHoldMinutes = 15
如果持仓曾达到 +10% 盈利 → 延长 10 分钟
如果持仓曾达到 +20% 盈利 → 再延长 10 分钟（总共 35 分钟）
```

**优点**: 奖励赢家，给盈利方向更多时间
**风险**: 本次 NVDA 从未盈利，此方案不解决本次问题

#### 方案 D：直接放宽 maxHoldMinutes 到 25 分钟

最简单的改动。对本次 NVDA 交易，额外 10 分钟可能足够等到反弹。
**风险**: 对真正需要快速退出的 OTM 期权过于宽松

### 建议优先级

**方案 A + D 组合**：maxHoldMinutes 从 15→25，且亏损超过 5% 时交给 STOP_LOSS 处理。
这样既给了趋势更多时间，又避免了 TIME_STOP 抢 STOP_LOSS 的活。

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
| NVDA 过早卖出分析 | ✅ 已分析，待决定方案 | — |
