# 正股趋势策略 TREND_FOLLOWING_V1 — 完整开发方案

> 日期: 2026-04-12
> 状态: Phase 1 实现完成 (Step 0-4)，待联调测试
> 来源: `docs/analysis/260412-多策略深度分析报告.md` 第二、三节
> 前置: Schwartz 合并（`67a8bd5`）+ 启动互斥校验（`47747bd`）已完成

---

## 0. 第一性原理审计

对原方案逐条审计，分离 **事实** 和 **假设**，纠正偏差。

### 被推翻的假设

| # | 原方案假设 | 事实 | 纠正 |
|---|----------|------|------|
| 1 | `000_init_schema.sql` 需新增 CHECK 约束 | `strategies.type` 列 **无 CHECK 约束**，类型校验在 app 层 | 不需要 DB migration |
| 2 | "价格跌破 MA50 → 减半仓位" | 当前系统 `executeSellIntent` 是全仓卖出，无 partial sell 机制；`processHoldingPosition` 的股票路径也是全仓退出 | Phase 1 不做部分卖出。MA50 跌破 → 收紧 trailing stop 到 1×ATR |
| 3 | "SQQQ 自动对冲" 放在 MVP | 需要策略在 HOLDING 状态下对另一标的发起 BUY，跨标的状态管理复杂 | 延后到 Phase 2 |
| 4 | "直接复用 option-recommendation 的成交量加权" | 期权服务的成交量加权是 1min 级别 ATR 归一化，正股趋势策略用日线级别完全不同 | 正股成交量确认独立实现（日线 volume / 20d SMA volume） |
| 5 | "market-data.service 有 MA 计算" | `getDailyCloseHistory()` 返回 `{date, close}[]`，无 MA/ATR/52W 计算方法 | 在 stock-trend-recommendation 中自行计算 |
| 6 | 退出逻辑复用现有股票路径 | 现有股票退出硬编码 5%止损/10%止盈 + `dynamicPositionManager`，无 ATR trailing stop | 需在 `processHoldingPosition` 增加 `TREND_FOLLOWING` 分支 |
| 7 | "`getRacedKline` 可获取个股日线 OHLCV" | `getRacedKline()` 参数是 `'spx'\|'usd'\|'btc'`，**只支持 3 个市场指数，不支持个股**。方案写的 `getRacedKline('us', 'DAY', 250)` 参数也完全错误 | 新增 `getDailyOHLCV(symbol, count)` 方法，复用 `getDailyCloseHistory` 内部的 `candlesticks()` 调用但返回完整 `StandardCandlestickData[]` |
| 8 | "getCurrentMarketScore() 有 60s 内部缓存" | 实际缓存由 `market-data-cache.service.ts` 管理，**交易时段 15s / 非交易时段 5min**，不是固定 60s | 文档修正，缓存命中时确实零外部调用，行为正确 |
| 9 | "market-data.service 没有 MA/ATR 计算方法，需自行实现" | `calculateATR()` 已存在于 `utils/technical-indicators.ts:21-48`，`getLatestSMA()` 已存在于 `utils/ema.ts:56-64` | 直接复用现有工具函数，不重复实现 |
| 10 | "RECOMMENDATION_V1 已停用" | 在 `strategy-scheduler.service.ts` 的 3 个位置作为**默认回退值**使用（L1195, L2029, L2086），switch/case 也有分支 | 修正描述：RECOMMENDATION_V1 仍在代码中作为默认值，未停用 |
| 11 | "intent.metadata 中的 atrAtEntry 等字段自动传递到 HOLDING context" | OPENING→HOLDING 转换时（L2555-2576），非期权策略的 `metadata` **不会保存到 HOLDING context**（只有期权的 metadata 映射到 `optionMeta`） | 必须在转换代码中显式提取 metadata 字段到 HOLDING context |
| 12 | "新增 context 字段自动清理" | `atrAtEntry`, `trailingStopPrice`, `maTightenActive` **不在** `POSITION_EXIT_CLEANUP` 中，退出后会残留污染下一笔交易 | 必须加入 `POSITION_CONTEXT_RESET`（初始化）和 `POSITION_EXIT_CLEANUP`（清除）。注意 `peakPrice` 已存在于两个列表中可直接复用 |

### 被确认的设计

| 设计 | 验证方式 | 结论 |
|------|---------|------|
| StrategyBase 多态模式 | 读 `strategy-base.ts` + `recommendation-strategy.ts` | `generateSignal()` → `TradingIntent` 模式成立 |
| 60s 扫描周期 | 读 `strategy-scheduler.service.ts:418-429` | 非期权策略已用 60s，无需改 |
| 资金隔离 | 读 `capital-manager.service.ts:399-590` | `SELECT FOR UPDATE` per-strategy，开箱即用 |
| 同类型互斥 | 读 `quant.ts:1154-1167` | 409 拒绝同类型并发，已到位（全 codebase 仅此一处） |
| 期权/正股天然隔离 | 分析报告已论证 | 不需要 CrossStrategyCoordinator |
| 现有工具函数 | 读 `utils/technical-indicators.ts` + `utils/ema.ts` | `calculateATR()` / `getLatestSMA()` / `calculateEMA()` 已存在，可直接复用 |
| CHOP 过滤器独立性 | 读 `schwartz-signal-filter.service.ts` | `checkChopFilter()` 是 singleton 公开方法，不依赖 Schwartz 策略运行状态 |

---

## 1. 评分逻辑对比：现有两套系统 → 新模型推导

新评分模型不是凭空设计的，是从现有两套评分系统的对比中蒸馏出来的。

### 1.1 现有正股评分（TradingRecommendationService）— 问题在哪

```
env_score = SPX趋势强度 × 0.4 + 市场温度(归一化) × 0.4 + VIX(归一化) × 0.2
```

| 特征 | 现状 | 问题 |
|------|------|------|
| 因子数 | 3 个 | 信息量不足，遗漏动量、成交量、跨资产联动 |
| 时间粒度 | 纯日线 | 无法捕捉日内异动 |
| 决策方式 | 分类判断（良好/中性/较差）| 粗粒度，中间状态丢失信号 |
| VIX 处理 | > 35 一票否决 | 过于粗暴，VIX 25-35 区间完全无区分 |
| 动态阈值 | 无 | 固定阈值在高波动期误触发 |
| 个股分析 | 趋势判断 + ATR 止损 | 无相对强度、无成交量确认、无均线系统 |

