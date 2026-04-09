# Strategy-Check 数据预处理端点

**日期**: 2026-04-09
**状态**: 已实现

## 背景

`/strategy-check` 技能每次执行需写临时 JS 脚本拉取 5 个 API 端点的原始数据（signals 300条、logs 200条、orders 等），原始数据约 30,000 tokens，大量上下文消耗在数据传输和清洗上。

## 方案

新建 `GET /api/quant/strategy-check-digest` 聚合端点，服务端完成全部数据查询和指标预计算。

### 数据源

| 数据 | 来源 | 说明 |
|------|------|------|
| 交易记录+信号元数据 | DB: `auto_trades JOIN strategy_signals` | 复用 analysis/trades SQL |
| 策略配置 | DB: `strategies` | RUNNING 策略 |
| 实例状态 | DB: `strategy_instances` | JSONB context 关键字段 |
| 今日订单 | Longport SDK: `todayOrders()` | 实时 |
| 历史订单 | Longport SDK: `historyOrders()` | 按日期范围 |
| 系统日志 | DB: `system_logs` | 去重聚合 + 关键事件提取 |
| 最近信号 | DB: `strategy_signals` | 最近 20 条 |

### 预计算指标

- 层级1: EV（overall/bySymbol/byRegime/byScoreBucket），含 Kelly fraction
- 层级2: 退出效率（byExitType: count/avgPnl/totalPnl/winRate，持仓时长）
- 层级3: 信号质量（feeDrag, slippage）
- 层级4: 风险检查（PnL 一致性）
- 层级5: SmartReverse（反向 vs 非反向 winRate/avgPnl）
- 日志去重：`GROUP BY module, regexp_replace(message, '[0-9]+', 'N', 'g')` 按模式聚合
- 关键事件：正则匹配熔断/止损/冷却/拒绝/连接错误等业务事件

### 查询参数

| 参数 | 默认 | 说明 |
|------|------|------|
| startDate | 7天前 | 分析窗口起始 |
| endDate | 今天 | 分析窗口结束 |
| strategyId | 全部RUNNING | 指定策略 |

## 修改文件

- `api/src/routes/quant.ts` — 新增端点
- `.claude/skills/strategy-check/SKILL.md` — 更新执行流程

## 效果

- Token 消耗：~30,000 → ~3,000（降低 ~85%）
- 响应速度：单次 fetch vs 5 次 HTTP + JS 脚本生成
