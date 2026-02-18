# 更新日志

## 2026-02-18

### SPX/USD/BTC 分时K线数据持久化存储

**新增**: 实现 SPX、USD_INDEX、BTC 三大市场标的的 1 分钟 K 线数据持久化存储，支持从 DB 优先读取历史分时数据用于回测。

**改动内容**:

#### 1. 数据库迁移（两张新表 + 配置项）
- **新增**: `market_kline_history` 表 — 存储 1m K 线数据（source/symbol/timestamp/open/high/low/close/volume/turnover），主键 `(source, symbol, timestamp)` 自动去重
- **新增**: `kline_collection_status` 表 — 采集监控（每个 source 的最后采集时间、记录数、错误计数）
- **新增**: `system_config` 种子数据 — `kline_collection_enabled`（启用采集）、`kline_collection_interval_minutes`（采集间隔，默认 60）、`kline_collection_sources`（采集标的列表）
- 同步追加到 `000_init_schema.sql` 确保新部署包含完整 DDL

#### 2. K线采集服务（`kline-collection.service.ts`）
- **新增**: 定时从 Moomoo API 获取 SPX/USD_INDEX/BTC 的 1m K 线数据并批量 upsert 到 PostgreSQL
- 自适应采集间隔：交易时段 60 分钟 / 非交易时段 240 分钟
- 批量 upsert（`ON CONFLICT DO NOTHING`），避免重复插入
- 健康监控：记录每次采集状态（成功/失败/记录数/错误信息）
- 数据清理：自动清理超过保留天数的旧数据
- 启动延迟 7 秒，等待其他服务就绪

#### 3. K线查询服务（`kline-history.service.ts`）
- **新增**: 从 DB 读取历史 K 线数据的查询服务
- `getIntradayData(source, date?)` — 获取指定日期的分时数据
- `getIntradayByDate(source, date)` — 按日期精确查询
- `checkAvailability(source, date)` — 检查某日数据是否可用
- `getCompleteness(source, date)` — 返回数据完整度（记录数、时间跨度、覆盖率）

#### 4. REST API 路由（`kline-history.ts`）
- `GET /api/kline-history/:source` — 查询 K 线数据
- `GET /api/kline-history/status` — 采集状态总览
- `GET /api/kline-history/health` — 健康检查
- `GET /api/kline-history/completeness/:source/:date` — 数据完整度查询
- `POST /api/kline-history/collect` — 手动触发采集

#### 5. Server 集成
- `server.ts` 注册 `kline-history` 路由、启动 kline-collection 服务（7s 延迟）、graceful shutdown 时停止采集

#### 6. 回测数据源优化
- `market-data-cache.service.ts` 新增 `getHistoricalIntradayFromDB()` 方法
- `getHistoricalMarketData()` 修改为优先从 DB 读取分时数据（回测场景），DB 无数据时 fallback 到原有 API

**新增文件**:
- `api/migrations/013_add_market_kline_history.sql`（迁移脚本）
- `api/src/services/kline-collection.service.ts`（采集服务）
- `api/src/services/kline-history.service.ts`（查询服务）
- `api/src/routes/kline-history.ts`（REST API）

**修改文件**:
- `api/migrations/000_init_schema.sql`（追加 DDL）
- `api/src/server.ts`（路由注册 + 服务启动/关闭）
- `api/src/services/market-data-cache.service.ts`（DB 优先读取分时数据）

---

## 2026-02-17

### 日志输出优化 — 消除非交易时段 ~75% 冗余日志

**优化**: 1.7MB 日志中约 75% 是非交易时段策略循环的冗余输出，通过 8 项优化大幅减少控制台日志量。

**改动内容**:

#### 1. 期权决策 NO_SIGNAL 非交易时间不打印（占 ~60%）
- **优化**: `logDecision()` 中当 `rejectionCheckpoint === 'trade_window'` 时直接 return，不再打印完整决策对象
- 上层 scheduler 已有限频的"非交易时段跳过"日志，无需重复输出

#### 2. "非交易时间，跳过信号生成" debug 日志添加限频
- **优化**: 添加 `tradeWindowSkipLogTimes` Map，每标的每 5 分钟最多打印一次
- 原来 4 标的 × 347 次/天 = 1388 行 → 降至约 48 行

#### 3. "策略执行完成" 无活动时降级为 debug
- **优化**: `logExecutionSummary()` 的空转分支从 `logger.info` 改为 `logger.debug`，不再输出到控制台

#### 4. "监控 N 个未成交订单" 添加限频
- **优化**: 添加 5 分钟限频，复用 scheduler 已有的 `(this as any)[lastLogKey]` 模式

#### 5. "实际持仓数据为空或格式异常" 降级
- **优化**: 从 `logger.warn` 改为 `logger.debug`，非交易时段持仓为空是预期行为

#### 6. "Database connected" 只打印首次
- **优化**: 添加 `dbFirstConnect` 标志，首次连接打印 info，后续用 debug

#### 7. "LogService 队列缩容" 降级为 debug
- **优化**: 从 `infraLogger.info` 改为 `infraLogger.debug`，队列缩容是常规运维行为

#### 8. "恢复策略实例" 合并为单条日志
- **优化**: 从每个实例单独一条 info 日志合并为一条汇总行

**修改文件**:
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（#1 logDecision 跳过 + #2 debug 限频）
- 📝 `api/src/services/strategy-scheduler.service.ts`（#3 空转降级 + #4 未成交订单限频）
- 📝 `api/src/services/account-balance-sync.service.ts`（#5 持仓为空降级）
- 📝 `api/src/config/database.ts`（#6 首次连接标志）
- 📝 `api/src/services/log.service.ts`（#7 缩容降级）
- 📝 `api/src/services/state-manager.service.ts`（#8 合并恢复日志）

**验证**: 279 个测试全部通过

---

### 0DTE 单腿动态风控 Phase 2（VWAP 结构确认 + 时间止损 + 追踪止盈动态化）

**新增**: 基于 VWAP 的结构确认入场/退出、波动率分桶时间止损、追踪止盈动态化。Phase 1 + Phase 2 全部完成。

**改动内容**:

#### 1. VWAP 计算服务
- **新增**: `MarketDataService.getIntradayVWAP()` 方法
- 数据源：LongPort SDK 1m K 线，计算 VWAP = Σ(TP×V)/Σ(V)
- 同时返回 `rangePct`（30 分钟开盘波动率）和最近 5 根 K 线
- 60s 缓存 TTL + 5min 旧缓存降级

#### 2. VWAP 结构确认入场
- **新增**: 连续确认通过后，检查标的是否满足 VWAP 结构条件
- PUT：最近 2 根 1m 收盘价 < VWAP + 无强反转阳线
- CALL：最近 2 根 1m 收盘价 > VWAP + 无强反转阴线
- VWAP 不可用时自动跳过（降级策略）

#### 3. 结构失效止损（Level A）
- **新增**: 退出检查中止盈之后新增结构失效止损
- PUT 持仓：2 根 close > VWAP → 做空结构失效 → 平仓
- CALL 持仓：2 根 close < VWAP → 做多结构失效 → 平仓
- exitTag: `structure_invalidation`

#### 4. 时间止损（Level B）
- **新增**: 入场后 T 分钟无"最小顺风延续"则退出
- T 值按波动率分桶：高(≥0.65%)→3min / 中(0.45~0.65%)→5min / 低(<0.45%)→8min
- 顺风判定：标的创新低(PUT)/新高(CALL) 或 期权 mid 盈利 ≥ +5%
- exitTag: `time_stop_no_tailwind`

#### 5. 追踪止盈动态化
- **改进**: 0DTE 追踪止盈参数按波动率分桶动态调整
  - 高波动：trigger=15%, trail=15%
  - 中波动：trigger=15%, trail=12%
  - 低波动：trigger=15%, trail=10%
- **改进**: 移动止损使用 scheduler 精确追踪的 `peakPnLPercent` 替代旧的启发式估算
- exitTag: `trailing_stop`

#### 6. Scheduler 集成
- **新增**: `import marketDataService` 到策略调度器
- 在持仓监控中解析期权方向(CALL/PUT)、标的 symbol、入场标的价格
- 获取 VWAP 数据并传递到退出服务的 `positionCtx`
- 退出日志增加 VWAP、rangePct、timeStopMinutes、optionDirection 信息

**修改文件**:
- 📝 `api/src/services/market-data.service.ts`（VWAP 计算 + 缓存 + 波动率）
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（VWAP 结构确认入场）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（结构失效 + 时间止损 + 追踪止盈动态化）
- 📝 `api/src/services/strategy-scheduler.service.ts`（VWAP 数据获取 + positionCtx 传递）

**开发文档**: `docs/features/260216-0DTE单腿动态风控开发文档.md`
**方案文档**: `docs/analysis/260216-0DTE-single-leg-dynamic-risk-playbook.md`

---

## 2026-02-16

### 0DTE 单腿动态风控 Phase 1（禁入窗口/阈值/连续确认/退出兜底mid价）

**新增**: 基于 02-13 交易分析（-$485 0DTE 亏损），实现四层核心风控改进。

**改动内容**:

#### 1. 0DTE 开盘禁入窗口
- 09:30-10:00 ET 禁止 0DTE 新开仓（`zdteCooldownMinutes: 30`）
- 合约选择器支持 `skip0DTE` 参数，禁入期选择 1DTE/2DTE

#### 2. 入场阈值提升
- 0DTE 入场阈值从 -10 提升到 -12（`zdteEntryThreshold: 12`）
- `evaluateDirectionalBuyer()` / `evaluateSpreadStrategy()` 支持 `is0DTE` 参数

#### 3. 连续确认（Consecutive Confirm）
- 入场信号需连续 N 次（默认 2）同向达标才触发
- 15 秒容忍窗口，方向翻转或超时自动重置

#### 4. 0DTE 止损收紧
- PnL 兜底收紧到 -25%（使用 mid 价格计算）
- 禁用 3-10 分钟冷却期放宽（不再从 -35% 放宽到 -52.5%）
- scheduler 传递 midPrice = (bid+ask)/2 到退出服务

#### 5. 日志增强
- 入场日志新增 `zdteFlags` 结构化字段
- 退出日志新增 `exitTag` 标签（`0dte_time_stop` / `0dte_pnl_floor` / `0dte_stop_loss_no_widen`）

