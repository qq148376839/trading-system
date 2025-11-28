# 项目上下文压缩文档

本文档提供项目的核心信息摘要，用于快速了解项目状态和关键决策。

## 🎯 项目核心

**长桥股票交易系统** - 基于 Longbridge OpenAPI SDK 的全栈交易系统

## 📋 关键决策记录

### 1. 订单管理架构（2025-01）

**决策**: 完全基于 Longbridge SDK，不再使用数据库查询订单

**原因**:
- 数据一致性：SDK 返回的数据始终是最新的
- 减少同步问题：避免数据库和 API 数据不一致
- 简化架构：减少数据库查询逻辑

**实现**:
- 所有订单查询直接调用 SDK：`todayOrders()`, `historyOrders()`, `orderDetail()`
- 数据库 `trades` 表仅用于日志记录（记录提交的订单）
- 统一订单管理页面，整合今日订单和历史订单

**文件**:
- `api/src/routes/orders.ts` - 完全重构
- `frontend/app/orders/page.tsx` - 统一订单管理页面
- `frontend/app/trades/page.tsx` - 重定向到订单管理

### 2. 数据格式规范化

**决策**: 所有枚举值返回字符串格式，符合 Longbridge API 文档规范

**实现**:
- `normalizeOrderType()` - 订单类型转换（数字 → 字符串）
- `normalizeStatus()` - 订单状态转换（数字/字符串 → 标准字符串）
- `normalizeTag()` - 订单标记转换
- `normalizeTimeInForce()` - 有效期类型转换
- `normalizeOutsideRth()` - 盘前盘后转换

**中文翻译**:
- `translateOrderType()` - 订单类型中文翻译
- `translateOutsideRth()` - 盘前盘后中文翻译
- API 返回字段：`order_type_text`, `outside_rth_text`

### 3. 期权行情 Fallback 机制

**决策**: 优先使用长桥 API，权限不足时自动切换到富途牛牛 API

**实现**:
- 检测错误码 `301604`（权限不足）
- 自动切换到富途牛牛 API
- 用户无感知切换

### 4. 期权链功能实现（2025-01-28）

**决策**: 使用富途牛牛 API 实现完整的期权链功能

**原因**:
- 长桥 API 没有期权权限（错误码 301604）
- 富途牛牛 API 提供完整的期权链数据
- 用户体验优先，提供完整的期权交易功能

**实现**:
- 期权链展示：到期日期列表、行权价列表、看涨/看跌期权
- 期权详情：实时价格、Greeks、隐含波动率等
- 主页跳转：从股票列表一键跳转到期权链
- 自动定位：自动滚动到当前价格附近的行权价
- 期权交易：支持买入/卖出期权

**文件**:
- `api/src/routes/options.ts` - 期权相关 API
- `api/src/services/futunn-option-chain.service.ts` - 富途期权链服务
- `frontend/app/options/chain/page.tsx` - 期权链页面
- `frontend/app/options/[optionCode]/page.tsx` - 期权详情页
- `frontend/components/OptionTradeModal.tsx` - 期权交易模态框

## 🔑 核心技术栈

- **后端**: Node.js + Express + TypeScript + Longbridge SDK
- **前端**: Next.js 14 + TypeScript + Tailwind CSS
- **数据库**: PostgreSQL 15
- **部署**: Docker + Cloudflare Zero Trust

## 📁 关键文件

### 后端
- `api/src/routes/orders.ts` - 订单管理 API（完全基于 SDK）
- `api/src/routes/options.ts` - 期权相关 API（富途牛牛）
- `api/src/config/longport.ts` - Longbridge SDK 配置
- `api/src/config/futunn.ts` - 富途牛牛 API 配置
- `api/src/services/futunn-option-chain.service.ts` - 富途期权链服务
- `api/src/services/trading-recommendation.service.ts` - 交易推荐逻辑

### 前端
- `frontend/app/orders/page.tsx` - 统一订单管理页面
- `frontend/app/options/chain/page.tsx` - 期权链页面
- `frontend/app/options/[optionCode]/page.tsx` - 期权详情页
- `frontend/components/OptionTradeModal.tsx` - 期权交易模态框
- `frontend/lib/api.ts` - API 客户端

### 文档
- `README.md` - 项目主文档
- `CHANGELOG.md` - 更新日志
- `PROJECT_SUMMARY.md` - 项目总结
- `docs/` - 历史文档（已完成的计划文档）

## 🚀 快速启动

```bash
# 1. 配置环境变量
cp api/env.example api/.env
# 编辑 api/.env，填入 Longbridge API 密钥

# 2. 启动 API 服务
cd api && npm install && npm run dev

# 3. 启动前端服务
cd frontend && npm install && npm run dev
```

## 📝 API 端点摘要

### 订单管理（完全基于 SDK）
- `GET /api/orders/today` - 今日订单（支持筛选）
- `GET /api/orders/history` - 历史订单（支持时间范围）
- `GET /api/orders/:orderId` - 订单详情（包含中文翻译）
- `POST /api/orders/submit` - 提交订单
- `PUT /api/orders/:orderId` - 修改订单
- `DELETE /api/orders/:orderId` - 取消订单
- `GET /api/orders/estimate-max-quantity` - 预估最大购买数量

### 期权链（富途牛牛 API）
- `GET /api/options/strike-dates` - 获取期权到期日期列表
- `GET /api/options/chain` - 获取期权链数据
- `GET /api/options/detail` - 获取期权详情
- `GET /api/options/underlying-quote` - 获取正股行情

### 其他
- `GET /api/quote` - 实时行情（支持期权 Fallback）
- `GET /api/positions` - 持仓查询（支持期权）
- `GET /api/trading-recommendation` - 交易推荐

## 🔧 开发规范

1. **订单查询必须使用 SDK**，不要查询数据库
2. **数据映射必须使用 `mapOrderData()`**，确保格式统一
3. **枚举值必须转换为字符串**，符合 API 文档规范
4. **前端显示优先使用翻译字段**：`orderTypeText`, `outsideRthText`

## 📚 参考文档

- [Longbridge API 文档](https://open.longbridge.com/zh-CN/docs/trade/trade-definition)
- [Longbridge Node.js SDK](https://longportapp.github.io/openapi/nodejs/)

---

**最后更新**: 2025-01-28