**结论**: 这套系统做 swing trading 太粗糙，缺少 Robin 核心的均线/强度/量价逻辑。

### 1.2 期权评分（OptionRecommendationService Phase 3）— 哪些值得借

```
finalScore = 市场分(20%) + 日内分(60%) + 时间窗口分(20%)
```

**市场分 (20%) 详细拆解**:
- SPX 日线趋势 20%（多窗口：3d/10d/20d 一致性加权） — **质量高**
- SPX 分钟趋势 20%（1min+5min 加权）
- Gap 信号 0-15 点
- USD -10%（日线+分钟）
- BTC 5-10%（共振判断，Pearson 相关性 > 0.5 时加权）
- VIX 三级评分（hourly > subscription > daily，不是一票否决）
- 市场温度 10%

**日内分 (60%) 详细拆解**:
- 1min 成交量加权动量 30%（ATR 归一化）
- 5min 趋势确认 15%
- VWAP 偏离 15%
- SPX 日内 25%
- BTC/USD 小时级 15%

**时间窗口分 (20%)**: 去偏处理，开盘加分→下午递减→尾盘扣分

**动态阈值**: `effectiveThreshold = max(absoluteFloor, baseThreshold × vixFactor × timeFactor)`

### 1.3 信号迁移决策表

从期权评分中逐项审计每个信号对正股趋势策略的适用性：

| 信号 | 期权中的可靠性 | 迁移到正股？ | 决策理由 |
|------|-------------|------------|---------|
| **SPX 多窗口一致性** | 最高 | **是** → 环境分 | 趋势确认不分品种，3d/10d/20d 一致性加权已在期权中验证 |
| **VIX 三级实时评分** | 高 | **是** → 环境分 | 替代现有 VIX > 35 一票否决，三级评分粒度更合理 |
| **Gap 信号** | 中 | **是** → 动量分 | 隔夜缺口对正股同样关键，直接复用 |
| **BTC 风险偏好** | 中 | **是** → 环境分 | 风险偏好实时脉搏，Pearson 共振检测已验证 |
| **USD 逆相关** | 中 | **是** → 环境分 | 美元走强 → 美股承压，逻辑成立 |
| **CHOP 震荡检测** | 中（Schwartz 过滤器） | **是** → 入场门控 | 震荡期假突破频繁，对正股趋势策略同样致命 |
| **市场温度** | 高 | **是** → 环境分 | 全市场温度计，品种无关 |
| **动态阈值机制** | 高 | **是** → 入场判断 | VIX 调整阈值，避免高波动期误入场 |
| **1min 成交量加权动量** | 高 | **否** | 60s 扫描周期 + swing 持仓 = 秒级动量无意义 |
| **5min 趋势确认** | 高 | **否** | 同上，日线级别策略不需要分钟确认 |
| **VWAP 偏离** | 低 | **否** | swing 尺度下 VWAP 不是有效支撑阻力 |
| **时间衰减/窗口** | N/A | **否** | 正股无到期日，时间衰减概念不适用 |

### 1.4 新模型推导逻辑

```
从现有正股评分继承:    ← 几乎没有（太粗糙）
从期权评分迁移:        ← 环境分整体迁移（VIX/BTC/USD/SPX/温度）
从 Robin 直觉新增:     ← 趋势分（MA系统/52W高点）+ 动量分（RS排名/成交量）
```

| 新模型组件 | 来源 | 为什么 |
|-----------|------|--------|
| **趋势分 40%** | Robin 核心（新建） | MA50/MA200 + 52W高点 + SPX一致性 — 现有两套系统都没有的 Robin 核心能力 |
| **动量分 30%** | Robin + 部分期权（新建+复用） | RS排名（Robin新建）+ 日线量价（新建）+ Gap（期权复用） |
| **环境分 30%** | 期权评分迁移（复用） | VIX三级 + BTC + USD + 市场温度 — 期权系统已验证，直接复用 |

**权重分配理由**:
- 趋势分最重（40%）：Robin 的核心 alpha 在趋势判断，均线/新高是他的看家本领
- 动量分次之（30%）：RS 排名实现行业轮动，成交量确认避免假突破
- 环境分兜底（30%）：大盘环境是系统性风险过滤，不生成 alpha 但防止逆势入场

---

## 2. 设计哲学（Robin 翻译表）

将 Robin 的交易直觉系统化翻译为量化参数，复用期权策略已验证的环境信号，构建独立于期权的正股趋势跟踪策略。

| Robin 特征 | 系统参数 |
|-----------|---------|
| 重仓新高股 | 只做 52 周高点附近（>85% 区间）的标的 |
| 截断亏损 | ATR 倍数止损（2×ATR），无例外 |
| 让利润奔跑 | ATR trailing stop（不设固定止盈） |
| 三倍杠杆 ETF | 标的池含 TQQQ/SQQQ/SPXL/SPXS |
| 行业轮动 | 多板块标的池 + 相对强度排名 |
| MA 系统 | MA50/MA200 双均线过滤 |
| 无情感 | 纯评分驱动，不人工干预 |

---

## 3. 架构变更：三个关键补充

### 3.1 环境信号去重 — 共享缓存，不重复调外部接口

**问题**: 期权策略和正股策略都需要 SPX/VIX/BTC/USD/市场温度信号。如果各自调用外部 API，接口调用量翻倍。

**方案**: `optionRecommendationService.getCurrentMarketScore()` 作为 **唯一环境信号入口**，正股策略复用其缓存结果，不独立调用外部接口。

```
┌─────────────────────────────────────────────────────────┐
│  外部接口层（LongPort / FutuOpenD）                       │
│  SPX K线 | VIX | BTC | USD | 市场温度                     │
└──────────────────────┬──────────────────────────────────┘
                       │ 调用一次
                       ▼
┌─────────────────────────────────────────────────────────┐
│  optionRecommendationService.getCurrentMarketScore()    │
│  动态缓存(交易15s/非交易5min)，返回 MonitorMarketScore    │
└──────────┬───────────────────────────┬──────────────────┘
           │                           │
           ▼                           ▼
┌──────────────────────┐   ┌──────────────────────────────┐
│  期权策略              │   │  正股策略                     │
│  直接使用 marketScore  │   │  调用同一方法，命中缓存        │
│  + 日内分 + 时间窗口   │   │  + 趋势分 + 动量分（自行计算） │
└──────────────────────┘   └──────────────────────────────┘
```