**修改文件**:
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（禁入窗口 + 阈值 + 连续确认）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（PnL 兜底 + mid 价格 + 禁用冷却放宽）
- 📝 `api/src/services/options-contract-selector.service.ts`（skip0DTE 支持）
- 📝 `api/src/services/strategy-scheduler.service.ts`（midPrice 传递）

---

## 2026-02-13

### 交易策略优化 — 基于 260212 分析报告（9项修复）

**优化**: 基于 2月12日实盘交易分析报告，修复配置合并、统一截止时间、新增方向确认窗口、资金自动排除/重分配、LATE冷却期、NaN 盈亏、资金自动重置、市场温度降级、合约选择器可配置化等9项问题。

**修复内容**:

#### 1. 配置深度合并（修复 tradeWindow 被覆盖）
- **问题**: 浅合并 `{ ...DEFAULT, ...config }` 导致 DB config 中只要存在 `tradeWindow` 字段就完全覆盖默认的 `firstHourOnly: true` 等设置
- **修复**: 改为深度合并 `tradeWindow`、`exitRules`、`positionSizing`、`latePeriod` 嵌套对象

#### 2. 统一 0DTE 截止时间为 180 分钟（1:00 PM ET）
- **问题**: 210 分钟过早截止，12:00~13:00 时段盈利 +$476 被截断；fallback 值为 60（与默认 210 不一致）；日志消息"收盘前120分钟"与实际不符
- **修复**: 全部统一为 180 分钟（5个文件），fallback `?? 60` → `?? 180`，日志消息改为动态值

#### 3. 开盘方向确认窗口（30分钟）
- **新增**: 开盘后30分钟内（9:30~10:00 ET）增加方向一致性检查
  - 大盘得分 > 5 → 仅允许 CALL/BULL_SPREAD
  - 大盘得分 < -5 → 仅允许 PUT/BEAR_SPREAD
  - 得分在 [-5, 5] → 不开仓（趋势不明确）
- 配置项: `tradeWindow.directionConfirmMinutes: 30`

#### 4. 资金不足标的自动排除 + 资金重新分配
- **新增**: `capitalManager.getEffectiveSymbolPool()` 方法
  - 最低期权门槛 $300（$3 权利金 × 100 乘数）
  - 排除资金不足的标的，将资金自动分配到可交易标的
  - 已有持仓的标的即使被排除也继续监控
- 排除标的记录 WARNING 日志（节流：每5分钟一次）

#### 5. LATE 时段冷却期 + 最小利润阈值
- **新增**: `latePeriod` 配置
  - `cooldownMinutes: 3` — 同一标的平仓后3分钟内不重新开仓
  - `minProfitThreshold: 0.10` — LATE 时段入场阈值提高 10%
- LATE 时段判定：收盘前 30min~2hr

#### 6. 持仓监控日志改用毛盈亏（修复 NaN）
- **问题**: `netPnLPercent` 在手续费数据不完整（T+1结算未到）时传播 NaN
- **修复**: 止盈/止损/移动止损判断统一使用 `grossPnLPercent`；监控日志标签从"净盈亏"改为"盈亏"

#### 7. 资金差异警告自动修复
- **新增**: `capitalManager.resetUsedAmount()` 方法
- 策略所有持仓平仓后（`active_positions = 0`），自动重置 `used_amount` 为 0
- 日志: `[资金同步] 策略X所有持仓已平仓，重置已用资金为0`

#### 8. 市场温度 API 降级处理
- **新增**: `getMarketTemperature()` 添加缓存降级机制
  - 成功时更新缓存（5分钟 TTL）
  - 失败时使用缓存值（最长15分钟）
  - 日志: `[市场温度] API调用失败，使用缓存值 X（Y秒前）`

#### 9. 合约选择器读取策略配置
- **新增**: `SelectOptionContractParams.noNewEntryBeforeCloseMinutes` 可选参数
- `is0DTEBuyBlocked()` 接收外部传入的分钟数，不再硬编码
- 调用方（`option-intraday-strategy.ts`）传递策略配置中的值

**修改文件**:
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（Task 1,2,3,5,9: 深度合并+180分钟+方向确认+LATE冷却+传递配置）
- 📝 `api/src/services/strategy-scheduler.service.ts`（Task 2,4,5,6,7: 180分钟默认值+有效池过滤+冷却期+毛盈亏日志+资金重置）
- 📝 `api/src/services/capital-manager.service.ts`（Task 4,7: 有效标的池+resetUsedAmount）
- 📝 `api/src/services/options-contract-selector.service.ts`（Task 2,9: 180分钟+可配置截止时间）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（Task 2,6: 180分钟+grossPnL决策）
- 📝 `api/src/services/market-data.service.ts`（Task 8: 温度API缓存降级）

---

## 2026-02-12

### Vercel Edge Function 主代理 + CF Worker 备选

**新增**: Vercel Edge Function 作为 Moomoo API 主代理，CF Worker 降为备选，实现三级 fallback 链路。

**背景**: CF 亚洲 PoP 节点有较大概率被 Moomoo 地区封锁（403），新增 Vercel Edge Function 部署在美东 (`iad1`)，靠近 Moomoo 美国服务器。

**架构**:
```
后端 moomooProxy()
  ├─ 1) Vercel Edge Function（主）  vercel-moomoo.riowang.win
  │     失败 ↓
  ├─ 2) Cloudflare Worker（备）     moomoo-api.riowang.win
  │     失败 ↓
  └─ 3) 直接访问 moomoo.com（兜底）
```

**新增文件**:
- 📝 `edge-functions/vercel-moomoo-proxy/api/moomooapi.js` — Vercel Edge Runtime handler，从 CF Worker 移植核心逻辑（去掉 KV 缓存和动态 cookie 获取）
- 📝 `edge-functions/vercel-moomoo-proxy/vercel.json` — 部署配置（region: iad1）
- 📝 `edge-functions/vercel-moomoo-proxy/package.json` — 最小 package

**修改文件**:
- 📝 `api/src/utils/moomoo-proxy.ts` — 提取 `callEdgeFunction()` 通用函数，新增 `_vercelProxyUrl` 配置变量，`moomooProxy()` 改为三级 fallback，`getProxyMode()` 返回完整链路信息

---

### 策略模拟运行 API

**新增**: `POST /api/quant/strategies/:id/simulate` 接口，模拟策略完整开盘流程，调用真实服务链路，跳过交易时间窗口检查。

**功能**:
1. 获取实时市场数据 → 评分 + 方向推荐（`calculateOptionRecommendation`）
2. 使用策略 `riskPreference` 阈值（`ENTRY_THRESHOLDS`）评估信号
3. 选择期权合约（默认 NEAREST 模式，非0DTE，方便手工撤单）
4. 计算入场价格、仓位大小、预估费用
5. 计算动态止盈止损参数（验证 `exitRules` 用户配置缩放是否生效）
6. 可选真实下单（`executeOrder=true`），返回 orderId

**请求参数**:
- `executeOrder?: boolean` — 是否真实下单，默认 false
- `symbols?: string[]` — 指定标的，默认使用策略 symbol_pool
- `overrideExpirationMode?: string` — 默认 'NEAREST'

**设计要点**:
- 不经过 `generateSignal()`（有 `isWithinTradeWindow()` 检查），直接调用底层推荐服务 + 合约选择服务
- 每个 symbol 的每个步骤独立错误隔离，失败不影响其他步骤诊断数据
- 返回完整诊断报告：marketData → signalEvaluation → contractSelection → entryCalculation → exitParams → orderExecution

**修改文件**:
- 📝 `api/src/routes/quant.ts`（+336 行，新增 simulate 端点 + 7 个新 import）

---

### 止盈止损用户配置生效修复

**修复**: 用户在 UI 配置的 `takeProfitPercent` / `stopLossPercent` 未在实际退出逻辑中生效，始终使用硬编码参数表。

**问题根因**:
- `option-dynamic-exit.service.ts` 的 `getDynamicExitParams()` 仅读取硬编码 `BUYER_PARAMS[phase]`，从不读取策略配置的 `exitRules`
- `strategy-scheduler.service.ts` 调用 `checkExitCondition()` 时未传入用户配置

**修复方案**:
- 用户配置作为 EARLY 阶段基准值，按时间阶段比例递减（保留时间衰减逻辑）
- 公式：`actualTP = userTP × (phaseTP / EARLY_TP_DEFAULT)`
- 未配置 exitRules 的旧策略行为不变（向后兼容）

**修改文件**:
- 📝 `api/src/services/option-dynamic-exit.service.ts`（新增 `ExitRulesOverride` 接口 + 缩放逻辑）
- 📝 `api/src/services/strategy-scheduler.service.ts`（提取 exitRules 并传递给退出服务）

---

### cookie_index 边缘函数优化 + Smart Placement + 市场数据诊断增强

**修复**: 边缘函数代理全链路优化，解决大陆 Docker 容器通过 Cloudflare Worker 访问 Moomoo API 持续 403 的问题。

**问题背景**:
1. 完整 cookies（~2000 bytes）作为 URL query params 传递导致 Cloudflare 530 错误（URL 过长）
2. Docker 容器在中国 → Cloudflare 亚洲 PoP → Moomoo 封锁亚洲 Cloudflare 出口 IP → 返回 HTML 403 页面
3. `market-data-test` 诊断接口缺少直接 Moomoo 代理测试，无法区分是 edge function 问题还是 service 层问题

**实现内容**:
1. **cookie_index 替代完整 cookies** — 后端通过 csrfToken 匹配确定 cookie 索引（0/1/2），仅传 integer index，边缘函数查找本地 cookies
2. **GUEST_CONFIGS 数组** — 边缘函数存储3组完整 cookie 配置，支持 `cookie_index` 参数查找
3. **Smart Placement** — `wrangler.jsonc` 添加 `placement.mode: "smart"`，Worker 运行在靠近 Moomoo 美国服务器的节点
4. **HTML 403 重试 + Cookie 轮转** — 检测到 Moomoo soft-403（HTTP 200 + HTML content）后自动切换下一组 cookie 重试，最多重试2次
5. **market-data-test 新增 `moomoo-proxy` 模式** — 直接测试 moomooProxy() 原始 API 调用（SPX/USD/BTC 日K + SPX分时），绕过 MarketDataService

**修改文件**:
- 📝 `api/src/config/futunn.ts`（导出 `getEffectiveConfigs()`）
- 📝 `api/src/utils/moomoo-proxy.ts`（cookie_index 逻辑替代完整 cookies）
- 📝 `api/src/routes/quote.ts`（market-data-test 新增 moomoo-proxy 模式）
- 📝 `edge-functions/moomoo-proxy/src/index.js`（GUEST_CONFIGS + cookie_index + 重试机制）
- 📝 `edge-functions/moomoo-proxy/wrangler.jsonc`（Smart Placement）
- 📝 `edge-functions/moomooapi.js`（GUEST_CONFIGS + cookie_index 同步）

