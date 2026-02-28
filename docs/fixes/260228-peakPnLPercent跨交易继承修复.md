# Fix: peakPnLPercent 跨交易继承 Bug

**日期**: 2026-02-28
**严重度**: P0（资金安全）
**文件**: `api/src/services/strategy-scheduler.service.ts`

## 问题根因

`state-manager.service.ts:60` 使用 PostgreSQL JSONB `||` 浅合并更新 context。
当交易结束（HOLDING→IDLE）时，`peakPnLPercent` 等持仓级字段未被显式清除（设为 null），
导致下一笔交易继承上一笔的峰值盈利，触发虚假尾部止损，造成秒级平仓和严重亏损。

回测代码（`option-backtest.service.ts:1382`）使用局部变量 `holdingPeakPnLPercent = 0` 每笔重置，
实盘与回测行为不一致。

## 受影响的持仓级字段（共 10 个）

| 字段 | 污染影响 | 严重度 |
|---|---|---|
| `peakPnLPercent` | 新交易继承旧峰值 → 虚假尾部止损 | **P0** |
| `peakPrice` | 峰值价格残留 → 日志误导 | P1 |
| `entryTime` | Path A 缺失 → 冷却期逻辑失效 | P1 |
| `emergencyStopLoss` | 旧紧急止损残留 → 无故触发退出 | P1 |
| `tslpRetryPending` | 旧重试标记 → 对新仓位发起无效 TSLP 重试 | P1 |
| `tslpRetryParams` | 同上 | P1 |
| `tslpRetryAfter` | 同上 | P1 |
| `lastCheckTime` | 旧检查时间 → 节流逻辑跳过首次检查 | P2 |
| `lastBrokerCheckTime` | 同上 | P2 |

## 修改方案

### Step 1: POSITION_CONTEXT_RESET 常量

在文件顶部定义重置常量，包含所有 10 个持仓级字段的初始值。

### Step 2: 六个入场路径注入重置字段

- **Path A** — Fill 处理路径：`...POSITION_CONTEXT_RESET` + 补充缺失的 `entryTime`
- **Path B** — `executeSymbolEntry`：`...POSITION_CONTEXT_RESET`
- **Path C** — `executeSymbolEntryR5v2`：`...POSITION_CONTEXT_RESET`
- **Path D** — `syncBrokerPosition` 期权恢复：`...POSITION_CONTEXT_RESET`
- **Path D-stock long** — `syncBrokerPosition` 做多股票：`...POSITION_CONTEXT_RESET`

### Step 3: 退出路径补充清除

在 CLOSING→IDLE 的 `updateState` 中追加 8 个持仓级字段设为 null。

### Step 4: 防御性校验

两个 `peakPnLPercent` 读取点改为：有 `peakPnLPercent` 但没有 `entryTime` 时强制归零。

## 不需要修改的文件

- `state-manager.service.ts` — JSONB `||` 合并是通用机制，不改底层
- `option-dynamic-exit.service.ts` — 消费端，入口数据正确后无需改动
- `option-backtest.service.ts` — 已正确（局部变量每笔重置）

## 验证

1. `pnpm run build` — 无新增编译错误
2. IDLE 状态下 `peakPnLPercent` 应为 null
3. 新交易进入 HOLDING 后 `peakPnLPercent` 从 0 开始
