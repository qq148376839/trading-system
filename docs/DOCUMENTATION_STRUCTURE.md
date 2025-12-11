# 文档结构说明

**创建日期**: 2025-12-08  
**最后更新**: 2025-12-08  
**文档版本**: v1.0

---

## 📁 文档目录结构

```
docs/
├── README.md                          # 文档中心首页（文档索引）
├── CHANGELOG.md                       # 更新日志
│
├── guides/                            # 用户指南
│   ├── DOCKER_SETUP.md                # Docker环境设置指南
│   ├── CONFIG_MANAGEMENT_SETUP.md     # 配置管理设置指南
│   ├── TRADING_GUIDE.md               # 交易功能使用说明
│   └── 卖出看跌期权（Sell Put）完全指南.md
│
├── technical/                         # 技术文档
│   ├── PROJECT_SUMMARY.md             # 项目总结
│   ├── STRATEGY_LOGIC_REVIEW.md       # 策略逻辑审查
│   ├── STRATEGY_OPTIMIZATION_SUMMARY.md # 策略优化总结
│   ├── ORDER_MODIFICATION_LOGIC_REVIEW.md # 订单修改逻辑审查
│   ├── TRADING_RECOMMENDATION_LOGIC.md # 交易推荐算法
│   └── OPTION_QUOTE_API.md            # 期权行情API
│
├── fixes/                             # 修复文档（新增）
│   ├── PRODUCT_CRITICAL_ISSUES_ANALYSIS.md  # 严重问题分析报告
│   ├── FIX_IMPLEMENTATION_GUIDE.md    # 修复实施指南
│   ├── FIX_COMPLETION_SUMMARY.md      # 第一阶段修复完成总结
│   ├── PHASE2_PROGRESS.md             # 第二阶段修复进度报告
│   ├── TEST_COMPLETION_SUMMARY.md     # 测试体系建设完成总结
│   ├── ERROR_HANDLING_IMPLEMENTATION.md # 错误处理统一实施文档
│   └── NEXT_STEPS_GUIDE.md            # 下一步行动计划
│
├── features/                          # 功能文档（新增）
│   ├── DYNAMIC_TRADING_STRATEGY_DESIGN.md # 动态交易策略设计
│   ├── DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md # 动态交易策略实施
│   ├── DYNAMIC_TRADING_STRATEGY_TESTING_GUIDE.md # 动态交易策略测试指南
│   ├── BACKTEST_FEATURE_PLAN.md       # 回测功能实施计划
│   ├── BACKTEST_USAGE_GUIDE.md        # 回测功能使用指南
│   ├── OPTION_CHART_IMPLEMENTATION.md # 期权图表功能实施总结 ✅ 新增
│   ├── OPTION_CHART_API_ANALYSIS.md   # 期权图表API分析文档 ✅ 新增
│   └── OPTION_CHART_SUMMARY.md        # 期权图表功能文档索引 ✅ 新增
│
├── integration/                       # 集成文档（新增）
│   ├── FUTUNN_API_CSRF_REQUIREMENTS.md # 富途API CSRF要求
│   ├── SEARCH_COOKIES_SETUP.md        # 富途搜索Cookies设置
│   └── MOOMOO_EDGE_FUNCTION_INTEGRATION.md # Moomoo边缘函数集成
│
└── archive/                           # 历史文档（归档）
    ├── QUANT_PHASE1_COMPLETION.md     # 量化交易Phase 1完成总结
    ├── QUANT_INTEGRATION_SUMMARY.md   # 量化交易模块集成总结
    ├── QUANT_CODE_REVIEW.md           # 量化交易模块代码审查
    ├── STRATEGY_EXECUTION_IMPROVEMENTS.md # 策略执行优化总结
    ├── ORDER_MANAGEMENT_REFACTOR_PLAN.md # 订单管理重构计划
    ├── ORDER_SUBMIT_OPTIMIZATION.md   # 订单提交功能优化
    ├── TRADE_RECORD_ORDER_MANAGEMENT.md # 交易记录和订单管理API
    ├── OPTION_CHAIN_FEASIBILITY_ANALYSIS.md # 期权链功能可行性分析
    ├── OPTION_CHAIN_ENHANCEMENT_PLAN.md # 期权链功能优化计划
    ├── BUG_FIX_APPLIED.md             # Bug修复应用记录
    ├── CRITICAL_BUG_FIX.md            # 严重Bug修复
    ├── ENHANCED_LOGGING_PATCH.md      # 增强日志补丁
    ├── FINAL_FIX_SUMMARY.md           # 最终修复总结
    ├── LOG_ANALYSIS_REPORT.md         # 日志分析报告
    ├── MIGRATION_COMPLETE.md          # 迁移完成
    ├── REVISION_SUMMARY.md            # 修订总结
    ├── STATE_SYNC_FIX.md              # 状态同步修复
    └── verify_backtest_fix.md         # 回测修复验证
```