---

## 2026-02-11

### 资金上限保护 + 0DTE交易时间前移

**修复**: 资金分配固定金额封顶保护 + 0DTE截止时间从收盘前120分钟前移至210分钟（12:30 PM ET）。

**问题背景**:
1. 策略配置固定金额 $4000，但账户因亏损实际可用不足 $4000，`requestAllocation()` 未与余额比较导致下单失败
2. 0DTE期权在 12:30 PM ET 后时间价值加速衰减，造成显著亏损

**实现内容**:
1. `capital-manager.service.ts` — `FIXED_AMOUNT` 分配增加 `Math.min(配置值, 实际余额)` 封顶，超额时打印 `[资金保护]` 警告
2. `option-dynamic-exit.service.ts` — 0DTE强制平仓阈值 120→210 分钟
3. `options-contract-selector.service.ts` — 0DTE买入拦截 120→210 分钟
4. `strategy-scheduler.service.ts` — 无持仓跳过监控 120→210 分钟
5. `option-intraday-strategy.ts` — 默认策略配置 `noNewEntryBeforeCloseMinutes` 120→210

**修改文件**:
- 📝 `api/src/services/capital-manager.service.ts`（资金分配上限保护）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（0DTE强制平仓时间）
- 📝 `api/src/services/options-contract-selector.service.ts`（0DTE买入拦截时间）
- 📝 `api/src/services/strategy-scheduler.service.ts`（无持仓跳过监控时间）
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（默认配置）

---

### 更新3组Moomoo游客Cookie + Worker fallback同步更新

**维护**: 更新3组 Moomoo 游客 Cookie（硬编码 fallback）并同步更新 Cloudflare Worker 中的 fallback Cookie，确保无 DB 配置时仍可正常代理。

**实现内容**:
1. 更新 `api/src/config/futunn.ts` 中3组硬编码游客 Cookie（cipher_device_id / csrfToken / futu-offline-csrf-v2）
2. 同步更新 `edge-functions/moomoo-proxy/src/index.js` 的 `FALLBACK_COOKIES` 和 `DEFAULT_CSRF_TOKEN`
3. 压力测试验证：30并发请求，100%成功，平均1.7秒，最大2.8秒（对比旧1-Cookie方案：20并发平均6秒）

**修改文件**:
- 📝 `api/src/config/futunn.ts`（3组Cookie更新）
- 📝 `edge-functions/moomoo-proxy/src/index.js`（fallback Cookie同步更新）

**压力测试结果**:
- 3-Cookie轮转：30并发，100%成功率，avg 1.7s，max 2.8s
- 旧1-Cookie方案：20并发，avg 6s（性能提升约3.5倍）

---

### Moomoo 多 Cookie 管理与边缘代理优化

**功能**: 实现 Moomoo Cookie 多账户管理 UI、后端 DB 驱动配置加载、Cookie 测试 API、边缘函数 URL DB 配置化，以及 Cloudflare Worker wrangler v4 迁移部署。

**实现内容**:

#### 1. 前端多 Cookie 管理 UI (`frontend/app/config/page.tsx`)
- 新增 `MoomooCookieRow` 接口和状态管理
- Moomoo Cookie 管理卡片：逐行添加/删除/测试/保存
- 状态标签：unknown / testing / valid / expired，测试后显示结果
- 登录后从 DB 加载，保存为 JSON 到 `moomoo_guest_cookies`
- Config 表列表过滤掉 `moomoo_guest_cookies`、`futunn_cookies`、`futunn_csrf_token`、`futunn_search_cookies`

#### 2. 后端 DB 驱动 Cookie 加载 (`api/src/config/futunn.ts`)
- `refreshDBConfigs()` 从 DB 读取 `moomoo_guest_cookies`，5 分钟 TTL 缓存
- `getEffectiveConfigs()` 优先返回 DB 配置，无可用时降级到硬编码
- `initFutunnConfig()` 启动时异步 DB 加载 + `setInterval` 定期刷新

#### 3. Cookie 测试 API (`api/src/routes/config.ts`)
- `POST /api/config/get-value` — 返回解密后的配置值
- `POST /api/config/test-moomoo-cookie` — 通过边缘代理测试 Cookie（SPX 日 K 数据）

#### 4. 前端 API 方法 (`frontend/lib/api.ts`)
- `configApi.getConfigValue(key, username, password)`
- `configApi.testMoomooCookie(cookies, csrfToken, username, password)`

#### 5. 边缘函数 URL 从 DB 加载 (`api/src/utils/moomoo-proxy.ts`)
- 从 DB 读取 `moomoo_edge_function_url` 和 `use_moomoo_edge_function`
- 5 分钟缓存 TTL，环境变量 fallback
- `getProxyMode()` 改为 async（所有调用方已同步调整）

#### 6. DB 迁移 (`api/migrations/000_init_schema.sql`)
- 新增种子数据：`moomoo_guest_cookies`、`moomoo_edge_function_url`、`use_moomoo_edge_function`

#### 7. Cloudflare Worker 部署 (`edge-functions/moomoo-proxy/`)
- `wrangler.toml` 迁移到 `wrangler.jsonc`（wrangler v4）
- KV namespace `MOOMOO_CACHE` 已创建
- Routes: `moomoo-api.riowang.win/*`，已部署

**新增文件**:
- `api/src/utils/moomoo-quote-token.ts`（Quote token 计算工具）
- `edge-functions/moomoo-proxy/wrangler.jsonc`（Cloudflare Worker 配置）

**修改文件**:
- 📝 `frontend/app/config/page.tsx`（多 Cookie 管理 UI）
- 📝 `frontend/lib/api.ts`（新增 configApi 方法）
- 📝 `api/src/config/futunn.ts`（DB 驱动 Cookie 加载）
- 📝 `api/src/routes/config.ts`（新增测试/获取值 API）
- 📝 `api/src/utils/moomoo-proxy.ts`（边缘函数 URL 从 DB 加载，getProxyMode async）
- 📝 `api/src/routes/forex.ts`、`futunn-test.ts`、`options.ts`（适配 async getProxyMode）
- 📝 `api/src/services/futunn-option-chain.service.ts`、`futunn-option-quote.service.ts`、`institution-stock-selector.service.ts`、`market-data.service.ts`（适配 async getProxyMode）
- 📝 `api/migrations/000_init_schema.sql`（新增种子数据）

**相关文档**: [Moomoo 多 Cookie 管理与边缘代理优化](docs/features/260211-Moomoo多Cookie管理与边缘代理优化.md)

---

### 回滚 TSLPPCT + 恢复原始监控频率 + 启动预热

**功能/修复**: 完全移除 TSLPPCT 券商侧跟踪止损逻辑（实际运行中 100% 失败且引入多处不稳定），恢复 9140d2c 之前的交易流程；修复 entryPrice 类型错误；新增启动时市场数据预热避免多策略并发限流。

**回滚原因**:
- TSLPPCT 提交 100% 失败（NaiveDate 类型不兼容）
- 监控频率从 5s 降至 90s 导致止盈止损延迟严重
- TSLPPCT API 调用阻塞核心退出逻辑（checkProtectionStatus/submitProtection 在 checkExitCondition 之前执行）
- 双定时器分离（entry 15s / position 90s）增加复杂度，引入模式过滤 bug
- 实际造成持仓亏损扩大（-45% 未触发止损）

**移除内容**:
1. ❌ 移除 `trailingStopProtectionService` 全部调用（import、买入提交、订单监控提交、补挂、状态检查、撤销、动态调整）
2. ❌ 移除 `trade-push.service.ts` 中 TSLPPCT 成交检测逻辑
3. ❌ 移除双定时器架构（`positionMgmtIntervals` Map + entry/position mode 过滤）
4. ❌ 恢复监控频率：期权策略 5 秒、订单监控 5 秒（与 9140d2c 之前一致）

**新增/保留的修复**:
1. ✅ `entryPrice`/`quantity` 从 context 取值时增加 `parseFloat`/`parseInt` + `isNaN` 校验（修复 `toFixed is not a function`）
2. ✅ 启动时市场数据预热（`startAllRunningStrategies` 先调用 `getMarketData` 填充缓存，避免多策略并发请求导致 API 限流）
3. ✅ 保留此前的 bug 修复：JSON.parse JSONB 防御、冷启动重试、多仓资金预算、entryTime 保留、account-balance-sync 期权匹配、安全阀 40%

**修改文件**:
- 📝 `api/src/services/strategy-scheduler.service.ts`（移除全部 TSLPPCT 代码 + 恢复 5s 单定时器 + entryPrice 类型修复 + 启动预热）
- 📝 `api/src/services/trade-push.service.ts`（移除 TSLPPCT 成交检测）

**验证结果**:
- TypeScript 编译通过 ✅

---

## 2026-02-10

### ~~TSLPPCT 跟踪止损保护 + 期权监控频率优化~~（已在 2026-02-11 回滚）

**已回滚**: 此功能因实际运行不稳定（TSLPPCT 100% 提交失败、监控延迟导致止损失效）已在 2026-02-11 完全移除。

---

### 市场数据降级容错 + 已平仓自动转 IDLE

**功能/修复**: 修复两个日志遗留问题 — BTC/USD 数据超时导致全链路阻断，已平仓持仓反复刷 error 日志。

**问题 A — BTC/USD 数据失败时全链路阻断**:
- 根因: `market-data-cache.service.ts` 的 `.catch()` 保留旧缓存但仍 throw，上游 `Promise.all()` 全部失败
- 修复: 三级降级策略 — 旧缓存<5分钟直接返回 → 延长超时(30s)重试 → 旧缓存兜底
- `market-data.service.ts` 全链路透传 `timeout` 参数（默认 15s 不变，重试时 30s）

**问题 B — 已平仓持仓反复刷 error 日志（1970 次）**:
- 根因: 券商侧已平仓（availableQuantity=0），DB 状态仍为 HOLDING，5秒循环持续触发
- 修复: `availableQuantity<=0` 时自动转 IDLE（`error` → `warn`，`actionTaken: true`）

**修改文件**:
- 📝 `api/src/services/market-data-cache.service.ts`（三级降级 `.catch()` 处理）
- 📝 `api/src/services/market-data.service.ts`（timeout 参数透传）
- 📝 `api/src/services/strategy-scheduler.service.ts`（零持仓自动转 IDLE）

