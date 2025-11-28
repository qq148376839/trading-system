# 更新日志

## 2025-01-28

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


