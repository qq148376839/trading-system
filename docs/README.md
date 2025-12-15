# 文档中心

欢迎来到长桥股票交易系统文档中心！本文档提供了项目的完整文档索引。

> **📍 代码地图**: 查看 [CODE_MAP.md](../CODE_MAP.md) 了解项目中每个文件的作用和调用关系

## 📚 文档结构

```
docs/
├── guides/          # 用户指南 - 如何使用系统
├── technical/       # 技术文档 - 系统架构和实现细节
├── fixes/          # 修复文档 - 问题修复过程记录
├── features/       # 功能文档 - 新功能开发记录
├── integration/    # 集成文档 - 第三方服务集成配置
└── archive/        # 历史文档 - 已完成功能的计划和总结
```

> 📖 **文档结构说明**: 查看 [DOCUMENTATION_STRUCTURE.md](251208-DOCUMENTATION_STRUCTURE.md) 了解详细的文档分类和管理规范

## 📖 用户指南 (guides/)

面向用户的使用指南，帮助您快速上手和使用系统功能。

### 🚀 快速开始
- **[Docker 部署完成总结](guides/251214-DOCKER_DEPLOYMENT_SUMMARY.md)** - Docker 部署修复完成总结 ⭐ 最新
- **[NAS Docker 部署指南](guides/251212-NAS_DOCKER_DEPLOYMENT.md)** - NAS 上 Docker 部署完整指南 ⭐ 新增
- **[环境变量配置指南](../ENV_SETUP_GUIDE.md)** - 环境变量配置说明（数据库账号密码等）⭐ 新增
- **[Docker 环境设置指南](guides/251214-DOCKER_SETUP.md)** - Docker 环境配置和部署说明（已更新）
- **[Docker 故障排查指南](../DOCKER_TROUBLESHOOTING.md)** - Docker 部署常见问题排查 ⭐ 新增
- **[前端 API URL 配置指南](../FRONTEND_API_URL_SETUP.md)** - 前端 API 连接配置说明 ⭐ 新增
- **[配置管理设置指南](guides/250127-CONFIG_MANAGEMENT_SETUP.md)** - 系统配置管理和 Token 刷新功能设置

### 💼 功能使用
- **[交易功能使用说明](guides/251212-TRADING_GUIDE.md)** - 股票交易功能的使用指南
- **[卖出看跌期权（Sell Put）完全指南](guides/251212-卖出看跌期权（Sell Put）完全指南.md)** - 期权交易策略指南

## 🔧 技术文档 (technical/)

面向开发者的技术文档，包含系统架构、API设计和实现细节。

### 代码结构
- 🗺️ **[代码地图](../CODE_MAP.md)** - 项目中每个文件的作用和调用关系（**推荐开发者阅读**）

### 核心架构
- **[项目总结](technical/251202-PROJECT_SUMMARY.md)** - 项目核心信息、关键决策和技术栈
- **[策略逻辑审查](technical/251202-STRATEGY_LOGIC_REVIEW.md)** - 量化交易策略的详细逻辑说明
- **[策略优化总结](technical/251202-STRATEGY_OPTIMIZATION_SUMMARY.md)** - 所有策略优化的完整总结（最新）⭐
- **[订单修改逻辑审查](technical/251212-ORDER_MODIFICATION_LOGIC_REVIEW.md)** - 订单修改逻辑修复详情（已修复）

### API 文档
- **[交易推荐算法](technical/251212-TRADING_RECOMMENDATION_LOGIC.md)** - 交易推荐系统的算法和实现
- **[期权行情 API](technical/251121-OPTION_QUOTE_API.md)** - 期权行情获取 API 开发文档

## 🔧 修复文档 (fixes/)

记录问题修复过程的文档，包括问题分析、修复方案和实施总结。

### 问题分析
- **[严重问题分析报告](fixes/251208-PRODUCT_CRITICAL_ISSUES_ANALYSIS.md)** - P0/P1/P2级问题分析 ⭐
- **[修复实施指南](fixes/251208-FIX_IMPLEMENTATION_GUIDE.md)** - 修复路线图和实施步骤