**实现要点**:
- `stock-trend-recommendation.service.ts` 的 `calculateEnvironmentScore()` 调用 `optionRecommendationService.getCurrentMarketScore()`
- 底层由 `market-data-cache.service.ts` 管理缓存（交易时段 15s / 非交易时段 5min），两个策略并行运行时天然共享
- 缓存命中时零外部接口调用（已验证 `market-data-cache.service.ts:162-173`）
- 不新建环境信号计算逻辑，不重复调外部接口

### 3.2 两种正股模式：条件选股 vs 自选股监测

**核心区别**: 标的池来源不同 → 评估流程不同 → 应为两个独立策略类型。

| 维度 | STOCK_SCREENING_V1（Robin 条件选股） | TREND_FOLLOWING_V1（自选股监测） |
|------|--------------------------------------|-------------------------------|
| 标的来源 | Futu `get_stock_filter` API 动态筛选 | 用户手动配置 `symbol_pool_config` |
| 标的池大小 | 动态，每轮 0-200 只 | 固定，~10-20 只 |
| 扫描流程 | 先筛选 → 再评分排名 → 取 Top N | 直接评分全部标的 → 排名 → 取 Top N |
| Futu 依赖 | 必须（`futu-bridge` 新增端点） | 不需要 |
| 信号重点 | 外部筛选做粗选，内部评分做精选 | 内部评分做全部判断 |
| 适用场景 | Robin 风格：全市场扫描找强势股 | 用户有明确关注列表 |

**Futu 条件选股 API 能力（`get_stock_filter`）**:

已验证 FutuOpenD 支持以下过滤条件，映射到 Robin 策略：

| Robin 需求 | Futu CustomIndicatorFilter | K线周期 |
|-----------|---------------------------|---------|
| MA50 > MA200 | `MA(50)` > `MA(200)`, RelativePosition.GREATER | 日线 |
| 价格 > MA50 | `CUR_PRICE` > `MA(50)` | 日线 |
| 52 周高点附近 | SimpleFilter: 52 周高低比 > 85% | — |
| 放量确认 | SimpleFilter: volume_ratio > 1.5 | — |
| RSI 确认 | `RSI(14)` > 50 | 日线 |

**futu-bridge 需新增端点**:

```python
# futu-bridge/main.py 新增
@app.get("/stock-filter")
async def stock_filter(market: str = "US", filters: str = ""):
    """条件选股 — 调用 FutuOpenD get_stock_filter"""
    # 解析 filters JSON → 构建 SimpleFilter + CustomIndicatorFilter
    # 调用 quote_ctx.get_stock_filter(market, filter_list)
    # 返回 { symbols: [...], count: N }
```

**频率限制**: 10 次/30s。60s 扫描周期内只调一次，绰绰有余。

### 3.3 正股策略类别互斥 — 同类别只允许一个运行

**现状**: 互斥检查是 `s1.type = s2.type`，只防同类型并发。
**问题**: `TREND_FOLLOWING_V1` 和 `STOCK_SCREENING_V1` 类型不同，可以同时运行，但它们都是正股策略，同时运行会争抢标的和资金。

**方案**: App 层维护策略类别映射，启动时检查同类别冲突。

```typescript
// api/src/config/strategy-categories.ts
export const STRATEGY_CATEGORIES: Record<string, string[]> = {
  STOCK: ['RECOMMENDATION_V1', 'TREND_FOLLOWING_V1', 'STOCK_SCREENING_V1'],
  OPTION: ['OPTION_INTRADAY_V1', 'OPTION_SCHWARTZ_V1'],
};

// 根据 type 找到所属类别的所有类型
export function getSameCategoryTypes(type: string): string[] {
  for (const [, types] of Object.entries(STRATEGY_CATEGORIES)) {
    if (types.includes(type)) return types;
  }
  return [type]; // 未分类则仅限同类型
}
```

**修改互斥查询** (`quant.ts:1155-1160`):

```sql
-- 原来: s1.type = s2.type（同类型）
-- 改为: s2.type = ANY($2)（同类别所有类型）
SELECT s2.id, s2.name, s2.type FROM strategies s2
WHERE s2.id != $1 AND s2.status = 'RUNNING'
  AND s2.type = ANY($2)
```

其中 `$2 = getSameCategoryTypes(thisStrategy.type)`。

**效果**: 启动 `TREND_FOLLOWING_V1` 时，如果已有 `STOCK_SCREENING_V1` 在运行 → 409 拒绝，反之亦然。期权策略不受影响。

---

## 4. 评分模型

```
策略名: TREND_FOLLOWING_V1 / STOCK_SCREENING_V1（共享评分引擎）
周期: 60s 扫描
标的池: 自选股固定池 / Futu 条件选股动态池

┌─────────────────────────────────────┐
│ 趋势分 (40%)                        │
│  - MA50/MA200 位置关系 20%           │ → 详见 4.1
│  - 52周高点距离 10%                  │ → 详见 4.2
│  - SPX 多窗口一致性 10%              │ → 复用 optionRecommendation
├─────────────────────────────────────┤
│ 动量分 (30%)                        │
│  - 相对强度(RS) vs SPX 15%          │ → 详见 4.3
│  - 成交量确认 10%                    │ → 详见 4.4
│  - Gap 信号 5%                      │ → 复用 optionRecommendation
├─────────────────────────────────────┤
│ 环境分 (30%)                        │
│  - VIX 三级评分 10%                  │ → 复用 optionRecommendation
│  - BTC 风险偏好 5%                   │ → 复用 optionRecommendation
│  - USD 逆相关 5%                     │ → 复用 optionRecommendation
│  - 市场温度 10%                      │ → 复用 marketDataService
└─────────────────────────────────────┘
```

### 4.1 MA50/MA200 位置关系评分（20 分满分）

数据源: `marketDataService.getDailyOHLCV(symbol, 250)` → 复用 `getLatestSMA(closes, period)`（`utils/ema.ts`）