---

## 📋 文档分类说明

### 1. 用户指南 (guides/)

面向**最终用户**的使用指南，帮助用户快速上手和使用系统功能。

**特点**:
- 语言通俗易懂
- 包含详细的操作步骤
- 提供截图和示例
- 关注"如何使用"而非"如何实现"

**文档列表**:
- `DOCKER_SETUP.md` - Docker环境设置指南
- `CONFIG_MANAGEMENT_SETUP.md` - 配置管理设置指南
- `TRADING_GUIDE.md` - 交易功能使用说明
- `卖出看跌期权（Sell Put）完全指南.md` - 期权交易策略指南

---

### 2. 技术文档 (technical/)

面向**开发者**的技术文档，包含系统架构、API设计和实现细节。

**特点**:
- 关注技术实现细节
- 包含代码示例和架构图
- 说明设计决策和权衡
- 关注"如何实现"和"为什么这样实现"

**文档列表**:
- `PROJECT_SUMMARY.md` - 项目核心信息、关键决策和技术栈
- `STRATEGY_LOGIC_REVIEW.md` - 量化交易策略的详细逻辑说明
- `STRATEGY_OPTIMIZATION_SUMMARY.md` - 所有策略优化的完整总结
- `ORDER_MODIFICATION_LOGIC_REVIEW.md` - 订单修改逻辑修复详情
- `TRADING_RECOMMENDATION_LOGIC.md` - 交易推荐系统的算法和实现
- `OPTION_QUOTE_API.md` - 期权行情获取API开发文档

---

### 3. 修复文档 (fixes/)

记录**问题修复过程**的文档，包括问题分析、修复方案和实施总结。

**特点**:
- 记录问题发现和分析过程
- 说明修复方案和实施步骤
- 记录修复效果和验证结果
- 作为问题修复的历史记录

**文档列表**:
- `PRODUCT_CRITICAL_ISSUES_ANALYSIS.md` - 严重问题分析报告（P0/P1/P2）
- `FIX_IMPLEMENTATION_GUIDE.md` - 修复实施指南（修复路线图）
- `FIX_COMPLETION_SUMMARY.md` - 第一阶段修复完成总结
- `PHASE2_PROGRESS.md` - 第二阶段修复进度报告
- `TEST_COMPLETION_SUMMARY.md` - 测试体系建设完成总结
- `ERROR_HANDLING_IMPLEMENTATION.md` - 错误处理统一实施文档
- `NEXT_STEPS_GUIDE.md` - 下一步行动计划

---

### 4. 功能文档 (features/)

记录**新功能开发**的文档，包括功能设计、实施计划和测试指南。

**特点**:
- 记录功能设计思路
- 说明实施计划和进度
- 提供测试和使用指南
- 作为功能开发的历史记录

**文档列表**:
- `DYNAMIC_TRADING_STRATEGY_DESIGN.md` - 动态交易策略设计文档
- `DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md` - 动态交易策略实施总结
- `DYNAMIC_TRADING_STRATEGY_TESTING_GUIDE.md` - 动态交易策略测试指南
- `BACKTEST_FEATURE_PLAN.md` - 回测功能实施计划
- `BACKTEST_USAGE_GUIDE.md` - 回测功能使用指南
- `OPTION_CHART_IMPLEMENTATION.md` - 期权图表功能实施总结 ✅ 新增
- `OPTION_CHART_API_ANALYSIS.md` - 期权图表API分析文档 ✅ 新增
- `OPTION_CHART_SUMMARY.md` - 期权图表功能文档索引 ✅ 新增

---

### 5. 集成文档 (integration/)

记录**第三方服务集成**的文档，包括API配置、认证设置和集成方案。

**特点**:
- 关注第三方服务配置
- 提供详细的配置步骤
- 说明认证和授权机制
- 记录集成过程中的问题和解决方案

**文档列表**:
- `FUTUNN_API_CSRF_REQUIREMENTS.md` - 富途API CSRF Token配置说明
- `SEARCH_COOKIES_SETUP.md` - 富途搜索API Cookies配置指南
- `MOOMOO_EDGE_FUNCTION_INTEGRATION.md` - Moomoo API边缘函数集成文档

---

### 6. 历史文档 (archive/)

**已归档的历史文档**，保留作为历史记录，不再更新。

