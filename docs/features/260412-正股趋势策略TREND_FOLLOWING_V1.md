# 正股趋势策略 TREND_FOLLOWING_V1

> 日期: 2026-04-12
> 状态: 设计完成，待实施
> 来源: `docs/analysis/260412-多策略深度分析报告.md` 第二、三节
> 前置: Schwartz 合并 + 停用（见 `260412-多策略冲突解决方案.md`）

---

## 设计哲学

将 Robin 的交易直觉系统化翻译为量化参数，复用期权策略已验证的信号源，构建独立于期权的正股趋势跟踪策略。

| Robin 特征 | 系统参数 |
|-----------|---------|
| 重仓新高股 | 只做 52 周高点附近（>85% 区间）的标的 |
| 截断亏损 | ATR 倍数止损（1.5-2x ATR），无例外 |
| 让利润奔跑 | 追踪止盈（不设固定止盈，只设 trailing stop） |
| 三倍杠杆 ETF | 标的池含 TQQQ/SQQQ/SPXL/SPXS |
| 行业轮动 | 多板块标的池 + 相对强度排名 |
| MA 系统 | MA50/MA200 双均线过滤 |
| 无情感 | 纯评分驱动，不人工干预 |

---

## 评分模型

```
策略名: TREND_FOLLOWING_V1
策略类型: TREND_FOLLOWING_V1（新增）
周期: 60s 扫描
标的池: ~15-20 只（强势股 + 杠杆 ETF + 板块龙头）

┌─────────────────────────────┐
│ 趋势分 (40%)               │
│  - MA50/MA200 位置关系 20%  │ ← Robin 核心
│  - 52周高点距离 10%         │ ← Robin 核心
│  - SPX 多窗口一致性 10%     │ ← 期权验证过
├─────────────────────────────┤
│ 动量分 (30%)               │
│  - 相对强度(RS) vs SPX 15% │ ← 行业轮动
│  - 成交量确认 10%           │ ← 期权验证过
│  - Gap 信号 5%              │ ← 期权验证过
├─────────────────────────────┤
│ 环境分 (30%)               │
│  - VIX 三级评分 10%         │ ← 替代一票否决
│  - BTC 风险偏好 5%          │
│  - USD 逆相关 5%            │
│  - 市场温度 10%             │
└─────────────────────────────┘
```

### 从期权迁移的信号（已验证）

| 信号 | 期权中的可靠性 | 迁移方式 |
|------|-------------|---------|
| SPX 多窗口一致性 | 最高 | 直接复用 `optionRecommendationService` 中的 SPX 趋势计算 |
| VIX 三级实时评分 | 高 | 复用，替代正股策略原来的 VIX > 35 一票否决 |
| 成交量确认 | 高 | 复用 1min 成交量加权逻辑，但窗口拉长到日线级别 |
| Gap 信号 | 中 | 直接复用 |
| BTC/USD 联动 | 中 | 直接复用 |
| CHOP 震荡检测 | 中 | 复用 `schwartz-signal-filter.service.ts` 的 `checkChopFilter()` |

### 不迁移的信号

| 信号 | 理由 |
|------|------|
| VWAP 偏离 | 正股 swing 尺度下意义不大 |
| 时间衰减 | 正股无到期日 |
| 1min 动量（高频部分） | 60s 周期不需要秒级动量 |

---

## 入场条件

1. 综合分 > 动态阈值（VIX 调整）
2. 价格 > MA50 且 MA50 > MA200（金叉或多头排列）
3. 相对强度排名前 5
4. CHOP 检测非震荡期

## 出场条件

1. 价格跌破 MA50 → 减半仓位
2. 价格跌破 MA200 → 清仓
3. ATR trailing stop（2x ATR 从高点回撤）
4. 日内熔断（单日亏损 > 2% 本金 → 停止新开仓）

## 仓位管理

- 每只标的最大 15% 资金（正股杠杆低需分散）
- 杠杆 ETF 标的最大 10%（3x 杠杆自带放大）
- 相关组内最大 30%（防集中暴露）

## Robin 弱点对冲

| Robin 弱点 | 系统化对冲 |
|-----------|-----------|
| 震荡市连续假突破 | CHOP 检测 — 震荡期暂停开仓 |
| 黑天鹅无对冲 | VIX > 25 + 持有多头 → 自动建 SQQQ 仓位 |
| 杠杆 ETF 磨损 | TQQQ/SQQQ 最长持仓 5 天 |
| 追高被套 | 开盘跳空 > 2% 不追，等回踩 MA |

---

## 与期权策略的隔离关系

期权（OPTION_INTRADAY_V1）和正股（TREND_FOLLOWING_V1）在券商层天然隔离：

| 维度 | 隔离情况 |
|------|---------|
| 券商持仓 | 完全独立（期权合约 vs 股票） |
| Symbol | 完全不同（合约名 vs 股票代码） |
| 资金 | `SELECT FOR UPDATE` per-strategy 隔离 |
| 状态机 | `UNIQUE(strategy_id, symbol)` |
| 启动 | 同类型互斥校验（已实现，409 拒绝） |

不需要 CrossStrategyCoordinator。

---

## 实施计划

### 需要新建的文件

| 文件 | 内容 |
|------|------|
| `api/src/services/strategies/trend-following-strategy.ts` | 策略实现（评分 + 入场 + 出场） |
| `api/src/services/stock-recommendation.service.ts` | 正股评分服务（趋势分 + 动量分 + 环境分） |

### 需要修改的文件

| 文件 | 改动 |
|------|------|
| `api/src/services/strategy-scheduler.service.ts` | `createStrategyInstance` 新增 `TREND_FOLLOWING_V1` case |
| `api/src/routes/quant.ts` | 无（通用策略管理 API 已支持） |
| `frontend/components/StrategyFormModal.tsx` | 新增 TREND_FOLLOWING_V1 配置表单 |
| `api/migrations/000_init_schema.sql` | strategies.type CHECK 约束新增值（如需要） |

### 可复用的现有服务

| 服务 | 复用内容 |
|------|---------|
| `option-recommendation.service.ts` | SPX 趋势计算、VIX 评分、BTC/USD 联动、Gap 信号、市场温度 |
| `schwartz-signal-filter.service.ts` | CHOP 震荡检测 (`checkChopFilter`) |
| `market-data.service.ts` | K 线数据、MA 计算 |
| `capital-manager.service.ts` | 资金分配（已支持多策略） |
| `basic-execution.service.ts` | 正股下单（已有正股订单逻辑） |

### 需要新建的评分能力

| 能力 | 说明 |
|------|------|
| MA50/MA200 位置关系评分 | 日线级别双均线多空判断 |
| 52 周高点距离评分 | 标的相对 52w high 的位置（>85% 加分） |
| 相对强度(RS)排名 | 标的 vs SPX 的相对表现排序 |
| ATR trailing stop | 2x ATR 追踪止损（新的退出机制） |

---

## 待决事项

1. **标的池确定** — 15-20 只具体标的（强势股 + 杠杆 ETF + 板块龙头），需要 Robin 输入
2. **评分权重校准** — 40/30/30 是初始设计，需要回测数据验证
3. **杠杆 ETF 持仓上限** — 5 天硬限制是否合适，需要 TQQQ/SQQQ 历史磨损数据
4. **SQQQ 自动对冲逻辑** — VIX > 25 时自动建仓的具体触发条件和仓位
5. **与现有 RECOMMENDATION_V1 的关系** — RECOMMENDATION_V1 已停用，TREND_FOLLOWING_V1 是否完全替代还是独立并行