### 修复总结
- **[第一阶段修复完成总结](fixes/251208-FIX_COMPLETION_SUMMARY.md)** - P0级问题修复完成总结 ✅
- **[第二阶段修复进度报告](fixes/251208-PHASE2_PROGRESS.md)** - P1级问题修复进度
- **[测试体系建设完成总结](fixes/251208-TEST_COMPLETION_SUMMARY.md)** - 单元测试完成总结 ✅
- **[错误处理统一实施文档](fixes/251209-ERROR_HANDLING_IMPLEMENTATION.md)** - 错误处理系统实施 ✅
- **[下一步行动计划](fixes/251208-NEXT_STEPS_GUIDE.md)** - 后续工作计划

## 🎯 功能文档 (features/)

记录新功能开发的文档，包括功能设计、实施计划和测试指南。

### 动态交易策略
- **[动态交易策略设计](features/251203-DYNAMIC_TRADING_STRATEGY_DESIGN.md)** - 动态持仓管理和市场环境响应机制 ⭐
- **[动态交易策略实施总结](features/251203-DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md)** - 实施完成总结
- **[动态交易策略测试指南](features/251203-DYNAMIC_TRADING_STRATEGY_TESTING_GUIDE.md)** - 功能测试和问题排查指南 ⭐

### 回测功能 ⭐ 最新更新
- **[回测功能修订文档索引](features/251215-BACKTEST_REVISION_INDEX.md)** - 回测功能修订文档索引 ⭐ 推荐阅读
- **[回测功能修订总结](features/251215-REVISION_SUMMARY.md)** - 交易日验证与交易逻辑优化总结 ⭐ 最新
- **[回测历史数据优化实施总结](features/251214-IMPLEMENTATION_SUMMARY.md)** - 历史数据优化实施总结
- **[回测功能使用指南](features/250101-BACKTEST_USAGE_GUIDE.md)** - 回测功能使用说明
- **[回测交易逻辑分析报告](../analyze_backtest_logic_final.md)** - 回测交易逻辑分析报告 ⭐ 最新

### Bug修复
- **[策略Bug修复说明](features/251203-STRATEGY_BUG_FIX_20251203.md)** - 高买低卖和重复卖出单问题修复说明
- **[构建错误修复总结](features/251211-BUILD_ERROR_FIX_SUMMARY.md)** - TypeScript编译错误修复总结 ⭐ 新增

### 机构选股功能
- **[机构选股功能PRD](features/251205-INSTITUTION_STOCK_SELECTOR_PRD.md)** - 产品需求文档
- **[机构选股功能实施总结](features/251208-INSTITUTION_STOCK_SELECTOR_IMPLEMENTATION.md)** - 开发实施总结
- **[机构选股缓存对比](features/251205-INSTITUTION_STOCK_SELECTOR_CACHE_COMPARISON.md)** - 缓存方案对比

### UI优化
- **[策略创建UI优化](features/251208-STRATEGY_CREATION_UI_OPTIMIZATION.md)** - 策略创建页面UI优化总结 ⭐
- **[策略编辑和详情页面优化](features/251205-STRATEGY_EDIT_DETAIL_OPTIMIZATION_PRD.md)** - 策略编辑和详情页面优化PRD ⭐

### 量化交易订单管理
- **[量化交易订单管理重构PRD](features/251211-QUANT_ORDER_MANAGEMENT_REFACTOR_PRD.md)** - 产品需求文档 ⭐
- **[量化交易订单管理重构实施总结](features/251211-QUANT_ORDER_MANAGEMENT_REFACTOR_IMPLEMENTATION_SUMMARY.md)** - 实施完成总结 ✅ 新增
- **[信号日志历史数据修复方案](features/251212-SIGNAL_ORDER_HISTORICAL_DATA_FIX.md)** - 历史数据修复方案（可选）

