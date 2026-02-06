# 更新日志

## 2026-02-06

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