```typescript
// 计算逻辑
const ma50 = SMA(closes, 50);
const ma200 = SMA(closes, 200);
const price = closes[closes.length - 1];

let maScore = 0;
if (price > ma50 && ma50 > ma200) maScore = 20;       // 多头排列
else if (price > ma50 && ma50 <= ma200) maScore = 10;  // 价在MA50上但未金叉
else if (price > ma200 && price <= ma50) maScore = 5;   // 回踩区间
else maScore = 0;                                        // 空头排列，不入场
```

### 4.2 52 周高点距离评分（10 分满分）

数据源: `getDailyOHLCV(symbol, 252)` → 取 max(high)（需要完整 OHLCV，close 不够精确）

```typescript
const high52w = Math.max(...dailyData.map(d => d.high));
const distancePct = price / high52w * 100;

let highScore = 0;
if (distancePct >= 95) highScore = 10;       // 接近新高
else if (distancePct >= 90) highScore = 8;
else if (distancePct >= 85) highScore = 5;
else if (distancePct >= 75) highScore = 2;
else highScore = 0;                           // 远离高点，不符合强势股特征
```

### 4.3 相对强度（RS）评分（15 分满分）

SPX 日线数据来源：`marketDataService.getSPXCandlesticks(30)` 获取 SPX 日线价格序列，计算 20d 收益率（不能从 `getCurrentMarketScore()` 获取，它只返回评分分量不返回原始价格）。

```typescript
// RS = (symbol_return_20d / spx_return_20d) 归一化
const symbolReturn = (price - closes20dAgo) / closes20dAgo;
const spxReturn = (spxPrice - spxPrice20dAgo) / spxPrice20dAgo;
const rs = symbolReturn - spxReturn;  // 超额收益率

// 在所有候选标的中排名
// 排名 1-3: 15分 | 4-5: 12分 | 6-10: 8分 | 10+: 3分
```

### 4.4 成交量确认评分（10 分满分）

数据源: `getDailyOHLCV(symbol, 30)` — 返回完整 OHLCV 含 volume

```typescript
const avgVolume20d = SMA(volumes.slice(-20), 20);
const todayVolume = volumes[volumes.length - 1];
const volumeRatio = todayVolume / avgVolume20d;

let volumeScore = 0;
if (volumeRatio >= 2.0) volumeScore = 10;     // 放量突破
else if (volumeRatio >= 1.5) volumeScore = 8;
else if (volumeRatio >= 1.0) volumeScore = 5;  // 正常量
else volumeScore = 2;                           // 缩量（趋势衰减信号）
```

### 4.5 环境分（30 分满分）— 全部复用

环境分是标的无关的，每个扫描周期只算一次，由 `market-data-cache.service.ts` 管理缓存（交易时段 15s / 非交易时段 5min）。

```typescript
// 复用 optionRecommendationService.calculateOptionRecommendation('SPY.US')
// 提取其中的 marketScore（-100 ~ +100），归一化到 0-30
// 或直接调用其内部子方法（需要看是否可独立调用）

// 实际实现方式：调用 getCurrentMarketScore()
const marketScore = await optionRecommendationService.getCurrentMarketScore();

// 拆解子分
const vixScore = mapVixToScore(marketScore.vixValue);        // 0-10
const btcScore = mapBtcToScore(marketScore.btcComponent);    // 0-5
const usdScore = mapUsdToScore(marketScore.usdComponent);    // 0-5
const tempScore = mapTempToScore(marketScore.temperature);   // 0-10
```

### 4.6 动态阈值

```typescript
effectiveThreshold = max(
  absoluteScoreFloor,    // 默认 45（百分制中的 45 分）
  baseThreshold * vixFactor
)

// vixFactor: VIX < 15 → 0.9 | 15-20 → 1.0 | 20-25 → 1.1 | 25-30 → 1.3 | > 30 → 1.5
```

---

## 5. 入场条件

全部满足才触发 BUY：

1. **综合分 > 动态阈值** — 百分制，默认阈值 65
2. **MA 多头排列** — `price > MA50 && MA50 > MA200`（maScore > 0 已隐含此条件）
3. **相对强度排名 Top N** — 竞价阶段（scoringAuction）自然处理
4. **CHOP 非震荡期** — 内联到评分流程中（`|MA10 - MA20| / MA20 * 100 < chopThreshold`），复用已拉取的日线数据，不独立调用 `checkChopFilter()`（该方法无内部缓存，每次调用都查库）
5. **Gap 过滤** — 当日开盘跳空 > `maxGapUpPct`（默认 2%）不追

### 入场竞价流程

与期权策略一致，复用现有 `scoringAuction()`:
1. `evaluateIdleSymbol()` 调用 `strategy.generateSignal(symbol)` 收集候选
2. `scoringAuction()` 按分数排序，取 Top N
3. `executeSymbolEntry()` 申请资金 + 下单

---

## 6. 出场条件

### Phase 1 出场机制（ATR trailing stop 为核心）

需要在 `processHoldingPosition()` 中新增 `TREND_FOLLOWING` 分支，替代硬编码的 5%/10%。

```
退出优先级（从高到低）：
1. 日内熔断 — dailyRealizedPnL < -dailyLossLimitPct × 本金 → 停止新开仓（不平现有仓）
2. MA200 跌破 — price < MA200 → 全仓清仓
3. ATR trailing stop — price < peakPrice - atrMultiple × ATR → 全仓清仓
4. 杠杆 ETF 持仓天数 — holdingDays > maxLeveragedEtfDays → 全仓清仓
5. MA50 跌破 — price < MA50 → 收紧 trailing stop 到 1×ATR（不直接卖出）
```

### ATR Trailing Stop 实现

```typescript
// 入场时: 通过 intent.metadata 传递，在 OPENING→HOLDING 转换时显式存入 context
// ⚠️ 非期权策略的 metadata 不会自动映射到 HOLDING context，必须在 scheduler 中显式提取
context.atrAtEntry = calculateATR(dailyData, 14);  // 复用 utils/technical-indicators.ts
context.initialStopLoss = entryPrice - 2 * context.atrAtEntry;
context.peakPrice = entryPrice;  // ✅ 已存在于 POSITION_CONTEXT_RESET，直接复用
context.trailingStopPrice = context.initialStopLoss;
context.maTightenActive = false;  // MA50 跌破后的收紧标记

// 每 tick 更新（processHoldingPosition 中）:
if (currentPrice > context.peakPrice) {
  context.peakPrice = currentPrice;
  const atrMultiple = context.maTightenActive ? 1.0 : 2.0;  // MA50 跌破后收紧
  context.trailingStopPrice = context.peakPrice - atrMultiple * context.atrAtEntry;
}

// 触发卖出
if (currentPrice <= context.trailingStopPrice) → SELL
```