### 构建和部署
- **[构建错误修复总结](features/251211-BUILD_ERROR_FIX_SUMMARY.md)** - TypeScript编译错误修复总结 ⭐ 新增

### 期权功能
- **[期权图表功能实施总结](features/251208-OPTION_CHART_IMPLEMENTATION.md)** - 期权图表功能实施总结 ✅ 新增

### 边缘函数文档
- **[边缘函数README](../edge-functions/README.md)** - 边缘函数使用说明和API列表
- **[边缘函数集成指南](../edge-functions/INTEGRATION_GUIDE.md)** - 后端集成边缘函数的详细指南
- **[Quote-Token实现说明](../edge-functions/QUOTE_TOKEN_IMPLEMENTATION.md)** - Quote-Token自动计算实现细节
- **[边缘函数故障排查](../edge-functions/TROUBLESHOOTING.md)** - 常见问题和调试步骤

## 🔌 集成文档 (integration/)

记录第三方服务集成的文档，包括API配置、认证设置和集成方案。

- **[富途 API CSRF 要求](integration/251212-FUTUNN_API_CSRF_REQUIREMENTS.md)** - 富途 API CSRF Token 配置说明
- **[富途搜索 Cookies 设置](integration/251212-SEARCH_COOKIES_SETUP.md)** - 富途搜索 API Cookies 配置指南
- **[Moomoo 边缘函数集成](integration/251212-MOOMOO_EDGE_FUNCTION_INTEGRATION.md)** - Moomoo API 边缘函数集成文档

## 📦 历史文档 (archive/)

已完成功能的计划和总结文档，保留作为历史记录。

### 量化交易模块
- **[Phase 1 开发完成总结](archive/251212-QUANT_PHASE1_COMPLETION.md)** - 量化交易 Phase 1 完成情况
- **[量化交易模块集成总结](archive/251212-QUANT_INTEGRATION_SUMMARY.md)** - 模块集成过程总结
- **[量化交易模块代码审查](archive/251212-QUANT_CODE_REVIEW.md)** - 代码审查报告
- **[策略执行优化总结](archive/250128-STRATEGY_EXECUTION_IMPROVEMENTS.md)** - 策略执行功能优化记录

### 已完成功能计划
- **[订单管理重构计划](archive/220509-ORDER_MANAGEMENT_REFACTOR_PLAN.md)** - 订单管理功能重构计划（已完成）
- **[订单提交功能优化](archive/250115-ORDER_SUBMIT_OPTIMIZATION.md)** - 订单提交功能优化方案（已完成）
- **[交易记录和订单管理 API](archive/231201-TRADE_RECORD_ORDER_MANAGEMENT.md)** - API 文档（已完成）
- **[期权链功能可行性分析](archive/251212-OPTION_CHAIN_FEASIBILITY_ANALYSIS.md)** - 期权链功能分析（已完成）
- **[期权链功能优化计划](archive/251212-OPTION_CHAIN_ENHANCEMENT_PLAN.md)** - 期权链功能优化计划（已完成）

## 🔍 快速查找

### 按角色查找

**👤 用户**
- 想开始使用系统？→ [Docker 环境设置指南](guides/251214-DOCKER_SETUP.md)
- 需要配置系统？→ [配置管理设置指南](guides/250127-CONFIG_MANAGEMENT_SETUP.md)
- 想进行交易？→ [交易功能使用说明](guides/251212-TRADING_GUIDE.md)
- 想了解期权策略？→ [卖出看跌期权完全指南](guides/251212-卖出看跌期权（Sell Put）完全指南.md)

**👨‍💻 开发者**
- 想了解项目架构？→ [项目总结](technical/251202-PROJECT_SUMMARY.md)
- 想了解策略优化？→ [策略优化总结](technical/251202-STRATEGY_OPTIMIZATION_SUMMARY.md) ⭐
- 想了解策略逻辑？→ [策略逻辑审查](technical/251202-STRATEGY_LOGIC_REVIEW.md)
- 想了解推荐算法？→ [交易推荐算法](technical/251212-TRADING_RECOMMENDATION_LOGIC.md)
- 想集成期权 API？→ [期权行情 API](technical/251121-OPTION_QUOTE_API.md)

