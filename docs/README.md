# 文档中心

欢迎来到长桥股票交易系统文档中心！本文档提供了项目的完整文档索引。

> **📍 代码地图**: 查看 [CODE_MAP.md](../CODE_MAP.md) 了解项目中每个文件的作用和调用关系

## 📚 文档结构

```
docs/
├── guides/          # 用户指南 - 如何使用系统
├── technical/       # 技术文档 - 系统架构和实现细节
└── archive/        # 历史文档 - 已完成功能的计划和总结
```

## 📖 用户指南 (guides/)

面向用户的使用指南，帮助您快速上手和使用系统功能。

### 🚀 快速开始
- **[Docker 环境设置指南](guides/DOCKER_SETUP.md)** - Docker 环境配置和部署说明
- **[配置管理设置指南](guides/CONFIG_MANAGEMENT_SETUP.md)** - 系统配置管理和 Token 刷新功能设置

### 💼 功能使用
- **[交易功能使用说明](guides/TRADING_GUIDE.md)** - 股票交易功能的使用指南
- **[卖出看跌期权（Sell Put）完全指南](guides/卖出看跌期权（Sell Put）完全指南.md)** - 期权交易策略指南

## 🔧 技术文档 (technical/)

面向开发者的技术文档，包含系统架构、API设计和实现细节。

### 代码结构
- 🗺️ **[代码地图](../CODE_MAP.md)** - 项目中每个文件的作用和调用关系（**推荐开发者阅读**）

### 核心架构
- **[项目总结](technical/PROJECT_SUMMARY.md)** - 项目核心信息、关键决策和技术栈
- **[策略逻辑审查](technical/STRATEGY_LOGIC_REVIEW.md)** - 量化交易策略的详细逻辑说明
- **[策略优化总结](technical/STRATEGY_OPTIMIZATION_SUMMARY.md)** - 所有策略优化的完整总结（最新）⭐
- **[订单修改逻辑审查](technical/ORDER_MODIFICATION_LOGIC_REVIEW.md)** - 订单修改逻辑修复详情（已修复）
- **[动态交易策略设计](DYNAMIC_TRADING_STRATEGY_DESIGN.md)** - 动态持仓管理和市场环境响应机制 ⭐ 新

### API 文档
- **[交易推荐算法](technical/TRADING_RECOMMENDATION_LOGIC.md)** - 交易推荐系统的算法和实现
- **[期权行情 API](technical/OPTION_QUOTE_API.md)** - 期权行情获取 API 开发文档

### 集成文档
- **[富途 API CSRF 要求](FUTUNN_API_CSRF_REQUIREMENTS.md)** - 富途 API CSRF Token 配置说明
- **[富途搜索 Cookies 设置](SEARCH_COOKIES_SETUP.md)** - 富途搜索 API Cookies 配置指南
- **[Moomoo 边缘函数集成](MOOMOO_EDGE_FUNCTION_INTEGRATION.md)** - Moomoo API 边缘函数集成文档

## 📦 历史文档 (archive/)

已完成功能的计划和总结文档，保留作为历史记录。

### 量化交易模块
- **[Phase 1 开发完成总结](archive/QUANT_PHASE1_COMPLETION.md)** - 量化交易 Phase 1 完成情况
- **[量化交易模块集成总结](archive/QUANT_INTEGRATION_SUMMARY.md)** - 模块集成过程总结
- **[量化交易模块代码审查](archive/QUANT_CODE_REVIEW.md)** - 代码审查报告
- **[策略执行优化总结](archive/STRATEGY_EXECUTION_IMPROVEMENTS.md)** - 策略执行功能优化记录

### 已完成功能计划
- **[订单管理重构计划](archive/ORDER_MANAGEMENT_REFACTOR_PLAN.md)** - 订单管理功能重构计划（已完成）
- **[订单提交功能优化](archive/ORDER_SUBMIT_OPTIMIZATION.md)** - 订单提交功能优化方案（已完成）
- **[交易记录和订单管理 API](archive/TRADE_RECORD_ORDER_MANAGEMENT.md)** - API 文档（已完成）
- **[期权链功能可行性分析](archive/OPTION_CHAIN_FEASIBILITY_ANALYSIS.md)** - 期权链功能分析（已完成）
- **[期权链功能优化计划](archive/OPTION_CHAIN_ENHANCEMENT_PLAN.md)** - 期权链功能优化计划（已完成）

## 🔍 快速查找

### 按角色查找

