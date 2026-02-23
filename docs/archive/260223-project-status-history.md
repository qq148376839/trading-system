# 项目状态 — 历史修复记录

> 归档自 [PROJECT_STATUS.md](../../PROJECT_STATUS.md)，归档日期：2026-02-23
> 包含 2025-12-05 ~ 2026-02-01 的修复记录

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
- 📄 [错误位置定位及修复指南](../guides/260127-错误位置定位及修复指南.md)
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
