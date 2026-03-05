# 快慢双动量 — Fast Momentum Gate 防追高

**日期**: 2026-03-05
**状态**: 已实现

## 问题

0DTE 期权入场信号基于 1 分钟 K 线动量（10 根回看 = 10 分钟历史），延迟链总计 2-11 分钟。0DTE 有效移动窗口仅 2-5 分钟，导致信号确认时价格已在局部顶部 → "追高入场"。

## 方案

在现有慢动量（1m K 线：EMA/CHOP/得分）基础上，新增**快动量**层：
- 数据源：`quoteCtx.quote()` 实时报价，每周期采样一次
- 12 点环形缓冲区 = ~60 秒窗口
- 线性回归检测方向一致性 + 减速（前后半段斜率对比）
- 慢动量通过 → 快动量确认方向未减速 → 才允许入场

## 涉及文件

| 文件 | 变更 |
|------|------|
| `api/src/services/fast-momentum.service.ts` | **新建** — 环形缓冲区 + 线性回归 + gate 逻辑 |
| `api/src/services/strategies/schwartz-option-strategy.ts` | 在得分阈值后、合约选择前插入 fast momentum gate |
| `api/src/services/strategy-scheduler.service.ts` | Phase A.5 批量 quote 获取 + 喂入 service + reset 调用 |
| `api/src/__tests__/fast-momentum.test.ts` | **新建** — 27 个单元测试 |

## 核心逻辑

### FastMomentumService

- `feedQuotes(quotes: Map<string, number>)` — 每个 symbol 维护独立 RingBuffer(12)
- `checkGate(symbol, direction)` — 线性回归 → 方向检查 → 减速检查
  - 数据不足（<6 点）→ 优雅降级放行
  - 方向检查：CALL 要求 slope > 0，PUT 要求 slope < 0
  - 减速检查：|后半段斜率| / |前半段斜率| < 0.5 → 拒绝
  - 前半段斜率接近零（< 0.0001）→ 跳过减速检查

### 集成点

- **strategy-scheduler**: Phase A.5 批量 `quoteCtx.quote(idleSymbols)` → `feedQuotes`
- **schwartz-option-strategy**: 步骤 5.5（得分阈值后、0DTE禁入前）调用 `checkGate`
- **信号 metadata**: `schwartzFilters.fastMomentum` 记录 slope/rSquared/deceleration/dataPoints
- **重置**: 策略停止 + 日重置时调用 `reset()`

## 验证

- 27 个单元测试全通过（RingBuffer / 线性回归精度 / 方向检查 / 减速检测 / 降级 / 集成）
- 编译无新增错误
