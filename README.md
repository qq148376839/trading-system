# 长桥股票交易系统

基于 NAS + Docker + Zero Trust 的股票交易系统，支持美股、港股、A股实时行情查询和交易执行。

## 📋 目录

- [项目概述](#项目概述)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [核心功能](#核心功能)
- [快速开始](#快速开始)
- [API 文档](#api-文档)
- [开发指南](#开发指南)
- [重要更新](#重要更新)
- [项目状态](#项目状态)

## 🎯 项目概述

这是一个全栈股票交易系统，提供实时行情查询、订单管理、持仓管理、交易推荐等功能。系统采用前后端分离架构，后端使用 Node.js + Express + TypeScript，前端使用 Next.js + TypeScript。

### 主要特性

- ✅ **完全基于 Longbridge SDK**：所有订单查询和管理功能直接调用 Longbridge OpenAPI SDK
- ✅ **统一订单管理**：整合今日订单和历史订单，提供统一的订单管理界面
- ✅ **智能数据映射**：自动将 SDK 返回的数字枚举值转换为字符串枚举值，符合 API 文档规范
- ✅ **中文翻译支持**：订单类型、订单状态、盘前盘后等字段提供中文翻译
- ✅ **期权行情 Fallback**：优先使用长桥 API，权限不足时自动切换到富途牛牛 API

## 🛠 技术栈

### 前端
- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **图表**: Recharts
- **HTTP客户端**: Axios

### 后端
- **框架**: Express.js
- **语言**: TypeScript
- **数据库**: PostgreSQL 15
- **SDK**: Longbridge OpenAPI SDK (Node.js)
- **其他**: dotenv, axios (富途 API)

### 部署
- **容器化**: Docker + Docker Compose ✅ 已完全修复并测试通过
- **包管理**: pnpm（统一使用）
- **基础镜像**: Debian (node:20) - 支持原生模块编译
- **公网访问**: Cloudflare Zero Trust Tunnel

## 📁 项目结构

```
trading-system/
├── api/                          # API 服务
│   ├── src/
│   │   ├── config/               # 配置文件
│   │   │   ├── database.ts       # 数据库配置
│   │   │   ├── longport.ts       # Longbridge SDK 配置
│   │   │   └── futunn.ts         # 富途 API 配置
│   │   ├── routes/               # API 路由
│   │   │   ├── orders.ts         # 订单管理（完全基于 SDK）
│   │   │   ├── quote.ts          # 行情查询
│   │   │   ├── positions.ts      # 持仓查询
│   │   │   └── ...
│   │   ├── services/             # 业务逻辑服务
│   │   └── middleware/           # 中间件
│   ├── migrations/               # 数据库迁移脚本
│   └── package.json
│
├── frontend/                     # 前端应用
│   ├── app/                      # Next.js App Router 页面
│   │   ├── orders/              # 订单管理页面（重定向到/quant/orders）
│   │   ├── quant/               # 量化交易模块
│   │   │   ├── orders/          # 订单管理页面（统一）
│   │   │   ├── strategies/      # 策略管理
│   │   │   ├── signals/        # 信号日志
│   │   │   └── ...
│   │   ├── quote/                # 行情页面
│   │   ├── positions/            # 持仓页面
│   │   └── ...
│   ├── components/               # React 组件
│   ├── lib/                      # 工具函数
│   └── package.json
│
└── docs/                        # 项目文档
    ├── ORDER_MANAGEMENT_REFACTOR_PLAN.md
    ├── TRADE_RECORD_ORDER_MANAGEMENT.md
    └── ...
```

## ✨ 核心功能

### 1. 期权链和期权交易 ⭐ 新功能

**功能亮点**：
- ✅ **期权链展示**：查看股票的所有可用期权到期日期和行权价
- ✅ **期权详情**：显示期权的实时价格、Greeks、隐含波动率等详细信息
- ✅ **主页跳转**：从主页股票列表一键跳转到对应股票的期权链
- ✅ **自动定位**：期权链表格自动滚动到当前价格附近的行权价并高亮显示
- ✅ **期权交易**：支持在期权详情页直接交易期权（买入/卖出）

**API 端点**：
- `GET /api/options/strike-dates` - 获取期权到期日期列表
- `GET /api/options/chain` - 获取期权链数据
- `GET /api/options/detail` - 获取期权详情
- `GET /api/options/underlying-quote` - 获取正股行情（用于定位）

**数据来源**：
- 使用富途牛牛 API 获取期权链数据（长桥 API 权限不足）
- 支持自动 fallback 机制

### 2. 订单管理（完全基于 SDK）

**重构亮点**：
- ✅ 完全基于 Longbridge SDK，不再依赖数据库查询订单状态
- ✅ 统一订单管理页面，整合今日订单和历史订单
- ✅ 智能数据映射，自动转换数字枚举值为字符串枚举值
- ✅ 中文翻译支持，订单类型和盘前盘后字段提供中文显示

**API 端点**：
- `GET /api/orders/today` - 查询今日订单（支持筛选：symbol, status, side, market, order_id）
- `GET /api/orders/history` - 查询历史订单（支持筛选：symbol, status, side, market, start_at, end_at）
- `GET /api/orders/:orderId` - 查询订单详情（包含完整字段和中文翻译）
- `POST /api/orders/submit` - 提交订单（支持所有订单类型）
- `PUT /api/orders/:orderId` - 修改订单
- `DELETE /api/orders/:orderId` - 取消订单
- `GET /api/orders/account-balance` - 查询账户余额
- `GET /api/orders/estimate-max-quantity` - 预估最大购买数量

**数据格式**：
- 所有枚举值返回字符串格式（符合 [Longbridge 交易命名词典](https://open.longbridge.com/zh-CN/docs/trade/trade-definition)）
- 提供中文翻译字段：`order_type_text`, `outside_rth_text`
- 时间字段返回时间戳（秒）格式

### 3. 实时行情查询

- **支持市场**: 美股、港股、A股
- **支持标的**: 股票、期权、外汇、指数
- **Fallback 机制**: 期权行情优先使用长桥 API，权限不足时自动切换到富途牛牛 API

### 4. 持仓管理

- **持仓查询**: 实时查询账户持仓
- **盈亏计算**: 
  - 支持期权合约乘数
  - 正确计算卖空期权盈亏
  - 自动使用富途牛牛 API 作为期权行情备用方案

### 5. 交易推荐

- **市场环境分析**: SPX、USD Index、BTC 数据分析
- **动态止损止盈**: 基于 ATR 计算
- **风险收益比验证**: >= 1.5
- **交易费用考虑**: 自动计算交易成本

### 6. 配置管理

- **Web 界面配置**: 数据库存储，支持加密
- **Token 自动刷新**: LongPort Access Token 自动刷新机制
- **多环境支持**: 开发、生产环境配置分离

### 7. 量化交易策略 ⭐ 新功能

**功能亮点**：
- ✅ **策略管理**：创建、编辑、启动、停止策略
- ✅ **统一界面**：创建和编辑策略使用相同的界面，支持从关注列表快速添加股票
- ✅ **股票代码验证**：自动验证和修正股票代码格式（APPL.US → AAPL.US）
- ✅ **智能数量计算**：根据可用资金自动计算购买数量（使用10%可用资金）
- ✅ **价格精度处理**：自动格式化价格到正确的小数位数（美股2位，港股3位）
- ✅ **持仓检查**：避免重复买入同一标的
- ✅ **订单追踪**：自动追踪未成交订单，根据市场变化更新价格
- ✅ **资金管理**：支持资金分配和额度管理

**策略执行流程**：
1. 订单追踪：每个策略周期开始时，先追踪并更新未成交订单
2. 持仓检查：在处理每个标的时，先检查是否已有持仓
3. 未成交订单检查：检查是否有未成交的订单
4. 信号生成：生成交易信号
5. 数量计算：根据可用资金计算购买数量
6. 价格格式化：格式化价格到正确的小数位数
7. 订单提交：提交订单到交易所

**API 端点**：
- `GET /api/quant/strategies` - 获取策略列表
- `GET /api/quant/strategies/:id` - 获取策略详情
- `POST /api/quant/strategies` - 创建策略
- `PUT /api/quant/strategies/:id` - 更新策略
- `DELETE /api/quant/strategies/:id` - 删除策略
- `POST /api/quant/strategies/:id/start` - 启动策略
- `POST /api/quant/strategies/:id/stop` - 停止策略
- `GET /api/quant/strategies/:id/instances` - 获取策略实例
- `GET /api/quant/signals` - 获取信号日志
- `GET /api/quant/capital/allocations` - 获取资金分配列表

### 8. 回测功能 ⭐ 最新优化

**功能亮点**：
- ✅ **策略回测**：使用历史数据回测策略表现
- ✅ **交易日验证**：自动排除周末和未来日期，使用Longbridge SDK获取真实交易日数据
- ✅ **历史数据优化**：使用Longbridge历史K线API，支持Moomoo降级方案
- ✅ **数据完整性检查**：自动检查数据量，不足时自动补充
- ✅ **API频次限制**：自动处理API频次限制（每30秒最多60次）
- ✅ **配额监控**：监控API配额使用情况，自动预警
- ✅ **市场环境模拟**：使用日K数据模拟分时市场环境
- ✅ **交易逻辑分析**：全面分析回测交易逻辑，发现潜在改进点

**API 端点**：
- `POST /api/quant/backtest` - 创建回测任务
- `GET /api/quant/backtest/:id` - 获取回测结果
- `GET /api/quant/backtest/:id/status` - 获取回测状态
- `GET /api/quant/backtest` - 获取回测任务列表

**相关文档**：
- 📄 [回测功能文档](docs/features/251215-回测功能文档.md) ⭐ 推荐阅读（包含修订文档索引和使用指南）
- 📄 [回测功能使用指南](docs/archive/250101-回测功能使用指南.md)（历史文档）
- 📄 [回测交易逻辑分析报告](docs/archive/251216-回测交易逻辑分析报告.md)（历史文档）

## 🚀 快速开始

### 环境要求

- **Docker 部署（推荐）**: Docker & Docker Compose
- **本地开发**: Node.js 20+, PostgreSQL 15+

### 1. 克隆项目

```bash
git clone <repository-url>
cd trading-system
```

### 2. Docker 部署（推荐）

#### 快速开始

```bash
# 1. 克隆项目
git clone <repository-url>
cd trading-system

# 2. 配置环境变量（项目根目录创建 .env 文件）
cat > .env << EOF
POSTGRES_USER=trading_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=trading_db
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token
NEXT_PUBLIC_API_URL=http://192.168.31.18:3001  # 使用你的 NAS IP
EOF

# 3. 构建并启动服务
docker-compose build
docker-compose up -d

# 4. 创建管理员账户
docker-compose exec api node scripts/create-admin.js admin your_password

# 5. 访问应用
# 前端: http://192.168.31.18:3000
# API: http://192.168.31.18:3001
```

**详细文档**:
- 📖 [Docker 部署指南](docs/guides/251214-Docker部署指南.md) - 完整的 Docker 部署指南
- 🔧 [Docker 故障排查和优化指南](docs/guides/251216-Docker故障排查和优化指南.md) - 常见问题排查
- 🌐 [前端 API URL 配置指南](docs/guides/251216-前端API-URL配置指南.md) - 前端连接配置

### 3. 本地开发环境配置

#### API 服务配置 (`api/.env`)

```bash
# 数据库配置
DATABASE_URL=postgresql://user:password@localhost:5432/trading_db

# 长桥 API 配置（必需）
# 请访问 https://open.longportapp.com/ 获取 API 密钥
LONGPORT_APP_KEY=your_app_key
LONGPORT_APP_SECRET=your_app_secret
LONGPORT_ACCESS_TOKEN=your_access_token

# 可选：开启美股夜盘
LONGPORT_ENABLE_OVERNIGHT=false

# 服务器配置
PORT=3001
NODE_ENV=development
```

#### 前端配置 (`frontend/.env.local`)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**重要提示**:
- ACCESS_TOKEN 有效期为 3 个月，过期后需要到 https://open.longportapp.com/ 重新生成
- 如果遇到 401003 或 401004 错误，请检查 Token 是否有效
- 富途牛牛/Moomoo API 配置已硬编码在代码中（使用游客 cookies），无需环境变量配置

### 4. 初始化数据库（仅本地开发）

```bash
cd api
# Docker 部署会自动执行初始化脚本，本地开发需要手动执行
psql -U postgres -d trading_db -f migrations/000_init_schema.sql
```

### 5. 安装依赖并启动服务（仅本地开发）

```bash
# 启动 API 服务
cd api
npm install
npm run dev
# API 服务将在 http://localhost:3001 启动

# 启动前端服务（新终端）
cd frontend
npm install
npm run dev
# 前端应用将在 http://localhost:3000 启动
```

### 6. 访问应用

- **Docker 部署**: http://你的NAS地址:3000
- **本地开发**: http://localhost:3000

## 📚 API 文档

### 订单管理 API

#### 查询今日订单

```bash
GET /api/orders/today?symbol=AAPL.US&status=Filled&side=Buy&market=US
```

**查询参数**：
- `symbol` (可选): 标的代码，如 `AAPL.US`
- `status` (可选): 订单状态，多个状态用逗号分隔，如 `Filled,New`
- `side` (可选): 买卖方向，`Buy` 或 `Sell`
- `market` (可选): 市场，`US` 或 `HK`
- `order_id` (可选): 订单 ID

#### 查询历史订单

```bash
GET /api/orders/history?symbol=AAPL.US&start_at=2025-01-01&end_at=2025-01-31
```

**查询参数**：
- `symbol` (可选): 标的代码
- `status` (可选): 订单状态（多个用逗号分隔）
- `side` (可选): 买卖方向
- `market` (可选): 市场
- `start_at` (可选): 开始时间（ISO 字符串或时间戳秒）
- `end_at` (可选): 结束时间（ISO 字符串或时间戳秒）

#### 查询订单详情

```bash
GET /api/orders/:orderId
```

**返回字段**（包含完整订单信息和中文翻译）：
- `order_id`: 订单 ID
- `order_type`: 订单类型（如 `LO`, `MO`）
- `order_type_text`: 订单类型中文翻译（如 `限价单`, `市价单`）
- `status`: 订单状态（如 `FilledStatus`, `NewStatus`）
- `outside_rth`: 盘前盘后（如 `ANY_TIME`, `RTH_ONLY`）
- `outside_rth_text`: 盘前盘后中文翻译（如 `允许盘前盘后`, `不允许盘前盘后`）
- `history`: 订单历史明细数组
- `charge_detail`: 订单费用明细
- 更多字段请参考 [Longbridge API 文档](https://open.longbridge.com/zh-CN/docs/trade/trade-definition)

### 其他 API

详细的 API 文档请参考：
- [API README](api/README.md)
- [订单管理重构优化方案](docs/archive/220509-订单管理重构优化方案.md)（历史文档）
- [交易记录与订单管理文档](docs/archive/231201-交易记录与订单管理文档.md)（历史文档）

## 🔧 开发指南

### 代码规范

- **TypeScript**: 严格模式，类型安全
- **代码风格**: ESLint + Prettier
- **提交规范**: 使用有意义的提交信息

### 数据库设计

- **trades 表**: 仅用于日志记录，不用于订单查询
- **positions 表**: 持仓数据
- **config 表**: 配置管理
- **watchlist 表**: 关注列表

### SDK 使用规范

所有订单相关操作必须使用 Longbridge SDK：

```typescript
import { getTradeContext, OrderStatus, OrderSide, Market } from '../config/longport';

const tradeCtx = await getTradeContext();

// 查询今日订单
const orders = await tradeCtx.todayOrders({
  symbol: 'AAPL.US',
  status: [OrderStatus.Filled, OrderStatus.New],
  side: OrderSide.Buy,
  market: Market.US,
});

// 查询历史订单
const historyOrders = await tradeCtx.historyOrders({
  symbol: 'AAPL.US',
  startAt: new Date('2025-01-01'),
  endAt: new Date('2025-01-31'),
});

// 查询订单详情
const orderDetail = await tradeCtx.orderDetail('order_id');
```

### 数据映射规范

所有 SDK 返回的数据必须通过 `mapOrderData()` 函数映射：

```typescript
import { mapOrderData } from '../routes/orders';

const mappedOrder = mapOrderData(orderDetail);
// mappedOrder 包含：
// - 所有字段的下划线命名（符合 API 文档）
// - 中文翻译字段（order_type_text, outside_rth_text）
// - 向后兼容的驼峰命名字段
```

## 📝 重要更新

### 2025-12-19: LongPort SDK 升级和测试完成 ⭐ 最新

**升级内容**：
1. ✅ **SDK版本升级**：从1.1.7升级到3.0.18
2. ✅ **市场温度功能**：成功实现市场温度获取（值：70.0）
3. ✅ **API调用修复**：修复所有`candlesticks`方法调用，添加必需的`TradeSessions`参数
4. ✅ **测试体系建设**：创建市场状态矩阵测试文件（21个测试用例，100%通过）

**技术实现**：
- 升级`longport`依赖到`latest`（实际升级到3.0.18）
- 修复`getStockCandlesticks`、`getVIXCandlesticks`、`getHistoricalCandlesticks`方法
- 所有K线数据获取方法统一添加`TradeSessions.All`参数
- 创建完整的市场状态矩阵测试套件

**测试覆盖**：
- 市场状态矩阵计算（4种状态）
- 一票否决权机制（VIX > 35、温度 < 10）
- 环境分计算（权重验证）
- 市场环境评估
- 止损止盈调整
- 边界条件处理

**相关文档**：
- 📄 [市场温度实现PRD](docs/features/251218-MARKET_TEMPERATURE_IMPLEMENTATION_PRD.md)
- 📄 [交易推荐逻辑总结](docs/technical/251212-交易推荐逻辑总结.md)
- 📄 [市场状态矩阵测试文档](api/src/tests/MARKET_REGIME_MATRIX_TEST.md)

### 2025-12-15: 回测功能优化

**优化内容**：
1. ✅ **交易日验证功能**：自动排除周末和未来日期，使用Longbridge SDK获取真实交易日数据
2. ✅ **交易日服务**：创建专门的交易日服务，实现24小时缓存和分批获取
3. ✅ **日期范围验证**：自动验证和调整回测日期范围，确保数据准确性
4. ✅ **交易逻辑分析**：完成回测交易逻辑全面分析，发现并记录潜在改进点

**技术实现**：
- 新增交易日服务（`trading-days.service.ts`），使用Longbridge `tradingDays`接口
- 新增交易日工具函数（`trading-days.ts`），支持日期范围验证和调整
- 集成到回测服务，自动过滤非交易日数据
- 创建交易逻辑分析工具，全面检查回测逻辑

**相关文档**：
- 📄 [回测功能文档](docs/features/251215-回测功能文档.md) ⭐ 推荐阅读（包含修订文档索引和修订总结）
- 📄 [回测交易逻辑分析报告](analyze_backtest_logic_final.md)

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

### 2025-01-XX: 期权链功能完整实现

**新增功能**：
1. ✅ **期权链展示**：支持查看股票的所有可用期权到期日期和行权价
2. ✅ **期权详情页**：显示期权的实时价格、Greeks、隐含波动率等详细信息
3. ✅ **主页跳转功能**：从主页股票列表一键跳转到对应股票的期权链
4. ✅ **自动滚动定位**：期权链表格自动滚动到当前价格附近的行权价
5. ✅ **期权交易功能**：支持在期权详情页直接交易期权

**技术实现**：
- 使用富途牛牛 API 获取期权链数据（长桥 API 权限不足）
- 支持期权到期日期查询、期权链查询、期权详情查询
- 前端实现固定表头、自动滚动、高亮显示等用户体验优化

**涉及文件**：
- 后端：`api/src/routes/options.ts` - 期权相关 API
- 后端：`api/src/services/futunn-option-chain.service.ts` - 富途期权链服务
- 前端：`frontend/app/options/chain/page.tsx` - 期权链页面
- 前端：`frontend/app/options/[optionCode]/page.tsx` - 期权详情页
- 前端：`frontend/components/OptionTradeModal.tsx` - 期权交易模态框

### 2025-01-28: 策略执行优化 ⭐

**优化内容**：
1. ✅ **策略界面统一**：创建和编辑策略使用相同的界面，支持从关注列表快速添加股票
2. ✅ **股票代码验证**：自动验证和修正股票代码格式（APPL.US → AAPL.US）
3. ✅ **数量计算优化**：根据可用资金正确计算购买数量（使用10%可用资金）
4. ✅ **价格精度修复**：自动格式化价格到正确的小数位数（美股2位，港股3位），避免下单失败
5. ✅ **持仓检查**：避免重复买入同一标的
6. ✅ **订单追踪**：自动追踪未成交订单，根据市场变化更新价格（价格差异超过2%时自动更新）
7. ✅ **未成交订单检查**：避免同一标的同时存在多个未成交订单

**技术实现**：
- 前端：统一创建和编辑策略的UI组件，添加股票代码实时验证
- 后端：改进数量计算逻辑、价格格式化逻辑、持仓检查逻辑、订单追踪逻辑

**涉及文件**：
- 前端：`frontend/app/quant/strategies/page.tsx` - 创建策略界面
- 前端：`frontend/app/quant/strategies/[id]/page.tsx` - 编辑策略界面
- 后端：`api/src/routes/quant.ts` - 添加股票代码验证和自动修正
- 后端：`api/src/services/strategy-scheduler.service.ts` - 添加数量计算、持仓检查、订单追踪
- 后端：`api/src/services/basic-execution.service.ts` - 添加价格格式化逻辑

**详细文档**：
- 📄 [策略执行优化总结](docs/archive/250128-策略执行优化总结.md) - 完整的优化说明和技术细节

### 2025-01-XX: 订单管理重构

**重构内容**：
1. ✅ **完全基于 SDK**：所有订单查询直接调用 Longbridge SDK，不再依赖数据库
2. ✅ **统一订单管理页面**：整合今日订单和历史订单，提供统一的筛选和管理界面
3. ✅ **数据格式规范化**：所有枚举值返回字符串格式，符合 API 文档规范
4. ✅ **中文翻译支持**：订单类型、盘前盘后等字段提供中文翻译
5. ✅ **完整字段支持**：订单详情包含所有字段（免佣、抵扣、费用明细、历史记录等）

**影响范围**：
- 后端：`api/src/routes/orders.ts` - 完全重构
- 前端：`frontend/app/orders/page.tsx` - 统一订单管理页面
- 前端：`frontend/app/trades/page.tsx` - 重定向到订单管理页面

### 其他更新

- ✅ 期权行情 Fallback 机制（长桥 → 富途）
- ✅ Token 自动刷新功能
- ✅ 配置管理 Web 界面
- ✅ 交易推荐算法优化
- ✅ 期权持仓计算优化（考虑合约乘数）

## 📖 相关文档

### 📍 代码地图
- 🗺️ [代码地图](CODE_MAP.md) - 项目中每个文件的作用和调用关系

### 📚 文档中心

**👉 [查看完整文档索引](docs/README.md)**

#### 使用指南
- 🏠 [NAS Docker 部署指南](docs/guides/251212-NAS-Docker部署指南.md) - NAS 上 Docker 部署完整指南 ⭐ 新增
- ⚙️ [环境变量配置指南](docs/guides/251216-环境变量配置指南.md) - 环境变量配置说明（数据库账号密码等）⭐ 新增
- 💼 [交易功能使用说明](docs/guides/251212-交易功能使用说明.md) - 交易功能使用说明
- ⚙️ [配置管理功能设置指南](docs/guides/250127-配置管理功能设置指南.md) - 配置管理和 Token 刷新功能设置指南
- 🐳 [Docker 部署指南](docs/guides/251214-Docker部署指南.md) - Docker 环境配置和部署说明
- 📄 [卖出看跌期权完全指南](docs/guides/251212-卖出看跌期权（Sell Put）完全指南.md) - 期权交易策略指南

#### 技术文档
- 🏗️ [量化交易系统技术文档](docs/technical/251202-量化交易系统技术文档.md) - 项目核心信息、关键决策和技术栈
- 📊 [交易推荐逻辑总结](docs/technical/251212-交易推荐逻辑总结.md) - 交易推荐算法详细说明
- 🔧 [期权行情获取API开发文档](docs/technical/251121-期权行情获取API开发文档.md) - 期权行情 API 开发文档
- 🤖 [量化交易系统技术文档](docs/technical/251202-量化交易系统技术文档.md) - 量化交易策略的详细逻辑说明

#### 历史文档（已归档）
- 📋 [订单管理重构优化方案](docs/archive/220509-订单管理重构优化方案.md) - 订单管理重构详细计划（已完成）
- 📝 [交易记录与订单管理文档](docs/archive/231201-交易记录与订单管理文档.md) - 订单管理 API 文档（已完成）
- 📈 [股票期权功能可行性分析文档](docs/archive/251212-股票期权功能可行性分析文档.md) - 期权链功能可行性分析（已完成）
- 🚀 [期权链功能优化计划](docs/archive/251212-期权链功能优化计划.md) - 期权链功能优化计划（已完成）
- ⚡ [委托下单功能优化方案](docs/archive/250115-委托下单功能优化方案.md) - 订单提交功能优化方案（已完成）
- 🤖 [策略执行优化总结](docs/archive/250128-策略执行优化总结.md) - 策略执行功能优化和问题修复总结

## 🐛 故障排除

### Docker 部署问题

1. **前端无法连接 API**
   - 检查 `NEXT_PUBLIC_API_URL` 是否设置为 NAS 的实际 IP
   - 修改后必须重新构建：`docker-compose build --no-cache frontend`
   - 参考：[前端 API URL 配置指南](docs/guides/251216-前端API-URL配置指南.md)

2. **API 容器启动失败（unhealthy）**
   - 查看日志：`docker-compose logs api`
   - 检查数据库连接配置（使用服务名 `postgres` 而不是 `localhost`）
   - 参考：[Docker 故障排查和优化指南](docs/guides/251216-Docker故障排查和优化指南.md)

3. **构建失败**
   - longport 模块错误：已修复，使用 Debian 基础镜像
   - bcrypt 编译错误：已修复，添加了构建工具
   - 参考：[Docker 部署指南](docs/guides/251214-Docker部署指南.md)（包含构建修复说明）

### 常见问题

1. **401004 错误（Token 无效）**
   - 检查 ACCESS_TOKEN 是否过期（有效期 3 个月）
   - 访问 https://open.longportapp.com/ 重新生成 Token
   - 更新 `.env` 文件中的 `LONGPORT_ACCESS_TOKEN`

2. **订单查询返回数字枚举值**
   - 确保使用最新版本的 `mapOrderData()` 函数
   - 检查 SDK 版本是否最新

3. **前端显示英文枚举值而非中文**
   - 检查 API 返回是否包含 `order_type_text` 和 `outside_rth_text` 字段
   - 确保前端代码使用翻译字段：`{order.orderTypeText || order.orderType}`

### 调试工具

- **健康检查**: `GET /api/health`
- **API 日志**: 查看控制台输出的详细错误信息
- **数据库日志**: 检查 PostgreSQL 日志

## 📄 许可证

MIT License

## 🙏 致谢

- [Longbridge OpenAPI](https://open.longbridge.com/) - 提供股票行情和交易 API
- [富途牛牛/Moomoo](https://www.moomoo.com/) - 提供期权行情备用方案

## 📊 项目状态

### 当前版本
- **版本**: 1.0
- **状态**: ✅ 正常运行
- **最后更新**: 2025-12-08

### 最近更新

#### 2025-12-08 - 策略创建UI优化和文档整理

**UI优化**：
- ✅ 策略类型UI优化：移除单一选项的下拉框，改为说明卡片
- ✅ 按钮位置优化：将创建/取消按钮固定在模态框底部
- ✅ 机构选择功能增强：支持获取全部机构列表（42,638个机构），支持分页浏览
- ✅ 策略配置说明优化：添加详细的参数说明、推荐值和计算公式
- ✅ 布局优化：将策略说明卡片移到策略参数配置上方

**Bug修复**：
- ✅ 可用资金计算：修复使用固定默认值的问题，改为从资金分配账户动态获取
- ✅ 美股过滤：机构选股只返回美股（.US），过滤掉日股、港股等非美股
- ✅ 分页逻辑：优化分页判断，支持获取多页数据直到达到目标数量

**文档整理**：
- ✅ 归档已完成的功能文档到 `docs/archive/`
- ✅ 更新边缘函数文档，添加机构选股相关API支持
- ✅ 更新代码地图，添加机构选股相关服务和组件

#### 2025-12-05

#### ⚠️ 关键BUG修复
- **资金使用差异BUG修复**: 修复持仓数据解析BUG，扩展状态同步逻辑，修复实际使用值计算
- **修复效果**: 差异从 24810.74 减少到 17033.84（减少31%）
- **数据库迁移脚本合并**: 合并008和009到000_init_schema.sql，简化部署流程

### 项目进度
查看 [PROJECT_STATUS.md](PROJECT_STATUS.md) 了解详细的项目进度和计划。

### 更新日志
查看 [CHANGELOG.md](CHANGELOG.md) 了解完整的功能更新和修复记录。

### 文档中心
查看 [docs/README.md](docs/README.md) 了解完整的文档索引。

---

**最后更新**: 2025-12-15 (回测功能优化：交易日验证、交易逻辑分析)
