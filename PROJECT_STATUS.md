# 项目进度总结

**更新时间**: 2026-02-18
**项目状态**: ✅ **正常运行**

---

## 🆕 最近更新

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

### 2026-02-01: 系统部署与最新SDK兼容性修复 ⭐ 最新

**修复内容**：
1. ✅ 修改了 src/config/longport.ts 以添加错误处理机制
2. ✅ 保持了 package.json 中 LongPort SDK 版本为 "latest"
3. ✅ 优化了部署流程，确保服务正常启动
4. ✅ 验证了 API 和前端服务的正常运行

**相关文档**：
- 📄 [系统部署与最新SDK兼容性修复](docs/features/260201-系统部署与最新SDK兼容性修复-PRD.md)

### 2026-01-27: 策略执行关键错误修复 ⭐ 

**修复内容**：
1. ✅ 卖空验证失败写入 `validation_failure_logs`（迁移已执行）
2. ✅ 卖空下单数量格式修复：对LongPort提交统一传正数 `submittedQuantity`
3. ✅ 订单改价参数修复：`replaceOrder.quantity` 使用 `Decimal`，避免 unwrap 报错
4. ✅ 新增 LongPort 调用限流 + 429002 指数退避重试（关键调用点已接入）
5. ✅ 持仓/卖空持仓 `context` 为空时自动尝试恢复，无历史则重置为 `IDLE`

**相关文档**：
- 📄 [错误位置定位及修复指南](错误位置定位及修复指南.md)
- 📄 [validation_failure_logs 迁移脚本](api/migrations/011_create_validation_failure_logs.sql)

### 2025-12-24: 策略执行诊断 ⭐ 最新

**诊断内容**：
1. ✅ **策略执行诊断报告**：创建策略执行诊断工具，分析信号生成但未执行的问题
2. ✅ **问题识别**：发现IDLE状态下生成SELL信号但未执行的问题
3. ✅ **根因分析**：分析状态与信号不匹配、验证逻辑等问题
4. ✅ **优化建议**：提供状态同步、信号验证、日志增强等优化建议

**技术实现**：
- 创建策略执行诊断工具，分析策略执行日志
- 识别信号生成但未执行的根本原因
- 提供详细的诊断报告和优化建议

**相关文档**：
- 📄 [策略执行诊断报告](docs/analysis/251224-策略执行诊断报告.md) ⭐ 最新

### 2025-12-22: LongPort SDK Decimal类型修复 ⭐ 关键修复

**修复内容**：
1. ✅ **Decimal类型修复**：修复`submittedQuantity`字段类型从`number`到`Decimal`的变更
2. ✅ **订单提交修复**：修复订单提交时的类型错误，确保策略能正常执行
3. ✅ **测试验证**：创建完整的测试用例，验证所有订单类型的提交
4. ✅ **回测问题修复**：修复回测功能中的多个问题（5月15日前无交易、动态调整等）

**技术实现**：
- 修复`basic-execution.service.ts`中的`submittedQuantity`类型问题
- 修复`orders.ts`中的`submittedQuantity`类型问题
- 使用`Decimal.fromNumber()`正确转换数量
- 创建订单提交小数测试文档

**修复效果**：
- 订单提交成功率恢复至100%
- 所有订单类型（买入/卖出）都能正常提交
- 修复后无类型错误

**相关文档**：
- 📄 [LongPort SDK Decimal类型修复](docs/features/251222-LONGPORT_SDK_DECIMAL_FIX.md) ⭐ 关键修复
- 📄 [订单提交小数测试](docs/features/251222-ORDER_SUBMISSION_DECIMAL_TEST.md)
- 📄 [回测问题修复总结](docs/analysis/251222-回测问题修复总结.md)
- 📄 [回测修复完成总结](docs/analysis/251222-回测修复完成总结.md)

### 2025-12-19: 系统优化和问题修复 ⭐ 重要更新

**优化内容**：
1. ✅ **交易推送服务优化**：修复unsubscribe功能，添加优雅关闭处理
2. ✅ **API频率限制修复**：创建统一缓存服务，消除API频率限制错误
3. ✅ **日志系统优化**：实现日志聚合和降噪，减少95%+的日志输出
4. ✅ **日志写入修复**：修复批量写入逻辑，确保少量日志也能写入数据库
5. ✅ **市场状态矩阵测试**：创建完整的测试套件，21个测试用例全部通过

**技术实现**：
- 新增`today-orders-cache.service.ts`统一缓存服务
- 优化`strategy-scheduler.service.ts`日志输出策略
- 修复`log-worker.service.ts`批量写入逻辑
- 创建`market-regime-matrix.test.ts`测试文件

**优化效果**：
- API调用从多个服务重复调用减少到统一缓存服务调用
- 日志条数从每分钟20+条减少到1条（减少95%+）
- 数据库写入减少80-90%：从每次10+条减少到1-2条
- 测试通过率：100%（21/21）

**相关文档**：
- 📄 [交易推送服务unsubscribe功能修复](docs/fixes/251219-TRADE_PUSH_UNSUBSCRIBE_FIX.md)
- 📄 [今日订单API频率限制和日志写入问题修复](docs/fixes/251219-LOG_AND_API_FREQUENCY_FIX.md)
- 📄 [策略日志聚合与降噪功能实施](docs/features/251219-LOG_AGGREGATION_IMPLEMENTATION.md) ⭐
- 📄 [市场状态矩阵测试文档](api/src/tests/MARKET_REGIME_MATRIX_TEST.md)

### 2025-12-22: 交易时段优化