**验证结果**:
- TypeScript 编译通过 ✅
- 279 个测试全部通过 ✅

---

### 修复富途 API 与 LongPort SDK 兼容性问题（7 项）

**功能/修复**: 修复 LongPort 期权路径交叉调用 Moomoo API 导致的 Greeks 为零、IV 格式不一致、strikeDate 格式混乱等 7 个问题。

**问题清单**:
1. ⚠️严重 — LongPort 路径交叉调用 Moomoo 传入错误 strikeDate 格式（YYYYMMDD 传给期望 Unix 时间戳的 API）
2. ⚠️严重 — LongPort SDK 有 `calcIndexes()` 可获取 Greeks 但未使用，完全依赖 Moomoo（因问题1失败）
3. ⚠️严重 — IV 格式不一致：LongPort 小数(0.35) vs Moomoo 百分比(35.0)，导致 ivChange 出现 99% 误差
4. 中等 — LongPort 路径 `optionId`/`underlyingStockId` 因交叉调用失败为空
5. 中等 — `SelectedOptionContract.strikeDate` 两种路径格式不同
6. 低 — `contractMultiplier` 硬编码为 100
7. 低 — `safePct()` 不做 IV 尺度归一化

**修复方案**:
- 新增 `getGreeks()` 批量方法（`calcIndexes` API），消除 Moomoo 交叉调用
- IV 归一化为百分比制（小数 < 5 自动 ×100）
- Moomoo 路径 strikeDate 统一转换为 YYYYMMDD
- `contractMultiplier` 从 SDK 读取
- `entryIV` 兜底归一化（兼容旧数据）

**附加优化**:
- 期权价格缓存按数据来源区分 TTL：LongPort 5秒（与监控周期对齐）/ Moomoo 10秒

**修改文件**:
- 📝 `api/src/services/longport-option-quote.service.ts`（新增 `getGreeks()` + `contractMultiplier` + IV 归一化）
- 📝 `api/src/services/options-contract-selector.service.ts`（替换 Moomoo 交叉调用 + strikeDate 统一）
- 📝 `api/src/services/strategy-scheduler.service.ts`（entryIV 兜底归一化）
- 📝 `api/src/services/option-price-cache.service.ts`（LongPort 5s / Moomoo 10s 分级 TTL）

**验证结果**:
- TypeScript 编译通过 ✅
- 279 个测试全部通过 ✅
- `futunn-option-chain.service.ts` 零修改 ✅

---

### Swagger API文档修复 — 跨平台路径 + 启动诊断

**功能/修复**: 修复 Swagger 文档显示 "No operations defined in spec!" 的问题，同时增加启动诊断日志。

**根因分析**:
1. Windows 上 `path.join()` 产生反斜杠路径（`D:\...\routes\*.ts`），`swagger-jsdoc` 内部的 `glob.sync()` 无法正确匹配
2. Docker 生产环境只有 `dist/` 目录，旧代码使用 `apis: ['./src/routes/*.ts']` 相对路径匹配 0 个文件

