# 交易记录与订单管理文档

## 目录

- [概述](#概述)
- [数据库结构](#数据库结构)
- [API接口](#api接口)
- [前端功能](#前端功能)
- [订单状态说明](#订单状态说明)
- [使用示例](#使用示例)
- [注意事项](#注意事项)

---

## 概述

本系统提供了完整的交易记录和订单管理功能，包括：

- ✅ **交易记录查询**：支持按标的代码、状态、日期范围等条件查询历史交易记录
- ✅ **订单提交**：支持多种订单类型（限价单、竞价单、增强限价单、特别限价单）
- ✅ **订单查询**：查询今日订单、订单详情
- ✅ **订单管理**：修改订单、取消订单
- ✅ **状态同步**：自动同步订单状态和持仓数据
- ✅ **账户余额查询**：查询账户资金信息

---

## 数据库结构

### trades 表（交易记录表）

```sql
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,              -- 标的代码，如：AAPL.US
    side VARCHAR(10) NOT NULL,                -- 交易方向：BUY, SELL
    quantity INTEGER NOT NULL,                 -- 数量
    price DECIMAL(20, 4),                     -- 价格（限价单必需）
    status VARCHAR(20) NOT NULL,             -- 状态：PENDING, SUCCESS, FAILED, CANCELLED
    order_id VARCHAR(100),                    -- 订单ID（来自Longbridge API）
    error_message TEXT,                        -- 错误信息（如果失败）
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | SERIAL | 主键，自增ID |
| `symbol` | VARCHAR(50) | 标的代码，格式：`ticker.region`（如：`AAPL.US`、`700.HK`） |
| `side` | VARCHAR(10) | 交易方向：`BUY`（买入）、`SELL`（卖出） |
| `quantity` | INTEGER | 交易数量（必须是正整数） |
| `price` | DECIMAL(20,4) | 价格（限价单必需，竞价单可为空） |
| `status` | VARCHAR(20) | 订单状态：`PENDING`（处理中）、`SUCCESS`（成功）、`FAILED`（失败）、`CANCELLED`（已取消） |
| `order_id` | VARCHAR(100) | Longbridge API返回的订单ID |
| `error_message` | TEXT | 错误信息（订单失败时记录） |
| `created_at` | TIMESTAMP | 创建时间 |
| `updated_at` | TIMESTAMP | 更新时间（自动更新） |

---

## API接口

### 1. 交易记录查询

**接口地址：** `GET /api/trades`

**功能：** 查询交易记录，支持多条件筛选

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `symbol` | string | 否 | 标的代码，如：`AAPL.US` |
| `status` | string | 否 | 订单状态：`PENDING`、`SUCCESS`、`FAILED`、`CANCELLED` |
| `start_date` | string | 否 | 开始日期（ISO格式） |
| `end_date` | string | 否 | 结束日期（ISO格式） |
| `limit` | number | 否 | 每页数量（默认：100） |
| `offset` | number | 否 | 偏移量（默认：0） |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "trades": [
      {
        "id": 1,
        "symbol": "AAPL.US",
        "side": "BUY",
        "quantity": 100,
        "price": "150.50",
        "status": "SUCCESS",
        "order_id": "20231201001",
        "error_message": null,
        "created_at": "2023-12-01T10:00:00Z",
        "updated_at": "2023-12-01T10:05:00Z"
      }
    ],
    "total": 1,
    "limit": 100,
    "offset": 0
  }
}
```

---

### 2. 提交订单

**接口地址：** `POST /api/orders/submit`

**功能：** 提交交易订单

**请求体：**

```json
{
  "symbol": "AAPL.US",
  "side": "Buy",
  "orderType": "LO",
  "quantity": 100,
  "price": 150.50
}
```

**请求参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `symbol` | string | 是 | 标的代码，格式：`ticker.region`（如：`AAPL.US`、`.SPX.US`） |
| `side` | string | 是 | 交易方向：`Buy`（买入）、`Sell`（卖出） |
| `orderType` | string | 是 | 订单类型：`LO`（限价单）、`AO`（竞价单）、`ELO`（增强限价单）、`EAO`（特别限价单） |
| `quantity` | number | 是 | 数量（必须是正整数） |
| `price` | number | 条件 | 价格（限价单和增强限价单必需） |

**订单类型说明：**

| 订单类型 | 代码 | 是否需要价格 | 说明 |
|---------|------|------------|------|
| 限价单 | LO | ✅ 是 | 按指定价格成交 |
| 竞价单 | AO | ❌ 否 | 按市场价格成交 |
| 增强限价单 | ELO | ✅ 是 | 增强版限价单 |
| 特别限价单 | EAO | ❌ 否 | 特别限价单 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "orderId": "20231201001",
    "status": "NotReported",
    "trade": {
      "id": 1,
      "symbol": "AAPL.US",
      "side": "BUY",
      "quantity": 100,
      "price": "150.50",
      "status": "PENDING",
      "order_id": "20231201001",
      "created_at": "2023-12-01T10:00:00Z"
    }
  }
}
```

---

### 3. 查询今日订单

**接口地址：** `GET /api/orders/today`

**功能：** 查询今日订单列表

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `symbol` | string | 否 | 标的代码筛选 |
| `status` | string[] | 否 | 状态筛选（逗号分隔，如：`FilledStatus,PartialFilledStatus`） |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "orderId": "20231201001",
        "symbol": "AAPL.US",
        "stockName": "Apple Inc.",
        "side": "Buy",
        "orderType": "LO",
        "status": "FilledStatus",
        "quantity": "100",
        "executedQuantity": "100",
        "price": "150.50",
        "executedPrice": "150.48",
        "submittedAt": "2023-12-01T10:00:00Z",
        "updatedAt": "2023-12-01T10:05:00Z",
        "currency": "USD",
        "msg": ""
      }
    ]
  }
}
```

**注意：** 此接口会自动同步订单状态到数据库。

---

### 4. 查询订单详情

**接口地址：** `GET /api/orders/:orderId`

**功能：** 查询指定订单的详细信息

**路径参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `orderId` | string | 是 | 订单ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "order": {
      "orderId": "20231201001",
      "symbol": "AAPL.US",
      "stockName": "Apple Inc.",
      "side": "Buy",
      "orderType": "LO",
      "status": "FilledStatus",
      "quantity": "100",
      "executedQuantity": "100",
      "price": "150.50",
      "executedPrice": "150.48",
      "currency": "USD",
      "msg": "",
      "submittedAt": "2023-12-01T10:00:00Z",
      "updatedAt": "2023-12-01T10:05:00Z"
    }
  }
}
```

**注意：** 此接口会自动更新数据库中的订单状态。

---

### 5. 修改订单

**接口地址：** `PUT /api/orders/:orderId`

**功能：** 修改订单的数量和/或价格（仅限未成交订单）

**路径参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `orderId` | string | 是 | 订单ID |

**请求体：**

```json
{
  "quantity": 150,
  "price": 151.00
}
```

**请求参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `quantity` | number | 否 | 新数量（必须大于0的整数） |
| `price` | number | 否 | 新价格（限价单必需，必须大于0） |

**注意：** 至少需要提供 `quantity` 或 `price` 中的一个参数。

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "订单已修改",
    "orderId": "20231201001"
  }
}
```

---

### 6. 取消订单

**接口地址：** `DELETE /api/orders/:orderId`

**功能：** 取消指定订单（仅限未成交订单）

**路径参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `orderId` | string | 是 | 订单ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "订单已取消"
  }
}
```

**注意：** 
- 只有未成交的订单可以取消
- 取消后订单状态会更新为 `CANCELLED`

---

### 7. 查询账户余额

**接口地址：** `GET /api/orders/account-balance`

**功能：** 查询账户资金信息

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `currency` | string | 否 | 币种（如：`USD`、`HKD`），不传则返回所有币种 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "balances": [
      {
        "currency": "USD",
        "totalCash": "100000.00",
        "netAssets": "100000.00",
        "buyPower": "100000.00",
        "maxFinanceAmount": "0",
        "remainingFinanceAmount": "0",
        "riskLevel": "1",
        "marginCall": "0",
        "initMargin": "0",
        "maintenanceMargin": "0",
        "market": "US",
        "cashInfos": [
          {
            "currency": "USD",
            "availableCash": "100000.00",
            "frozenCash": "0",
            "settlingCash": "0",
            "withdrawCash": "100000.00"
          }
        ],
        "frozenTransactionFees": []
      }
    ]
  }
}
```

**注意：** 此接口有频率限制，建议避免频繁调用。

---

### 8. 同步订单状态

**接口地址：** `POST /api/orders/sync-status`

**功能：** 同步订单状态和持仓数据

**功能说明：**
1. 同步今日订单状态到数据库
2. 查询待处理订单详情并更新状态
3. 同步持仓数据到 `positions` 表

**响应示例：**

```json
{
  "success": true,
  "data": {
    "ordersSynced": 5,
    "detailsSynced": 2,
    "positionsSynced": 10,
    "message": "已同步 5 个订单状态，2 个订单详情，10 个持仓"
  }
}
```

**注意：**
- 此接口会自动处理频率限制（每2秒查询一个订单详情）
- 建议定期调用此接口以保持数据同步
- 前端交易记录页面每10秒自动调用一次

---

## 前端功能

### 1. 交易记录页面 (`/trades`)

**功能特性：**
- ✅ 显示所有历史交易记录
- ✅ 支持按标的代码、状态筛选
- ✅ 显示订单状态（成功/失败/处理中/已取消）
- ✅ 点击订单ID可查看订单详情
- ✅ 自动刷新（每10秒）
- ✅ 手动刷新状态按钮
- ✅ 链接到实时订单页面

**页面组件：**
- 文件位置：`frontend/app/trades/page.tsx`
- API调用：`tradesApi.getTrades()`
- 状态同步：`ordersApi.syncStatus()`

---

### 2. 今日订单页面 (`/orders`)

**功能特性：**
- ✅ 显示今日所有订单
- ✅ 支持按标的代码筛选
- ✅ 支持按状态筛选（全部/已成交/待处理）
- ✅ 显示订单详情（数量、价格、成交情况）
- ✅ 查看订单详情弹窗
- ✅ 取消订单功能
- ✅ 修改订单功能（在详情弹窗中）
- ✅ 自动刷新（每30秒，避免频率限制）
- ✅ 手动刷新按钮
- ✅ 链接到交易记录页面

**页面组件：**
- 文件位置：`frontend/app/orders/page.tsx`
- API调用：`ordersApi.getTodayOrders()`
- 订单操作：`ordersApi.cancelOrder()`、`ordersApi.replaceOrder()`

**订单详情弹窗功能：**
- 显示完整订单信息
- 修改订单数量和价格（仅限未成交订单）
- 取消订单（仅限未成交订单）

---

## 订单状态说明

### 数据库状态（trades表）

| 状态 | 说明 |
|------|------|
| `PENDING` | 处理中（待提交、已委托、已提待报等） |
| `SUCCESS` | 成功（已成交、部分成交） |
| `FAILED` | 失败（已拒绝） |
| `CANCELLED` | 已取消 |

### Longbridge API状态（OrderStatus枚举）

根据 [Longbridge API文档](https://open.longbridge.com/zh-CN/docs/trade/trade-definition#orderstatus)，订单状态包括：

| 状态枚举值 | 说明 | 映射到数据库状态 |
|-----------|------|-----------------|
| `NotReported` | 待提交 | `PENDING` |
| `ReplacedNotReported` | 替换待提交 | `PENDING` |
| `ProtectedNotReported` | 保护待提交 | `PENDING` |
| `VarietiesNotReported` | 品种待提交 | `PENDING` |
| `NewStatus` | 已委托 | `PENDING` |
| `WaitToNew` | 已提待报 | `PENDING` |
| `FilledStatus` | 已成交 | `SUCCESS` |
| `PartialFilledStatus` | 部分成交 | `SUCCESS` |
| `CanceledStatus` | 已撤单 | `CANCELLED` |
| `PendingCancelStatus` | 待撤单 | `CANCELLED` |
| `WaitToCancel` | 待取消 | `CANCELLED` |
| `RejectedStatus` | 已拒绝 | `FAILED` |
| `ExpiredStatus` | 已过期 | `CANCELLED` |
| `WaitToReplace` | 待替换 | `PENDING` |
| `PendingReplaceStatus` | 待替换状态 | `PENDING` |
| `ReplacedStatus` | 已替换 | `PENDING` |
| `PartialWithdrawal` | 部分撤单 | `CANCELLED` |

**状态转换逻辑：**

系统会自动将Longbridge API返回的状态转换为数据库状态：

```typescript
// 成功状态
if (status === 'FilledStatus' || status === 'PartialFilledStatus') {
  dbStatus = 'SUCCESS';
}
// 取消状态
else if (status === 'CanceledStatus' || status === 'PendingCancelStatus' || status === 'WaitToCancel') {
  dbStatus = 'CANCELLED';
}
// 失败状态
else if (status === 'RejectedStatus') {
  dbStatus = 'FAILED';
}
// 处理中状态
else {
  dbStatus = 'PENDING';
}
```

---

## 使用示例

### 1. 提交买入订单（限价单）

```typescript
import { ordersApi } from '@/lib/api'

// 提交限价买单
const response = await ordersApi.submitOrder({
  symbol: 'AAPL.US',
  side: 'Buy',
  orderType: 'LO',
  quantity: 100,
  price: 150.50
})

console.log('订单ID:', response.data.orderId)
console.log('订单状态:', response.data.status)
```

### 2. 提交卖出订单（竞价单）

```typescript
// 提交竞价卖单（不需要价格）
const response = await ordersApi.submitOrder({
  symbol: 'AAPL.US',
  side: 'Sell',
  orderType: 'AO',
  quantity: 50
})

console.log('订单ID:', response.data.orderId)
```

### 3. 查询交易记录

```typescript
import { tradesApi } from '@/lib/api'

// 查询所有交易记录
const response = await tradesApi.getTrades({
  limit: 50,
  offset: 0
})

console.log('交易记录:', response.data.trades)
console.log('总数:', response.data.total)

// 按标的代码筛选
const filteredResponse = await tradesApi.getTrades({
  symbol: 'AAPL.US',
  status: 'SUCCESS'
})
```

### 4. 查询今日订单

```typescript
// 查询所有今日订单
const response = await ordersApi.getTodayOrders()

console.log('今日订单:', response.data.orders)

// 按状态筛选
const filledOrders = await ordersApi.getTodayOrders({
  status: ['FilledStatus', 'PartialFilledStatus']
})
```

### 5. 查询订单详情

```typescript
const orderId = '20231201001'
const response = await ordersApi.getOrderDetail(orderId)

console.log('订单详情:', response.data.order)
console.log('成交数量:', response.data.order.executedQuantity)
console.log('成交价格:', response.data.order.executedPrice)
```

### 6. 修改订单

```typescript
const orderId = '20231201001'

// 修改订单数量
await ordersApi.replaceOrder(orderId, {
  quantity: 150
})

// 修改订单价格
await ordersApi.replaceOrder(orderId, {
  price: 151.00
})

// 同时修改数量和价格
await ordersApi.replaceOrder(orderId, {
  quantity: 150,
  price: 151.00
})
```

### 7. 取消订单

```typescript
const orderId = '20231201001'
await ordersApi.cancelOrder(orderId)
console.log('订单已取消')
```

### 8. 查询账户余额

```typescript
// 查询所有币种余额
const allBalances = await ordersApi.getAccountBalance()
console.log('所有余额:', allBalances.data.balances)

// 查询特定币种余额
const usdBalance = await ordersApi.getAccountBalance('USD')
console.log('USD余额:', usdBalance.data.balances[0])
```

### 9. 同步订单状态

```typescript
// 同步订单状态和持仓
const response = await ordersApi.syncStatus()
console.log('同步结果:', response.data.message)
console.log('订单同步数:', response.data.ordersSynced)
console.log('持仓同步数:', response.data.positionsSynced)
```

---

## 注意事项

### 1. API频率限制

- **账户余额查询**：有频率限制，建议避免频繁调用
- **订单详情查询**：同步状态接口会自动节流（每2秒查询一个订单）
- **今日订单查询**：前端自动刷新间隔为30秒，避免频率限制

### 2. 订单状态同步

- 订单提交后，状态初始为 `PENDING`
- 系统会自动同步订单状态（通过 `sync-status` 接口）
- 前端交易记录页面每10秒自动同步一次
- 建议定期调用 `sync-status` 接口以保持数据最新

### 3. 订单修改和取消限制

- **只能修改/取消未成交的订单**
- 已成交（`FilledStatus`）、部分成交（`PartialFilledStatus`）、已取消（`CanceledStatus`）、已拒绝（`RejectedStatus`）的订单无法修改或取消

### 4. 标的代码格式

- 必须使用 `ticker.region` 格式（如：`AAPL.US`、`700.HK`）
- 支持指数代码带前导点（如：`.SPX.US`）
- 格式验证：`/^\.?[A-Z0-9]+\.[A-Z]{2}$/`

### 5. 订单类型和价格

- **限价单（LO）和增强限价单（ELO）**：必须提供价格
- **竞价单（AO）和特别限价单（EAO）**：不需要价格

### 6. 数量要求

- 数量必须是正整数
- 不能为0或负数

### 7. 错误处理

- 订单提交失败时，系统会保存失败记录到数据库（状态为 `FAILED`）
- 错误信息会保存在 `error_message` 字段中
- 前端会显示错误提示

### 8. 数据一致性

- 订单提交成功后，会立即保存到 `trades` 表
- 订单状态会通过 `sync-status` 接口定期更新
- 建议在关键操作后调用 `sync-status` 以确保数据一致性

---

## 相关文件

### 后端文件

- `api/src/routes/trades.ts` - 交易记录路由
- `api/src/routes/orders.ts` - 订单管理路由
- `api/migrations/001_initial_schema.sql` - 数据库表结构

### 前端文件

- `frontend/app/trades/page.tsx` - 交易记录页面
- `frontend/app/orders/page.tsx` - 今日订单页面
- `frontend/lib/api.ts` - API客户端（`tradesApi`、`ordersApi`）

### 配置文件

- `api/src/config/longport.ts` - Longbridge API配置
- `api/src/config/database.ts` - 数据库配置

---

## 更新日志

- **2023-12-01**: 初始版本，支持基本的交易记录和订单管理功能
- **2023-12-01**: 添加订单状态同步功能
- **2023-12-01**: 添加账户余额查询功能
- **2023-12-01**: 完善订单状态映射逻辑
- **2023-12-01**: 添加订单修改功能
- **2023-12-01**: 优化频率限制处理

---

## 参考文档

- [Longbridge API文档](https://open.longbridge.com/zh-CN/docs/trade/trade-definition)
- [交易功能使用说明](./TRADING_GUIDE.md)