### MA 均线退出（嵌入 processHoldingPosition）

```typescript
// 需要在 HOLDING tick 中获取 MA50/MA200（日线级别，缓存 5 分钟）
const { ma50, ma200 } = await getCachedMA(symbol);

if (currentPrice < ma200) {
  // 硬退出：跌破 MA200 = 趋势彻底翻转
  shouldSell = true;
  exitReason = 'MA200_BREAK';
} else if (currentPrice < ma50 && !context.maTightenActive) {
  // 软退出：跌破 MA50 = 趋势减弱，收紧止损
  context.maTightenActive = true;
  context.trailingStopPrice = context.peakPrice - 1.0 * context.atrAtEntry;
  // 不卖出，只收紧
}
```

---

## 7. 仓位管理

通过 `capital-manager.service.ts` 现有机制实现：

| 规则 | 实现方式 |
|------|---------|
| 每只标的最大 15% 资金 | config.maxConcentration = 0.15 → `requestAllocation()` 已支持 |
| 杠杆 ETF 最大 10% | 在 `generateSignal()` 中判断标的类型，调整 `intent.metadata.maxConcentration` |
| 相关组内最大 30% | 复用 `symbol_pool_config.correlationGroups` |
| 最多 5 个并发持仓 | config.maxConcurrentPositions → `scoringAuction()` 前检查 |

---

## 8. Config Interface（TypeScript 接口定义）

```typescript
export interface TrendFollowingConfig {
  // === 趋势参数 ===
  maFastPeriod: number;            // 快线周期，默认 50
  maSlowPeriod: number;            // 慢线周期，默认 200
  weekHigh52Threshold: number;     // 52周高点最低百分比，默认 85

  // === 动量参数 ===
  rsLookbackDays: number;          // 相对强度回看天数，默认 20
  volumeConfirmMultiple: number;   // 放量确认倍数，默认 1.5

  // === 风控参数 ===
  atrPeriod: number;               // ATR 计算周期，默认 14
  atrTrailingMultiple: number;     // trailing stop ATR 倍数，默认 2.0
  atrTightenMultiple: number;      // MA50 跌破后收紧倍数，默认 1.0
  maxConcurrentPositions: number;  // 最大并发持仓数，默认 5
  maxConcentration: number;        // 单标的最大资金占比，默认 0.15
  leveragedEtfMaxConcentration: number;  // 杠杆ETF最大占比，默认 0.10
  leveragedEtfMaxDays: number;     // 杠杆ETF最长持仓天数，默认 5
  dailyLossLimitPct: number;       // 日内熔断百分比，默认 2

  // === 入场参数 ===
  entryScoreThreshold: number;     // 入场分数阈值（百分制），默认 65
  absoluteScoreFloor: number;      // 绝对分数地板，默认 45
  maxGapUpPct: number;             // 最大跳空追入百分比，默认 2
  chopThreshold: number;           // CHOP 震荡检测阈值，默认 0.5

  // === 权重（高级，通常不改） ===
  weights?: {
    trend: number;      // 默认 40
    momentum: number;   // 默认 30
    environment: number; // 默认 30
  };
}
```

### 默认配置

```typescript
const DEFAULT_TREND_FOLLOWING_CONFIG: TrendFollowingConfig = {
  maFastPeriod: 50,
  maSlowPeriod: 200,
  weekHigh52Threshold: 85,
  rsLookbackDays: 20,
  volumeConfirmMultiple: 1.5,
  atrPeriod: 14,
  atrTrailingMultiple: 2.0,
  atrTightenMultiple: 1.0,
  maxConcurrentPositions: 5,
  maxConcentration: 0.15,
  leveragedEtfMaxConcentration: 0.10,
  leveragedEtfMaxDays: 5,
  dailyLossLimitPct: 2,
  entryScoreThreshold: 65,
  absoluteScoreFloor: 45,
  maxGapUpPct: 2,
  chopThreshold: 0.5,
};
```

---

## 9. 文件变更清单

### 新建文件（3 个）

| 文件 | 行数估算 | 职责 |
|------|---------|------|
| `api/src/services/stock-trend-recommendation.service.ts` | ~350 | 评分引擎：趋势分 + 动量分 + 环境分 + 动态阈值（两种策略共享） |
| `api/src/services/strategies/trend-following-strategy.ts` | ~120 | 自选股策略类：固定标的池 + `generateSignal()` |
| `api/src/config/strategy-categories.ts` | ~20 | 策略类别映射：STOCK / OPTION 分类，支持同类别互斥 |

### 修改文件（5 个）

| 文件 | 改动位置 | 改动内容 | 行数估算 |
|------|---------|---------|---------|
| `api/src/services/market-data.service.ts` | `getDailyCloseHistory` 附近 | 新增 `getDailyOHLCV(symbol, count)` 方法，复用内部 `candlesticks()` 调用但返回完整 `StandardCandlestickData[]` | ~20 |
| `strategy-scheduler.service.ts` | L5886-5897 (`createStrategyInstance`) | 新增 `TREND_FOLLOWING_V1` case + import | ~5 |
| `strategy-scheduler.service.ts` | L3877-3915 (股票退出分支) | 新增 TREND_FOLLOWING 退出逻辑（ATR trailing + MA check） | ~80 |
| `strategy-scheduler.service.ts` | L41-72 (`POSITION_CONTEXT_RESET` + `POSITION_EXIT_CLEANUP`) | 新增 `atrAtEntry`, `trailingStopPrice`, `maTightenActive`, `initialStopLoss` 字段（`peakPrice` 已存在） | ~8 |
| `strategy-scheduler.service.ts` | L2555-2576 (OPENING→HOLDING 转换) | 显式提取 `intent.metadata` 中的趋势策略字段到 HOLDING context（非期权 metadata 不会自动映射） | ~10 |
| `api/src/routes/quant.ts` | L1155-1160 (互斥检查) | 改为同类别互斥：`s2.type = ANY($2)` + `getSameCategoryTypes()` | ~10 |
| `frontend/components/StrategyFormModal.tsx` | L547-550 (type dropdown) + 新 config section | 新增 TREND_FOLLOWING_V1 选项 + 配置表单 | ~150 |