**🔧 运维**
- Docker 部署问题？→ [Docker 故障排查指南](../DOCKER_TROUBLESHOOTING.md) ⭐
- 前端无法连接 API？→ [前端 API URL 配置指南](../FRONTEND_API_URL_SETUP.md) ⭐
- 配置富途 API？→ [富途 API CSRF 要求](integration/251212-FUTUNN_API_CSRF_REQUIREMENTS.md)
- 配置搜索 Cookies？→ [富途搜索 Cookies 设置](integration/251212-SEARCH_COOKIES_SETUP.md)
- 集成边缘函数？→ [Moomoo 边缘函数集成](integration/251212-MOOMOO_EDGE_FUNCTION_INTEGRATION.md)

**🐛 问题修复**
- 了解系统问题？→ [严重问题分析报告](fixes/251208-PRODUCT_CRITICAL_ISSUES_ANALYSIS.md)
- 查看修复进度？→ [修复实施指南](fixes/251208-FIX_IMPLEMENTATION_GUIDE.md)
- 了解修复完成情况？→ [第一阶段修复完成总结](fixes/251208-FIX_COMPLETION_SUMMARY.md)

### 按主题查找

**🚀 快速开始**
- [Docker 环境设置指南](guides/251214-DOCKER_SETUP.md)
- [配置管理设置指南](guides/250127-CONFIG_MANAGEMENT_SETUP.md)

**💼 功能使用**
- [交易功能使用说明](guides/251212-TRADING_GUIDE.md)
- [卖出看跌期权完全指南](guides/251212-卖出看跌期权（Sell Put）完全指南.md)

**🏗️ 系统架构**
- [项目总结](technical/251202-PROJECT_SUMMARY.md)
- [策略优化总结](technical/251202-STRATEGY_OPTIMIZATION_SUMMARY.md) ⭐
- [策略逻辑审查](technical/251202-STRATEGY_LOGIC_REVIEW.md)
- [订单修改逻辑审查](technical/251212-ORDER_MODIFICATION_LOGIC_REVIEW.md)

**📡 API 文档**
- [交易推荐算法](technical/251212-TRADING_RECOMMENDATION_LOGIC.md)
- [期权行情 API](technical/251121-OPTION_QUOTE_API.md)
- [期权图表 API 分析](features/251212-OPTION_CHART_API_ANALYSIS.md)

**🔌 集成配置**
- [富途 API CSRF 要求](integration/251212-FUTUNN_API_CSRF_REQUIREMENTS.md)
- [富途搜索 Cookies 设置](integration/251212-SEARCH_COOKIES_SETUP.md)
- [Moomoo 边缘函数集成](integration/251212-MOOMOO_EDGE_FUNCTION_INTEGRATION.md)

**🐛 问题修复**
- [严重问题分析报告](fixes/251208-PRODUCT_CRITICAL_ISSUES_ANALYSIS.md)
- [修复实施指南](fixes/251208-FIX_IMPLEMENTATION_GUIDE.md)
- [第一阶段修复完成总结](fixes/251208-FIX_COMPLETION_SUMMARY.md)
- [错误处理统一实施文档](fixes/251209-ERROR_HANDLING_IMPLEMENTATION.md)

**🎯 功能开发**
- [动态交易策略设计](features/251203-DYNAMIC_TRADING_STRATEGY_DESIGN.md)
- [回测功能使用指南](features/250101-BACKTEST_USAGE_GUIDE.md)
- [期权图表功能实施总结](features/251208-OPTION_CHART_IMPLEMENTATION.md) ✅ 新增

## 📝 文档更新说明