**优化内容**：
1. ✅ **交易时段服务**：创建专门的交易时段服务，使用Longbridge `tradingSession` API获取当日交易时段
2. ✅ **策略监控交易时段检查**：非交易时段不执行策略监控和订单追踪，更精准的资源控制
3. ✅ **时区处理**：自动处理各市场时区（美股-美东时间，港股-香港时间，A股-北京时间）
4. ✅ **交易日服务修复**：修复日期格式解析问题（ISO格式转YYMMDD），修复未来日期查询限制
5. ✅ **API接口完善**：添加交易日和交易时段的API接口，方便测试和调试

**技术实现**：
- 新增交易时段服务（`trading-session.service.ts`），使用Longbridge `tradingSession`接口
- **策略调度器优化**：在 `runStrategyCycle` 和 `trackPendingOrders` 中添加交易时段检查
- 支持多市场策略，根据标的池自动识别市场类型
- 时区自动转换，确保交易时段判断准确
- 交易日服务修复：正确处理API返回的ISO日期格式（`YYYY-MM-DD` -> `YYMMDD`）
- 交易日服务修复：限制未来日期查询，符合API限制（仅支持最近一年数据）

**API接口**：
- `GET /api/trading-days/is-trading-day` - 判断是否为交易日
- `GET /api/trading-days/get-trading-days` - 获取交易日列表
- `GET /api/trading-days/get-trading-sessions` - 获取各市场交易时段
- `GET /api/trading-days/is-in-trading-session` - 判断是否在交易时段内
- `POST /api/trading-days/clear-cache` - 清除缓存

**相关文档**：
- 📄 [Longbridge API文档 - 获取市场交易日](https://open.longbridge.com/zh-CN/docs/quote/pull/trade-day)
- 📄 [Longbridge API文档 - 获取各市场当日交易时段](https://open.longbridge.com/zh-CN/docs/quote/pull/trade-session)
- 📄 [Longbridge Node.js SDK文档 - tradingSession](https://longportapp.github.io/openapi/nodejs/classes/QuoteContext.html#tradingsession)

### 2025-12-15: 交易日优化

**优化内容**：
1. ✅ **策略监控交易日检查**：非交易日不执行策略监控和订单追踪，节省资源
2. ✅ **交易日验证功能**：自动排除周末和未来日期，使用Longbridge SDK获取真实交易日数据
3. ✅ **交易日服务**：创建专门的交易日服务，实现24小时缓存和分批获取
4. ✅ **日期范围验证**：自动验证和调整回测日期范围，确保数据准确性
5. ✅ **回测功能优化**：在获取数据后立即过滤非交易日，避免处理不必要的数据

**技术实现**：
- 新增交易日服务（`trading-days.service.ts`），使用Longbridge `tradingDays`接口
- 新增交易日工具函数（`trading-days.ts`），支持日期范围验证和调整
- **策略调度器优化**：在 `runStrategyCycle` 和 `trackPendingOrders` 中添加交易日检查
- 集成到回测服务，自动过滤非交易日数据
- 根据策略标的池的市场类型判断交易日，支持多市场策略

**相关文档**：
- 📄 [回测功能文档](docs/features/251215-回测功能文档.md) ⭐ 推荐阅读（包含修订文档索引和修订总结）
- 📄 [回测交易逻辑分析报告](docs/archive/251216-回测交易逻辑分析报告.md)

### 2025-12-14: 回测历史数据优化

**优化内容**：
1. ✅ **使用Longbridge历史K线API**：使用`historyCandlesticksByDate`和`historyCandlesticksByOffset`替代`candlesticks()`
2. ✅ **Moomoo降级方案**：Longbridge失败时自动降级到Moomoo日K接口
3. ✅ **API频次限制处理**：实现每30秒最多60次请求的限制
4. ✅ **配额监控**：监控每月查询的标的数量，自动预警
5. ✅ **数据完整性检查**：检查数据量是否满足需求，不足时自动补充
6. ✅ **市场环境模拟**：使用日K数据的OHLC模拟分时市场环境

**相关文档**：
- 📄 [回测功能文档](docs/features/251215-回测功能文档.md) ⭐ 推荐阅读（包含历史数据优化实施总结和PRD）

### 2025-12-05: 资金使用差异BUG修复 ⚠️ 关键修复

**问题**: 资金使用记录值与实际值存在严重差异（差异 24810.74）

**修复内容**:
1. ✅ 修复持仓数据解析BUG（支持channels结构）
2. ✅ 扩展状态同步逻辑（支持OPENING/CLOSING状态）
3. ✅ 修复实际使用值计算（OPENING状态资金计入）
4. ✅ 增强日志输出（状态分布、修复统计）

**修复效果**:
- 差异从 24810.74 减少到 17033.84（减少31%）
- 系统能正确检测和修复状态不一致
- 资金使用计算更准确

### 2025-12-05: 数据库迁移脚本合并

**合并内容**:
- ✅ 合并 `008_add_backtest_results.sql` 到 `000_init_schema.sql`
- ✅ 合并 `009_add_backtest_status.sql` 到 `000_init_schema.sql`
- ✅ 使用安全的合并方式，确保向后兼容

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

## 🚀 下一步计划

### 短期优化（1-2周）
1. 监控资金使用差异，确保持续减少
2. 检查买入逻辑，确保context中保存allocationAmount
3. 添加修复历史记录
4. 优化修复性能（批量更新）

### 中期优化（1-2月）
1. 实现预防机制（避免状态不一致）
2. 添加修复报告（定期生成修复报告）
3. 完善监控告警
4. 添加单元测试覆盖

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

**最后更新**: 2026-02-11（更新3组Moomoo游客Cookie + 3-Cookie轮转压力测试30并发100%成功avg1.7s）
**项目版本**: 1.0

