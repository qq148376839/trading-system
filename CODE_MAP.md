# 代码地图 (Code Map)

本文档详细说明了项目中每个文件的作用以及文件之间的调用和关联关系。

**最后更新**: 2025-12-03 (添加回测功能)

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
- `GET /api/quant/trades` - 交易记录
- `GET /api/quant/blacklist` - 黑名单
- `POST /api/quant/blacklist` - 添加黑名单
- `DELETE /api/quant/blacklist/:symbol` - 删除黑名单

**调用关系**:
- ✅ 使用 `services/capital-manager.service.ts` - 资金管理
- ✅ 使用 `services/stock-selector.service.ts` - 选股器
- ✅ 使用 `services/strategy-scheduler.service.ts` - 策略调度器
- ✅ 使用 `services/state-manager.service.ts` - 状态管理
- ✅ 使用 `services/account-balance-sync.service.ts` - 余额同步
- ✅ 使用 `config/database.ts` - 数据库操作

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
**作用**: 市场数据获取服务（富途 API）

**主要功能**:
- 获取 K线数据
- 获取分时数据
- 重试机制和错误处理

**调用关系**:
- ✅ 使用 `config/futunn.ts` - 富途配置
- ✅ 使用 `utils/moomoo-proxy.ts` - Moomoo API 代理

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
- 综合分析市场数据（SPX、USD、BTC）
- 计算技术指标（ATR、Z-score）
- 生成交易信号（BUY/SELL/HOLD）
- 计算入场价、止损价、止盈价

**调用关系**:
- ✅ 使用 `services/market-data-cache.service.ts` - 市场数据缓存
- ✅ 使用 `config/longport.ts` - 获取股票行情
- ✅ 使用 `utils/logger.ts` - 日志记录

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

**调用关系**:
- ✅ 使用 `config/futunn.ts` - 富途配置
- ✅ 使用 `utils/moomoo-proxy.ts` - Moomoo API 代理

**被调用**:
- 📌 `routes/options.ts` - 期权链 API

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
**作用**: 基础执行服务（订单执行）

**主要功能**:
- 执行买入/卖出意图
- 提交订单到 Longbridge SDK
- 等待订单成交
- 记录交易结果

**调用关系**:
- ✅ 使用 `config/longport.ts` - 获取交易上下文
- ✅ 使用 `config/database.ts` - 数据库操作（记录订单）
- ✅ 使用 `utils/logger.ts` - 日志记录

**被调用**:
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（执行交易）

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

**调用关系**:
- ✅ 使用 `config/database.ts` - 数据库操作
- ✅ 使用 `services/strategies/strategy-base.ts` - 策略基类
- ✅ 使用 `services/strategies/recommendation-strategy.ts` - 推荐策略
- ✅ 使用 `services/stock-selector.service.ts` - 选股器
- ✅ 使用 `services/capital-manager.service.ts` - 资金管理器
- ✅ 使用 `services/state-manager.service.ts` - 状态管理器
- ✅ 使用 `services/basic-execution.service.ts` - 订单执行
- ✅ 使用 `services/dynamic-position-manager.service.ts` - 动态持仓管理
- ✅ 使用 `services/trading-recommendation.service.ts` - 交易推荐服务（获取ATR）
- ✅ 使用 `config/longport.ts` - 获取持仓和订单（直接调用 SDK）
- ✅ 使用 `utils/logger.ts` - 日志记录

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

**调用关系**:
- ✅ 使用 `services/state-manager.service.ts` - 状态管理

**被调用**:
- 📌 `services/strategies/recommendation-strategy.ts` - 推荐策略（继承）
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（使用策略实例）

#### `api/src/services/strategies/recommendation-strategy.ts`
**作用**: 推荐策略实现

**主要功能**:
- 实现 `StrategyBase` 接口
- 调用交易推荐服务生成信号
- 管理策略状态

**调用关系**:
- ✅ 继承 `services/strategies/strategy-base.ts` - 策略基类
- ✅ 使用 `services/trading-recommendation.service.ts` - 交易推荐服务
- ✅ 使用 `services/state-manager.service.ts` - 状态管理

**被调用**:
- 📌 `services/strategy-scheduler.service.ts` - 策略调度器（创建策略实例）

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

**调用关系**:
- ✅ 使用 `config/futunn.ts` - 富途配置

**被调用**:
- 📌 `services/market-data.service.ts` - 市场数据服务
- 📌 `services/futunn-option-quote.service.ts` - 期权行情服务
- 📌 `services/futunn-option-chain.service.ts` - 期权链服务

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
**作用**: 订单管理页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/orders`

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

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用
- ✅ 使用 `components/OptionTradeModal.tsx` - 期权交易模态框

**被调用**:
- 📌 Next.js 路由 `/options/chain`

#### `frontend/app/options/[optionCode]/page.tsx`
**作用**: 期权详情页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/options/[optionCode]`

#### `frontend/app/quant/page.tsx`
**作用**: 量化交易主页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/quant`

#### `frontend/app/quant/strategies/page.tsx`
**作用**: 策略管理页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

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
**作用**: 量化交易记录页面

**调用关系**:
- ✅ 使用 `lib/api.ts` - API 调用

**被调用**:
- 📌 Next.js 路由 `/quant/trades`

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

**调用关系**:
- ✅ 无外部依赖

**被调用**:
- 📌 数据库初始化时手动执行

#### `api/migrations/archive/*.sql`
**作用**: 历史迁移脚本（已归档）

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

**调用关系**:
- ✅ 定义服务容器配置

**被调用**:
- 📌 Docker Compose

#### `docker-compose.dev.yml`
**作用**: Docker Compose 开发环境配置

**调用关系**:
- ✅ 定义开发服务容器配置

**被调用**:
- 📌 Docker Compose

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
   │   └── trading-recommendation.service.ts
   │       └── market-data-cache.service.ts
   │           └── market-data.service.ts
   ├── capital-manager.service.ts (申请资金)
   │   └── config/longport.ts (获取余额)
   └── basic-execution.service.ts (执行订单)
       └── config/longport.ts (提交订单)
```

### 订单查询流程

```
1. frontend/app/orders/page.tsx
   └── lib/api.ts
       └── GET /api/orders/today
           └── routes/orders.ts
               └── config/longport.ts
                   └── tradeCtx.todayOrders()
```

---

## 注意事项

1. **单例模式**: 所有服务都使用单例模式导出（`export default new ServiceClass()`）
2. **数据库连接**: 所有需要数据库的服务都使用 `config/database.ts` 的 `pool`
3. **Longbridge SDK**: 行情查询使用 `getQuoteContext()`，交易操作使用 `getTradeContext()`
4. **日志记录**: 所有服务都使用 `utils/logger.ts` 进行日志记录
5. **错误处理**: 所有路由都通过 `middleware/errorHandler.ts` 统一处理错误

---

**文档维护**: 当添加新文件或修改调用关系时，请更新本文档。