**修复方案**:
- 新增 `toGlobPath()` 函数，将 `path.sep`（Windows `\`）统一转换为 `/`
- 使用 `__dirname` + 正斜杠转换，在生产环境正确解析到 `dist/routes/*.js`
- 新增启动诊断日志：输出 `__dirname`、glob 模式、文件数量、解析路径数

**修改文件**:
- 📝 `api/src/config/swagger.ts`（toGlobPath + 启动诊断日志）

**验证结果**:
- 开发模式（tsx）：44 个 API 路径 ✅
- 生产模式（dist/）：44 个 API 路径 ✅

---

### 普通账户无法编辑/删除修复

**功能/修复**: 资金管理页面普通账户无法编辑或删除（回归问题）。

**根因**: SQL 查询统计所有策略（含已停止/错误状态），应只统计 RUNNING 状态的策略。

**修改文件**:
- 📝 `api/src/routes/quant.ts`（3处 SQL 查询添加 `AND status = 'RUNNING'`）

---

### API文档嵌入前端页面

**功能/修复**: API文档从新标签页跳转改为嵌入前端框架内，使用 iframe 展示。

**修改文件**:
- 📝 `frontend/app/api-docs/page.tsx`（新增，iframe 嵌入 Swagger UI）
- 📝 `frontend/components/AppLayout.tsx`（侧边栏改用 `<Link href="/api-docs">`）

---

### LongPort期权链主源 + API文档入口 + 0DTE时间限制

**功能/修复**: 将期权链数据获取从富途切换为LongPort主源（富途备用），前端新增API文档入口，并为0DTE期权增加买入截止和强制平仓时间限制。

**实现内容**:

#### 1. LongPort期权链API作为主源
1. ✅ **`longport-option-quote.service.ts` 新增方法**：`getOptionExpiryDates()`（获取期权到期日列表）、`getOptionChainByDate()`（按日期获取期权链）
2. ✅ **`options-contract-selector.service.ts` 重构**：LongPort 作为期权链主源，富途降级为备用（fallback）
3. ✅ **新增3个LongPort路由**：
   - `GET /api/options/lb/expiry-dates` — 获取期权到期日列表（LongPort）
   - `GET /api/options/lb/chain` — 获取期权链数据（LongPort）
   - `GET /api/options/lb/quote` — 获取期权行情（LongPort）

#### 2. 前端API文档入口
4. ✅ **`AppLayout.tsx` 侧边栏新增**：在系统区域添加"API文档"链接，新标签页打开 `/api/docs`

#### 3. 0DTE期权时间限制（三部分）
5. ✅ **0DTE买入截止**（`options-contract-selector.service.ts`）：收盘前120分钟禁止买入0DTE期权
6. ✅ **0DTE强制平仓**（`option-dynamic-exit.service.ts`）：`PositionContext` 新增 `is0DTE` 字段，收盘前120分钟触发 TIME_STOP 强制平仓
7. ✅ **0DTE清仓后跳过监控**（`strategy-scheduler.service.ts`）：截止时间后若无活跃持仓，跳过当前监控周期

**修改文件**:
- 📝 `api/src/services/longport-option-quote.service.ts`（新增 `getOptionExpiryDates()` / `getOptionChainByDate()`）
- 📝 `api/src/services/options-contract-selector.service.ts`（LongPort主源 + 0DTE买入截止）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（`is0DTE` + TIME_STOP 120分钟）
- 📝 `api/src/services/strategy-scheduler.service.ts`（0DTE清仓后跳过监控）
- 📝 `api/src/routes/options.ts`（新增3个LongPort路由）
- 📝 `frontend/components/AppLayout.tsx`（侧边栏新增API文档链接）

**预期效果**:
- 期权链数据获取延迟降低（LongPort SDK 直连）
- 富途API保留为完整备用，自动降级
- 0DTE期权风控增强：收盘前120分钟自动截止买入 + 强制平仓
- API文档可通过前端侧边栏直接访问

---

### 日志导出接口流式改造（Streaming NDJSON）

**功能/修复**: `/api/logs/export` 从一次性加载全部结果改为流式导出，解决大数据量导出时网关/CDN 超时问题。

**实现内容**:
1. ✅ **流式查询**：使用 `pg-query-stream` 将数据库查询结果以流的方式逐行写入 HTTP 响应
2. ✅ **NDJSON 格式**：响应格式从单个大 JSON 改为 NDJSON（每行一个 JSON 对象，可独立 `JSON.parse()`）
3. ✅ **连接安全**：独立获取 `PoolClient`，`req.on('close')` 监听客户端断开自动释放连接
4. ✅ **结构化输出**：第一行 meta（导出时间 + 筛选条件），中间数据行，最后一行 summary（总数）

**新增依赖**:
- `pg-query-stream`（流式 PostgreSQL 查询）

**修改文件**:
- 📝 `api/src/routes/logs.ts`（export 路由流式改造）

**响应格式变更**:
```
之前: {"success":true,"data":{"exportedAt":"...","total":50000,"logs":[...]}}
之后（NDJSON，每行一个对象）:
  {"meta":{"exportedAt":"...","filters":{...}}}
  {"id":1,"timestamp":"...","level":"INFO",...}
  {"summary":{"total":50000}}
```

**预期效果**:
- 大数据量导出不再超时（边查边发，连接持续有数据流动）
- 内存占用从 O(n) 降为 O(1)（不再一次性加载全部结果）
- 最大导出 100,000 条限制保持不变

---

### 期权价格获取切换长桥 API 主源

**功能/修复**: 将期权价格/IV 的获取从富途 API 主源切换为长桥 API 主源，富途降级为备用。新增统一长桥期权行情服务，封装 `optionQuote()` + `depth()` + 多层 fallback 链。

**实现内容**:
1. ✅ **新增 `longport-option-quote.service.ts`**：统一封装 `getOptionQuote()`（含IV）、`getOptionDepth()`（盘口）、`getOptionPrice()`（完整fallback链）
2. ✅ **strategy-scheduler 价格获取简化**：`processHoldingPosition()` 从4层 if/else 替换为统一服务调用
3. ✅ **strategy-scheduler IV获取优化**：`processOptionDynamicExit()` IV 改为 LongPort 主源、富途备用
4. ✅ **basic-execution 价格验证优化**：`getCurrentMarketPrice()` 期权路径切换为统一服务
5. ✅ **option-dynamic-exit IV获取优化**：`buildPositionContext()` IV 改为 LongPort 主源

**新增文件**:
- 📝 `api/src/services/longport-option-quote.service.ts`（统一长桥期权行情服务）

**修改文件**:
- 📝 `api/src/services/strategy-scheduler.service.ts`（价格/IV获取切换长桥主源）
- 📝 `api/src/services/basic-execution.service.ts`（期权价格验证切换长桥主源）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（IV获取切换长桥主源）

**价格获取优先级（改动后）**:
```
缓存 → LongPort optionQuote() → LongPort depth() → 富途 getOptionDetail() → LongPort quote()
```

**预期效果**:
- 期权价格延迟降低（长桥 SDK 直连 vs 富途 HTTP API）
- optionQuote 同时返回价格和 IV，减少 API 调用次数
- 富途 API 保留为完整备用，权限错误（301604）自动降级

---

## 2026-02-06

### 日志系统降噪 — 减少不必要的DB写入

**功能/修复**: 分析215条日志，发现约175条（81.4%）为心跳/空跑/启停等不必要的DB写入。通过`{dbWrite:false}`标记，将这些日志保留在控制台但跳过入库，进一步减少80-90%的DB写入。

**实现内容**:
1. ✅ **策略调度器降噪（7处）**：启停消息、空跑日志、无活动执行汇总、订单心跳
2. ✅ **余额同步降噪（3处）**：同步心跳、启停消息
3. ✅ **状态管理器降噪（2处）**：启动状态恢复消息
4. ✅ **交易推送降噪（2处）**：订阅/取消确认
5. ✅ **配置/路由降噪（2处）**：Moomoo配置加载、缓存刷新
6. ✅ **logs.ts调试清理（4处）**：删除5个诊断SQL查询、合并重复debug块、删除调试残留

**修改文件**:
- 📝 `api/src/services/strategy-scheduler.service.ts`（7处dbWrite:false）
- 📝 `api/src/services/account-balance-sync.service.ts`（3处dbWrite:false）
- 📝 `api/src/services/state-manager.service.ts`（2处dbWrite:false）
- 📝 `api/src/services/trade-push.service.ts`（2处dbWrite:false）
- 📝 `api/src/config/futunn.ts`（1处dbWrite:false）
- 📝 `api/src/routes/quote.ts`（1处dbWrite:false）
- 📝 `api/src/routes/logs.ts`（删除诊断SQL、合并重复debug）

**预期效果**:
- 心跳/空跑DB写入：从~860-1460条/小时降至0（仅控制台）
- 所有ERROR/WARN/业务事件日志不受影响，继续入库
- 279个测试全部通过

---

### 日志系统全面重构 ⭐ 核心架构

**功能/修复**: 全面重构日志系统，实现级别门控、节流机制、摘要聚合，DB写入量减少95-98%，同时确保ERROR/WARN日志100%入库。

**实现内容**:
1. ✅ **级别门控**：DEBUG仅控制台、ERROR必入库不节流、WARN入库走节流、INFO可选跳过
2. ✅ **节流机制**：新增throttleMap/generateThrottleKey/shouldEnqueue，30秒窗口去重
3. ✅ **摘要聚合服务**：新增log-digest.service.ts，每5分钟聚合高频指标
4. ✅ **基础设施Logger**：新增infra-logger.ts，解决底层模块循环依赖
5. ✅ **console全量迁移**：约38个文件、约398处console.*迁移到logger.*
6. ✅ **新增配置项**：5个数据库配置项控制节流/摘要/DEBUG入库行为
7. ✅ **33个单元测试**：覆盖级别门控、节流、摘要、向后兼容、infraLogger

**新增文件**:
- 📝 `api/src/utils/infra-logger.ts`（基础设施轻量Logger）
- 📝 `api/src/services/log-digest.service.ts`（摘要聚合服务）
- 📝 `api/migrations/013_add_log_throttle_digest_config.sql`（配置项迁移）

**修改核心文件**:
- 📝 `api/src/utils/logger.ts`（级别门控、{dbWrite:false}、console()/metric()方法）
- 📝 `api/src/services/log.service.ts`（节流机制、DEBUG门控）
- 📝 `api/src/utils/log-module-mapper.ts`（Log.Digest映射）
- 📝 `api/src/server.ts`（digest服务初始化和关闭）

**相关文档**:
- 📄 [日志系统重构](docs/features/260206-日志系统重构.md)
- 📄 [日志系统优化文档（v1.0）](docs/features/251215-日志系统优化文档.md)

**预期效果**:
- DB写入/min（盘中）：从25,000-50,000降至500-1,000（减少95-98%）
- ERROR/WARN日志完整性：100%入库
- 33个单元测试全部通过

---

### 期权策略风控优化 ⭐ 关键优化

**功能/修复**: 优化期权止盈止损执行方式，增强订单追踪能力，提升期权策略风控可靠性。

**实现内容**:
1. ✅ **期权止盈止损改用市价单(MO)**：避免限价单无法成交导致亏损扩大，确保风控指令快速执行
2. ✅ **修复SELL订单信号关联问题**：新增logSellSignal方法确保卖出订单可追踪，完善订单-信号关联链路
3. ✅ **防止已完成订单重复匹配**：在findMatchingSignal中检查订单状态，减少日志噪音，避免重复处理
4. ✅ **新增动态止盈止损服务**：创建option-dynamic-exit.service实现更灵活的期权退出策略
5. ✅ **增强期权合约选择和价格缓存**：优化期权合约筛选逻辑，提升价格获取性能
6. ✅ **前端策略配置支持**：EditStrategyModal支持更多期权策略配置参数

**修改文件**:
- 📝 `api/src/services/strategy-scheduler.service.ts`（期权止盈止损改用MO单，修复信号关联）
- 📝 `api/src/services/strategies/strategy-base.ts`（新增logSellSignal方法）
- 📝 `api/src/services/basic-execution.service.ts`（优化findMatchingSignal，检查订单状态）
- 📝 `api/src/services/option-dynamic-exit.service.ts`（新增）
- 📝 `api/src/services/options-contract-selector.service.ts`（增强合约选择）
- 📝 `api/src/services/option-price-cache.service.ts`（优化缓存策略）
- 📝 `frontend/components/EditStrategyModal.tsx`（支持更多期权策略配置）

**相关文档**:
- 📄 本次更新记录到CHANGELOG.md
- 📄 相关代码文件已更新

**预期效果**:
- 🎯 期权止盈止损执行成功率：从限价单~60%提升至市价单~95%+
- 📊 订单追踪准确性：SELL订单信号关联率提升至100%
- 📉 日志噪音：减少已完成订单的重复匹配日志
- ⚡ 风控响应速度：市价单平均成交时间<1秒

---

## 2026-02-05

### Docker 部署重大升级 ⭐ 关键修复

**功能/修复**: 升级 Docker 部署到 Ubuntu 24.04 基础镜像，支持 longport SDK 3.0.21，修复原生绑定问题，优化中国网络环境。

**实现内容**:
1. ✅ **升级基础镜像到 Ubuntu 24.04**：从 `node:20-alpine` 升级到 `ubuntu:24.04`，提供 GLIBC 2.39 支持 longport SDK 3.0.21
2. ✅ **手动下载 longport 原生绑定**：添加 curl 命令直接下载 `longport-linux-x64-gnu-3.0.21.tgz` 到正确路径
3. ✅ **修复 Next.js 网络绑定**：在 `deploy/start-all.sh` 中添加 `HOSTNAME=0.0.0.0`，允许容器外部访问
4. ✅ **中国网络镜像优化**：配置 apt 使用阿里云镜像，npm/pnpm 使用淘宝镜像
5. ✅ **替换 corepack**：使用 `npm install -g pnpm@10.28.2` 直接安装 pnpm，避免网络问题
6. ✅ **单容器部署架构**：前端和后端在同一容器运行，只暴露端口 3001

**修改文件**:
- 📝 `Dockerfile`（完全重构：Ubuntu 24.04 + 手动下载原生绑定 + 镜像源配置）
- 📝 `deploy/start-all.sh`（+1行：`HOSTNAME=0.0.0.0`）
- 📝 `docker-compose.yml`（架构：单容器部署）

**更新文档**:
- 📄 [Docker 部署指南](docs/guides/251214-Docker部署指南.md)（更新到 2026-02-05）
- 📄 [README.md](README.md)（更新 Docker 部署说明）

**相关文档**:
- 📄 [Docker 部署指南](docs/guides/251214-Docker部署指南.md) - 完整的部署指南
- 📄 [环境变量配置指南](docs/guides/251216-环境变量配置指南.md) - 数据库凭证说明

**预期效果**:
- ✅ 构建成功率：100%（解决 GLIBC 版本问题）
- ✅ 原生绑定可用性：100%（手动下载 + 验证）
- ✅ 容器外部访问：正常（Next.js 监听所有接口）
- ✅ 中国网络构建速度：提升 3-5 倍

**数据库凭证说明**:
- 默认用户名：`trading_user`
- 默认密码：`trading_password`
- 默认数据库：`trading_db`
- 可通过项目根目录 `.env` 文件自定义

**管理员账户创建**:
```bash
docker-compose exec app node api/scripts/create-admin.js admin your_password
```

---

## 2026-02-04

### 期权策略决策链路日志增强 ⭐ 开发体验优化

**功能/修复**: 为期权日内策略增加9个关键检查点的详细日志，并提供快捷日志分析工具，缩短问题定位时间从数小时到几分钟。

**实现内容**:
1. ✅ **9个关键检查点日志**：市场数据充足性、信号方向判定、风险等级评估、期权日期、期权链数据、流动性过滤、Greeks筛选、入场价格、信号生成
2. ✅ **统一日志格式**：`📍 [标的符号] 描述 | 指标=值` 格式，方便快速定位
3. ✅ **快捷分析工具**：`analyze-today.bat`（分析指定日志）和 `analyze-latest.bat`（自动分析最新日志）
4. ✅ **可视化报告**：自动生成 HTML 看板、文本报告和详细数据JSON

**修改文件**:
- 📝 `api/src/services/option-recommendation.service.ts`（+3个检查点）
- 📝 `api/src/services/options-contract-selector.service.ts`（+4个检查点）
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（+2个检查点）

**新增文件**:
- 📄 `analyze-today.bat`（日志分析主脚本，109行）
- 📄 `analyze-latest.bat`（快速分析最新日志，38行）

**相关文档**:
- 📄 [期权策略决策链路日志增强](docs/features/260204-期权策略决策链路日志增强.md)

**预期效果**:
- 📊 问题定位速度：从数小时缩短到几分钟
- 📉 调试难度：从手动翻日志降低到一键分析
- 🎯 诊断准确性：9个检查点覆盖完整决策链路

---

## 2026-02-03

### 期权策略推荐算法优化 ⭐ 关键优化

**功能/修复**: 创建期权专用推荐服务，替代股票推荐逻辑，增加市场数据重试机制，解决策略10零持仓问题。

**实现内容**:
1. ✅ **期权专用推荐服务**：基于大盘环境(40%) + 分时动量(40%) + 时间窗口(20%)，降低入场门槛（finalScore > 15）
2. ✅ **市场数据重试机制**：SPX/USD/BTC获取失败时自动重试3次，间隔500ms指数退避
3. ✅ **option-intraday-strategy改造**：使用新推荐服务，添加详细日志输出，增加风险等级检查

**新增文件**:
- 📄 `api/src/services/option-recommendation.service.ts`（期权专用推荐服务，588行）

**修改文件**:
- 📝 `api/src/services/market-data.service.ts`（+1行import, 修改关键数据获取添加重试）
- 📝 `api/src/services/strategies/option-intraday-strategy.ts`（+1行import, 替换推荐逻辑，修改日志输出）

**相关文档**:
- 📄 [期权策略优化实施文档](docs/features/260203-期权策略优化实施文档.md)

**预期效果**:
- 📊 信号生成率：从0%提升至20-40%
- 📉 数据获取失败率：从18次降至<1次
- 🎯 实际成交：预计1-5笔/天

---

## 2026-01-28

### 期权策略完整修复 ✅ 关键修复 ⭐ 最新

**功能/修复**: 修复期权策略的10个关键问题，涵盖资金管理、价格获取、Greeks过滤、0DTE处理等，提升稳定性和准确性。

**核心修复（P0 - Critical）**:
1. ✅ **资金释放逻辑**：优先使用 `allocationAmount`（包含完整成本），添加详细fallback日志，修复multiplier依赖问题
2. ✅ **持仓状态保存**：统一使用 `allocationAmountOverride`（含手续费），修复开仓和平仓计算不一致问题
3. ✅ **期权价格缓存**：新增 `option-price-cache.service.ts`，实现5分钟TTL缓存，减少API调用60%
4. ✅ **价格获取增强**：三层降级机制（LongPort → 持仓缓存 → 富途详情）+ 缓存集成，详细失败日志

**重要改进（P1 - High）**:
5. ✅ **边缘函数参数**：明确 `get-stock-quote` 的可选参数处理（lotSize），添加清晰注释
6. ✅ **getOptionDetail数据增强**：添加顶层便捷字段（underlyingPrice等），避免嵌套访问
7. ✅ **0DTE到期日期验证**：检查期权是否仍在交易，避免选择已过期期权
8. ✅ **Greeks数据缺失处理**：区分"数据不可用"和"值为0"，跳过Greeks缺失的期权
9. ✅ **指数stockId映射**：补充SPX/SPXW/XSP系列，自动记录未映射指数

**新增文件**:
- 📄 `api/src/services/option-price-cache.service.ts`（期权价格缓存服务，165行）

**修改文件**:
- 📝 `api/src/services/strategy-scheduler.service.ts`（+150行：资金管理和价格获取优化）
- 📝 `api/src/services/options-contract-selector.service.ts`（+80行：Greeks和0DTE修复）
- 📝 `api/src/services/futunn-option-chain.service.ts`（+4行：返回数据增强）
- 📝 `edge-functions/moomooapi.js`（+4行：参数说明）

**相关文档**:
- 📄 [期权策略完整诊断与修复方案](docs/fixes/260128-期权策略完整诊断与修复方案.md)（13,000+字）
- 📄 [期权策略修复完成总结](docs/fixes/260128-期权策略修复完成总结.md)（本次修复）

**预期效果**:
- 💰 资金准确性：100%（无泄漏/锁定）
- 📈 价格获取成功率：>95%
- ⚡ API调用减少：60%（缓存命中率>80%）
- 🎯 期权选择准确性：大幅提升（Greeks过滤可靠）

---

## 2026-01-27

### 策略执行关键错误修复 ✅ 关键修复

**功能/修复**: 修复 LongPort 下单/改单的 Decimal 与数量格式问题，完善卖空验证失败落库，并为关键 LongPort 调用加入限流与 429002 重试，降低策略执行噪音与失败率。

**实现内容**:
1. ✅ 卖空验证失败写入 `validation_failure_logs`（不再写入 `signal_logs`）
2. ✅ 卖空下单 `submittedQuantity` 统一传正数（内部仍保留负数语义用于记录/风控）
3. ✅ `replaceOrder.quantity` 统一使用 `Decimal`（修复 unwrap 报错）
4. ✅ 新增 `api/src/utils/longport-rate-limiter.ts`：轻量限流 + 429002 指数退避重试，并接入关键调用点
5. ✅ 持仓/卖空持仓 `context` 为空时尝试从订单历史恢复，无历史则重置为 `IDLE`

**相关文档**:
- 📄 [错误位置定位及修复指南](错误位置定位及修复指南.md)
- 📄 [validation_failure_logs 迁移脚本](api/migrations/011_create_validation_failure_logs.sql)

---

## 2026-01-26

### 期权日内策略交易（买方）✅ 新增

**新增能力**：
- ✅ 新增策略类型 `OPTION_INTRADAY_V1`：基于 underlying 方向信号自动选择期权合约开仓
- ✅ 合约选择：0DTE/最近到期、ATM附近 strike、流动性（OI/价差）与 Greek（delta/theta）过滤
- ✅ 费用模型：按张计费（佣金最小 0.99 + 平台费每张 0.30）并纳入资金占用

**硬约束实现**：
- ✅ 收盘前 30 分钟强制平仓（原因：`FORCED_CLOSE_BEFORE_MARKET_CLOSE`）
- ✅ 收盘前 N 分钟禁止开新仓（默认 60，可配置）

**系统一致性修复**：
- ✅ 期权详情/正股报价的 `get-stock-quote` 改走 `moomooProxy`（与边缘函数代理一致，更适配大陆网络）
- ✅ 期权资金释放逻辑优先使用 `allocationAmount`（避免 multiplier 漏乘，并与费用占用一致）
- ✅ 增强订单成交后的实例映射：`execution_orders.symbol`（期权）可反查到 `strategy_instances`（underlying）

**测试**：
- ✅ 新增单测：`options-fee.service` 与 `market-session.service`

---

## 2025-12-24

### 策略执行逻辑优化 ✅ 修复 ⭐ 最新

**问题**: IDLE状态下生成的SELL信号被静默忽略，导致日志显示"生成信号 SELL"但"操作 0"

**修复内容**:

1. **问题分析**
   - 策略在IDLE状态下生成了SELL信号（可能是做空信号）
   - 代码逻辑只处理IDLE状态下的BUY信号，SELL信号被静默忽略
   - 日志中没有明确说明为什么SELL信号未执行

2. **修复方案**
   - ✅ 在`processSymbol`方法中添加IDLE状态下SELL信号的明确处理
   - ✅ 明确忽略SELL信号并记录调试日志
   - ✅ 将标的标记为IDLE状态，避免重复处理

3. **代码修改**
   - ✅ 修改`strategy-scheduler.service.ts`的`processSymbol`方法
   - ✅ 在信号生成后、验证前添加SELL信号检查
   - ✅ 记录调试日志说明忽略原因

**技术要点**:
- IDLE状态下只能执行BUY操作，SELL信号应该被明确忽略
- 策略生成的SELL信号可能是做空信号（当前系统不支持做空）
- 日志记录原则：关键操作记录到控制台，调试信息记录到日志系统

**修改文件**:
- `api/src/services/strategy-scheduler.service.ts` - 添加IDLE状态下SELL信号的明确处理

**新增文档**:
- `docs/analysis/251224-策略执行诊断报告.md` - 详细的问题分析报告
- `docs/analysis/251224-策略执行问题分析与修复总结.md` - 完整的修复总结

**相关文档**:
- [策略执行诊断报告](docs/analysis/251224-策略执行诊断报告.md)
- [策略执行问题分析与修复总结](docs/analysis/251224-策略执行问题分析与修复总结.md)

---

## 2025-12-19

### LongPort SDK 升级和修复 ✅ 关键更新 ⭐ 最新

**功能**: 升级LongPort SDK到3.0.18，修复市场温度获取和K线数据获取问题

**实现内容**:

1. **SDK版本升级**
   - ✅ 升级 `longport` 从 `1.1.7` 到 `3.0.18`
   - ✅ 更新 `package.json` 依赖配置
   - ✅ 市场温度功能成功获取（值：70.0）

2. **API调用修复**
   - ✅ 修复 `candlesticks` 方法调用，添加必需的 `TradeSessions` 参数
   - ✅ 修复 `getStockCandlesticks` 方法（交易推荐服务）
   - ✅ 修复 `getVIXCandlesticks` 方法（市场数据服务）
   - ✅ 修复 `getHistoricalCandlesticks` 方法（回测服务）
   - ✅ 所有K线数据获取方法统一添加 `TradeSessions.All` 参数

3. **市场温度功能验证**
   - ✅ 市场温度API成功调用（`quoteCtx.marketTemperature(Market.US)`）
   - ✅ 成功获取市场温度值（70.0）
   - ✅ 数据解析正确（从`temperature`属性提取）

4. **测试体系建设**
   - ✅ 创建市场状态矩阵测试文件（21个测试用例）
   - ✅ 测试通过率：100%（21/21）
   - ✅ 覆盖所有主要逻辑路径和边界条件

**技术要点**:
- SDK 3.0.18需要`TradeSessions`参数作为`candlesticks`方法的第5个参数
- 市场温度功能在SDK 3.0.18中正常工作
- 使用`TradeSessions.All`获取所有交易时段的数据

**修改文件**:
- `api/package.json` - 更新longport依赖到latest（实际升级到3.0.18）
- `api/src/services/trading-recommendation.service.ts` - 修复`getStockCandlesticks`方法
- `api/src/services/market-data.service.ts` - 修复`getVIXCandlesticks`方法，简化`getMarketTemperature`方法
- `api/src/services/backtest.service.ts` - 修复`getHistoricalCandlesticks`方法中的两处`candlesticks`调用

**新增文件**:
- `api/src/tests/market-regime-matrix.test.ts` - 市场状态矩阵测试文件（527行）
- `api/src/tests/MARKET_REGIME_MATRIX_TEST.md` - 测试说明文档

**相关文档**:
- [市场温度实现PRD](docs/features/251218-MARKET_TEMPERATURE_IMPLEMENTATION_PRD.md)
- [交易推荐逻辑总结](docs/technical/251212-交易推荐逻辑总结.md)

---

## 2025-12-15

### 量化日志系统实现 ✅ 新功能 ⭐ 最新更新

**功能**: 实现了完整的量化日志系统，支持非阻塞日志写入、结构化日志记录、数据库持久化、日志查询和导出功能

**实现内容**:

1. **非阻塞日志写入机制**
   - ✅ 创建日志服务（`log.service.ts`）
   - ✅ 使用内存队列缓冲日志（初始10000条，支持动态调整5000-50000条）
   - ✅ 后台工作线程批量写入数据库（批量大小：100条，批量间隔：1秒）
   - ✅ 动态队列大小调整（使用率>80%扩容，<30%缩容）
   - ✅ 日志写入延迟 < 10ms（P99），不影响交易主循环

2. **结构化日志记录**
   - ✅ 支持模块、级别、TraceID、JSON数据等字段
   - ✅ 自动提取文件路径和行号
   - ✅ TraceID自动生成（UUID v4）和上下文传递（AsyncLocalStorage）
   - ✅ 日志级别：INFO、WARNING、ERROR、DEBUG

3. **数据库持久化**
   - ✅ 创建`system_logs`表（PostgreSQL）
   - ✅ 支持BRIN索引（时间戳）、B-tree索引（级别、模块、TraceID）、GIN索引（JSONB数据）
   - ✅ 批量插入性能 ≥ 1000条/秒
   - ✅ 字段长度优化（module: VARCHAR(200), file_path: VARCHAR(500)）

4. **日志模块映射系统**
   - ✅ 创建模块映射器（`log-module-mapper.ts`）
   - ✅ 自动将文件路径映射到功能模块（如`Strategy.Scheduler`、`Execution.Basic`等）
   - ✅ 支持16个模块分类体系（策略、执行、回测、资金管理、选股、市场数据、订单、期权等）
   - ✅ 优先级匹配规则（精确匹配 → 目录匹配 → 推断匹配）

5. **日志查询和导出功能**
   - ✅ 创建日志查询API（`GET /api/logs`）
   - ✅ 支持按模块、时间、级别、TraceID查询
   - ✅ 创建日志导出API（`GET /api/logs/export`）
   - ✅ 支持JSON格式导出
   - ✅ 前端查询页面（支持多维度筛选和分页）

6. **日志清理功能**
   - ✅ 创建日志清理服务（`log-cleanup.service.ts`）
   - ✅ 自动清理配置（通过`system_config`表配置）
   - ✅ 手动清理API（`DELETE /api/logs/cleanup`）
   - ✅ 默认不清理日志（`log_retention_days = -1`）

7. **代码改造**
   - ✅ 更新`logger.ts`工具，保持向后兼容
   - ✅ 创建TraceID上下文管理（`trace-context.ts`）
   - ✅ 核心服务改造（策略调度器、回测服务、订单执行、账户余额同步）
   - ✅ 重要服务改造（交易推荐、市场数据、交易日服务、错误处理）
   - ✅ 路由文件改造（日志API路由）

**技术要点**:
- 非阻塞设计：内存队列 + 异步批量写入，确保日志写入不影响交易主循环
- 结构化日志：支持模块、级别、TraceID、JSON数据等字段，便于查询和分析
- 动态队列调整：根据实际日志量自动调整队列大小，提高系统适应性
- TraceID追踪：支持UUID v4生成和异步上下文传递，便于链路追踪
- 模块映射：自动将文件路径映射到功能模块，确保日志分类清晰

**修改文件**:
- `api/src/services/log.service.ts` - 新建日志服务
- `api/src/services/log-worker.service.ts` - 新建日志工作线程
- `api/src/services/log-cleanup.service.ts` - 新建日志清理服务
- `api/src/utils/log-module-mapper.ts` - 新建模块映射器
- `api/src/utils/trace-context.ts` - 新建TraceID上下文管理
- `api/src/utils/logger.ts` - 更新日志工具，保持向后兼容
- `api/src/routes/logs.ts` - 新建日志API路由
- `api/migrations/000_init_schema.sql` - 添加`system_logs`表结构

**新增文件**:
- `api/src/services/log.service.ts` - 日志服务（279行）
- `api/src/services/log-worker.service.ts` - 日志工作线程（241行）
- `api/src/services/log-cleanup.service.ts` - 日志清理服务（约200行）
- `api/src/utils/log-module-mapper.ts` - 模块映射器（390行）
- `api/src/utils/trace-context.ts` - TraceID上下文管理（约50行）
- `api/src/routes/logs.ts` - 日志API路由（约300行）

**相关文档**:
- [日志系统优化文档](docs/features/251215-日志系统优化文档.md) ⭐ 推荐阅读（包含PRD、模块映射说明和字段长度修复指南）

### 回测功能优化 ⭐ 最新更新

**功能**: 回测功能交易日验证和交易逻辑分析优化

**实现内容**:

1. **交易日验证功能**
   - ✅ 新增交易日工具函数（`trading-days.ts`）
     - `isFutureDate()`: 检查未来日期
     - `adjustDateRangeToTradingDays()`: 自动调整日期范围
     - `validateDateRange()`: 验证日期范围
   - ✅ 创建交易日服务（`trading-days.service.ts`）
     - 使用Longbridge SDK的`tradingDays`接口获取真实交易日数据
     - 实现24小时缓存机制
     - 支持日期范围超过30天时的分批获取
     - 降级方案：API失败时降级到周末判断
   - ✅ 集成到回测服务
     - 在`getHistoricalCandlesticks`中验证和调整日期范围
     - 在`runBacktest`中使用真实交易日数据过滤日期

2. **代码错误修复**
   - ✅ 修复重复声明错误（`getMarketFromSymbol`, `market`, `today`）

3. **回测交易逻辑分析**
   - ✅ 创建分析工具（Python脚本）
   - ✅ 完成交易逻辑分析
   - ✅ 发现4个潜在改进点（止损止盈执行时机、同一天买卖检查、价格使用优化、滑点和手续费）

**技术要点**:
- 使用Longbridge SDK的`tradingDays`接口获取真实交易日数据（包括节假日）
- 自动排除周末和未来日期
- 实现24小时缓存机制，减少API调用
- 支持日期范围超过30天时的分批获取

**修改文件**:
- `api/src/utils/trading-days.ts` - 新增交易日工具函数
- `api/src/services/trading-days.service.ts` - 新建交易日服务
- `api/src/services/backtest.service.ts` - 集成交易日验证
- `api/src/routes/backtest.ts` - 集成日期范围验证

**新增文件**:
- `analyze_backtest_logic.py` - 基本交易逻辑检查工具
- `analyze_backtest_logic_detailed.py` - 详细交易逻辑检查工具
- `analyze_backtest_logic_final.md` - 交易逻辑分析报告

**相关文档**:
- [回测功能文档](docs/features/251215-回测功能文档.md) ⭐ 推荐阅读（包含修订文档索引和修订总结）
- [回测交易逻辑分析报告](docs/archive/251216-回测交易逻辑分析报告.md)

## 2025-12-14

### 回测历史数据优化 ⭐

**功能**: 回测历史K线数据获取优化

**实现内容**:

1. **使用Longbridge历史K线API**
   - ✅ 使用`historyCandlesticksByDate`和`historyCandlesticksByOffset`替代`candlesticks()`
   - ✅ 实现降级方案：失败时自动降级到`candlesticks()`

2. **Moomoo降级方案**
   - ✅ 创建`symbol-to-moomoo.ts`工具函数
   - ✅ 实现`getHistoricalCandlesticksFromMoomoo()`方法

3. **API频次限制处理**
   - ✅ 创建`api-rate-limiter.ts`
   - ✅ 实现每30秒最多60次请求的限制

4. **配额监控**
   - ✅ 创建`quota-monitor.ts`
   - ✅ 监控每月查询的标的数量（去重），配额警告

5. **数据完整性检查**
   - ✅ 检查数据量是否满足需求（50%阈值）
   - ✅ 数据不足时自动补充

6. **交易日判断逻辑**
   - ✅ 创建`trading-days.ts`
   - ✅ 支持不同市场（US、HK、SH、SZ），自动过滤非交易日

7. **日K数据模拟市场环境**
   - ✅ 创建`market-simulation.ts`
   - ✅ 实现线性插值算法生成分时价格序列

**相关文档**:
- [回测功能文档](docs/features/251215-回测功能文档.md) ⭐ 推荐阅读（包含历史数据优化实施总结和PRD）

## 2025-12-08

### 期权图表功能实现 ✅ 新功能

**功能**: 实现了期权详情页面的图表功能，支持分时图、5日图和日K图显示。

**实现内容**:

1. **后端API实现**
   - ✅ 新增 `getOptionKline()` 函数：获取期权日K线数据
   - ✅ 新增 `getOptionMinute()` 函数：获取期权分时数据
   - ✅ 新增 `GET /api/options/kline` 端点：K线数据API
   - ✅ 新增 `GET /api/options/minute` 端点：分时数据API
   - ✅ 使用边缘函数代理调用Moomoo API，解决IP限制问题

2. **前端图表实现**
   - ✅ 实现分时图：显示实时价格走势
   - ✅ 实现5日图：显示最近5天的收盘价走势
   - ✅ 实现日K图：显示历史收盘价走势
   - ✅ 统一使用折线图（LineChart）显示，提供一致的用户体验
   - ✅ 使用Recharts库绘制图表
   - ✅ 实现图表切换功能
   - ✅ 添加加载状态和错误处理

**技术要点**:
- 通过Cloudflare边缘函数代理调用Moomoo API
- 自动处理cookies、CSRF token和quote-token
- 数据格式转换（时间戳、价格单位等）
- 完善的错误处理和用户提示

**修改文件**:
- `api/src/services/futunn-option-chain.service.ts` - 新增K线和分时数据获取函数
- `api/src/routes/options.ts` - 新增API端点
- `frontend/lib/api.ts` - 新增API客户端方法
- `frontend/app/options/[optionCode]/page.tsx` - 实现图表组件

**相关文档**:
- [期权图表功能文档](docs/features/251208-期权图表功能文档.md) ⭐ 推荐阅读（包含实施总结和API分析）

## 2025-12-05

### 资金使用差异BUG修复 ⚠️ 关键修复

**问题**: 资金使用记录值与实际值存在严重差异（差异 24810.74）

**根本原因**:
1. **持仓数据解析BUG**: API返回结构是 `channels[].positions`，代码错误检查 `positions.positions`
2. **状态同步不完整**: 只处理HOLDING状态，OPENING和CLOSING状态未处理
3. **实际使用值计算错误**: OPENING状态的资金未计入实际使用值

**修复内容**:

1. **修复持仓数据解析逻辑**
   - ✅ 支持多种数据结构：`positions.positions` 和 `positions.channels[].positions`
   - ✅ 支持多种价格字段：`currentPrice`, `costPrice`, `avgPrice`, `lastPrice`
   - ✅ 修复文件：`api/src/services/account-balance-sync.service.ts`, `api/src/services/capital-manager.service.ts`

2. **扩展状态同步逻辑**
   - ✅ 处理所有非IDLE状态（HOLDING, OPENING, CLOSING）
   - ✅ 检查未成交订单，判断状态是否合理
   - ✅ 自动修复状态不一致并释放资金
   - ✅ 修复条件：
     - HOLDING但实际持仓不存在 → 修复
     - OPENING但实际持仓不存在且无未成交订单 → 修复
     - CLOSING但实际持仓不存在且无未成交订单 → 修复

3. **修复实际使用值计算**
   - ✅ OPENING/CLOSING状态的申请资金也计入实际使用值
   - ✅ 与实际资金占用更一致

4. **增强日志输出**
   - ✅ 状态分布统计
   - ✅ 资金使用详细计算过程
   - ✅ 修复统计（修复了多少标的，释放了多少资金）

**修复效果**:
- **修复前**: 记录值 32922.07, 实际值 8111.33, 差异 24810.74
- **修复后**: 记录值 32922.07, 实际值 15888.23, 差异 17033.84
- **减少了**: 7776.90 (31%)

**修改文件**:
- `api/src/services/account-balance-sync.service.ts` - 账户余额同步服务
- `api/src/services/capital-manager.service.ts` - 资金管理服务

### 数据库迁移脚本合并 ✅

**合并内容**:
- ✅ 合并 `008_add_backtest_results.sql` 到 `000_init_schema.sql`
- ✅ 合并 `009_add_backtest_status.sql` 到 `000_init_schema.sql`
- ✅ 已移动已合并脚本到 `archive/` 目录

**合并原则**:
- ✅ 使用 `CREATE TABLE IF NOT EXISTS` 避免覆盖已有表
- ✅ 使用 `DO $$ ... END $$` 块检查列是否存在，避免重复添加列
- ✅ 使用 `UPDATE` 更新已有数据，确保数据一致性
- ✅ 保持向后兼容，已有数据不受影响

**修改文件**:
- `api/migrations/000_init_schema.sql` - 统一初始化脚本（已更新）
- `api/migrations/README.md` - 使用说明（已更新）

## 2025-01-28 (下午)

### 策略执行优化 ⭐

1. **策略界面统一优化**
   - ✅ 统一创建和编辑策略界面，使用相同的股票添加方式
   - ✅ 使用"添加关注"的方式添加股票，确保代码准确性
   - ✅ 添加股票代码验证和自动修正（APPL.US → AAPL.US）
   - ✅ 支持从关注列表快速添加股票
   - ✅ 统一的策略配置输入（ATR周期、ATR倍数、风险收益比）

2. **策略执行问题修复**
   - ✅ 修复数量计算问题：根据可用资金正确计算购买数量（使用10%可用资金）
   - ✅ 修复价格精度问题：美股保留2位小数，港股保留3位小数，避免下单失败
   - ✅ 添加持仓检查：避免重复买入同一标的
   - ✅ 添加订单追踪：自动追踪未成交订单，根据市场变化更新价格
   - ✅ 添加未成交订单检查：避免同一标的同时存在多个未成交订单

3. **后端验证增强**
   - ✅ 添加股票代码格式验证（创建和更新策略时）
   - ✅ 自动修正常见错误（APPL.US → AAPL.US）
   - ✅ 自动去重股票代码
   - ✅ 返回详细的错误信息

### 技术改进

1. **前端优化**
   - 统一创建和编辑策略的UI组件
   - 添加股票代码实时验证和错误提示
   - 优化用户体验，支持键盘快捷键（Enter键添加）

2. **后端优化**
   - 改进数量计算逻辑，添加详细日志
   - 添加价格格式化逻辑，根据市场类型选择小数位数
   - 添加持仓检查逻辑，同时检查数据库和实际持仓
   - 添加订单追踪逻辑，自动更新未成交订单价格

### 文件变更

**修改文件：**
- `frontend/app/quant/strategies/page.tsx` - 统一创建策略界面
- `frontend/app/quant/strategies/[id]/page.tsx` - 统一编辑策略界面
- `api/src/routes/quant.ts` - 添加股票代码验证和自动修正
- `api/src/services/strategy-scheduler.service.ts` - 添加数量计算、持仓检查、订单追踪
- `api/src/services/basic-execution.service.ts` - 添加价格格式化逻辑

**新增文档：**
- `STRATEGY_EXECUTION_IMPROVEMENTS.md` - 策略执行优化总结文档

## 2025-01-28 (上午)

### 新增功能

1. **期权链功能完整实现** ⭐
   - ✅ 期权链展示页面：支持查看股票的所有可用期权到期日期和行权价
   - ✅ 期权详情页：显示期权的实时价格、Greeks、隐含波动率等详细信息
   - ✅ 主页跳转功能：从主页股票列表一键跳转到对应股票的期权链
   - ✅ 自动滚动定位：期权链表格自动滚动到当前价格附近的行权价并高亮显示
   - ✅ 期权交易功能：支持在期权详情页直接交易期权（买入/卖出）

2. **期权链 API 接口**
   - ✅ `GET /api/options/strike-dates` - 获取期权到期日期列表
   - ✅ `GET /api/options/chain` - 获取期权链数据
   - ✅ `GET /api/options/detail` - 获取期权详情
   - ✅ `GET /api/options/underlying-quote` - 获取正股行情（用于定位）

3. **期权交易模态框**
   - ✅ 支持买入/卖出期权
   - ✅ 支持限价单和市价单
   - ✅ 显示期权信息（类型、行权价、合约乘数、当前价）
   - ✅ 订单预览和合约价值计算

### 技术改进

1. **富途牛牛 API 集成**
   - 新增 `futunn-option-chain.service.ts` - 期权链数据服务
   - 优化 `quote-token` 生成算法（HMAC-SHA512 + SHA256）
   - 支持自动 fallback 机制（expiration=1 → expiration=0）

2. **前端用户体验优化**
   - 固定表头：期权链表格支持固定表头滚动
   - 自动滚动：自动定位到最近行权价并高亮显示
   - 正股价格显示：在期权链页面显示正股当前价格

3. **代码优化**
   - 修复期权代码格式问题（自动添加.US后缀）
   - 修复 `estimateMaxQuantity` API 缺失问题
   - 优化订单提交参数格式

### 文件变更

**新增文件：**
- `api/src/routes/options.ts` - 期权相关 API 路由
- `api/src/services/futunn-option-chain.service.ts` - 富途期权链服务
- `frontend/app/options/chain/page.tsx` - 期权链页面
- `frontend/app/options/[optionCode]/page.tsx` - 期权详情页
- `frontend/components/OptionTradeModal.tsx` - 期权交易模态框

**修改文件：**
- `api/src/server.ts` - 添加期权路由
- `frontend/lib/api.ts` - 添加期权相关 API 方法
- `frontend/app/page.tsx` - 添加期权跳转链接
- `frontend/components/OptionTradeModal.tsx` - 修复参数格式问题

**文档更新：**
- 更新 `README.md` - 添加期权链功能说明
- 归档已完成计划文档到 `docs/` 目录

## 2025-01-27

### 新增功能

1. **期权持仓计算优化**
   - ✅ 正确计算期权持仓的市值和盈亏（考虑合约乘数）
   - ✅ 支持卖空期权的反向盈亏计算
   - ✅ 自动使用富途牛牛API作为期权行情备用方案
   - ✅ 在持仓查询接口（`/api/positions`）中集成期权行情获取

2. **配置管理功能**
   - ✅ Web界面配置管理（数据库存储，支持加密）
   - ✅ 管理员账户管理（创建、编辑、密码修改）
   - ✅ LongPort Access Token自动刷新（小于10天自动刷新）

### 修复问题

1. **期权持仓计算错误**
   - 修复：期权市值计算未考虑合约乘数的问题
   - 修复：卖空期权盈亏计算错误的问题
   - 修复：期权行情获取失败时使用成本价导致盈亏为0的问题

2. **期权行情获取**
   - 修复：长桥API权限不足时无法获取期权行情的问题
   - 新增：自动使用富途牛牛API作为备用方案

### 技术改进

1. **代码优化**
   - 添加详细的调试日志，便于排查问题
   - 优化期权行情获取逻辑，支持双重备用机制
   - 改进错误处理，提供更清晰的错误信息

2. **文档更新**
   - 更新 `README.md`，添加期权持仓计算说明
   - 更新 `OPTION_QUOTE_API.md`，说明在positions.ts中的集成
   - 清理多余的测试文件和临时文件

### 文件变更

**新增文件：**
- `api/migrations/003_config_management.sql` - 配置管理数据库迁移
- `api/migrations/004_add_token_auto_refresh_config.sql` - Token自动刷新配置
- `api/src/services/config.service.ts` - 配置管理服务
- `api/src/services/token-refresh.service.ts` - Token刷新服务
- `api/src/routes/config.ts` - 配置管理API路由
- `api/src/routes/token-refresh.ts` - Token刷新API路由
- `api/scripts/create-admin.js` - 创建管理员账户脚本
- `frontend/app/config/page.tsx` - 配置管理前端页面
- `CONFIG_MANAGEMENT_SETUP.md` - 配置管理设置指南

**删除文件：**
- `api/src/test-account-balance.ts` - 测试文件（已删除）
- `api/src/test-trade-context.ts` - 测试文件（已删除）
- `api/test-config.ts` - 测试文件（已删除）
- `api/test-env.ts` - 测试文件（已删除）
- `api/test-env-file.ts` - 测试文件（已删除）

**修改文件：**
- `api/src/routes/positions.ts` - 集成富途牛牛期权行情备用方案，优化期权持仓计算
- `api/src/routes/quote.ts` - 集成富途牛牛期权行情备用方案
- `api/src/config/longport.ts` - 支持从数据库读取配置
- `api/src/server.ts` - 添加Token自动刷新定时任务
- `frontend/app/page.tsx` - 优化期权持仓显示（合并价格/成本、市值/数量列）
- `frontend/lib/api.ts` - 添加配置管理和Token刷新API

## 2025-01-26

### 新增功能

1. **期权行情API**
   - ✅ 使用富途牛牛API作为长桥API的备用方案
   - ✅ 支持期权行情查询接口（`/api/quote/option`）

2. **市场数据获取**
   - ✅ SPX、USD Index、BTC数据获取（富途牛牛API）
   - ✅ 分时数据过滤和验证
   - ✅ 智能数据缓存机制

### 技术改进

1. **数据过滤**
   - 成交量异常检测和修正
   - Z-score异常值过滤
   - EMA平滑处理

2. **错误处理**
   - 改进API错误处理和日志记录
   - 添加数据不足警告