### Phase 2 新增文件（条件选股模式，Phase 1 不做）

| 文件 | 职责 |
|------|------|
| `api/src/services/strategies/stock-screening-strategy.ts` | Robin 条件选股策略类：调用 Futu → 动态标的池 + 评分 |
| `api/src/services/futu-stock-filter.service.ts` | Futu 条件选股 API 封装（调用 futu-bridge） |
| `futu-bridge/main.py` 新增 `/stock-filter` 端点 | Python 侧暴露 `get_stock_filter` |

### 不需要改的文件

| 文件 | 原方案说需要改 | 实际不需要 |
|------|-------------|-----------|
| `000_init_schema.sql` | "新增 CHECK 约束" | type 列无 CHECK 约束 |
| `capital-manager.service.ts` | — | 现有 `requestAllocation` 已支持 |
| `basic-execution.service.ts` | — | 现有正股下单已支持 |
| `utils/technical-indicators.ts` | — | `calculateATR()` 已存在，直接复用 |
| `utils/ema.ts` | — | `getLatestSMA()` / `calculateEMA()` 已存在，直接复用 |

---

## 10. 实施步骤（分 Step 执行，每步独立可验证）

### Step 0: strategy-categories.ts + 互斥校验改造

最先做，因为后续所有正股策略都依赖这个基础设施。

**0a. 新建 `api/src/config/strategy-categories.ts`**（~20 行）

```typescript
export const STRATEGY_CATEGORIES: Record<string, string[]> = {
  STOCK: ['RECOMMENDATION_V1', 'TREND_FOLLOWING_V1', 'STOCK_SCREENING_V1'],
  OPTION: ['OPTION_INTRADAY_V1', 'OPTION_SCHWARTZ_V1'],
};

export function getSameCategoryTypes(type: string): string[] {
  for (const [, types] of Object.entries(STRATEGY_CATEGORIES)) {
    if (types.includes(type)) return types;
  }
  return [type];
}
```

**0b. 修改 `quant.ts:1155-1160`**（~10 行）

```typescript
// 原: s1.type = s2.type（同类型互斥）
// 改: s2.type = ANY($2)（同类别互斥）
const sameCategoryTypes = getSameCategoryTypes(strategy.type);
const sameTypeCheck = await pool.query(
  `SELECT s2.id, s2.name, s2.type FROM strategies s2
   WHERE s2.id != $1 AND s2.status = 'RUNNING'
     AND s2.type = ANY($2)`,
  [id, sameCategoryTypes]
);
// 409 错误信息改为: "同类别策略 XX (类型: YY) 已在运行"
```

**验证**: 启动一个正股策略后，尝试启动另一个正股策略 → 应返回 409

### Step 0.5: market-data.service.ts 新增 getDailyOHLCV()

**前置条件**: 无。Step 1 的所有评分子模块（ATR、成交量、52W 高点）都依赖此方法。

**实现**（~20 行）:

```typescript
// 在 getDailyCloseHistory() 附近新增
async getDailyOHLCV(symbol: string, count: number = 60): Promise<StandardCandlestickData[]> {
  // 复用现有 candlesticks() 调用 + formatLongbridgeCandlestick()
  // 与 getDailyCloseHistory 唯一区别：返回完整 OHLCV 而非只有 {date, close}
}
```

**原因**: `getDailyCloseHistory()` 内部已通过 `formatLongbridgeCandlestick()` 拿到完整 OHLCV 但主动丢弃了 high/low/volume。`getRacedKline()` 只支持 SPX/USD/BTC 三个指数，不支持个股。

**验证**: 调用 `getDailyOHLCV('AAPL.US', 30)` → 确认返回含 high/low/close/volume/timestamp

### Step 1: stock-trend-recommendation.service.ts（评分引擎）

**输入**: symbol + 日线 OHLCV 数据 + 环境数据
**输出**: `TrendFollowingScore { totalScore, trendScore, momentumScore, envScore, details, atr, ma50, ma200 }`

实现顺序：
1. **直接复用现有工具函数**：`calculateATR()`（`utils/technical-indicators.ts`）、`getLatestSMA()`（`utils/ema.ts`），不重复实现
2. `calculateTrendScore(symbol)` — MA 位置 + 52W 高点（使用 `getDailyOHLCV` 获取 high） + SPX 一致性
3. `calculateMomentumScore(symbol, allSymbols)` — RS 排名（SPX 数据需额外调用 `getSPXCandlesticks(30)`）+ 成交量（使用 `getDailyOHLCV` 获取 volume）+ Gap
4. `calculateEnvironmentScore()` — 调用 `optionRecommendationService.getCurrentMarketScore()`，命中动态缓存（交易 15s / 非交易 5min），不重复调外部接口
5. **CHOP 检测内联** — 复用已拉取的日线 close 计算 `|SMA(10)-SMA(20)|/SMA(20)*100`，不独立调用 `checkChopFilter()`（该方法无缓存，会重复查库）
6. `evaluateSymbol(symbol)` — 组合三个子分 + CHOP 门控 + 动态阈值
7. `batchEvaluate(symbols)` — 批量评估 + RS 排名

**缓存策略**（避免重复调外部接口）:
- 环境分: 复用 `optionRecommendationService` 底层 `market-data-cache.service.ts` 缓存，不新建
- 日线 OHLCV: per-symbol 内部 Map 缓存 5min（日线数据日内不变，同一标的不重复拉取）。结构 `Map<symbol, { data: StandardCandlestickData[], timestamp: number }>`
- SPX 日线（用于 RS 计算）: 单独调 `getSPXCandlesticks(30)` 一次，per-cycle 缓存
- RS 排名: 每 cycle 重新计算（纯内存计算，不调外部接口）

**验证**: 单元测试 mock 日线数据 → 验证评分输出合理性

### Step 2: trend-following-strategy.ts（自选股策略类）

继承 `StrategyBase`，实现 `generateSignal()`：

