# peakPnLPercent 跨交易继承 + 0DTE 无冷却重入复合缺陷

> 日期: 2026-03-01
> 严重级别: P0（资金安全）
> 发现方式: 2月27日实盘日志逐行回放分析

## 问题描述

2月27日 TSLA 发生 4 笔连续交易（均为 PUT 方向），其中后 3 笔被错误的移动止损秒杀。根因是两个缺陷叠加：

1. **peakPnLPercent 跨交易继承**（已在 commit `b188cdb` 修复）：HOLDING→IDLE 转换时 peakPnLPercent 未重置，下一笔交易继承了上一笔的峰值
2. **0DTE 无冷却重入**（本次修复）：`cooldownMinutes=0` 允许退出后秒级重入

## 2月27日 TSLA 实际交易时间线

| 笔 | 买入时间 | 卖出时间 | 持仓时长 | PnL | 退出原因 | peakPnL 来源 |
|---|---|---|---|---|---|---|
| 1 | 16:20:21 | 16:23:52 | 3m31s | +$4 | TSLPPCT | 自身: 真实 16.7% |
| 2 | 16:24:38 | 16:24:52 | **14秒** | +$6 | TRAILING_STOP | 继承: 假 16.7% |
| 3 | 16:25:42 | 16:27:08 | 1m26s | -$8 | TRAILING_STOP | 继承: 假 16.7% |
| 4 | 16:29:27 | 16:29:43 | **16秒** | -$11 | TRAILING_STOP | 继承: 假 16.7% |

### 缺陷叠加机制

```
第1笔: 正常盈利 → peakPnLPercent=16.7% 残留 → TSLPPCT退出 → IDLE
                                                        ↓
    cooldownMinutes=0 (0DTE, 连亏=0, tradeCount=1) → 46秒后重入
                                                        ↓
第2笔: 买入后 PnL≈0%, peak仍=16.7% → 回撤=16.7% > 10% → 14秒秒杀
                                                        ↓
    cooldownMinutes=0 (连亏仍=0, 因第2笔实际小赚) → 继续重入
                                                        ↓
第3笔: 同上 → 86秒后被秒杀 → 连亏=1
                                                        ↓
    cooldownMinutes=3 (连亏=1) → 但冷却仅3分钟
                                                        ↓
第4笔: 再次被秒杀 → 连亏=2 → 触发信号抑制终止循环
```

## 冷却逻辑漏洞分析

代码位置: `strategy-scheduler.service.ts` line 2395-2411

```typescript
// 0DTE 冷却规则:
if (consecLosses >= 3) cooldownMinutes = 15;
else if (consecLosses === 2) cooldownMinutes = 5;
else if (consecLosses === 1) cooldownMinutes = 3;
else {
    if (dailyTradeCount <= 1) cooldownMinutes = 0;      // ← 漏洞: 首笔盈利退出后0冷却
    else if (dailyTradeCount <= 3) cooldownMinutes = 1;  // ← 不足: 仅1分钟
    else cooldownMinutes = 3;
}
```

漏洞: 当 peakPnLPercent 导致假盈利退出（TSLPPCT/TRAILING_STOP）时, `consecutiveLosses` 可能仍为 0（因为实际成交价可能微赚），导致冷却时间为 0-1 分钟。

## 修复方案

### 修复 1: 0DTE 最低冷却时间（本次实施）

无论连亏与否，0DTE 每笔交易退出后**至少冷却 1 分钟**：
- dailyTradeCount=0: 0 分钟（首笔不受限）
- dailyTradeCount=1: **1 分钟**（原来 0 分钟）
- dailyTradeCount=2-3: 1 分钟（不变）
- dailyTradeCount>=4: 3 分钟（不变）

连亏冷却保持不变（1亏=3min, 2亏=5min, 3亏=15min），因为连亏冷却已经足够。

### 修复 2: peakPnLPercent 已修复确认

commit `b188cdb` 已在 HOLDING→IDLE 转换时清除 peakPnLPercent。
本次在 POSITION_CONTEXT_RESET 使用点位再次确认无遗漏。

## 涉及文件

- `api/src/services/strategy-scheduler.service.ts` — 冷却规则修改

## 之前模拟结论的修正

之前分析称"4项修订均为预防性质，不影响2月27日交易"——**这是错误的**。

commit `b188cdb` 的 peakPnLPercent 修复**直接影响 2月27日 TSLA 后 3 笔交易**。如果当天已有修复后代码：
- 第2笔买入后 peakPnLPercent=0，需等真实涨到 8%+ 才启用移动止损，不会被秒杀
- 第3、4笔同理，持仓时间更长，结果可能不同
