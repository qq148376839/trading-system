# 项目进度总结

**更新时间**: 2026-02-27
**项目状态**: ✅ **正常运行**

---

## 🆕 最近更新

### 2026-02-28: 修复 peakPnLPercent 跨交易继承 Bug（P0 资金安全）

**问题**: JSONB `||` 浅合并导致 10 个持仓级字段（peakPnLPercent、emergencyStopLoss、tslpRetry* 等）在交易结束后未清除，下一笔交易继承旧峰值盈利，触发虚假尾部止损造成秒级平仓。

**修复内容**:

1. **POSITION_CONTEXT_RESET 常量**: 定义 10 个持仓级字段的初始值
2. **6 个入场路径注入重置**: Path A(Fill处理) + Path B(executeSymbolEntry) + Path C(executeSymbolEntryR5v2) + Path D(syncBrokerPosition 期权/股票)
3. **退出路径补充清除**: CLOSING→IDLE 时显式设 8 个持仓级字段为 null
4. **防御性校验**: peakPnLPercent 读取点检查 entryTime 存在性，残留数据强制归零
5. **Path A 补充缺失 entryTime**: Fill 处理路径原来未设 entryTime，冷却期逻辑失效

**修改文件**:
- 📝 `api/src/services/strategy-scheduler.service.ts`

**修复文档**: [peakPnLPercent跨交易继承修复](docs/fixes/260228-peakPnLPercent跨交易继承修复.md)

### 2026-02-27: 期权成交量排行快速选股

**变更内容**:

1. **边缘函数**: Vercel + CF Worker 新增 `get-option-rank` 路径支持，quote-token 基于全部查询参数计算，排除 `_` 时间戳自动补充
2. **后端路由**: `GET /quant/option-rank` 通过 `moomooProxy` 调用 Moomoo API，返回标准化的排行数据
3. **前端 API**: `quantApi.getOptionRank()` 支持 rankType / count 参数
4. **前端 UI**: EditStrategyModal 手动输入模式新增「期权热门股」可折叠区块，支持总成交量/成交额切换，已添加标的灰显

**修改文件**:
- 📝 `edge-functions/vercel-moomoo-proxy/api/moomooapi.js`
- 📝 `edge-functions/moomoo-proxy/src/index.js`
- 📝 `api/src/routes/quant.ts`
- 📝 `frontend/lib/api.ts`
- 📝 `frontend/components/EditStrategyModal.tsx`

### 2026-02-27: R5v2 竞价机制优化 — 移除多仓 + 自动分组 + 资金动态分配

**变更内容**:

1. **移除多仓模式**: 删除 `processOptionNewSignalWhileHolding` 方法及调用，所有入场统一走竞价路径
2. **资金动态分配**: `survivorCount` 替代标的池总数 + `maxConcentration` 封顶（默认 33%）
3. **自动相关性分组**: 新建 `correlation.ts`（Pearson + Union-Find），新增 `POST /strategies/:id/correlation-groups` API
4. **回测同步配置**: `applyCrossSymbolFilter` 从策略 `config.correlationGroups` 读取分组

**修改文件**:
- 📝 `api/src/services/strategy-scheduler.service.ts`
- 📝 `api/src/services/capital-manager.service.ts`
- 📝 `api/src/services/option-backtest.service.ts`
- 📝 `api/src/services/market-data.service.ts`
- 🆕 `api/src/utils/correlation.ts`
- 📝 `api/src/routes/quant.ts`

**验证**: 部署后 HOLDING 标的不再生成 `NEW_CONTRACT` 日志；资金分配日志中 `maxPositionPerSymbol` 应为 `allocatedAmount / survivorCount`（不超过 33%）；`POST /api/quant/strategies/1/correlation-groups` 返回分组结果

### 2026-02-27: 回测-实盘信号对齐 — 真实温度 + 日K分时修正

**变更内容**:

1. **温度历史表**: `market_temperature_history` 存储实盘 Longport API 真实温度（5 分钟去重 + BRIN 索引）
2. **实盘写温度**: `getMarketTemperature()` 异步写 DB，不阻塞返回
3. **回测读真实温度**: `buildMarketDataWindow()` 优先 DB 读取 ±5min 窗口真实温度，回退到 `estimateMarketTemperature()`
4. **日K close 分时修正**: `calculateMarketScore()` 用 hourly K 最新价修正 SPX/USD/BTC 日K 当天 close，消除缓存延迟导致趋势跳动

**修改文件**:
- 🆕 `api/migrations/014_add_market_temperature_history.sql`
- 📝 `api/src/services/market-data.service.ts`
- 📝 `api/src/services/option-backtest.service.ts`
- 📝 `api/src/services/option-recommendation.service.ts`

**验证**: 部署后检查 `market_temperature_history` 表有数据写入；实盘日志 `[大盘评分明细]` SPX趋势应保持稳定（不再 -0.9 ↔ -22.1 跳动）

### 2026-02-26: 实盘同步 — 两阶段评分竞价 + 相关性分组 (R5v2)

**变更内容**:

1. **evaluate-then-execute**: 期权策略从并行先到先得改为 Phase A(状态分类) → Phase B(并行评估) → Phase C(两阶段竞价) → Phase D(顺序执行)
2. **相关性分组竞价**: SPY/QQQ/IWM/DIA 归入 `INDEX_ETF` 组，同组 `|finalScore|` 竞价只取最高分，跨组并发/floor 保护
3. **评分传递**: `generateSignal()` metadata 新增 `finalScore`/`marketScore`/`intradayScore`，供竞价使用
4. **group-based floor**: `crossSymbolState.lastFloorExitByGroup` 替代原 per-symbol 的 `lastFloorExitTime/Symbol`