```typescript
export class TrendFollowingStrategy extends StrategyBase {
  async generateSignal(symbol: string): Promise<TradingIntent | null> {
    const score = await stockTrendRecommendationService.evaluateSymbol(symbol);

    // CHOP 过滤（内联在评分引擎中，复用已拉取的日线数据，不独立调 checkChopFilter）
    if (score.details.chopDetected) return null;

    // 分数不够
    if (score.totalScore < score.effectiveThreshold) return null;

    // MA 不满足
    if (score.details.maScore === 0) return null;

    // Gap 过滤
    if (score.details.gapPct > this.getConfig('maxGapUpPct', 2)) return null;

    // 杠杆 ETF 浓度调整
    const isLeveraged = LEVERAGED_ETFS.includes(symbol);
    const maxConc = isLeveraged
      ? this.getConfig('leveragedEtfMaxConcentration', 0.10)
      : this.getConfig('maxConcentration', 0.15);

    return {
      action: 'BUY',
      symbol,
      entryPrice: score.details.currentPrice,
      stopLoss: score.details.currentPrice - score.atr * this.getConfig('atrTrailingMultiple', 2.0),
      reason: `趋势=${score.trendScore} 动量=${score.momentumScore} 环境=${score.envScore} 总分=${score.totalScore}`,
      metadata: {
        signalId: await this.logSignal(...),
        totalScore: score.totalScore,
        atrAtEntry: score.atr,
        ma50: score.ma50,
        ma200: score.ma200,
        maxConcentration: maxConc,
        isLeveraged,
      },
    };
  }
}
```

**验证**: 集成测试 → mock market data → 验证信号输出

### Step 3: strategy-scheduler.service.ts 改动

**3a. 工厂方法**（~5 行）

```typescript
// L5886 createStrategyInstance switch
case 'TREND_FOLLOWING_V1':
  return new TrendFollowingStrategy(strategyId, config);
```

**3b. Context 生命周期修正**（~18 行，**安全关键**）

```typescript
// L41-53: POSITION_CONTEXT_RESET 新增字段
const POSITION_CONTEXT_RESET = {
  // ... 现有 10 个字段保持不变 ...
  atrAtEntry: null,           // ← 新增
  trailingStopPrice: null,    // ← 新增
  maTightenActive: false,     // ← 新增
  initialStopLoss: null,      // ← 新增
  // peakPrice 已存在，无需新增
};

// L60-72: POSITION_EXIT_CLEANUP 新增字段
const POSITION_EXIT_CLEANUP = {
  // ... 现有 11 个字段保持不变 ...
  atrAtEntry: null,           // ← 新增（防止泄露到下一笔）
  trailingStopPrice: null,    // ← 新增
  maTightenActive: null,      // ← 新增
  initialStopLoss: null,      // ← 新增
};

// L2555-2576: OPENING→HOLDING 转换时，显式提取趋势策略 metadata
const isTrendFollowing = strategyInstance instanceof TrendFollowingStrategy;
const holdingContext = {
  ...POSITION_CONTEXT_RESET,
  entryPrice: executionResult.avgPrice,
  quantity: executionResult.filledQuantity,
  stopLoss: intent.stopLoss,
  takeProfit: intent.takeProfit,
  // ⚠️ 非期权 metadata 不会自动映射，必须显式提取
  ...(isTrendFollowing && intent.metadata ? {
    atrAtEntry: intent.metadata.atrAtEntry,
    trailingStopPrice: intent.metadata.initialStopLoss,
    maTightenActive: false,
    initialStopLoss: intent.metadata.initialStopLoss,
    isLeveraged: intent.metadata.isLeveraged,
  } : {}),
};
```

**3c. 退出逻辑**（~80 行）

在 `processHoldingPosition()` L3388 处新增检测，L3862（期权分支之后）插入分支：

```typescript
// L3388: 新增检测
const isTrendFollowing = strategyInstance instanceof TrendFollowingStrategy;

// L3862 之后（期权分支后、现有股票分支前）:
if (isTrendFollowing) {
  return await this.processTrendFollowingExit(
    strategyInstance, strategyId, symbol,
    context, currentPrice, entryPrice, quantity, strategyConfig
  );
}

// ========== 其他股票策略：原有 5%/10% 逻辑 ==========
```

新增 `processTrendFollowingExit()` 私有方法：
- 获取缓存 MA50/MA200（复用 `getDailyOHLCV` + `getLatestSMA`，5min TTL）
- 更新 peakPrice + trailingStopPrice
- 检查 MA200 跌破 → SELL
- 检查 ATR trailing stop → SELL
- 检查杠杆 ETF 持仓天数 → SELL
- 检查 MA50 跌破 → 收紧 trailing stop
- 更新 context 到 DB（包括新增的 4 个字段）
- **每条退出路径必须确保 POSITION_EXIT_CLEANUP 被应用**（防止 atrAtEntry 等字段泄露）

### Step 4: 前端配置表单

在 `StrategyFormModal.tsx` 中：
1. type dropdown 新增 `TREND_FOLLOWING_V1 - 正股趋势跟踪 V1`
2. `DEFAULT_CONFIGS.TREND_FOLLOWING_V1` 使用默认配置
3. 新增配置区块：
   - 均线参数（MA 快/慢周期）
   - 风控参数（ATR 周期/倍数、最大持仓数、单标的占比）
   - 入场参数（分数阈值、Gap 过滤）
   - 杠杆 ETF 限制

**验证**: 前端 build 通过 + 手动检查表单渲染

### Step 5: 联调测试

1. 测试环境创建策略实例（配置 3-5 个标的的小池子）
2. 观察评分日志输出
3. 模拟入场 → 验证 context 中 ATR/MA 数据正确
4. 模拟退出 → 验证 trailing stop 更新 + MA break 逻辑

---

## 11. 数据依赖分析

### 需要的市场数据

| 数据 | 来源 | 调用方法 | 缓存 | 用途 |
|------|------|---------|------|------|
| 标的日线 OHLCV (250 天) | LongPort | `marketDataService.getDailyOHLCV(symbol, 250)` **[新增]** | 内部 Map 5min | MA/ATR/52W/成交量/CHOP |
| SPX 日线 (30 天) | LongPort 三源竞速 | `marketDataService.getSPXCandlesticks(30)` | 由 marketDataCache 管理 | RS 计算用 SPX 收益率 |
| 环境评分 | 间接（LongPort/Futu） | `optionRecommendationService.getCurrentMarketScore()` | 交易 15s / 非交易 5min | VIX/BTC/USD/温度 |
| 标的实时价格 | LongPort 行情 | `quoteCtx.quote([symbol])` | 无缓存（实时） | HOLDING 阶段止损判断 |