**特点**:
- 已完成功能的计划和总结
- 不再更新，仅作为历史记录
- 保留作为参考和追溯

**文档列表**:
- 量化交易模块相关文档
- 已完成功能计划文档
- 历史Bug修复记录

---

## 📝 文档管理规范

### 文档命名规范

1. **使用英文命名**（中文文档除外）
2. **使用大写字母分隔单词**（SCREAMING_SNAKE_CASE）
3. **文件名应清晰描述文档内容**
4. **避免使用特殊字符**

**示例**:
- ✅ `FIX_IMPLEMENTATION_GUIDE.md`
- ✅ `ERROR_HANDLING_IMPLEMENTATION.md`
- ❌ `fix-implementation-guide.md`（使用连字符）
- ❌ `FixImplementationGuide.md`（使用驼峰命名）

### 文档分类原则

1. **用户指南** (`guides/`): 面向最终用户的使用指南
2. **技术文档** (`technical/`): 面向开发者的技术文档
3. **修复文档** (`fixes/`): 问题修复相关文档
4. **功能文档** (`features/`): 新功能开发相关文档
5. **集成文档** (`integration/`): 第三方服务集成文档
6. **历史文档** (`archive/`): 已归档的历史文档

### 文档更新规范

1. **及时更新**: 代码变更后及时更新相关文档
2. **版本控制**: 重要文档标注版本号和更新日期
3. **保持同步**: 确保文档与实际代码一致
4. **归档旧文档**: 功能完成后归档相关文档

### 文档索引维护

1. **README.md**: 文档中心首页，包含完整的文档索引
2. **DOCUMENTATION_STRUCTURE.md**: 本文档，说明文档结构和管理规范
3. **定期更新**: 新增文档后及时更新索引

---

## 🔄 文档迁移计划

### 第一步：创建新目录结构

1. ✅ 创建 `fixes/` 目录
2. ✅ 创建 `features/` 目录
3. ✅ 创建 `integration/` 目录

### 第二步：迁移文档

1. **修复文档迁移**:
   - `PRODUCT_CRITICAL_ISSUES_ANALYSIS.md` → `fixes/`
   - `FIX_IMPLEMENTATION_GUIDE.md` → `fixes/`
   - `FIX_COMPLETION_SUMMARY.md` → `fixes/`
   - `PHASE2_PROGRESS.md` → `fixes/`
   - `TEST_COMPLETION_SUMMARY.md` → `fixes/`
   - `ERROR_HANDLING_IMPLEMENTATION.md` → `fixes/`
   - `NEXT_STEPS_GUIDE.md` → `fixes/`

2. **功能文档迁移**:
   - `DYNAMIC_TRADING_STRATEGY_DESIGN.md` → `features/`
   - `DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md` → `features/`
   - `DYNAMIC_TRADING_STRATEGY_TESTING_GUIDE.md` → `features/`
   - `BACKTEST_FEATURE_PLAN.md` → `features/`
   - `BACKTEST_USAGE_GUIDE.md` → `features/`
   - `STRATEGY_BUG_FIX_20251203.md` → `features/`

3. **集成文档迁移**:
   - `FUTUNN_API_CSRF_REQUIREMENTS.md` → `integration/`
   - `SEARCH_COOKIES_SETUP.md` → `integration/`
   - `MOOMOO_EDGE_FUNCTION_INTEGRATION.md` → `integration/`

### 第三步：更新文档索引

1. 更新 `README.md` 以反映新的文档结构
2. 更新文档中的链接路径
3. 确保所有链接正确

---

## 📌 注意事项

1. **保持向后兼容**: 迁移文档时保留原文件，使用符号链接或重定向
2. **更新链接**: 迁移后更新所有文档中的链接路径
3. **测试链接**: 确保所有文档链接正确可用
4. **版本控制**: 使用Git跟踪文档变更

---

**最后更新**: 2025-12-08  
**维护者**: 开发团队

---

## 📝 文档更新记录

### 2025-12-08

**新增文档**:
- `features/OPTION_CHART_IMPLEMENTATION.md` - 期权图表功能实施总结
- `features/OPTION_CHART_API_ANALYSIS.md` - 期权图表API分析文档（从根目录迁移）
- `features/OPTION_CHART_SUMMARY.md` - 期权图表功能文档索引

**文档迁移**:
- `OPTION_CHART_API_ANALYSIS.md` → `features/OPTION_CHART_API_ANALYSIS.md`

**文档更新**:
- `README.md` - 添加期权图表功能文档链接
- `CHANGELOG.md` - 添加期权图表功能更新记录