- **用户指南**：随功能更新而更新
- **技术文档**：随架构变更而更新
- **历史文档**：归档后不再更新，仅作为历史记录
- **文档命名规范**：所有文档已按最后更新日期重命名为 `YYMMDD-文件名.md` 格式（如 `251212-BACKTEST_LOGIC_FIX_PRD.md`），方便按日期排序查找

## 🆕 最新更新 (2025-12-15)

### ✅ 回测功能优化完成
- **完成度**: 100% ✅
- **优化内容**:
  - 交易日验证功能（自动排除周末和未来日期）
  - 交易日服务（使用Longbridge SDK获取真实交易日数据）
  - 日期范围验证（自动验证和调整回测日期范围）
  - 交易逻辑分析（全面检查回测逻辑，发现潜在改进点）
- **相关文档**:
  - [回测功能修订文档索引](features/251215-BACKTEST_REVISION_INDEX.md) ⭐ 推荐阅读
  - [回测功能修订总结](features/251215-REVISION_SUMMARY.md)
  - [回测交易逻辑分析报告](../analyze_backtest_logic_final.md)

## 🆕 历史更新 (2025-12-14)

### ✅ 回测历史数据优化完成
- **完成度**: 100% ✅
- **优化内容**:
  - 使用Longbridge历史K线API（`historyCandlesticksByDate`和`historyCandlesticksByOffset`）
  - Moomoo降级方案（Longbridge失败时自动降级）
  - API频次限制处理（每30秒最多60次请求）
  - 配额监控（监控每月查询的标的数量）
  - 数据完整性检查（自动检查数据量，不足时自动补充）
  - 市场环境模拟（使用日K数据模拟分时市场环境）
- **相关文档**:
  - [回测历史数据优化实施总结](features/251214-IMPLEMENTATION_SUMMARY.md)
  - [回测历史数据优化PRD](features/251214-BACKTEST_HISTORICAL_DATA_OPTIMIZATION_PRD.md)

## 🆕 历史更新 (2025-12-12)

### ✅ 文档重命名完成
- **完成度**: 100% ✅
- **重命名规则**: 按最后更新日期重命名为 `YYMMDD-文件名.md` 格式（如 `251212-BACKTEST_LOGIC_FIX_PRD.md`）
- **重命名数量**: 99 个文档已重命名
- **链接更新**: 所有文档中的链接已更新（50+ 个文档）
- **目录分布**: guides(6), technical(6), fixes(9), features(38), integration(3), archive(20), 根目录(16)
- **相关文档**: [文档重命名完成总结](251212-DOCUMENTATION_RENAME_SUMMARY.md) ⭐ 新增

### ✅ Docker 部署修复完成
- **完成度**: 100% ✅
- **修复内容**:
  - pnpm 包管理器支持（API 和 Frontend）
  - longport 原生模块支持（切换到 Debian 基础镜像）
  - bcrypt 编译支持（添加构建工具）
  - 前端 API URL 构建时注入修复（使用 ARG + ENV）
  - PostgreSQL 端口冲突修复（移除外部端口映射）
  - NAS 系统兼容性（移除 CPU CFS 调度器配置）
- **相关文档**:
  - [Docker 故障排查指南](../DOCKER_TROUBLESHOOTING.md) ⭐
  - [前端 API URL 配置指南](../FRONTEND_API_URL_SETUP.md) ⭐
  - [Docker 构建修复说明](../DOCKER_BUILD_FIX.md)

## 🆕 历史更新 (2025-12-08)

### ✅ 期权图表功能实现完成
- **功能**: 实现了期权详情页面的图表功能，支持分时图、5日图和日K图显示
- **技术**: 通过边缘函数代理调用Moomoo API，统一使用折线图显示
- **相关文档**: [期权图表功能实施总结](features/251208-OPTION_CHART_IMPLEMENTATION.md) ✅

### 📄 新增文档
- **[期权图表功能实施总结](features/251208-OPTION_CHART_IMPLEMENTATION.md)** - 功能实施总结和技术细节 ⭐