**修改文件**:
- 📝 `api/src/services/strategy-scheduler.service.ts`
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`

**验证**: 部署后检查日志关键词 `R5v2_CANDIDATE` / `R5v2_PHASE1_FILTERED` / `R5v2_PHASE2_FILTERED` / `R5v2_AUCTION`

### 2026-02-26: 回测消除遍历顺序偏差 + 相关性分组竞价 + DQ 评分

**变更内容**:

1. **相关性分组**: SPY/QQQ/IWM/DIA 归入 `INDEX_ETF` 组，同组标的评分竞价只允许最高分入场，消除 `symbols` 数组顺序对结果的影响
2. **两阶段竞价**: `applyCrossSymbolFilter()` 从 entryTime 先到先得改为 `|entryScore|` 降序竞价 — Phase 1 同组竞价 + Phase 2 跨组 R5
3. **DQ 评分**: `diagnosticLog.dqScore` 追踪数据质量 — `totalSlots`(日期×标的)、`validSlots`、`score`(%)、`missingOptionData`

**修改文件**:
- 📝 `api/src/services/option-backtest.service.ts`

**验证**: 回测 QQQ+SPY 7天，无论 `symbols` 顺序如何结果应一致；检查 `CORR_GROUP:` filterReason 和 `dqScore`

### 2026-02-26: 回测支持周期权到期日 + API限频防超时

**变更内容**:

1. **周期权到期日规则**: 新增 `OPTION_EXPIRY_SCHEDULE` — TSLA/NVDA 等 weekly_friday 标的自动用本周五到期合约（与实盘对齐），SPY/QQQ 等保持每日 0DTE
2. **API 限频**: 引入 `backtestRateLimiter`(200ms) + `retryWithBackoff`(1-5s)，标的间 500ms / 日间 1000ms 延迟，防止多标的回测 API 超时卡死

**修改文件**:
- 📝 `api/src/services/option-backtest.service.ts`

**验证**: 回测 TSLA/NVDA 应生成含周五到期日的期权符号（如 `TSLA260221C...`），非周五日 DTE>0

### 2026-02-26: R5 跨标的入场保护 + 回测性能优化

**变更内容**:

1. **R5 跨标的保护（回测）**: 新增 `applyCrossSymbolFilter()` 后过滤 — 并发入场(±3min) + floor 连锁(30min)，被过滤交易带 `filterReason` 标记，汇总排除被过滤交易
2. **R5 跨标的保护（实盘）**: 新增 `crossSymbolState` 策略级共享内存 — IDLE 入场前检查 CROSS_CONCURRENT/CROSS_FLOOR，入场/退出时更新状态，exitTag 持久化，新交易日自动重置
3. **回测性能优化**: SPX/USD/BTC 1m + VIX 1m 日级预加载，每天只加载一次所有标的共享（4标的×7天: 节省 ~63 DB + ~21 API 调用）

**修改文件**:
- 📝 `api/src/services/option-backtest.service.ts`
- 📝 `api/src/services/strategy-scheduler.service.ts`

**验证**: 部署后跑回测 #94（同 #93 参数），对比执行时间、交易数、`crossSymbolFiltered` 值、floor 数量

### 2026-02-26: 期权回测 — 交易窗口对齐 + 评分曲线修复 + 前端日期优化

**变更内容**: 修复回测 #86 分析定位的 P2 问题（3项子任务全部完成）：

1. **交易窗口对齐**: `resolveStrategyConfig` 从 `tradeWindow.firstHourOnly` 推导窗口（`true`→10:30, `false`→全天），不再读不存在的字段
2. **评分曲线平滑**: `calculateTimeWindowAdjustment` 从阶梯改为渐变，10:30不再断崖（旧: +20→0 跌4分, 新: +5→0 跌1分），中等强度信号10:30后仍可入场
3. **前端日期优化**: `DatePicker multiple` → `RangePicker` + 交易日API自动过滤非交易日 + 列表展示区间格式 + 策略窗口自动联动

**修改文件**:
- 📝 `api/src/services/option-backtest.service.ts`
- 📝 `frontend/app/quant/backtest/page.tsx`
- 📝 `frontend/lib/api.ts`

### 2026-02-26: 期权回测数据分析 — 交易窗口 + 评分曲线问题定位

**分析内容**: 对回测 #86 进行深度分析，定位以下问题（已在上方修复中全部解决）：

1. **交易窗口未对齐实盘**: 回测 `resolveStrategyConfig` 读 `tradeWindowStartET/EndET`（策略 DB 不存在此字段），永远 fallback 到 630（10:30 ET）。实盘用 `tradeWindow.firstHourOnly` 布尔值控制，`firstHourOnly=false` 时全天可交易
2. **timeWindowAdjustment 断崖**: 10:30 从 +20 直降到 0，加权后 -4 分，导致扩展窗口后大部分时段评分不够
3. **前端日期选择器不过滤非交易日**: 用户误选总统日等假日，浪费回测时间
4. **阈值已确认对齐**: 实盘 `option-intraday-strategy.ts:264-269` 和回测都用 `directionalScoreMin × vixFactor`
5. **120%+ 止盈属正常行为**: 0DTE gamma 效应 + 1min 分辨率，TAKE_PROFIT 在下一个 candle close 触发时已超调

**状态**: ~~P2 待优化~~ → ✅ 已修复（交易窗口+评分曲线+日期选择器），仅 marketScore 数据源仍为 P2

### 2026-02-26: 期权回测对齐实盘仓位模式 — MAX_PREMIUM 动态合约数

**变更内容**: 回测引擎支持 `MAX_PREMIUM` 仓位模式 — 入场时根据策略资金预算和当前权利金动态计算合约数（对齐实盘逻辑）。从策略 DB 读取 `positionSizing`/`feeModel`/`capital_allocations`，不再硬编码 1 张。

**修改文件**:
- 📝 `api/src/services/option-backtest.service.ts`

### 2026-02-26: 前端期权回测页面优化 — 4项修复

**变更内容**:
1. **列表页无数据修复**: 后端 `getBacktestResultsByStrategy` 补返回 `config`/`status` 等字段，前端过滤逻辑恢复正常
2. **参数覆盖改为可选**: 选策略后显示只读参数卡，默认使用策略 DB 配置，勾选覆盖后才展开编辑面板
3. **4 个新参数**: `avoidFirstMinutes`/`noNewEntryBeforeCloseMinutes`/`forceCloseBeforeCloseMinutes`/`vixAdjustThreshold` 加入前端表单
4. **信号日志 VIX 列**: 详情页信号表新增 VIX因子、动态阈值 两列

**修改文件**:
- 🐛 `api/src/services/backtest.service.ts`
- 📝 `frontend/lib/api.ts`
- 📝 `frontend/app/quant/backtest/page.tsx`
- 📝 `frontend/app/quant/backtest/option/[id]/page.tsx`

### 2026-02-26: 回测引擎对齐实盘规则 — 4项修订

**变更内容**:
1. **开盘禁入窗口** (`avoidFirstMinutes: 15`): 9:30-9:45 禁止入场，对齐实盘 cooldown 机制
2. **收盘前禁开新仓** (`noNewEntryBeforeCloseMinutes: 180`): 13:00 后禁入，与 `tradeWindowEndET` 取较严限制
3. **收盘前强平** (`forceCloseBeforeCloseMinutes: 30`): 15:30 后强制平仓，作为 dynamic-exit 之后的安全网
4. **VIX 动态阈值** (`vixAdjustThreshold: true`): `threshold * clamp(VIX/20, 0.5, 2.5)`，信号日志增加 vixFactor/dynamicThreshold

**修改文件**:
- 📝 `api/src/services/option-backtest.service.ts`（唯一修改文件）

### 2026-02-26: 生死审查 — P0安全修复 + 评分重写 + P1四项修复 + 46用例测试

**变更内容**:
1. **P0 安全修复（4项）**: Shadow-Pricer costPrice fallback 移除、Reconciliation 补全 `dailyRealizedPnL`/`consecutiveLosses`/`dailyTradeCount`、MIN_TRAILING_PERCENT 8→30、NaN guard on prevDailyPnL/prevConsecutiveLosses
2. **日内评分系统重写**: `calculateIntradayScore` 从 3 个失效分量重写为 5 个有效分量 — 标的1m动量(30%) + VWAP位置(15%) + SPX日内(25%) + BTC时K(15%) + USD时K(15%)
3. **finalScore 权重**: market 0.4 + intraday 0.4 → market 0.2 + intraday 0.6
4. **VIX 自适应入场**: `threshold = base * (VIX/20)`，高波动自动提高门槛
5. **结构对齐检查**: VWAP vs 信号方向一致性验证
6. **P1-V4 TSLP 失败计数器持久化**: `recordTslpFailure`/`resetTslpFailure` 写入 DB context，进程重启后恢复
7. **P1-V3 熔断器收紧 HOLDING**: 熔断触发后将 HOLDING 仓位 TSLPPCT 收紧至 15%
8. **P1-V6 PnL 实际手续费**: 用 `chargeDetail` 实际费用替代 `estimatedFees * 2` 估算
9. **P1-V5 PartialFilledStatus 分离**: 部分成交不再触发 fill 处理，等待最终 FilledStatus
10. **单元测试 46 用例**: NaN guard / 评分系统 / 结构检查 / VIX / TSLP持久化 / 手续费

**修改文件**:
- 🐛 `api/src/services/strategy-scheduler.service.ts`（P0 + P1 全部修复）
- 🐛 `api/src/services/trailing-stop-protection.service.ts`（MIN_TRAILING_PERCENT 8→30）
- 📝 `api/src/services/option-recommendation.service.ts`（日内评分重写 + VIX 自适应）
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（权重调整）
- 📝 `api/src/services/market-data.service.ts`（SPX hourly）
- 📝 `api/src/services/market-data-cache.service.ts`（spxHourly 缓存）
- 📝 `api/src/routes/quant.ts` + `quote.ts` + `futunn-test.ts`（诊断 API）
- ✅ `api/src/__tests__/safety-guards.test.ts`（新增 46 用例安全防护测试）
- 📄 `docs/analysis/260226-生死审查报告.md`（审计报告）

**相关文档**: [生死审查报告](docs/analysis/260226-生死审查报告.md)

### 2026-02-25: Fix 1/2/3 — JSONB 合并 + LIT 移除 + 评分修正

**变更内容**:
1. **Fix 1 JSONB 合并**: `updateState()` 使用 `||` 合并替代整体覆盖，保留累积字段（`dailyRealizedPnL`、`consecutiveLosses`）
2. **Fix 2 移除 LIT**: LIT 止盈保护单与软件止盈冲突，移除全部三处调用（提交/检查/取消）。TSLPPCT trailing 放宽至 55-60%（崩溃安全网），不干扰软件动态退出
3. **Fix 3 评分修正**: 温度 ≥65 权重 0.3→0.5；趋势放大 10x→5x

**修改文件**:
- 📝 `api/src/services/state-manager.service.ts`（JSONB 合并）
- 🐛 `api/src/services/strategy-scheduler.service.ts`（LIT 移除 -76 行）
- 📝 `api/src/services/trailing-stop-protection.service.ts`（TSLPPCT 55-60%）
- 📝 `api/src/services/option-recommendation.service.ts`（评分修正）

### 2026-02-24: 订单成交竞态修复 + 0DTE 收盘窗口扩至180分钟

**变更内容**:
1. **P0 竞态修复**: WebSocket trade-push 抢先设 `current_status='FILLED'`，order monitor 守卫恒 false → 卖出回调（PnL/熔断/LIT）全部失效。新增 `fill_processed` 布尔列解耦，仅 order monitor 处理完成后置 TRUE
2. **0DTE 收盘窗口 120→180 分钟**: 不再开新仓时间从 2:00 PM ET 提前到 1:00 PM ET，强平 watchdog 同步调整

**修改文件**:
- 🐛 `api/src/services/strategy-scheduler.service.ts`（守卫条件 + fill_processed + 180min）
- 🐛 `api/src/services/option-dynamic-exit.service.ts`（TIME_STOP 阈值 180min）
- 🐛 `api/src/services/0dte-watchdog.service.ts`（FORCE_CLOSE_HOUR 14→13）
- 📝 `api/migrations/000_init_schema.sql`（fill_processed 列 + 兼容迁移）

**部署注意**: 需执行数据库迁移 `000_init_schema.sql`（含 IF NOT EXISTS 兼容）

### 2026-02-24: 盈亏百分比归零修复 + LIT 止盈保护单

**变更内容**:
1. **P0 修复**: `grossPnLPercent` 始终为 0.0% 导致止盈止损完全失效。`multiplier` 从 JSONB 反序列化为字符串，`costBasis` 计算 NaN → 百分比归零。`calculatePnL()` 强制 `Number()` 转换 + 回退公式 `(priceDiff/entryPrice)*100` + 诊断日志
2. **positionCtx 数值保护**: `multiplier`/`entryPrice`/`currentPrice`/`quantity` 全部 `Number()` 包裹
3. **LIT 止盈保护单**: 期权买入后自动提交 LIT（触价限价单）止盈保护，与 TSLPPCT 互补（TSLPPCT 防回撤 + LIT 确保止盈）
4. **LIT 生命周期**: 持仓监控状态检查 + 软件退出前取消 + 双保护单互斥处理

**修改文件**:
- 🐛 `api/src/services/option-dynamic-exit.service.ts`（`calculatePnL()` 防御性强化）
- 🐛 `api/src/services/strategy-scheduler.service.ts`（positionCtx 数值保护 + LIT 集成）
- 📝 `api/src/services/trailing-stop-protection.service.ts`（新增 LIT 止盈方法）

**开发文档**: [260224-盈亏百分比归零与LIT止盈保护修复](docs/fixes/260224-盈亏百分比归零与LIT止盈保护修复.md)

### 2026-02-23: 移除标的池 $300 硬编码筛选门槛

**变更内容**: 删除 `getEffectiveSymbolPool()` 中 `MIN_OPTION_COST = 300` 硬编码，简化为全标的均分。资金保护由下游 `requestAllocation()` 事务级关卡负责。

**修改文件**:
- 📝 `api/src/services/capital-manager.service.ts`（`getEffectiveSymbolPool` 简化）
- 📝 `api/src/routes/quant.ts`（simulate 诊断移除 `minOptionCost`）

### 2026-02-21: 策略模拟接口新增资金分配诊断

**变更内容**: simulate 端点响应新增 `capitalAllocation` 字段，展示账户现金、策略额度、已用/可用、标的池过滤、每标的上限、持仓明细。

**修改文件**:
- 📝 `api/src/routes/quant.ts`（simulate 端点 +81 行）

### 2026-02-21: Moomoo Cookie 池扩容 + 边缘函数请求去重

**变更内容**: Cookie 池 3→15 组 + CF Worker/Vercel Edge 请求去重（2.5s TTL），降低限流风险，合并并发请求。

**新增文件**:
- 🆕 `scripts/harvest-moomoo-cookies.js`（Playwright 自动采集脚本）

**修改文件**:
- 📝 `edge-functions/moomoo-proxy/src/index.js`（15 组 Cookie + 请求去重）
- 📝 `edge-functions/vercel-moomoo-proxy/api/moomooapi.js`（15 组 Cookie + 请求去重）
- 📝 `api/src/config/futunn.ts`（HARDCODED_FALLBACK 扩至 15 组）

### 2026-02-20: 期权回测策略关联 + UX 重构

**变更内容**: 修复期权回测 FK 约束错误（strategy_id=-1 违反外键）+ 前端重构为策略优先选择模式。

**修改文件**:
- 🐛 `api/src/services/option-backtest.service.ts`（createTask 接收 strategyId 替代 -1，新增 getStrategySymbols）
- 🐛 `api/src/routes/option-backtest.ts`（POST body: symbols → strategyId，自动从策略配置获取标的）
- 📝 `frontend/app/quant/backtest/page.tsx`（OptionBacktestTab 重构：策略选择器 + 只读标的展示 + 策略列）
- 📝 `frontend/lib/api.ts`（optionBacktestApi.run 签名更新）

### 2026-02-20: 期权策略回测模块 (Option Intraday Backtest)

**变更内容**: 新建独立期权策略回测引擎，回放 OPTION_INTRADAY_V1 策略在指定日期的表现。不修改生产服务。

**新增文件**:
- 🆕 `api/src/services/option-backtest.service.ts`（核心回测引擎：评分+入场+退出+汇总）
- 🆕 `api/src/routes/option-backtest.ts`（POST 创建任务 + GET 获取结果）
- 🆕 `frontend/app/quant/backtest/option/[id]/page.tsx`（期权回测详情页）
- 📄 `docs/features/260220-期权回测模块.md`

**修改文件**:
- 📝 `api/src/server.ts`（注册新路由）
- 📝 `frontend/app/quant/backtest/page.tsx`（Tabs 切换：策略回测/期权回测）
- 📝 `frontend/lib/api.ts`（新增 optionBacktestApi）
- 🐛 `api/src/services/backtest.service.ts`（修复 L180 缺失方法名）

### 2026-02-20: 策略回滚到盈利版本(22901e7) + 保留安全修复

**变更内容**: 策略核心逻辑回滚到22901e7简洁版本（删除VWAP/价格确认/RSI/动量衰减/反向策略等过度拦截），保留Greeks检查、entryThresholdOverride、skip0DTE、0DTE冷却窗口等安全修复。评分权重恢复到40/40/20。

**修改文件**:
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（1257→749行，回滚generateSignal核心逻辑）
- 📝 `api/src/services/option-recommendation.service.ts`（评分权重+算法恢复到22901e7版本）
- 📄 `docs/fixes/260220-策略回滚到盈利版本.md`

### 2026-02-19: 前端策略配置整体改版 — 风险预设系统 + 数字输入UX修复 + 布局重组

**变更内容**:
1. **后端 `entryThresholdOverride`**：`OptionIntradayStrategyConfig` 新增可选字段 `entryThresholdOverride: { directionalScoreMin?, spreadScoreMin? }`，`getThresholds()` 优先读 override，fallback 到 `ENTRY_THRESHOLDS` 查表。无需数据库迁移（JSONB 字段自动兼容）
2. **模拟接口适配**：`quant.ts` simulate 端点阈值计算也使用 `entryThresholdOverride`
3. **风险预设系统（4档）**：替换旧的 CONSERVATIVE/AGGRESSIVE 二选一下拉框，新增 保守/标准(推荐)/激进/自定义 四档 radio 卡片。选择预设自动填充8个关联参数，手动修改任一字段自动切为「自定义」
4. **数字输入UX修复**：所有14个 number input 引入 `localNumbers` string 状态 + `numberInputProps()` 复用函数，onChange 存原始字符串，onBlur 解析+校验+回写 formData，用户可自由清空/编辑不再跳回默认值
5. **6区块布局重组**：策略类型 → 风险模式 → 入场参数(可折叠) → 退出参数 → 交易窗口 → 开仓设置
6. **新增前端配置字段**：入场得分阈值(`entryThresholdOverride.directionalScoreMin`)、方向确认窗口(`tradeWindow.directionConfirmMinutes`)、尾盘阈值提升(`latePeriod.minProfitThreshold`)
7. **修复不一致**：`noNewEntryBeforeCloseMinutes` 默认 60→120（与后端对齐）；`firstHourOnly` 开启时灰显「禁止开仓窗口」并提示不生效

**修改文件**:
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（新增 `entryThresholdOverride` 接口 + `getThresholds()` override 逻辑）
- 📝 `api/src/routes/quant.ts`（simulate 端点适配 `entryThresholdOverride`）
- 📝 `frontend/components/EditStrategyModal.tsx`（重写 OPTION_INTRADAY_V1 配置区块：预设系统 + 数字输入UX + 6区块布局）

### 2026-02-19: 0DTE 强平时间调整 180→120 分钟

**变更内容**: 0DTE 期权强制平仓时间从收盘前 180 分钟（1:00 PM ET）调整为收盘前 120 分钟（2:00 PM ET），多出 1 小时交易窗口。同步调整禁入窗口默认值和前端文案。

**修改文件**:
- 📝 `api/src/services/option-dynamic-exit.service.ts`（0DTE TIME_STOP 阈值 180→120）
- 📝 `api/src/services/strategy-scheduler.service.ts`（空闲跳过 + 禁入窗口默认值 180→120，共3处）
- 📝 `frontend/components/EditStrategyModal.tsx`（强平规则文案 180→120，共2处）

---

### 2026-02-18: 修复 VWAP rangePct 单位不匹配导致波动率分桶失效

**问题**: rangePct 百分比值（0.65）与消费侧小数阈值（0.0065）不匹配，波动率分桶永远走高波动分支。
**修复**: `strategy-scheduler.service.ts` + `option-dynamic-exit.service.ts` 阈值和日志对齐为百分比单位。

---

### 2026-02-18: SPX/USD/BTC 分时K线数据持久化存储

**变更内容**:
1. 新建 `market_kline_history` 表存储 1m K 线数据 + `kline_collection_status` 表监控采集状态
2. 新建 K 线采集服务：定时从 Moomoo API 获取 SPX/USD_INDEX/BTC 1m K 线，批量 upsert 到 PostgreSQL
3. 自适应采集间隔：交易时段 60min / 非交易时段 240min，启动延迟 7s
4. 新建 K 线查询服务：`getIntradayData`/`checkAvailability`/`getCompleteness` 等方法
5. 新建 REST API：`GET /:source`、`GET /status`、`GET /health`、`GET /completeness/:source/:date`、`POST /collect`
6. `market-data-cache.service.ts` 回测场景优先从 DB 读取分时数据，DB 无数据时 fallback API
7. `server.ts` 注册路由 + 服务启动/关闭

**新增文件**:
- `api/migrations/013_add_market_kline_history.sql`
- `api/src/services/kline-collection.service.ts`
- `api/src/services/kline-history.service.ts`
- `api/src/routes/kline-history.ts`

**修改文件**:
- `api/migrations/000_init_schema.sql`（追加 DDL）
- `api/src/server.ts`（路由 + 服务集成）
- `api/src/services/market-data-cache.service.ts`（DB 优先读取）

---

### 2026-02-18: 期权信号系统动态化改造 + TSLPPCT 券商保护单集成

**变更内容**:
1. **VWAP 数据修复**：补上 `TradeSessions` 第 5 参数，修复所有标的 VWAP 获取 100% 失败的 napi 错误
2. **RSI-14 过滤器**：新增 Wilder's Smoothed RSI 计算 + 入场过滤（PUT+RSI<25 拒绝超卖追空 / CALL+RSI>75 拒绝超买追多）
3. **MA 排列加成线性化**：二值跳变 ±25/±15 改为偏离度加权线性（MA5×0.7 + MA10×0.3，clamp ±30），消除评分突变
4. **60s 价格确认**：替代旧 15s 连续确认，要求标的价格在 60s 内移动 ≥0.03% 确认信号方向
5. **TSLPPCT 券商保护单集成**：期权买入成交后自动挂出跟踪止损保护单（submit/monitor/cancel 全流程 + 竞态安全处理）
6. **0DTE 禁入默认值**：从 30 分钟改为 0（可通过 DB 配置恢复）
7. **LATE 时段截止**：从 13:00 ET 后移到 14:00 ET（`noNewEntryBeforeCloseMinutes: 180→120`）
8. **recentKlines 扩展**：从 5 根扩展到 20 根，支持 RSI-14 计算

**修改文件**:
- 📝 `api/src/services/market-data.service.ts`（VWAP TradeSessions 修复 + recentKlines 扩展）
- 📝 `api/src/services/option-recommendation.service.ts`（RSI-14 计算 + MA 线性化 + rsi 字段）
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（RSI 过滤 + 价格确认 + 配置默认值）
- 📝 `api/src/services/strategy-scheduler.service.ts`（TSLPPCT submit/monitor/cancel 集成）

**开发文档**: `docs/features/260218-期权信号系统动态化改造开发文档.md`

---

### 2026-02-17: 日志输出优化 — 消除非交易时段 ~75% 冗余日志

**变更内容**:
1. 期权决策 `logDecision()` 非交易时间（`rejectionCheckpoint === 'trade_window'`）直接跳过，不再打印完整决策对象
2. "非交易时间，跳过信号生成" debug 日志添加每标的 5 分钟限频
3. "策略执行完成" 空转分支从 `logger.info` 降级为 `logger.debug`
4. "监控 N 个未成交订单" 添加 5 分钟限频
5. "实际持仓数据为空" 从 `warn` 降级为 `debug`（非交易时段预期行为）
6. "Database connected" 仅首次连接打印 `info`，后续 `debug`
7. "LogService 队列缩容" 从 `info` 降级为 `debug`
8. "恢复策略实例" 多条 info 合并为单条汇总

**修改文件**:
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（logDecision 跳过 + debug 限频）
- 📝 `api/src/services/strategy-scheduler.service.ts`（空转降级 + 未成交订单限频）
- 📝 `api/src/services/account-balance-sync.service.ts`（持仓为空降级）
- 📝 `api/src/config/database.ts`（首次连接标志）
- 📝 `api/src/services/log.service.ts`（缩容降级）
- 📝 `api/src/services/state-manager.service.ts`（合并恢复日志）

---

### 2026-02-17: 0DTE 单腿动态风控 Phase 2（VWAP + 时间止损 + 追踪动态化）

**变更内容**:
1. 新增 `getIntradayVWAP()` VWAP 计算服务（LongPort 1m K 线，60s 缓存 + 5min 降级）
2. 新增 VWAP 结构确认入场：连续 2 根 1m 收盘在 VWAP 同侧 + 无反转形态
3. 新增结构失效止损（Level A）：标的价格连续 2 根穿回 VWAP → 平仓
4. 新增时间止损（Level B）：入场后 T 分钟无顺风 → 退出（T = 3/5/8 按波动率分桶）
5. 追踪止盈动态化：0DTE 按波动率分桶设置 trail（10%/12%/15%），使用精确 peakPnLPercent 追踪
6. Scheduler 集成：解析期权方向、获取 VWAP 数据、传递到退出服务 positionCtx

**修改文件**:
- 📝 `api/src/services/market-data.service.ts`（VWAP 计算 + 缓存 + 波动率）
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（VWAP 结构确认入场）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（结构失效 + 时间止损 + 追踪动态化）
- 📝 `api/src/services/strategy-scheduler.service.ts`（VWAP 数据获取 + positionCtx 传递）

**开发文档**: `docs/features/260216-0DTE单腿动态风控开发文档.md`

---

### 2026-02-16: 0DTE 单腿动态风控 Phase 1（禁入窗口/阈值/连续确认/退出兜底）

**变更内容**:
1. 09:30-10:00 ET 禁止 0DTE 新开仓（`zdteCooldownMinutes: 30`），禁入期选 1DTE/2DTE
2. 0DTE 入场阈值从 -10 提升到 -12（`zdteEntryThreshold: 12`）
3. 连续确认：入场信号需连续 2 次同向达标（15s 容忍窗口）
4. 0DTE 止损收紧：PnL 兜底 -25%（mid 价格）+ 禁用冷却期放宽
5. 日志增强：`zdteFlags` 结构化入场日志 + `exitTag` 退出标签

**修改文件**:
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（禁入窗口 + 阈值 + 连续确认）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（PnL 兜底 + mid 价格 + 禁用冷却放宽）
- 📝 `api/src/services/options-contract-selector.service.ts`（skip0DTE 支持）
- 📝 `api/src/services/strategy-scheduler.service.ts`（midPrice 传递）

---

### 2026-02-13: 交易策略优化 — 9项修复（基于260212分析报告）

**变更内容**:
1. 修复策略配置浅合并导致 `tradeWindow` 子字段被覆盖的问题（改为深度合并）
2. 统一 0DTE 截止时间为 180 分钟（1:00 PM ET），从210分钟下调，修复 fallback 值不一致
3. 新增开盘方向确认窗口（30分钟），开盘初期仅允许与大盘方向一致的交易
4. 新增资金不足标的自动排除 + 资金重分配（最低门槛 $300）
5. 新增 LATE 时段冷却期（3分钟）+ 入场阈值提高 10%
6. 止盈止损判断从 `netPnLPercent` 改为 `grossPnLPercent`，修复手续费未到账时 NaN 问题
7. 策略全部平仓后自动重置 `used_amount` 为 0，修复资金差异漂移
8. 市场温度 API 添加缓存降级（5分钟 TTL，最长15分钟）
9. 合约选择器支持外部传入截止时间参数，不再硬编码

**修改文件**:
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（深度合并+方向确认+LATE冷却）
- 📝 `api/src/services/strategy-scheduler.service.ts`（180分钟+有效池+冷却期+毛盈亏+资金重置）
- 📝 `api/src/services/capital-manager.service.ts`（有效标的池+resetUsedAmount）
- 📝 `api/src/services/options-contract-selector.service.ts`（180分钟+可配置截止）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（180分钟+grossPnL决策）
- 📝 `api/src/services/market-data.service.ts`（温度API缓存降级）

---

### 2026-02-12: Vercel Edge Function 主代理 + CF Worker 备选

**变更内容**:
1. 新增 Vercel Edge Function (`vercel-moomoo.riowang.win`) 作为 Moomoo API 主代理，部署在美东 iad1 节点
2. 后端 `moomooProxy()` 改为三级 fallback：Vercel → CF Worker → 直连 moomoo.com
3. 提取 `callEdgeFunction()` 通用函数，Vercel 和 CF 共享响应解析逻辑
4. 新增 `moomoo_vercel_proxy_url` DB 配置项（环境变量 `MOOMOO_VERCEL_PROXY_URL`）

**新增文件**:
- 📝 `edge-functions/vercel-moomoo-proxy/` — Vercel Edge Function 项目（从 CF Worker 移植，去掉 KV 缓存）

**修改文件**:
- 📝 `api/src/utils/moomoo-proxy.ts`（三级 fallback + callEdgeFunction 提取）

---

### 2026-02-12: 策略模拟运行 API

**变更内容**:
1. 新增 `POST /api/quant/strategies/:id/simulate` 接口，模拟策略完整开盘流程
2. 调用真实服务链路（市场数据 → 信号评估 → 合约选择 → 入场计算 → 止盈止损参数），跳过交易时间窗口检查
3. 支持可选真实下单（`executeOrder=true`），非0DTE 合约方便手工撤单
4. 返回完整诊断报告，验证策略配置（riskPreference、exitRules 缩放）是否正确生效

**修改文件**:
- 📝 `api/src/routes/quant.ts`（新增 simulate 端点 + 服务层 import）

---

### 2026-02-12: 止盈止损用户配置生效修复

**变更内容**:
1. 修复 `takeProfitPercent` / `stopLossPercent` 用户配置未在退出逻辑中生效的问题
2. 用户配置作为 EARLY 阶段基准值，按时间阶段比例递减，保留原有时间衰减逻辑
3. 未配置 exitRules 的旧策略行为不变（向后兼容）

**修改文件**:
- 📝 `api/src/services/option-dynamic-exit.service.ts`（新增 ExitRulesOverride + 缩放逻辑）
- 📝 `api/src/services/strategy-scheduler.service.ts`（提取 exitRules 传递给退出服务）

---

### 2026-02-12: cookie_index 边缘函数优化 + Smart Placement + 市场数据诊断增强

**变更内容**:
1. 边缘函数代理改用 `cookie_index`（整数索引）替代完整 cookies 字符串，修复 Cloudflare 530 URL 过长错误
2. 边缘函数新增 `GUEST_CONFIGS` 数组，支持 `cookie_index` 查找本地 cookies + HTML 403 自动重试（cookie 轮转）
3. `wrangler.jsonc` 启用 Smart Placement，Worker 运行在靠近 Moomoo 美国服务器的节点，避免亚洲 PoP 被封锁
4. `market-data-test` 诊断接口新增 `moomoo-proxy` 模式，直接测试 moomooProxy() 原始 API 调用（SPX/USD/BTC 日K + SPX 分时）

**修改文件**:
- 📝 `api/src/config/futunn.ts`（导出 `getEffectiveConfigs()`）
- 📝 `api/src/utils/moomoo-proxy.ts`（cookie_index 逻辑）
- 📝 `api/src/routes/quote.ts`（moomoo-proxy 诊断模式）
- 📝 `edge-functions/moomoo-proxy/src/index.js`（GUEST_CONFIGS + 重试）
- 📝 `edge-functions/moomoo-proxy/wrangler.jsonc`（Smart Placement）
- 📝 `edge-functions/moomooapi.js`（cookie_index 同步）

---

### 2026-02-11: 资金上限保护 + 0DTE交易时间前移

**变更内容**:
1. 资金分配 `FIXED_AMOUNT` 类型增加 `Math.min(配置值, 实际余额)` 封顶保护，避免分配金额超出账户可用余额
2. 0DTE截止时间统一从收盘前 120 分钟前移至 210 分钟（12:30 PM ET / 北京时间冬令时 1:30 AM）
3. 影响范围：强制平仓、买入拦截、无持仓跳过监控、默认策略配置

**修改文件**:
- 📝 `api/src/services/capital-manager.service.ts`（资金分配上限保护）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（0DTE强制平仓时间）
- 📝 `api/src/services/options-contract-selector.service.ts`（0DTE买入拦截时间）
- 📝 `api/src/services/strategy-scheduler.service.ts`（无持仓跳过监控时间）
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（默认配置）

---

### 2026-02-11: 更新3组Moomoo游客Cookie + Worker fallback同步更新

**变更内容**:
1. 更新 `api/src/config/futunn.ts` 中3组硬编码游客 Cookie（cipher_device_id / csrfToken / futu-offline-csrf-v2）
2. 同步更新 `edge-functions/moomoo-proxy/src/index.js` 的 FALLBACK_COOKIES 和 DEFAULT_CSRF_TOKEN
3. 压力测试验证：3-Cookie 轮转 30 并发请求，100% 成功率，avg 1.7s，max 2.8s
4. 对比旧 1-Cookie 方案：20 并发 avg 6s，性能提升约 3.5 倍

---

### 2026-02-11: Moomoo 多 Cookie 管理与边缘代理优化

**变更内容**:
1. 前端多 Cookie 管理 UI（`/config` 页面）：逐行添加/删除/测试/保存，状态标签（unknown/testing/valid/expired）
2. 后端 DB 驱动 Cookie 加载：`refreshDBConfigs()` 5 分钟 TTL 缓存，`getEffectiveConfigs()` 优先 DB 配置
3. Cookie 测试 API：`POST /api/config/test-moomoo-cookie` 通过边缘代理验证 Cookie 有效性
4. 边缘函数 URL 从 DB 加载（不再依赖 .env）：`moomoo_edge_function_url` + `use_moomoo_edge_function`，`getProxyMode()` 改为 async
5. Cloudflare Worker 部署到 `moomoo-api.riowang.win`（wrangler v4，KV namespace: MOOMOO_CACHE）
6. 3组游客 Cookie 硬编码 fallback，DB 覆盖优先

**修改文件**:
- 📝 `frontend/app/config/page.tsx`（多 Cookie UI）
- 📝 `api/src/config/futunn.ts`（DB 驱动 Cookie）
- 📝 `api/src/routes/config.ts`（测试/获取值 API）
- 📝 `api/src/utils/moomoo-proxy.ts`（边缘函数 URL 从 DB 加载）
- 📝 7 个服务/路由文件适配 async `getProxyMode()`

**相关文档**: [Moomoo 多 Cookie 管理与边缘代理优化](docs/features/260211-Moomoo多Cookie管理与边缘代理优化.md)

---

### 2026-02-11: 回滚 TSLPPCT + 恢复原始监控 + 启动预热

**变更内容**：
1. ❌ 完全移除 TSLPPCT 券商侧跟踪止损逻辑（实际运行 100% 失败，引入止损延迟）
2. ❌ 移除双定时器架构（entry 15s / position 90s），恢复单定时器 5 秒（期权策略）
3. ✅ 修复 `entryPrice.toFixed is not a function`：context 取值增加 parseFloat/parseInt + isNaN 校验
4. ✅ 启动市场数据预热：策略启动前先填充缓存，避免多策略并发请求导致 API 限流

**修改文件**：
- 📝 `api/src/services/strategy-scheduler.service.ts`（TSLPPCT 全部移除 + 恢复 5s 监控 + 类型修复 + 启动预热）
- 📝 `api/src/services/trade-push.service.ts`（移除 TSLPPCT 成交检测）

---

### 2026-02-10: 市场数据降级容错 + 已平仓自动转 IDLE

**修复内容**：
1. ✅ 市场数据三级降级：BTC/USD 超时不再阻断全链路，旧缓存<5分钟直接复用，超时重试30s，最终旧缓存兜底
2. ✅ timeout 参数全链路透传：`getAllMarketData` → `getCandlesticks` → `moomooProxy`，重试时可指定 30s
3. ✅ 已平仓持仓自动转 IDLE：券商报告 `availableQuantity=0` 时不再死循环刷 error，一次 warn 后转 IDLE

**修改文件**：
- 📝 `api/src/services/market-data-cache.service.ts`（三级降级）
- 📝 `api/src/services/market-data.service.ts`（timeout 透传）
- 📝 `api/src/services/strategy-scheduler.service.ts`（零持仓自动转 IDLE）

**预期效果**：
- BTC/USD 数据超时时推荐算法仍可运行（使用旧缓存）
- 已平仓期权不再每 5 秒刷一条 error 日志

---

### 2026-02-10: 修复富途 API 与 LongPort SDK 兼容性问题（7 项）

**修复内容**：
1. ✅ 消除 LongPort→Moomoo 交叉调用：新增 `getGreeks()` 批量方法（`calcIndexes` API），LongPort 路径不再依赖 Moomoo
2. ✅ IV 格式归一化：LongPort 小数制(0.35)自动转百分比制(35.0)，匹配 Moomoo 格式
3. ✅ strikeDate 统一为 YYYYMMDD：Moomoo 路径出口处 Unix 时间戳→YYYYMMDD 转换
4. ✅ `contractMultiplier` 从 SDK 读取（不再硬编码 100）
5. ✅ `entryIV` 兜底归一化：兼容数据库中旧格式数据
6. ✅ 期权价格缓存分级 TTL：LongPort 5秒 / Moomoo 10秒

**修改文件**：
- 📝 `api/src/services/longport-option-quote.service.ts`（getGreeks + contractMultiplier + IV 归一化）
- 📝 `api/src/services/options-contract-selector.service.ts`（替换交叉调用 + strikeDate 统一）
- 📝 `api/src/services/strategy-scheduler.service.ts`（entryIV 兜底）
- 📝 `api/src/services/option-price-cache.service.ts`（分级 TTL）

**预期效果**：
- LongPort 路径 Greeks（delta/theta）从 0 恢复为正常值
- ivChange 从 ±99% 异常恢复为 ±20% 正常波动
- 富途 API 代码零修改，向后兼容旧数据

---

### 2026-02-10: Swagger API文档跨平台路径修复

**修复内容**：
1. ✅ 修复 Windows 反斜杠路径导致 `glob.sync()` 匹配 0 文件的问题（`toGlobPath()` 统一转正斜杠）
2. ✅ 修复 Docker 生产环境无 `src/` 目录导致 Swagger 为空（`__dirname` 动态解析到 `dist/routes/*.js`）
3. ✅ 新增启动诊断日志：输出 routesDir、glob 模式、文件数量、API 路径数
4. ✅ 验证通过：开发/生产模式均解析出 44 个 API 路径

**修改文件**：
- 📝 `api/src/config/swagger.ts`（toGlobPath + 诊断日志）

---

### 2026-02-10: 普通账户编辑/删除修复 + API文档嵌入

**修复内容**：
1. ✅ 资金管理普通账户无法编辑/删除：SQL 策略计数改为仅统计 RUNNING 状态
2. ✅ API文档改为 iframe 嵌入前端框架内（`/api-docs` 页面），不再跳转新标签页

**修改文件**：
- 📝 `api/src/routes/quant.ts`（3处 SQL 添加 `AND status = 'RUNNING'`）
- 📝 `frontend/app/api-docs/page.tsx`（新增 iframe 页面）
- 📝 `frontend/components/AppLayout.tsx`（侧边栏链接改为内部路由）

---

### 2026-02-10: LongPort期权链主源 + API文档入口 + 0DTE时间限制

**优化内容**：
1. ✅ LongPort 期权链 API 作为主源：`longport-option-quote.service.ts` 新增到期日/期权链方法，`options-contract-selector.service.ts` 重构为 LongPort 主源 + 富途备用
2. ✅ 新增3个 LongPort 路由：`/api/options/lb/expiry-dates`、`/api/options/lb/chain`、`/api/options/lb/quote`
3. ✅ 前端侧边栏新增"API文档"入口（`AppLayout.tsx`），新标签页打开 `/api/docs`
4. ✅ 0DTE 买入截止：收盘前120分钟禁止买入0DTE期权（`options-contract-selector.service.ts`）
5. ✅ 0DTE 强制平仓：`PositionContext` 新增 `is0DTE`，收盘前120分钟触发 TIME_STOP（`option-dynamic-exit.service.ts`）
6. ✅ 0DTE 清仓后跳过监控：截止时间后无活跃持仓则跳过周期（`strategy-scheduler.service.ts`）

**修改文件**：
- 📝 `api/src/services/longport-option-quote.service.ts`（新增到期日/期权链方法）
- 📝 `api/src/services/options-contract-selector.service.ts`（LongPort主源 + 0DTE截止）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（is0DTE + TIME_STOP）
- 📝 `api/src/services/strategy-scheduler.service.ts`（0DTE清仓跳过监控）
- 📝 `api/src/routes/options.ts`（3个LongPort路由）
- 📝 `frontend/components/AppLayout.tsx`（API文档链接）

**预期效果**：
- 期权链获取延迟降低，富途自动降级备用
- 0DTE风控增强：收盘前120分钟截止买入 + 强制平仓
- API文档可从前端直接访问

---

### 2026-02-10: 日志导出接口流式改造（Streaming NDJSON）

**优化内容**：
1. ✅ `/api/logs/export` 从一次性加载改为 `pg-query-stream` 流式导出
2. ✅ 响应格式从单个大 JSON 改为 NDJSON（每行一个可独立解析的 JSON 对象）
3. ✅ 独立 `PoolClient` + `req.on('close')` 监听，连接安全释放
4. ✅ 结构化输出：meta 行 → 数据行 → summary 行

**修改文件**：
- 📝 `api/src/routes/logs.ts`（export 路由流式改造）

**预期效果**：
- 大数据量导出不再超时，内存占用 O(1)
- 其他路由和查询逻辑不受影响

---

### 2026-02-10: 期权价格获取切换长桥 API 主源

**优化内容**：
1. ✅ 新增统一长桥期权行情服务（`longport-option-quote.service.ts`）
2. ✅ 期权价格获取链：缓存 → LongPort optionQuote → LongPort depth → 富途（备用）→ LongPort quote
3. ✅ IV 获取：LongPort optionQuote 主源，富途 getOptionDetail 备用
4. ✅ 4个服务文件同步切换：strategy-scheduler / basic-execution / option-dynamic-exit

**相关文档**：
- 📄 [期权价格获取切换长桥主源](docs/features/260210-期权价格获取切换长桥主源.md)

**预期效果**：
- 期权价格延迟降低（长桥 SDK 直连）
- optionQuote 同时返回价格和 IV，减少 API 调用次数
- 富途 API 完整保留为备用

---

### 2026-02-06: 日志系统降噪 + 全面重构 ⭐ 核心架构

**优化内容**：
1. ✅ 级别门控：DEBUG仅控制台、ERROR必入库不节流、WARN入库走节流、INFO可选跳过
2. ✅ 节流机制：新增throttleMap/generateThrottleKey/shouldEnqueue，30秒窗口去重
3. ✅ 摘要聚合服务：新增log-digest.service.ts，每5分钟聚合高频指标
4. ✅ 基础设施Logger：新增infra-logger.ts，解决底层模块循环依赖
5. ✅ console全量迁移：约38个文件、约398处console.*迁移到logger.*
6. ✅ **降噪（阶段5）**：7个文件20处添加`{dbWrite:false}`，删除logs.ts调试残留（含5个诊断SQL）
7. ✅ 279个测试全部通过

**相关文档**：
- 📄 [日志系统重构](docs/features/260206-日志系统重构.md)

**预期效果**：
- DB写入/min（盘中）：从25,000-50,000降至500-1,000（减少95-98%）
- 心跳/空跑DB写入：从~860-1460条/小时降至0（仅控制台）
- ERROR/WARN日志完整性：100%入库

---

### 2026-02-05: Docker 部署重大升级 ⭐ 关键修复

**更新内容**：
1. ✅ 升级基础镜像到 Ubuntu 24.04（支持 longport SDK 3.0.21 需要的 GLIBC 2.39）
2. ✅ 手动下载 longport 原生绑定（解决 pnpm 不自动安装平台包问题）
3. ✅ 修复 Next.js 网络绑定（添加 `HOSTNAME=0.0.0.0`）
4. ✅ 中国网络镜像优化（阿里云 + 淘宝镜像）
5. ✅ 单容器部署架构（前端+后端，只暴露端口 3001）

**相关文档**：
- 📄 [Docker 部署指南](docs/guides/251214-Docker部署指南.md)（更新到 2026-02-05）
- 📄 [环境变量配置指南](docs/guides/251216-环境变量配置指南.md)（数据库凭证说明）

**预期效果**：
- 构建成功率 100%，解决 GLIBC 版本问题
- 原生绑定可用性 100%
- 中国网络构建速度提升 3-5 倍

**数据库凭证**：
- 默认：trading_user / trading_password / trading_db
- 可通过项目根目录 `.env` 文件自定义

---

### 2026-02-04: 期权策略决策链路日志增强 ⭐ 开发体验优化

**优化内容**：
1. ✅ 增加9个关键检查点的详细日志（市场数据、信号判定、风险评估、期权选择、流动性/Greeks筛选）
2. ✅ 统一日志格式（`📍 [标的符号] 描述 | 指标=值`）
3. ✅ 新增快捷分析工具（`analyze-today.bat` 和 `analyze-latest.bat`）
4. ✅ 自动生成可视化报告（HTML看板 + 文本报告 + 详细JSON）

**相关文档**：
- 📄 [期权策略决策链路日志增强](docs/features/260204-期权策略决策链路日志增强.md)

**预期效果**：
- 问题定位速度从数小时缩短到几分钟
- 调试难度大幅降低（一键分析）
- 9个检查点覆盖完整决策链路

---

### 2026-02-03: 期权策略推荐算法优化 ⭐ 关键优化

**优化内容**：
1. ✅ 创建期权专用推荐服务（大盘环境 + 分时动量 + 时间窗口）
2. ✅ 市场数据获取重试机制（3次重试，500ms间隔）
3. ✅ option-intraday-strategy改造使用新推荐算法
4. ✅ 降低入场门槛（finalScore > 15），提高交易频率

**相关文档**：
- 📄 [期权策略优化实施文档](docs/features/260203-期权策略优化实施文档.md)

**预期效果**：
- 信号生成率从0%提升至20-40%
- 数据获取失败率从18次降至<1次
- 预计今晚产生1-5笔交易

---

## 📊 项目概览

### 项目名称
长桥股票交易系统（Trading System）

### 项目类型
全栈量化交易平台

### 技术栈
- **后端**: Node.js + Express + TypeScript + PostgreSQL
- **前端**: Next.js 14 + React + TypeScript + Tailwind CSS
- **交易API**: Longbridge SDK（长桥证券）
- **市场数据API**: Moomoo API（富途牛牛）

---

## ✅ 已完成功能

### 1. 核心交易功能
- ✅ 实时行情查询（股票、期权）
- ✅ 订单管理（提交、查询、追踪、修改）
- ✅ 持仓管理（查询、监控、止盈/止损）
- ✅ 交易记录（自动记录、盈亏计算）

### 2. 量化交易系统
- ✅ 策略管理（创建、编辑、启动、停止）
- ✅ 策略执行（信号生成、订单提交、持仓监控）
- ✅ 资金管理（资金分配、可用资金计算、标的级限制）
- ✅ 状态管理（IDLE → OPENING → HOLDING → CLOSING → IDLE）
- ✅ 订单追踪（自动更新未成交订单价格）
- ✅ 状态同步（自动修复状态不一致）

### 3. 期权功能
- ✅ 期权链展示
- ✅ 期权详情查询
- ✅ 期权交易（买入/卖出）
- ✅ 期权持仓计算（考虑合约乘数）
- ✅ **期权日内策略交易（买方）**：支持 `OPTION_INTRADAY_V1`（合约选择、费用模型、收盘前强平）

---

## 🧪 当前测试准备（新增：期权日内策略）

### 功能点清单（必须覆盖）
- **策略类型**：`OPTION_INTRADAY_V1`
- **标的池输入**：支持 ETF/个股（如 `QQQ.US`）与指数（如 `.SPX.US`）
- **合约选择**（富途/Moomoo）：到期（0DTE/最近）、ATM附近 strike 选择、流动性过滤（OI/价差）、Greek过滤（delta/theta）
- **交易费用**：按张计费并纳入资金占用（佣金最小0.99 + 平台费每张0.30）
- **硬约束**：
  - 收盘前 **30 分钟强制平仓**（不论盈亏）
  - 收盘前 N 分钟 **禁止开新仓**（默认60，可配置）
- **订单与状态机**：
  - 期权策略以 underlying 作为 `strategy_instances.symbol`，真实成交标的记录在 `context.tradedSymbol`
  - 订单成交后能正确从 `execution_orders.symbol` 反查并更新到对应 underlying 实例
- **资金释放一致性**：
  - 卖出成交后优先使用 `context.allocationAmount` 释放资金（避免期权 multiplier 漏乘且确保费用一致）

### 推荐手工验证步骤（最小闭环）
1. 创建策略 `OPTION_INTRADAY_V1`，标的池加入 `QQQ.US` / `.SPX.US`（任意一个即可）
2. 启动策略，观察信号日志是否写入 `strategy_signals`（metadata含 optionId/strikeDate/multiplier/estimatedFees）
3. 观察策略在开仓后 `strategy_instances.context.tradedSymbol` 是否为期权 symbol（如 `TSLA260130C460000.US`）
4. 将系统时间调整到“收盘前30分钟”窗口（或在日志中等待接近窗口），确认触发 `FORCED_CLOSE_BEFORE_MARKET_CLOSE` 并发起平仓
5. 确认资金占用释放金额与开仓占用一致（优先看 `allocationAmount` 路径）

---

## ⚠️ 需要标准化/待确认的问题（测试前必须明确）

### 1) 指数期权 stockId 映射
- **现状**：已内置 `SPX -> 200003`；`NDX/XSP/SPXW/NDXP` 等仍依赖 `headfoot-search` 兜底。
- **风险**：搜索结果可能不稳定（名称/类型混淆），导致无法获取 strikeDates/chain/detail。
- **建议标准**：为每个指数确定并固化 `stockId`（来自 Moomoo 实测），写入映射表后再扩大支持范围。

### 2) 期权开仓/平仓定价规则
- **现状**：开仓限价默认取 `ASK`（可配 `MID`）；强平卖出使用当前价回填并走执行器限价逻辑。
- **需要确认**：强平是否允许改为“更激进的成交策略”（例如优先市价或贴近 bid）。

### 3) Windows 下测试命令执行方式
- **现状**：在当前环境中通过自动化执行 `npm test`/`git diff` 会被 PowerShell 包装器解析错误阻断（非测试失败）。
- **建议标准**：后续测试建议在本地终端手动执行：`cd api && npm test`（或直接在 VSCode/Cursor 终端运行）。

### 4. 配置管理
- ✅ Web界面配置管理（数据库存储，支持加密）
- ✅ 管理员账户管理
- ✅ LongPort Access Token自动刷新

### 5. 回测功能 ⭐ 最新优化
- ✅ 策略回测（历史数据回测）
- ✅ 回测结果存储和查询
- ✅ 回测状态管理（PENDING/RUNNING/COMPLETED/FAILED）
- ✅ **交易日验证**：自动排除周末和未来日期，使用Longbridge SDK获取真实交易日数据
- ✅ **历史数据优化**：使用Longbridge历史K线API，支持Moomoo降级方案
- ✅ **数据完整性检查**：自动检查数据量，不足时自动补充
- ✅ **API频次限制**：自动处理API频次限制（每30秒最多60次）
- ✅ **配额监控**：监控API配额使用情况，自动预警
- ✅ **市场环境模拟**：使用日K数据模拟分时市场环境
- ✅ **回测问题修复**：修复5月15日前无交易、动态调整等问题

### 6. 日志系统 ⭐ 全面重构（2026-02-06）
- ✅ **非阻塞日志写入**：内存队列 + 异步批量写入，日志写入延迟 < 10ms
- ✅ **结构化日志记录**：支持模块、级别、TraceID、JSON数据等字段
- ✅ **数据库持久化**：PostgreSQL存储，支持BRIN、B-tree、GIN索引
- ✅ **日志查询和导出**：支持多维度查询和流式 NDJSON 导出（pg-query-stream）
- ✅ **日志聚合和降噪**：日志条数减少95%+，关键信息可见性提升
- ✅ **统一缓存服务**：今日订单统一缓存，消除API频率限制
- ✅ **模块映射系统**：自动映射文件路径到功能模块
- ✅ **级别门控**：DEBUG仅控制台、ERROR必入库不节流、WARN/INFO走节流
- ✅ **节流机制**：30秒窗口去重，DB写入量减少95-98%
- ✅ **摘要聚合**：每5分钟聚合高频指标，写入一条摘要
- ✅ **基础设施Logger**：infra-logger.ts 解决循环依赖
- ✅ **console全量迁移**：约38个文件、398处迁移到logger.*

---

## 🔧 最近修复

### 2026-02-26: 生死审查 P0 安全修复（4项）
1. 🐛 Shadow-Pricer costPrice fallback 移除 — 消除过时成本价导致盈亏误判
2. 🐛 Reconciliation 对账字段补全 — `dailyRealizedPnL`/`consecutiveLosses`/`dailyTradeCount` 不再被意外清零
3. 🐛 MIN_TRAILING_PERCENT 8→30 — 崩溃保护不再因 8% 回撤过早触发
4. 🐛 NaN guard — `prevDailyPnL`/`prevConsecutiveLosses` 未初始化不再传播 NaN

> 2025-12-05 ~ 2026-02-01 的历史修复记录已归档至 [历史修复记录](docs/archive/260223-project-status-history.md)

---

## 📈 项目统计

### 代码规模
- **后端服务**: 19个服务文件
- **API路由**: 16个路由文件
- **数据库表**: 15+个表
- **前端页面**: 10+个页面

### 功能模块
- ✅ 订单管理模块
- ✅ 持仓管理模块
- ✅ 策略管理模块
- ✅ 资金管理模块
- ✅ 配置管理模块
- ✅ 回测模块
- ✅ 期权模块
- ✅ 日志系统模块
- ✅ 交易推送模块

---

## 🐛 已知问题

### 1. 资金使用差异（部分修复）
- **状态**: 已修复主要问题，差异减少31%
- **剩余差异**: 17033.84（可能来自历史订单）
- **计划**: 持续监控，逐步修复

### 2. Context中缺少allocationAmount
- **状态**: 部分标的的context中缺少allocationAmount
- **影响**: 无法自动释放资金
- **计划**: 检查买入逻辑，确保保存allocationAmount

---

## ⏳ P2 待优化

### 1. 期权回测 marketScore 数据源

**优先级**: P2 | **影响**: 回测准确性 | **来源**: 回测 #86 深度分析

- **问题**: `marketTemperature` 回测中固定50 → 贡献恒为0；SPX趋势放大不足（偏离<1%）
- **影响**: 评分几乎完全靠 intradayScore(60%) + timeAdj(20%)，大盘方向(20%)形同虚设
- **待设计**: 需要为回测引擎提供历史 marketTemperature 数据源，或调整计算方式
- **文件**: `api/src/services/option-backtest.service.ts` (~line 203-237, `calculateMarketScore`)

> **已完成子项** (2026-02-26):
> - ~~1a. 交易窗口对齐实盘 `firstHourOnly`~~ ✅
> - ~~1b. timeWindowAdjustment 平滑曲线~~ ✅
> - ~~2. 前端日期选择器 RangePicker + 交易日过滤~~ ✅

---

## 🚀 下一步计划

### 短期优化（1-2周）
1. 监控资金使用差异，确保持续减少
2. 检查买入逻辑，确保context中保存allocationAmount
3. **P2 期权回测 marketScore 数据源**（历史 marketTemperature 接入）
4. 添加修复历史记录

### 中期优化（1-2月）
1. 实现预防机制（避免状态不一致）
2. **P2 marketScore 数据源**（回测引擎 marketTemperature 历史数据）
3. 添加修复报告（定期生成修复报告）
4. 完善监控告警
5. 添加单元测试覆盖

### 长期优化（3-6月）
1. 完善API文档
2. 建立数据结构的类型定义
3. 添加集成测试
4. 性能优化和扩展性改进

---

## 📝 文档状态

### 文档结构
- ✅ **用户指南** (`docs/guides/`) - 使用指南
- ✅ **技术文档** (`docs/technical/`) - 架构和实现细节
- ✅ **功能文档** (`docs/features/`) - 新功能开发记录
- ✅ **修复文档** (`docs/fixes/`) - 问题修复过程记录
- ✅ **分析文档** (`docs/analysis/`) - 问题分析和诊断报告
- ✅ **历史文档** (`docs/archive/`) - 已完成功能的记录

### 文档更新
- ✅ `CHANGELOG.md` - 已更新（包含最新修复和优化）
- ✅ `docs/README.md` - 已更新（添加最新更新说明）
- ✅ `docs/CHANGELOG.md` - 已更新（文档更新日志，包含2025-12-19至2025-12-24的更新）
- ✅ 新增30+个文档（功能文档、修复文档、分析文档）

---

## 🔗 相关链接

- [项目主 README](README.md) - 项目概述和快速开始
- [更新日志](CHANGELOG.md) - 功能更新和修复记录
- [代码地图](CODE_MAP.md) - 代码结构和调用关系
- [文档中心](docs/README.md) - 完整文档索引

---

**最后更新**: 2026-02-28（修复 peakPnLPercent 跨交易继承 Bug — P0 资金安全）
**项目版本**: 1.0