**👤 用户**
- 想开始使用系统？→ [Docker 环境设置指南](guides/DOCKER_SETUP.md)
- 需要配置系统？→ [配置管理设置指南](guides/CONFIG_MANAGEMENT_SETUP.md)
- 想进行交易？→ [交易功能使用说明](guides/TRADING_GUIDE.md)
- 想了解期权策略？→ [卖出看跌期权完全指南](guides/卖出看跌期权（Sell Put）完全指南.md)

**👨‍💻 开发者**
- 想了解项目架构？→ [项目总结](technical/PROJECT_SUMMARY.md)
- 想了解策略优化？→ [策略优化总结](technical/STRATEGY_OPTIMIZATION_SUMMARY.md) ⭐
- 想了解策略逻辑？→ [策略逻辑审查](technical/STRATEGY_LOGIC_REVIEW.md)
- 想了解推荐算法？→ [交易推荐算法](technical/TRADING_RECOMMENDATION_LOGIC.md)
- 想集成期权 API？→ [期权行情 API](technical/OPTION_QUOTE_API.md)

**🔧 运维**
- 配置富途 API？→ [富途 API CSRF 要求](FUTUNN_API_CSRF_REQUIREMENTS.md)
- 配置搜索 Cookies？→ [富途搜索 Cookies 设置](SEARCH_COOKIES_SETUP.md)
- 集成边缘函数？→ [Moomoo 边缘函数集成](MOOMOO_EDGE_FUNCTION_INTEGRATION.md)

### 按主题查找

**🚀 快速开始**
- [Docker 环境设置指南](guides/DOCKER_SETUP.md)
- [配置管理设置指南](guides/CONFIG_MANAGEMENT_SETUP.md)

**💼 功能使用**
- [交易功能使用说明](guides/TRADING_GUIDE.md)
- [卖出看跌期权完全指南](guides/卖出看跌期权（Sell Put）完全指南.md)

**🏗️ 系统架构**
- [项目总结](technical/PROJECT_SUMMARY.md)
- [策略优化总结](technical/STRATEGY_OPTIMIZATION_SUMMARY.md) ⭐
- [策略逻辑审查](technical/STRATEGY_LOGIC_REVIEW.md)
- [订单修改逻辑审查](technical/ORDER_MODIFICATION_LOGIC_REVIEW.md)

**📡 API 文档**
- [交易推荐算法](technical/TRADING_RECOMMENDATION_LOGIC.md)
- [期权行情 API](technical/OPTION_QUOTE_API.md)

**🔌 集成配置**
- [富途 API CSRF 要求](FUTUNN_API_CSRF_REQUIREMENTS.md)
- [富途搜索 Cookies 设置](SEARCH_COOKIES_SETUP.md)
- [Moomoo 边缘函数集成](MOOMOO_EDGE_FUNCTION_INTEGRATION.md)

## 📝 文档更新说明

- **用户指南**：随功能更新而更新
- **技术文档**：随架构变更而更新
- **历史文档**：归档后不再更新，仅作为历史记录

## 🆕 最新更新 (2025-12-05)

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
- **[动态交易策略设计](DYNAMIC_TRADING_STRATEGY_DESIGN.md)** - 动态持仓管理和市场环境响应机制设计文档 ⭐
- **[动态交易策略实施总结](DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md)** - 实施完成总结
- **[测试指南](DYNAMIC_TRADING_STRATEGY_TESTING_GUIDE.md)** - 功能测试和问题排查指南 ⭐
- **[回测功能实施计划](BACKTEST_FEATURE_PLAN.md)** - 回测功能实施计划（Phase 1 & 2 已完成）✅
- **[回测功能使用指南](BACKTEST_USAGE_GUIDE.md)** - 回测功能使用说明 ⭐ 新
- **[策略Bug修复说明](STRATEGY_BUG_FIX_20251203.md)** - 高买低卖和重复卖出单问题修复说明

### 🔄 文档整理
- 合并重复文档：`STRATEGY_MONITORING_OPTIMIZATION.md` 和 `STRATEGY_MONITORING_DIAGNOSIS.md` 合并到 `STRATEGY_OPTIMIZATION_SUMMARY.md`
- 更新订单修改逻辑文档：标记为已修复，补充修复详情

## 🔗 相关链接

- [项目主 README](../README.md) - 项目概述和快速开始
- [更新日志](../CHANGELOG.md) - 功能更新和修复记录

---

**最后更新**: 2025-12-03
