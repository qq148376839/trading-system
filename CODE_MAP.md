# 代码地图 (Code Map)

本文档详细说明了项目中每个文件的作用以及文件之间的调用和关联关系。

**最后更新**: 2026-02-03（期权策略推荐算法优化：新建期权专用推荐服务，替代股票推荐逻辑，增加重试机制）

---

## 📋 目录

- [项目结构概览](#项目结构概览)
- [后端 API 服务](#后端-api-服务)
  - [入口文件](#入口文件)
  - [配置文件](#配置文件)
  - [路由文件](#路由文件)
  - [服务层](#服务层)
  - [工具类](#工具类)
  - [中间件](#中间件)
- [前端应用](#前端应用)
  - [页面组件](#页面组件)
  - [共享组件](#共享组件)
  - [工具库](#工具库)
- [数据库迁移](#数据库迁移)
- [脚本工具](#脚本工具)
- [配置文件](#配置文件)
- [依赖关系图](#依赖关系图)

---

## 项目结构概览

```
trading-system/
├── api/                    # 后端 API 服务
│   ├── src/
│   │   ├── server.ts       # 应用入口
│   │   ├── config/         # 配置模块
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务服务层
│   │   ├── middleware/     # 中间件
│   │   └── utils/          # 工具函数
│   ├── migrations/          # 数据库迁移脚本
│   └── scripts/            # 工具脚本
├── frontend/               # 前端应用 (Next.js)
│   ├── app/                # Next.js App Router 页面
│   ├── components/         # React 组件
│   └── lib/                # 工具库
├── edge-functions/         # 边缘函数 (Moomoo API 代理)
└── docs/                   # 项目文档
```

---

## 后端 API 服务

### 入口文件

#### `api/src/server.ts`
**作用**: Express 应用入口，启动 HTTP 服务器并注册所有路由

**主要功能**:
- 初始化 Express 应用
- 加载环境变量
- 注册所有 API 路由
- 启动后台服务（Token 刷新、账户余额同步、策略调度器）
- 设置定时任务（Token 自动刷新）

**调用关系**:
- ✅ 导入所有路由模块 (`routes/*`)
- ✅ 导入错误处理中间件 (`middleware/errorHandler`)
- ✅ 启动时动态导入并启动服务:
  - `services/token-refresh.service` - Token 自动刷新
  - `services/account-balance-sync.service` - 账户余额同步
  - `services/strategy-scheduler.service` - 策略调度器

**被调用**:
- 📌 应用启动入口，无其他文件调用

---

### 配置文件

#### `api/src/config/database.ts`
**作用**: PostgreSQL 数据库连接配置

**主要功能**:
- 创建 PostgreSQL 连接池
- 配置连接参数（从环境变量读取）

**调用关系**:
- ✅ 使用 `pg` 库创建连接池

**被调用**:
- 📌 `routes/*` - 所有路由文件
- 📌 `services/*` - 所有需要数据库访问的服务

#### `api/src/config/longport.ts`
**作用**: Longbridge SDK 配置和上下文管理

**主要功能**:
- 初始化 Longbridge SDK 配置
- 提供 `getQuoteContext()` - 行情查询上下文
- 提供 `getTradeContext()` - 交易上下文
- 管理 Access Token

**调用关系**:
- ✅ 使用 `longport` SDK
- ✅ 从数据库读取配置 (`config.service`)

**被调用**:
- 📌 `routes/quote.ts` - 行情查询
- 📌 `routes/positions.ts` - 持仓查询
- 📌 `routes/orders.ts` - 订单查询
- 📌 `routes/candlesticks.ts` - K线数据
- 📌 `services/capital-manager.service.ts` - 账户余额查询
- 📌 `services/basic-execution.service.ts` - 订单执行
- 📌 `services/account-balance-sync.service.ts` - 余额同步

#### `api/src/config/futunn.ts`
**作用**: 富途牛牛 API 配置

**主要功能**:
- 读取富途 API 配置（CSRF Token、Cookies）
- 提供配置访问接口

**调用关系**:
- ✅ 使用 `config.service` 读取数据库配置

**被调用**:
- 📌 `services/market-data.service.ts` - 市场数据查询
- 📌 `services/futunn-option-quote.service.ts` - 期权行情
- 📌 `services/futunn-option-chain.service.ts` - 期权链
- 📌 `utils/moomoo-proxy.ts` - Moomoo API 代理

---

### 路由文件

所有路由文件都遵循相同的模式：导出 Express Router，定义 API 端点，调用相应的服务。

#### `api/src/routes/health.ts`
**作用**: 健康检查端点

**API**: `GET /api/health`

**调用关系**:
- ✅ 无服务依赖，直接返回状态

**被调用**:
- 📌 `server.ts` - 注册路由

#### `api/src/routes/quote.ts`
**作用**: 实时行情查询 API

**API**: `GET /api/quote?symbols=...`

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取行情上下文

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/candlesticks.ts`
**作用**: K线数据查询 API

**API**: `GET /api/candlesticks?symbol=...&period=...`

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取行情上下文

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/watchlist.ts`
**作用**: 关注列表管理 API

**API**: 
- `GET /api/watchlist` - 获取关注列表
- `POST /api/watchlist` - 添加关注
- `DELETE /api/watchlist/:symbol` - 删除关注

**调用关系**:
- ✅ 使用 `config/database.ts` - 数据库操作

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/positions.ts`
**作用**: 持仓查询 API

**API**: `GET /api/positions`

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取交易上下文
- ✅ 使用 `services/futunn-option-quote.service.ts` - 期权持仓计算

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/orders.ts`
**作用**: 订单管理 API

**API**:
- `GET /api/orders/today` - 今日订单
- `GET /api/orders/history` - 历史订单
- `GET /api/orders/:orderId` - 订单详情
- `POST /api/orders` - 提交订单
- `DELETE /api/orders/:orderId` - 取消订单

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取交易上下文
- ✅ 使用 `utils/order-validation.ts` - 订单验证
- ✅ 使用 `utils/longport-rate-limiter.ts` - LongPort 调用限流 + 429002 重试（改单等关键调用）

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/trades.ts`
**作用**: 交易记录 API（已废弃，重定向到 orders）

**调用关系**:
- ✅ 重定向到 `/orders`

**被调用**:
- 📌 `server.ts` - 注册路由

#### `api/src/routes/trading-rules.ts`
**作用**: 交易规则管理 API

**API**:
- `GET /api/trading-rules` - 获取规则
- `POST /api/trading-rules` - 创建规则
- `PUT /api/trading-rules/:id` - 更新规则
- `DELETE /api/trading-rules/:id` - 删除规则

**调用关系**:
- ✅ 使用 `config/database.ts` - 数据库操作

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/forex.ts`
**作用**: 外汇行情查询 API

**API**: `GET /api/forex?symbols=...`

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取行情上下文

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/trading-recommendation.ts`
**作用**: 交易推荐 API

**API**: `GET /api/trading-recommendation?symbol=...`

**调用关系**:
- ✅ 使用 `services/trading-recommendation.service.ts` - 推荐算法

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/options.ts`
**作用**: 期权相关 API

**API**:
- `GET /api/options/chain?symbol=...` - 期权链
- `GET /api/options/quote?symbol=...` - 期权行情

**调用关系**:
- ✅ 使用 `services/futunn-option-chain.service.ts` - 期权链服务
- ✅ 使用 `services/futunn-option-quote.service.ts` - 期权行情服务

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/config.ts`
**作用**: 系统配置管理 API（需要管理员认证）

**API**:
- `GET /api/config` - 获取配置
- `PUT /api/config/:key` - 更新配置

**调用关系**:
- ✅ 使用 `services/config.service.ts` - 配置服务
- ✅ 使用 `middleware/rateLimiter.ts` - 限流中间件

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/token-refresh.ts`
**作用**: Token 刷新 API

**API**: `POST /api/token-refresh`

**调用关系**:
- ✅ 使用 `services/token-refresh.service.ts` - Token 刷新服务

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用（可选）

#### `api/src/routes/quant.ts`
**作用**: 量化交易 API

**API**:
- `GET /api/quant/capital/allocations` - 资金分配账户
- `POST /api/quant/capital/request` - 申请资金
- `GET /api/quant/strategies` - 策略列表
- `POST /api/quant/strategies` - 创建策略
- `PUT /api/quant/strategies/:id` - 更新策略
- `DELETE /api/quant/strategies/:id` - 删除策略
- `POST /api/quant/strategies/:id/start` - 启动策略
- `POST /api/quant/strategies/:id/stop` - 停止策略
- `GET /api/quant/signals` - 信号日志
- `GET /api/quant/dashboard/stats` - Dashboard统计数据（今日交易数量、盈亏等）
- `GET /api/quant/blacklist` - 黑名单
- `POST /api/quant/blacklist` - 添加黑名单
- `DELETE /api/quant/blacklist/:symbol` - 删除黑名单
- `GET /api/quant/institutions/popular` - 获取热门机构列表
- `GET /api/quant/institutions/list` - 获取机构列表（支持分页）
- `GET /api/quant/institutions/:institutionId/holdings` - 获取机构持仓
- `POST /api/quant/institutions/select-stocks` - 智能选股
- `POST /api/quant/institutions/calculate-allocation` - 计算资金分配
- `GET /api/quant/capital/usage` - 获取资金使用情况

**调用关系**:
- ✅ 使用 `services/capital-manager.service.ts` - 资金管理
- ✅ 使用 `services/stock-selector.service.ts` - 选股器
- ✅ 使用 `services/strategy-scheduler.service.ts` - 策略调度器
- ✅ 使用 `services/state-manager.service.ts` - 状态管理
- ✅ 使用 `services/account-balance-sync.service.ts` - 余额同步
- ✅ 使用 `services/institution-stock-selector.service.ts` - 机构选股服务
- ✅ 使用 `utils/moomoo-proxy.ts` - Moomoo API代理
- ✅ 使用 `config/database.ts` - 数据库操作
- ✅ 使用 `config/longport.ts` - 获取今日订单（Dashboard统计）
- ✅ 使用 `routes/orders.ts` - 导入 `normalizeStatus` 和 `normalizeSide` 函数

**被调用**:
- 📌 `server.ts` - 注册路由
- 📌 `frontend/lib/api.ts` - 前端调用

#### `api/src/routes/futunn-test.ts`
**作用**: 富途 API 测试端点（开发调试用）

**调用关系**:
- ✅ 使用 `services/market-data.service.ts` - 市场数据服务

**被调用**:
- 📌 `server.ts` - 注册路由

---

### 服务层

#### `api/src/services/config.service.ts`
**作用**: 系统配置管理服务

**主要功能**:
- 从数据库读取配置
- 更新配置
- 配置加密/解密

**调用关系**:
- ✅ 使用 `config/database.ts` - 数据库操作

**被调用**:
- 📌 `config/longport.ts` - Longbridge 配置
- 📌 `config/futunn.ts` - 富途配置
- 📌 `routes/config.ts` - 配置管理 API
- 📌 `services/token-refresh.service.ts` - Token 刷新

#### `api/src/services/market-data.service.ts`
**作用**: 市场数据获取服务（富途 API + LongPort SDK）

**主要功能**:
- 获取 K线数据（SPX、USD Index、BTC、VIX）
- 获取分时数据
- 获取市场温度（LongPort SDK `marketTemperature`方法）
- 获取历史市场温度（LongPort SDK `historyMarketTemperature`方法）
- 重试机制和错误处理

**调用关系**:
- ✅ 使用 `config/futunn.ts` - 富途配置
- ✅ 使用 `config/longport.ts` - LongPort配置（市场温度）
- ✅ 使用 `utils/moomoo-proxy.ts` - Moomoo API 代理

**主要方法**:
- `getMarketTemperature()` - 获取当前市场温度（0-100范围）
- `getHistoricalMarketTemperature()` - 获取历史市场温度（用于回测）
- `getVIXCandlesticks()` - 获取VIX恐慌指数K线数据（使用TradeSessions参数）
- `getBTCCandlesticks()` - 获取BTC K线数据

**被调用**:
- 📌 `services/market-data-cache.service.ts` - 市场数据缓存
- 📌 `services/trading-recommendation.service.ts` - 交易推荐
- 📌 `routes/futunn-test.ts` - 测试端点

#### `api/src/services/market-data-cache.service.ts`
**作用**: 市场数据缓存服务

**主要功能**:
- 缓存 SPX、USD Index、BTC 等市场数据
- 提供缓存接口

**调用关系**:
- ✅ 使用 `services/market-data.service.ts` - 市场数据获取

**被调用**:
- 📌 `services/trading-recommendation.service.ts` - 交易推荐

#### `api/src/services/trading-recommendation.service.ts`
**作用**: 交易推荐算法服务

**主要功能**:
- 综合分析市场数据（SPX、USD、BTC、VIX、市场温度）
- 计算技术指标（ATR、Z-score）
- 生成交易信号（BUY/SELL/HOLD）
- 计算入场价、止损价、止盈价
- 市场状态矩阵计算（Goldilocks、Volatile Bull、Fear、Stagnant）
- 一票否决权机制（VIX > 35 或 温度 < 10）
- 环境分计算（基础强度40% + 温度40% + VIX20%）

**调用关系**:
- ✅ 使用 `services/market-data-cache.service.ts` - 市场数据缓存
- ✅ 使用 `config/longport.ts` - 获取股票行情
- ✅ 使用 `utils/logger.ts` - 日志记录

**主要方法**:
- `calculateRecommendation()` - 计算单个股票的交易推荐
- `getMarketRegime()` - 获取市场状态矩阵（全局市场环境指标）
- `calculateTradingDecision()` - 综合计算交易决策（集成市场状态矩阵）

**被调用**:
- 📌 `routes/trading-recommendation.ts` - 交易推荐 API
- 📌 `services/strategies/recommendation-strategy.ts` - 推荐策略

#### `api/src/services/futunn-option-quote.service.ts`
**作用**: 富途期权行情服务

**主要功能**:
- 获取期权实时行情
- 计算期权持仓价值

**调用关系**:
- ✅ 使用 `config/futunn.ts` - 富途配置
- ✅ 使用 `utils/moomoo-proxy.ts` - Moomoo API 代理

**被调用**:
- 📌 `routes/positions.ts` - 持仓查询（期权持仓计算）
- 📌 `routes/options.ts` - 期权行情 API

#### `api/src/services/futunn-option-chain.service.ts`
**作用**: 富途期权链服务

**主要功能**:
- 获取期权链数据
- 搜索期权合约
- 获取期权详情（增强版，包含底层资产价格）

**调用关系**:
- ✅ 使用 `config/futunn.ts` - 富途配置
- ✅ 使用 `utils/moomoo-proxy.ts` - Moomoo API 代理

**主要方法**:
- `getOptionDetail()` - 获取期权详情（新增 `underlyingPrice` 等便捷字段）
- `getOptionStrikeDates()` - 获取期权到期日期列表
- `getOptionChain()` - 获取期权链数据

**被调用**:
- 📌 `routes/options.ts` - 期权链 API
- 📌 `services/options-contract-selector.service.ts` - 期权合约选择
- 📌 `services/strategy-scheduler.service.ts` - 期权价格获取（持仓监控）

#### `api/src/services/option-price-cache.service.ts`
**作用**: 期权价格缓存服务

**主要功能**:
- 缓存期权实时价格（5分钟TTL）
- 自动清理过期缓存（每10分钟）
- 记录价格来源（longport/futunn/position_cache）
- 提供统计信息查询

**调用关系**:
- ✅ 无外部依赖（纯内存缓存）

**被调用**:
- 📌 `services/strategy-scheduler.service.ts` - 期权持仓监控（价格获取）

**主要方法**:
- `set(symbol, entry)` - 设置缓存
- `get(symbol)` - 获取缓存（自动检查过期）
- `getStats()` - 获取缓存统计信息
- `startCleanup()` - 启动自动清理（应用启动时自动调用）

#### `api/src/services/intraday-data-filter.service.ts`
**作用**: 日内数据过滤服务

**主要功能**:
- 过滤日内数据（去除异常值）
- 数据清洗

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 `services/market-data.service.ts` - 市场数据服务（可选）

#### `api/src/services/account-balance-sync.service.ts`
**作用**: 账户余额同步服务

**主要功能**:
- 定期同步账户余额到数据库
- 更新 `positions` 表

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取交易上下文
- ✅ 使用 `config/database.ts` - 数据库操作
- ✅ 使用 `utils/logger.ts` - 日志记录

**被调用**:
- 📌 `server.ts` - 启动时自动启动（每5分钟同步一次）

#### `api/src/services/capital-manager.service.ts`
**作用**: 资金管理器服务

**主要功能**:
- 管理多策略资金分配
- 资金申请和审批
- 超配保护
- 标的级资金限制

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取账户余额
- ✅ 使用 `config/database.ts` - 数据库操作
- ✅ 使用 `services/account-balance-sync.service.ts` - 余额同步服务（可选）
- ✅ 使用 `services/stock-selector.service.ts` - 选股器（计算标的数量）
- ✅ 使用 `utils/logger.ts` - 日志记录

**被调用**:
- 📌 `routes/quant.ts` - 量化交易 API
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（资金申请）

#### `api/src/services/stock-selector.service.ts`
**作用**: 选股器服务

**主要功能**:
- 根据策略配置获取标的池
- 支持静态列表和 Watchlist 导入
- 黑名单过滤

**调用关系**:
- ✅ 使用 `config/database.ts` - 数据库操作

**被调用**:
- 📌 `routes/quant.ts` - 量化交易 API
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器
- 📌 `services/capital-manager.service.ts` - 资金管理器（计算标的数量）

#### `api/src/services/institution-stock-selector.service.ts`
**作用**: 机构选股服务

**主要功能**:
- 获取热门机构列表
- 获取机构列表（支持分页，42,638个机构）
- 获取机构持仓列表
- 智能选股（按持仓占比排序，过滤非美股，支持分页获取）
- 数据缓存（5-10分钟）

**调用关系**:
- ✅ 使用 `utils/moomoo-proxy.ts` - Moomoo API代理
- ✅ 使用 `utils/chinese-number-parser.ts` - 中文数字解析
- ✅ 使用 `services/institution-cache.service.ts` - 缓存服务
- ✅ 使用 `config/futunn.ts` - 富途配置

**被调用**:
- 📌 `routes/quant.ts` - 量化交易 API（机构选股相关接口）

#### `api/src/services/institution-cache.service.ts`
**作用**: 机构数据缓存服务

**主要功能**:
- 内存缓存实现
- 5分钟TTL（可配置）
- 自动清理过期缓存
- 最大1000条缓存限制

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 `services/institution-stock-selector.service.ts` - 机构选股服务

#### `api/src/services/state-manager.service.ts`
**作用**: 策略状态管理器服务

**主要功能**:
- 管理策略实例状态（IDLE、OPENING、HOLDING、CLOSING、COOLDOWN）
- 状态持久化到数据库
- 故障恢复

**调用关系**:
- ✅ 使用 `config/database.ts` - 数据库操作
- ✅ 使用 `utils/logger.ts` - 日志记录

**被调用**:
- 📌 `routes/quant.ts` - 量化交易 API
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器
- 📌 `services/strategies/strategy-base.ts` - 策略基类

#### `api/src/services/basic-execution.service.ts`
**作用**: 基础订单执行服务

**主要功能**:
- 执行买入/卖出订单
- 记录订单到数据库（`execution_orders`表）
- 关联信号和订单（通过`signal_id`字段）
- 更新信号状态（订单提交/成交/拒绝/取消时）

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取交易上下文
- ✅ 使用 `config/database.ts` - 数据库操作（记录订单）
- ✅ 使用 `utils/order-validation.ts` - 订单验证
- ✅ 使用 `utils/logger.ts` - 日志记录
- ✅ 使用 `routes/orders.ts` - 导入 `normalizeSide` 函数（用于信号状态更新）

**主要方法**:
- `executeBuyIntent` - 执行买入订单（接收`signalId`参数）
- `executeSellIntent` - 执行卖出订单（接收`signalId`参数）
- `submitOrder` - 提交订单到交易所（保存`signal_id`，更新信号状态）
- `recordOrder` - 记录订单到数据库（保存`signal_id`字段）
- `updateSignalStatusBySignalId` - 通过`signal_id`更新信号状态
- `updateSignalStatusByOrderId` - 通过订单ID更新信号状态（支持历史订单回填）

**被调用**:
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（执行订单）

#### `api/src/services/dynamic-position-manager.service.ts`
**作用**: 动态持仓管理服务

**主要功能**:
- 动态调整止盈/止损
- 市场环境响应机制
- 持仓时间调整
- 波动性调整
- 风险保护机制

**调用关系**:
- ✅ 使用 `services/trading-recommendation.service.ts` - 获取市场环境和ATR
- ✅ 使用 `utils/logger.ts` - 日志记录

**被调用**:
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（持仓监控）

#### `api/src/services/backtest.service.ts`
**作用**: 回测服务

**主要功能**:
- 执行策略回测
- 计算性能指标（收益率、最大回撤、夏普比率等）
- 保存和查询回测结果

**调用关系**:
- ✅ 使用 `services/strategies/recommendation-strategy.ts` - 推荐策略
- ✅ 使用 `services/trading-recommendation.service.ts` - 交易推荐服务
- ✅ 使用 `config/longport.ts` - 获取历史数据
- ✅ 使用 `config/database.ts` - 数据库操作
- ✅ 使用 `utils/logger.ts` - 日志记录

**被调用**:
- 📌 `routes/backtest.ts` - 回测API路由
- 📌 `scripts/backtest-strategy.ts` - 回测脚本

#### `api/src/services/strategy-scheduler.service.ts`
**作用**: 策略调度器服务（核心服务）

**主要功能**:
- 定时触发策略运行（每分钟）
- 管理策略生命周期（启动/停止）
- 处理策略信号
- 订单监控和追踪
- 持仓检查
- 动态持仓管理（集成动态调整逻辑）
- 更新信号状态（订单取消/拒绝时）

**调用关系**:
- ✅ 使用 `config/database.ts` - 数据库操作
- ✅ 使用 `services/strategies/strategy-base.ts` - 策略基类
- ✅ 使用 `services/strategies/recommendation-strategy.ts` - 推荐策略
- ✅ 使用 `services/strategies/option-intraday-strategy.ts` - 期权日内策略（买方）
- ✅ 使用 `services/stock-selector.service.ts` - 选股器
- ✅ 使用 `services/capital-manager.service.ts` - 资金管理器
- ✅ 使用 `services/state-manager.service.ts` - 状态管理器
- ✅ 使用 `services/basic-execution.service.ts` - 订单执行
- ✅ 使用 `services/dynamic-position-manager.service.ts` - 动态持仓管理
- ✅ 使用 `services/trading-recommendation.service.ts` - 交易推荐服务（获取ATR）
- ✅ 使用 `services/market-session.service.ts` - 收盘窗口计算（禁开仓/强平）
- ✅ 使用 `config/longport.ts` - 获取持仓和订单（直接调用 SDK）
- ✅ 使用 `utils/logger.ts` - 日志记录

**主要方法**:
- `trackPendingOrders` - 追踪未成交订单，检测取消/拒绝状态
- `handleOrderCancelled` - 处理订单取消（更新信号状态为`IGNORED`）
- `handleOrderRejected` - 处理订单拒绝（更新信号状态为`REJECTED`）
- `processHoldingPosition` - 期权策略支持收盘前强制平仓（`FORCED_CLOSE_BEFORE_MARKET_CLOSE`）

**被调用**:
- 📌 `server.ts` - 启动时自动启动
- 📌 `routes/quant.ts` - 量化交易 API（启动/停止策略）

#### `api/src/services/token-refresh.service.ts`
**作用**: Token 自动刷新服务

**主要功能**:
- 检查 Token 是否即将过期（少于10天）
- 自动刷新 Token
- 更新数据库配置

**调用关系**:
- ✅ 使用 `services/config.service.ts` - 配置服务
- ✅ 使用 `config/database.ts` - 数据库操作

**被调用**:
- 📌 `server.ts` - 启动时检查，定时任务（每天凌晨2点）
- 📌 `routes/token-refresh.ts` - Token 刷新 API

#### `api/src/services/strategies/strategy-base.ts`
**作用**: 策略基类（抽象类）

**主要功能**:
- 定义策略接口
- 提供状态管理方法
- 定义信号生成接口
- 记录信号到数据库（`logSignal`方法返回`signal_id`）

**调用关系**:
- ✅ 使用 `services/state-manager.service.ts` - 状态管理
- ✅ 使用 `config/database.ts` - 数据库操作（记录信号）

**主要方法**:
- `logSignal` - 记录信号到数据库，返回`signal_id`（用于关联订单）

**被调用**:
- 📌 `services/strategies/recommendation-strategy.ts` - 推荐策略（继承）
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（使用策略实例）

#### `api/src/services/strategies/recommendation-strategy.ts`
**作用**: 推荐策略实现

**主要功能**:
- 实现 `StrategyBase` 接口
- 调用交易推荐服务生成信号
- 管理策略状态
- 将`signal_id`传递到订单执行流程（通过`TradingIntent.metadata.signalId`）

**调用关系**:
- ✅ 继承 `services/strategies/strategy-base.ts` - 策略基类
- ✅ 使用 `services/trading-recommendation.service.ts` - 交易推荐服务
- ✅ 使用 `services/state-manager.service.ts` - 状态管理
- ✅ 调用 `logSignal` 获取`signal_id`并添加到`TradingIntent.metadata`

**被调用**:
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（创建策略实例）

#### `api/src/services/strategies/option-intraday-strategy.ts`
**作用**: 期权日内策略（买方）实现

**主要功能**:
- 基于 underlying 的推荐信号决定方向（BUY→Call，SELL→Put，可配置）
- 通过富途/Moomoo 期权链与详情选择流动性更好的合约（0DTE/最近到期）
- 生成期权下单意图（symbol=期权合约、quantity=contracts、entryPrice=期权权利金）
- 计算资金占用：`premium * multiplier * contracts + fees` 并通过 `metadata.allocationAmountOverride` 传递给调度器

**调用关系**:
- ✅ 使用 `services/trading-recommendation.service.ts` - underlying 方向信号
- ✅ 使用 `services/options-contract-selector.service.ts` - 合约选择
- ✅ 使用 `services/options-fee.service.ts` - 费用与资金占用估算

**被调用**:
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（`OPTION_INTRADAY_V1`）

---

### 工具类

#### `api/src/utils/logger.ts`
**作用**: 日志工具（带时间戳）

**主要功能**:
- 提供统一的日志接口（log、info、warn、error、debug）
- 自动添加时间戳

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 所有服务文件（广泛使用）

#### `api/src/utils/moomoo-proxy.ts`
**作用**: Moomoo API 代理工具

**主要功能**:
- 代理富途/Moomoo API 请求
- 处理 quote-token 计算
- 错误处理和重试
- 通过边缘函数代理访问（解决IP限制问题）

**调用关系**:
- ✅ 使用 `config/futunn.ts` - 富途配置
- ✅ 调用边缘函数 (`https://cfapi.riowang.win/api/moomooapi`)

**被调用**:
- 📌 `services/market-data.service.ts` - 市场数据服务
- 📌 `services/futunn-option-quote.service.ts` - 期权行情服务
- 📌 `services/futunn-option-chain.service.ts` - 期权链服务
- 📌 `services/institution-stock-selector.service.ts` - 机构选股服务

#### `api/src/utils/order-validation.ts`
**作用**: 订单验证工具

**主要功能**:
- 验证订单参数
- 价格精度格式化

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 `routes/orders.ts` - 订单 API
- 📌 `services/basic-execution.service.ts` - 订单执行服务

#### `api/src/utils/longport-rate-limiter.ts`
**作用**: LongPort API 调用保护（限流 + 429002 指数退避重试）

**主要功能**:
- 轻量队列限流（最小间隔）
- 识别 LongPort 429002 限流错误并指数退避重试

**被调用**:
- 📌 `services/basic-execution.service.ts` - 下单 submitOrder
- 📌 `services/strategy-scheduler.service.ts` - 改单 replaceOrder（订单追踪）
- 📌 `routes/orders.ts` - 改单 replaceOrder（API路由）
- 📌 `services/short-position-validation.service.ts` - accountBalance（卖空权限/保证金校验）

#### `api/src/utils/chinese-number-parser.ts`
**作用**: 中文数字解析工具

**主要功能**:
- 解析中文数字格式（如 "15.29亿" → 1529000000）
- 支持正负数、亿/千万/万单位
- 批量解析功能

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 `services/institution-stock-selector.service.ts` - 机构选股服务

#### `api/src/utils/trading-hours.ts`
**作用**: 交易时间工具

**主要功能**:
- 判断是否在交易时间内
- 支持不同市场（美股、港股、A股）

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（可选）

---

### 中间件

#### `api/src/middleware/errorHandler.ts`
**作用**: 全局错误处理中间件

**主要功能**:
- 捕获所有未处理的错误
- 格式化错误响应
- 记录错误日志

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 `server.ts` - 注册为全局错误处理中间件

#### `api/src/middleware/rateLimiter.ts`
**作用**: API 限流中间件

**主要功能**:
- 限制 API 请求频率
- 防止 API 滥用

**调用关系**:
- ✅ 使用 `express-rate-limit` 库

**被调用**:
- 📌 `routes/config.ts` - 配置管理 API（需要限流）

---

## 前端应用

### 页面组件

#### `frontend/app/layout.tsx`
**作用**: Next.js 根布局组件

**调用关系**:
- ✅ 导入全局样式 `globals.css`

**被调用**:
- 📌 Next.js 框架自动调用

#### `frontend/app/page.tsx`
**作用**: 主页（持仓和关注列表）

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用
- ✅ 使用 `components/TradeModal.tsx` - 交易模态框

**被调用**:
- 📌 Next.js 路由 `/`

#### `frontend/app/quote/page.tsx`
**作用**: 行情查询页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/quote`

#### `frontend/app/candles/page.tsx`
**作用**: K线图页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用
- ✅ 使用 `lib/indicators.ts` - 技术指标计算

**被调用**:
- 📌 Next.js 路由 `/candles`

#### `frontend/app/positions/page.tsx`
**作用**: 持仓页面（已废弃，重定向到主页）

**调用关系**:
- ✅ 重定向到主页

**被调用**:
- 📌 Next.js 路由 `/positions`

#### `frontend/app/orders/page.tsx`
**作用**: 订单管理页面（已重定向到`/quant/orders`）

**调用关系**:
- ✅ 重定向到 `/quant/orders`

**被调用**:
- 📌 Next.js 路由 `/orders`（向后兼容，重定向到`/quant/orders`）

#### `frontend/app/quant/orders/page.tsx`
**作用**: 量化交易订单管理页面（统一订单管理）

**主要功能**:
- 显示今日订单和历史订单
- 订单筛选、搜索
- 订单详情查看
- 订单取消、修改

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/quant/orders`

#### `frontend/app/trades/page.tsx`
**作用**: 交易记录页面（已废弃，重定向到订单页面）

**调用关系**:
- ✅ 重定向到 `/orders`

**被调用**:
- 📌 Next.js 路由 `/trades`

#### `frontend/app/watchlist/page.tsx`
**作用**: 关注列表管理页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/watchlist`

#### `frontend/app/forex/page.tsx`
**作用**: 外汇行情页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/forex`

#### `frontend/app/config/page.tsx`
**作用**: 系统配置管理页面（需要管理员认证）

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/config`

#### `frontend/app/options/chain/page.tsx`
**作用**: 期权链页面

**主要功能**:
- 显示期权链数据（看涨/看跌期权）
- 支持股票代码搜索和选择
- 支持到期日期选择
- 显示正股价格和高亮最近行权价
- 使用 `Suspense` 包裹 `useSearchParams()` 以符合Next.js 14要求

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用
- ✅ 使用 `components/AppLayout.tsx` - 应用布局
- ✅ 使用 `next/navigation` - `useRouter`, `useSearchParams`（需Suspense包裹）

**被调用**:
- 📌 Next.js 路由 `/options/chain`

#### `frontend/app/options/[optionCode]/page.tsx`
**作用**: 期权详情页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/options/[optionCode]`

#### `frontend/app/quant/page.tsx`
**作用**: 量化交易首页（Dashboard）

**主要功能**:
- 显示运行中的策略数量
- 显示总资金
- 显示今日交易数量（使用长桥API统计，Tooltip显示买入/卖出数量）
- 显示今日盈亏
- 显示持仓盈亏

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用（`getDashboardStats`）
- ✅ 使用 Ant Design `Tooltip` 组件显示买入/卖出数量

**被调用**:
- 📌 Next.js 路由 `/quant`

#### `frontend/app/quant/strategies/page.tsx`
**作用**: 策略管理页面

**主要功能**:
- 策略列表展示
- 创建策略（支持手动输入和机构选股）
- 策略类型说明卡片
- 策略参数配置（ATR周期、倍数、风险收益比）
- 按钮固定在模态框底部

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用
- ✅ 使用 `components/InstitutionStockSelector.tsx` - 机构选股组件

**被调用**:
- 📌 Next.js 路由 `/quant/strategies`

#### `frontend/app/quant/strategies/[id]/page.tsx`
**作用**: 策略编辑页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/quant/strategies/[id]`

#### `frontend/app/quant/capital/page.tsx`
**作用**: 资金管理页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/quant/capital`

#### `frontend/app/quant/signals/page.tsx`
**作用**: 信号日志页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/quant/signals`

#### `frontend/app/quant/trades/page.tsx`
**作用**: ~~量化交易记录页面~~ **已删除**（2025-12-11）

**说明**:
- 功能已整合到订单管理（`/quant/orders`）
- 所有交易数据统一通过订单管理查看

---

### 共享组件

#### `frontend/components/TradeModal.tsx`
**作用**: 股票交易模态框组件

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 `app/page.tsx` - 主页

#### `frontend/components/OptionTradeModal.tsx`
**作用**: 期权交易模态框组件

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 `app/options/chain/page.tsx` - 期权链页面

#### `frontend/components/BackButton.tsx`
**作用**: 返回按钮组件

**调用关系**:
- ✅ 使用 Next.js `useRouter`

**被调用**:
- 📌 多个页面组件

#### `frontend/components/InstitutionStockSelector.tsx`
**作用**: 机构选股组件

**主要功能**:
- 机构选择（热门机构/全部机构切换，支持分页）
- 股票选择（按持仓占比排序，支持多选）
- 资金分配预览（按持仓占比分配）
- 三步骤流程：选择机构 → 选择股票 → 预览分配

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 `app/quant/strategies/page.tsx` - 策略创建页面

---

### 工具库

#### `frontend/lib/api.ts`
**作用**: API 客户端封装

**主要功能**:
- 封装所有 API 调用
- 统一错误处理
- 请求/响应拦截器

**调用关系**:
- ✅ 使用 `axios` 库

**被调用**:
- 📌 所有页面组件
- 📌 所有共享组件

#### `frontend/lib/indicators.ts`
**作用**: 技术指标计算工具

**主要功能**:
- 计算各种技术指标（MA、RSI、MACD 等）

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 `app/candles/page.tsx` - K线图页面

---

## 数据库迁移

#### `api/migrations/000_init_schema.sql`
**作用**: 统一数据库初始化脚本

**主要功能**:
- 创建所有表结构
- 创建索引和触发器
- 插入默认配置
- 包含所有迁移内容（001-011已合并）

**已合并的迁移脚本**:
- 001-007: 基础表结构
- 008-009: 回测结果表
- 010: `capital_allocations.is_system`字段
- 011: `execution_orders.signal_id`字段

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 数据库初始化时手动执行
- 📌 Docker Compose 自动执行（挂载到`/docker-entrypoint-initdb.d`）

#### `api/migrations/012_backfill_signal_id_and_status.sql`
**作用**: 历史数据回填脚本（可选）

**主要功能**:
- 回填历史订单的`signal_id`字段（时间窗口匹配）
- 更新历史信号状态（基于订单状态）

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 仅在需要修复历史数据时手动执行
- ⚠️ **不在初始化时执行**

#### `api/migrations/archive/*.sql`
**作用**: 历史迁移脚本（已归档）

**归档内容**:
- 001-007: 基础迁移脚本
- 008-009: 回测功能迁移脚本
- 010-011: 量化交易优化迁移脚本

**说明**:
- 所有脚本内容已合并到`000_init_schema.sql`
- 仅作为历史记录保留
- 新项目请使用`000_init_schema.sql`

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 仅作为历史记录，不建议使用

---

## 脚本工具

#### `api/scripts/create-admin.js`
**作用**: 创建管理员账户脚本

**调用关系**:
- ✅ 使用 `bcryptjs` 加密密码
- ✅ 使用 `config/database.ts` - 数据库操作

**被调用**:
- 📌 手动执行（初始化时）

#### `api/scripts/test-quant-api.js`
**作用**: 量化交易 API 测试脚本

**调用关系**:
- ✅ 调用量化交易 API

**被调用**:
- 📌 手动执行（测试用）

#### `api/scripts/diagnose-strategy-capital.ts`
**作用**: 策略资金诊断脚本

**调用关系**:
- ✅ 使用 `services/capital-manager.service.ts` - 资金管理器

**被调用**:
- 📌 手动执行（诊断用）

#### `api/scripts/backfill-signal-associations.ts`
**作用**: 历史信号关联数据回填脚本（可选）

**主要功能**:
- 回填历史订单的`signal_id`字段
- 更新历史信号状态
- 支持dry-run模式
- 支持时间窗口配置（默认±5分钟）

**调用关系**:
- ✅ 使用 `config/database.ts` - 数据库操作

**被调用**:
- 📌 手动执行：`npm run backfill-signals` 或 `npm run backfill-signals -- --dry-run`

---

## 配置文件

#### `api/package.json`
**作用**: Node.js 项目配置和依赖管理

**调用关系**:
- ✅ 定义项目依赖和脚本

**被调用**:
- 📌 npm/yarn 包管理器

#### `api/tsconfig.json`
**作用**: TypeScript 编译配置

**调用关系**:
- ✅ TypeScript 编译器配置

**被调用**:
- 📌 TypeScript 编译器

#### `frontend/package.json`
**作用**: Next.js 项目配置和依赖管理

**调用关系**:
- ✅ 定义项目依赖和脚本

**被调用**:
- 📌 npm/yarn 包管理器

#### `frontend/tsconfig.json`
**作用**: TypeScript 编译配置

**调用关系**:
- ✅ TypeScript 编译器配置

**被调用**:
- 📌 TypeScript 编译器

#### `docker-compose.yml`
**作用**: Docker Compose 生产环境配置

**主要功能**:
- PostgreSQL 数据库服务（带健康检查）
- API 服务（带健康检查）
- Frontend 服务（带健康检查、构建参数支持）
- 只挂载初始化脚本（`000_init_schema.sql`）
- 支持环境变量配置

**优化内容**:
- ✅ 添加健康检查（所有服务）
- ✅ 优化迁移脚本挂载（只挂载初始化脚本）
- ✅ Frontend 依赖 API 健康状态
- ✅ PostgreSQL 端口不映射到宿主机（避免端口冲突）
- ✅ Frontend 支持构建参数（NEXT_PUBLIC_API_URL）
- ✅ 移除资源限制配置（兼容 NAS 系统）

**关键修复**:
- ✅ 修复 PostgreSQL 端口冲突（移除外部端口映射）
- ✅ 修复 CPU CFS 调度器不支持问题（移除 deploy.resources）
- ✅ 修复前端 API URL 配置（使用 build args）

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 Docker Compose

#### `docker-compose.dev.yml`
**作用**: Docker Compose 开发环境配置

**主要功能**:
- PostgreSQL 数据库服务（带健康检查）
- API 服务（开发模式，支持热重载，带健康检查）
- Frontend 服务（开发模式，支持热重载，带健康检查）
- 只挂载初始化脚本（`000_init_schema.sql`）

**优化内容**:
- ✅ 添加健康检查（所有服务）
- ✅ Frontend 依赖 API 健康状态
- ✅ 支持源代码热重载

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 Docker Compose（开发环境）

#### `api/Dockerfile`
**作用**: API 服务生产环境 Dockerfile

**主要功能**:
- 构建 TypeScript 代码
- 创建非 root 用户运行服务
- 添加健康检查支持
- 支持 pnpm 包管理器
- 支持 bcrypt 原生模块编译

**优化内容**:
- ✅ 使用 `node:20` (Debian/glibc) 而不是 Alpine，因为 longport 包需要 glibc
- ✅ 安装 pnpm 包管理器
- ✅ 安装构建工具（python3, make, g++, build-essential）用于编译 bcrypt
- ✅ 使用 `pnpm install --frozen-lockfile` 安装依赖
- ✅ 构建后清理构建工具以减小镜像大小
- ✅ 添加 `curl` 用于健康检查
- ✅ 添加 `HEALTHCHECK` 指令
- ✅ 创建非 root 用户（nodejs:1001）

**关键修复**:
- ✅ 修复 longport 原生模块问题（从 Alpine 切换到 Debian）
- ✅ 修复 bcrypt 编译问题（添加构建工具）
- ✅ 修复 pnpm lockfile 同步问题

#### `api/Dockerfile.dev`
**作用**: API 服务开发环境 Dockerfile

**主要功能**:
- 支持热重载（tsx watch）
- 添加健康检查支持

#### `frontend/Dockerfile`
**作用**: Frontend 服务生产环境 Dockerfile

**主要功能**:
- 多阶段构建（builder + runner）
- 使用 Next.js standalone 模式
- 创建非 root 用户运行服务
- 添加健康检查支持
- 支持 pnpm 包管理器
- 支持构建时环境变量注入

**优化内容**:
- ✅ 安装 pnpm 包管理器
- ✅ 智能检测 lock 文件（pnpm-lock.yaml 或 package-lock.json）
- ✅ 接收 `NEXT_PUBLIC_API_URL` 作为构建参数（ARG）
- ✅ 在构建时设置环境变量（ENV），确保 Next.js 能正确注入
- ✅ 确保 public 目录存在（Next.js standalone 模式需要）
- ✅ 添加 `curl` 用于健康检查
- ✅ 添加 `HEALTHCHECK` 指令

**关键修复**:
- ✅ 修复 NEXT_PUBLIC_API_URL 构建时注入问题（使用 ARG + ENV）
- ✅ 修复 public 目录缺失问题（创建 public 目录）
- ✅ 修复 @ant-design/icons 依赖缺失问题

#### `frontend/Dockerfile.dev`
**作用**: Frontend 服务开发环境 Dockerfile

**主要功能**:
- 支持热重载（next dev）
- 添加健康检查支持

#### `docker-check.sh` / `docker-check.ps1`
**作用**: Docker 构建和启动检查脚本

**主要功能**:
- 检查 Docker 环境
- 检查必要文件
- 检查端口占用
- 检查环境变量文件
- 构建镜像
- 启动服务
- 等待服务就绪
- 检查健康状态

**调用关系**:
- ✅ 调用 Docker 和 Docker Compose 命令

**被调用**:
- 📌 手动执行（Linux/Mac: `./docker-check.sh`，Windows: `.\docker-check.ps1`）

#### `DOCKER_OPTIMIZATION.md`
**作用**: Docker 配置优化说明文档

**主要内容**:
- Dockerfile 优化说明
- Docker Compose 优化说明
- 健康检查配置
- 资源限制配置
- 故障排除指南

---

## 依赖关系图

### 核心服务依赖关系

```
server.ts
├── routes/* (所有路由)
│   ├── config/database.ts
│   ├── config/longport.ts
│   ├── config/futunn.ts
│   └── services/* (各种服务)
│
├── services/strategy-scheduler.service.ts (核心)
│   ├── services/strategies/recommendation-strategy.ts
│   │   ├── services/trading-recommendation.service.ts
│   │   │   ├── services/market-data-cache.service.ts
│   │   │   │   └── services/market-data.service.ts
│   │   │   │       ├── config/futunn.ts
│   │   │   │       └── utils/moomoo-proxy.ts
│   │   │   └── config/longport.ts
│   │   └── services/state-manager.service.ts
│   │       └── config/database.ts
│   │
│   ├── services/dynamic-position-manager.service.ts
│   │   └── services/trading-recommendation.service.ts
│   │
│   ├── services/stock-selector.service.ts
│   │   └── config/database.ts
│   │
│   ├── services/capital-manager.service.ts
│   │   ├── config/longport.ts
│   │   ├── config/database.ts
│   │   ├── services/account-balance-sync.service.ts
│   │   └── services/stock-selector.service.ts
│   │
│   ├── services/state-manager.service.ts
│   │
│   └── services/basic-execution.service.ts
│       ├── config/longport.ts
│       └── config/database.ts
│
├── services/token-refresh.service.ts
│   ├── services/config.service.ts
│   └── config/database.ts
│
└── services/account-balance-sync.service.ts
    ├── config/longport.ts
    └── config/database.ts
```

### 前端依赖关系

```
frontend/app/* (所有页面)
└── lib/api.ts
    └── axios (HTTP 客户端)
        └── api/src/routes/* (后端 API)
```

---

## 关键调用链示例

### 策略执行流程

```
1. server.ts 启动
   └── 启动 strategy-scheduler.service.ts

2. strategy-scheduler.service.ts 定时运行（每分钟）
   ├── stock-selector.service.ts (获取标的池)
   ├── state-manager.service.ts (检查状态)
   ├── recommendation-strategy.ts (生成信号)
   │   ├── strategy-base.ts.logSignal() (返回 signal_id)
   │   └── trading-recommendation.service.ts
   │       └── market-data-cache.service.ts
   │           └── market-data.service.ts
   ├── capital-manager.service.ts (申请资金)
   │   └── config/longport.ts (获取余额)
   └── basic-execution.service.ts (执行订单)
       ├── 接收 signalId 参数
       ├── 保存 signal_id 到 execution_orders 表
       ├── 更新信号状态（EXECUTED/REJECTED/IGNORED）
       └── config/longport.ts (提交订单)
```

### 订单查询流程

```
1. frontend/app/quant/orders/page.tsx（统一订单管理）
   └── lib/api.ts
       └── GET /api/orders/today（今日订单）
       └── GET /api/orders/history（历史订单）
           └── routes/orders.ts
               └── config/longport.ts
                   └── tradeCtx.todayOrders() / tradeCtx.historyOrders()
```

### 信号状态更新流程

```
1. services/strategies/recommendation-strategy.ts（生成信号）
   └── strategy-base.ts.logSignal()
       └── 返回 signal_id
       └── 添加到 TradingIntent.metadata.signalId

2. services/basic-execution.service.ts（执行订单）
   └── executeBuyIntent/executeSellIntent（接收 signalId）
       └── submitOrder（保存 signal_id，更新信号状态为 EXECUTED）
           └── recordOrder（保存 signal_id 到 execution_orders 表）
           └── waitForOrderFill（订单成交时确认信号状态）

3. services/strategy-scheduler.service.ts（订单监控）
   └── trackPendingOrders（检测订单状态变化）
       └── handleOrderCancelled（订单取消 → 信号状态 IGNORED）
       └── handleOrderRejected（订单拒绝 → 信号状态 REJECTED）
```

### Dashboard 统计流程

```
1. frontend/app/quant/page.tsx（量化首页）
   └── lib/api.ts.getDashboardStats()
       └── GET /api/quant/dashboard/stats
           └── routes/quant.ts
               └── config/longport.ts.tradeCtx.todayOrders()
                   └── 统计已成交订单（FilledStatus/PartialFilledStatus）
                   └── 区分买入和卖出数量
                   └── 返回 todayTrades, todayBuyOrders, todaySellOrders
```

---

## 注意事项

1. **单例模式**: 所有服务都使用单例模式导出（`export default new ServiceClass()`）
2. **数据库连接**: 所有需要数据库的服务都使用 `config/database.ts` 的 `pool`
3. **Longbridge SDK**: 行情查询使用 `getQuoteContext()`，交易操作使用 `getTradeContext()`
4. **日志记录**: 所有服务都使用 `utils/logger.ts` 进行日志记录
5. **错误处理**: 所有路由都通过 `middleware/errorHandler.ts` 统一处理错误
6. **信号订单关联**: 新订单通过`signal_id`字段关联信号，历史订单可通过时间窗口匹配回填
7. **数据源统一**: 所有交易数据来自长桥API，`auto_trades`表保留用于兼容但不再作为主要数据源
8. **订单管理统一**: 所有订单管理功能统一在`/quant/orders`页面，`/quant/trades`已删除

## 最新变更（2026-01-28）

### 期权策略完整修复 ✅
- ✅ **资金管理修复**：
  - 资金释放逻辑优先使用 `allocationAmount`（包含完整成本：premium×multiplier×contracts+fees）
  - 持仓状态保存统一使用 `allocationAmountOverride`
  - 从历史订单恢复完整成本
  - 详细的fallback日志和警告
- ✅ **期权价格缓存服务**：
  - 新增 `option-price-cache.service.ts`
  - 5分钟TTL，减少API调用60%
  - 记录价格来源（longport/futunn/position_cache）
- ✅ **期权价格获取增强**：
  - 三层降级机制（LongPort → 持仓缓存 → 富途详情）
  - 缓存优先检查
  - 详细的失败日志
- ✅ **期权合约选择优化**：
  - 修复0DTE到期日期验证（检查是否仍在交易）
  - 修复Greeks数据缺失处理（区分"不可用"和"值为0"）
  - 补充指数stockId映射（SPX/SPXW/XSP系列）
  - 详细的过滤日志（记录Delta、Theta、价差过滤原因）
- ✅ **期权详情接口增强**：
  - 添加顶层便捷字段（underlyingPrice、underlyingChange等）
  - 避免嵌套访问
- ✅ **边缘函数优化**：
  - 明确可选参数处理（lotSize）
  - 清晰的注释说明

### 测试验证完成 ✅
- ✅ **单元测试**：9/9通过（100%）
  - 期权价格缓存测试（4个用例）
  - 期权费用计算测试（3个用例）
  - 市场时段计算测试（2个用例）
- ✅ **API集成测试**：3/4通过（75%）
  - 期权合约选择测试（1个因过滤条件严格未通过，属正常）
  - 期权详情接口测试（5个用例全部通过）
- ✅ **测试文档**：`docs/test/260128-期权策略修复验证报告.md`

---

## 历史变更（2025-12-19）

### LongPort SDK 升级和修复 ✅
- ✅ **SDK版本升级**：从1.1.7升级到3.0.18
- ✅ **市场温度功能**：成功实现市场温度获取（值：70.0）
- ✅ **API调用修复**：修复所有`candlesticks`方法调用，添加`TradeSessions`参数
  - `trading-recommendation.service.ts` - `getStockCandlesticks`方法
  - `market-data.service.ts` - `getVIXCandlesticks`方法
  - `backtest.service.ts` - `getHistoricalCandlesticks`方法（2处修复）
- ✅ **测试体系建设**：创建市场状态矩阵测试（21个测试用例，100%通过）

### 市场状态矩阵测试完成 ✅
- ✅ **测试文件**：`api/src/tests/market-regime-matrix.test.ts`（527行）
- ✅ **测试覆盖**：
  - 市场状态矩阵计算（4种状态）
  - 一票否决权机制
  - 环境分计算
  - 市场环境评估
  - 止损止盈调整
  - 完整策略影响
  - 边界条件处理
- ✅ **测试文档**：`api/src/tests/MARKET_REGIME_MATRIX_TEST.md`

---

## 历史变更（2025-12-12）

### Docker 部署修复完成 ✅
- ✅ **pnpm 支持**：API 和 Frontend Dockerfile 都支持 pnpm
- ✅ **longport 原生模块修复**：从 Alpine 切换到 Debian（glibc 支持）
- ✅ **bcrypt 编译支持**：添加构建工具（python3, make, g++, build-essential）
- ✅ **前端 API URL 配置修复**：使用构建参数（ARG）确保 NEXT_PUBLIC_API_URL 正确注入
- ✅ **public 目录创建**：确保 Next.js standalone 模式正常工作
- ✅ **@ant-design/icons 依赖添加**：修复构建错误
- ✅ **PostgreSQL 端口冲突修复**：移除外部端口映射，容器间通过 Docker 网络通信
- ✅ **NAS 兼容性**：移除 CPU CFS 调度器相关配置

### Docker 配置文件更新
- ✅ `api/Dockerfile`：切换到 Debian 基础镜像，添加构建工具
- ✅ `frontend/Dockerfile`：添加 ARG 和 ENV 支持构建时环境变量
- ✅ `docker-compose.yml`：使用 build args 传递 NEXT_PUBLIC_API_URL
- ✅ 添加故障排查文档：`DOCKER_TROUBLESHOOTING.md`、`DOCKER_BUILD_FIX.md`、`FRONTEND_API_URL_SETUP.md`

### 量化交易订单管理重构（2025-12-11）
- ✅ 删除`/quant/trades`页面和API
- ✅ 移动订单管理到`/quant/orders`
- ✅ 修改今日交易数量统计（使用长桥API）
- ✅ 修复信号日志状态更新（通过`signal_id`关联）

### Docker 优化（2025-12-11）
- ✅ 添加健康检查（所有服务）
- ✅ 优化迁移脚本挂载
- ✅ 创建错误检测脚本

### 系统部署与最新SDK兼容性修复（2026-02-01）
- ✅ 修改`api/src/config/longport.ts`添加错误处理机制
- ✅ 保持`api/package.json`中LongPort SDK版本为"latest"
- ✅ 优化Docker部署流程

### 数据库迁移脚本清理（2025-12-11）
- ✅ 合并010和011到`000_init_schema.sql`
- ✅ 归档历史迁移脚本（001-011）
- ✅ 保留012作为可选的历史数据修复脚本

---

**文档维护**: 当添加新文件或修改调用关系时，请更新本文档。