### 已解决的数据约束

- `getDailyCloseHistory()` 返回 `{date, close}[]`，**不含 high/low/volume** — 不足以支持 ATR/成交量/52W 高点计算
- `getRacedKline()` 参数类型为 `'spx'|'usd'|'btc'`，**只支持 3 个市场指数，不支持个股** — 不可用
- **解决方案**: 新增 `getDailyOHLCV()` 方法（Step 0.5），复用 `getDailyCloseHistory` 内部已有的 `candlesticks()` 调用 + `formatLongbridgeCandlestick()` 转换，返回完整 `StandardCandlestickData[]`（含 open/high/low/close/volume/turnover/timestamp）
- futu-bridge `/kline` 端点支持任意个股任意周期，可作为备选数据源

### 已有可复用工具

| 工具 | 文件 | 签名 |
|------|------|------|
| ATR 计算 | `utils/technical-indicators.ts:21-48` | `calculateATR(candles: {open,high,low,close}[], period=14): number` |
| SMA 计算 | `utils/ema.ts:56-64` | `getLatestSMA(closes: number[], period): number \| null` |
| EMA 计算 | `utils/ema.ts:12-48` | `calculateEMA(closes: number[], period): number[]` |
| K线格式化 | `utils/candlestick-formatter.ts:37-58` | `formatLongbridgeCandlestick(c): StandardCandlestickData` |

---

## 12. 与期权策略的隔离关系

期权（OPTION_INTRADAY_V1）和正股（TREND_FOLLOWING_V1）在券商层天然隔离：

| 维度 | 隔离情况 | 依据 |
|------|---------|------|
| 券商持仓 | 完全独立 | 期权合约 vs 股票，broker API 分离 |
| Symbol | 完全不同 | 合约名 `SPY260120C00410000` vs 股票 `AAPL.US` |
| 资金 | DB 事务隔离 | `SELECT FOR UPDATE` per-strategy |
| 状态机 | 行级隔离 | `UNIQUE(strategy_id, symbol)` |
| 启动 | **类别互斥** | 同类别 409 拒绝（Step 0 改造） |
| 退出逻辑 | 代码分支隔离 | `instanceof TrendFollowingStrategy` 分支 |

不需要 CrossStrategyCoordinator。

---

## 13. Robin 弱点对冲

| Robin 弱点 | Phase 1 对冲 | Phase 2 对冲 |
|-----------|-------------|-------------|
| 震荡市连续假突破 | CHOP 检测 — 震荡期拒绝入场 | — |
| 黑天鹅无对冲 | VIX > 25 → 环境分大幅降低 → 阈值难以触达 | SQQQ 自动建仓 |
| 杠杆 ETF 磨损 | 持仓天数硬限制（默认 5 天） | — |
| 追高被套 | Gap > 2% 过滤 | 回踩 MA 等待逻辑 |

---

## 14. Phase 2 路线图（Phase 1 完成后）

| 功能 | 描述 | 复杂度 | 优先级 |
|------|------|--------|--------|
| **STOCK_SCREENING_V1（Robin 条件选股）** | futu-bridge 新增 `/stock-filter` + 策略类 + 前端表单 | **高** | **P0** |
| SQQQ 自动对冲 | VIX > 25 + 持有多头 → 自动建 SQQQ/SPXS 仓位 | 高 | P1 |
| 部分卖出 | MA50 跌破 → 减半仓位（需改 executeSellIntent 支持 partial） | 高 | P1 |
| 回测框架对接 | 复用现有回测基础设施验证评分权重 | 中 | P1 |
| 多时间框架确认 | 周线趋势确认叠加日线信号 | 低 | P2 |

### STOCK_SCREENING_V1 实施要点（Phase 2 P0）

1. **futu-bridge 新增 `/stock-filter`**
   - Python 侧调用 `quote_ctx.get_stock_filter(TrdMarket.US, filter_list)`
   - 过滤条件映射：MA50>MA200（CustomIndicatorFilter）、52W 高点>85%（SimpleFilter）、量比>1.5
   - 频率：10 次/30s 限制，每 cycle 调一次足够
   - 返回 `{ symbols: string[], count: number }`

2. **Node 侧 `futu-stock-filter.service.ts`**
   - 封装 futu-bridge HTTP 调用
   - 结果缓存 60s（与扫描周期对齐）
   - 错误降级：Futu 不可用时回退到配置的固定标的池

3. **`stock-screening-strategy.ts`**
   - 继承 StrategyBase
   - `generateSignal()` 流程：Futu 粗选 → `stockTrendRecommendationService` 精评 → 返回 TradingIntent
   - 共享评分引擎，只是标的来源不同

4. **互斥已在 Step 0 覆盖** — STOCK 类别互斥自动生效

---

## 15. 待决事项

| # | 问题 | 影响范围 | 建议 |
|---|------|---------|------|
| 1 | **标的池具体清单** | Step 5 联调 | 初始用 8-10 只主流标的测试：AAPL/MSFT/NVDA/TSLA/META + TQQQ/SQQQ/SPXL |
| 2 | ~~`getDailyCloseHistory` 是否含 OHLCV~~ | ~~Step 1 实现~~ | **已解决**: 不含，新增 `getDailyOHLCV()` 方法（Step 0.5） |
| 3 | **评分权重 40/30/30** | 回测验证 | Phase 1 先用，Phase 2 通过回测校准 |
| 4 | **与 RECOMMENDATION_V1 关系** | 启动互斥 | RECOMMENDATION_V1 **仍在代码中作为 3 处默认回退值**（L1195/L2029/L2086），未真正停用。TREND_FOLLOWING_V1 与它同属 STOCK 类别，类别互斥会阻止并发运行 |
| 5 | **Futu 条件选股的具体过滤参数** | Phase 2 | Robin 提供选股条件偏好后确定 |
| 6 | **CHOP 检测阈值验证** | Step 1 | `checkChopFilter` 缺数据时默认放行（`pass: true`）。内联实现后需确认是否保留此行为 |