## 🆕 历史更新 (2025-12-08)

### ✅ 文档结构整理完成
- **新增目录结构**: 
  - `fixes/` - 修复文档目录
  - `features/` - 功能文档目录
  - `integration/` - 集成文档目录
- **文档迁移**: 已完成所有文档的分类和迁移
- **文档索引更新**: 更新了README.md以反映新的文档结构
- **文档管理规范**: 创建了 `251208-DOCUMENTATION_STRUCTURE.md` 说明文档结构和管理规范

### ✅ 错误处理统一完成
- **完成度**: 100% ✅
- **已迁移路由文件**: 15个（80+个路由）
- **统一错误处理系统**: 30+个错误码，4个错误分类，4个严重程度级别
- **相关文档**: [错误处理统一实施文档](fixes/251209-ERROR_HANDLING_IMPLEMENTATION.md)

### ✅ 测试体系建设完成
- **测试通过率**: 100%（29/29）
- **测试覆盖**: 资金管理、策略执行验证、动态持仓管理
- **相关文档**: [测试体系建设完成总结](fixes/251208-TEST_COMPLETION_SUMMARY.md)

## 🆕 历史更新 (2025-12-05)

### ✅ 资金使用差异BUG修复
- **问题**: 资金使用记录值与实际值存在严重差异
- **修复**: 
  - 修复持仓数据解析BUG（支持channels结构）
  - 扩展状态同步逻辑（支持OPENING/CLOSING状态）
  - 修复实际使用值计算（OPENING状态资金计入）
  - 增强日志输出（状态分布、修复统计）
- **效果**: 差异从 24810.74 减少到 17033.84（减少31%）
- **相关文档**: 已合并到 `CHANGELOG.md`

### ✅ 数据库迁移脚本合并
- **合并内容**: 008和009合并到000_init_schema.sql
- **合并原则**: 使用安全的合并方式，确保向后兼容
- **效果**: 统一初始化脚本，简化部署流程

## 🆕 历史更新 (2025-12-03)

### ✅ 动态交易策略实施完成
- **动态持仓管理服务**：实现动态止盈/止损调整、市场环境响应、风险保护等功能
- **市场环境响应机制**：根据市场环境变化智能调整止盈/止损
- **持仓时间调整**：根据持仓时间动态调整策略
- **波动性调整**：根据ATR变化调整止盈/止损
- **风险保护机制**：盈亏平衡保护、持仓时间保护、波动性保护

### 📄 新增文档
- **[动态交易策略设计](features/251203-DYNAMIC_TRADING_STRATEGY_DESIGN.md)** - 动态持仓管理和市场环境响应机制设计文档 ⭐
- **[动态交易策略实施总结](features/251203-DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md)** - 实施完成总结
- **[测试指南](features/251203-DYNAMIC_TRADING_STRATEGY_TESTING_GUIDE.md)** - 功能测试和问题排查指南 ⭐
- **[回测功能实施计划](features/250101-BACKTEST_FEATURE_PLAN.md)** - 回测功能实施计划（Phase 1 & 2 已完成）✅
- **[回测功能使用指南](features/250101-BACKTEST_USAGE_GUIDE.md)** - 回测功能使用说明 ⭐ 新
- **[策略Bug修复说明](features/251203-STRATEGY_BUG_FIX_20251203.md)** - 高买低卖和重复卖出单问题修复说明

### 🔄 文档整理
- 合并重复文档：`STRATEGY_MONITORING_OPTIMIZATION.md` 和 `STRATEGY_MONITORING_DIAGNOSIS.md` 合并到 `STRATEGY_OPTIMIZATION_SUMMARY.md`
- 更新订单修改逻辑文档：标记为已修复，补充修复详情

## 🔗 相关链接

- [项目主 README](../README.md) - 项目概述和快速开始
- [更新日志](../CHANGELOG.md) - 功能更新和修复记录

---

**最后更新**: 2025-12-15
