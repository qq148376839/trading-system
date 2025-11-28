# 订单管理重构优化方案

## 一、当前状态分析

### 1.1 现有功能

**后端API（`api/src/routes/orders.ts`）：**
- ✅ `GET /api/orders/today` - 查询今日订单（使用SDK：`tradeCtx.todayOrders()`）
- ✅ `GET /api/orders/:orderId` - 查询订单详情（使用SDK：`tradeCtx.orderDetail()`）
- ✅ `POST /api/orders/submit` - 提交订单（使用SDK：`tradeCtx.submitOrder()`）
- ✅ `PUT /api/orders/:orderId` - 修改订单（使用SDK：`tradeCtx.replaceOrder()`）
- ✅ `DELETE /api/orders/:orderId` - 取消订单（使用SDK：`tradeCtx.cancelOrder()`）
- ✅ `GET /api/orders/account-balance` - 查询账户余额（使用SDK：`tradeCtx.accountBalance()`）
- ✅ `POST /api/orders/sync-status` - 同步订单状态（混合使用SDK和数据库）

**前端API（`frontend/lib/api.ts`）：**
- ✅ `ordersApi.getTodayOrders()` - 查询今日订单
- ✅ `ordersApi.getOrderDetail()` - 查询订单详情
- ✅ `ordersApi.submitOrder()` - 提交订单
- ✅ `ordersApi.replaceOrder()` - 修改订单
- ✅ `ordersApi.cancelOrder()` - 取消订单
- ✅ `ordersApi.getAccountBalance()` - 查询账户余额
- ✅ `ordersApi.syncStatus()` - 同步订单状态

**前端页面：**
- ✅ `frontend/app/trades/page.tsx` - 交易记录页面（**当前从数据库查询**）
- ✅ `frontend/app/orders/page.tsx` - 今日订单页面（从API查询）

### 1.2 缺失功能

根据Longbridge官方SDK，以下功能缺失：

1. **历史订单查询** - `GET /api/orders/history`
   - 使用SDK：`tradeCtx.historyOrders(options)`
   - 支持查询过去90天的订单
   - 支持时间范围筛选（start_at, end_at）
   - 支持更多筛选参数（symbol, status, side, market）
   - 返回 `hasMore` 字段（分页支持）

2. **订单查询参数不完整**
   - 今日订单查询缺少：`side`（买卖方向）、`market`（市场）、`order_id`（订单ID）
   - 历史订单查询完全缺失

### 1.3 核心问题

1. **❌ 仍在使用数据库查询订单**
   - 当前：`GET /api/trades` 从数据库（trades表）查询交易记录
   - 前端：`tradesApi.getTrades()` 调用数据库查询接口
   - 问题：数据可能不同步，需要完全抛弃数据库查询

2. **❌ 数据来源混乱**
   - 当前：交易记录页面从数据库查询，订单页面从API查询
   - 问题：两套数据源，用户体验不一致

3. **❌ 订单数据映射不统一**
   - 当前：手动映射字段，可能遗漏官方API返回的字段
   - 问题：缺少官方API的完整字段（如：`lastDone`, `triggerPrice`, `tag`, `timeInForce`, `expireDate`, `triggerAt`, `trailingAmount`, `trailingPercent`, `limitOffset`, `triggerStatus`, `outsideRth`, `remark`等）

4. **❌ 查询能力受限**
   - 当前：只能查询今日订单，无法查询历史订单
   - 问题：无法进行历史订单分析和统计

5. **❌ 筛选功能不完整**
   - 当前：今日订单只支持 `symbol` 和 `status` 筛选
   - 问题：无法按买卖方向、市场、订单ID等筛选

6. **❌ 前端页面体验不佳**
   - 当前：交易记录页面和订单页面分离，功能重复
   - 问题：用户体验不统一，操作不便

---

## 二、重构目标

### 2.1 核心目标

1. **✅ 完全基于Longbridge SDK**
   - **抛弃所有数据库查询订单的逻辑**
   - 所有订单查询直接调用Longbridge SDK（`tradeCtx.todayOrders()`, `tradeCtx.historyOrders()`, `tradeCtx.orderDetail()`）
   - 数据库（trades表）仅作为交易记录日志，**不再用于查询**
   - 保持数据一致性，避免数据不同步问题

2. **✅ 统一订单数据格式**
   - 统一使用Longbridge SDK返回的完整订单数据结构
   - 保留所有官方字段，不丢失信息
   - 统一字段命名规范（camelCase）
   - 创建统一的订单数据映射函数

3. **✅ 完善查询功能**
   - 添加历史订单查询接口（使用 `tradeCtx.historyOrders()`）
   - 完善今日订单查询的筛选参数（side, market, order_id）
   - 支持分页查询（历史订单）

4. **✅ 重构前端页面**
   - 统一订单管理页面，整合今日订单和历史订单
   - 优化用户体验，让操作更便捷
   - 移除对数据库查询的依赖

### 2.2 架构设计

```
┌─────────────────┐
│   前端页面       │
│  (React/Next.js) │
│  - 订单管理页面   │
│  - 统一查询界面   │
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│  前端API客户端   │
│  (ordersApi)    │
│  - getTodayOrders│
│  - getHistoryOrders│
│  - getOrderDetail│
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│   后端API路由    │
│  (/api/orders)  │
│  使用SDK调用     │
└────────┬─────────┘
         │
         ▼
┌─────────────────┐      ┌─────────────────┐
│ Longbridge SDK  │      │   数据库(trades) │
│  (唯一数据源)   │      │   (仅日志记录)   │
│                 │      │   (不再查询)     │
└─────────────────┘      └─────────────────┘
```

**数据流向：**
- **查询订单**：前端 → 后端API → Longbridge SDK（唯一数据源）
- **提交订单**：前端 → 后端API → Longbridge SDK → 数据库（仅日志记录）
- **不再使用**：数据库查询订单功能（完全移除）

---

## 三、重构步骤

### 步骤1：创建统一的订单数据映射函数

**后端实现（`api/src/routes/orders.ts`）：**

```typescript
/**
 * 统一映射订单数据
 * 将Longbridge SDK返回的订单数据映射为统一格式
 * 保留所有官方字段
 */
function mapOrderData(order: any): OrderResponse {
  return {
    // 基础字段
    orderId: order.orderId || order.order_id,
    symbol: order.symbol,
    stockName: order.stockName || order.stock_name || '',
    side: normalizeSide(order.side),
    orderType: order.orderType || order.order_type || '',
    status: normalizeStatus(order.status),
    
    // 数量字段
    quantity: order.quantity?.toString() || order.submittedQuantity?.toString() || '0',
    executedQuantity: order.executedQuantity?.toString() || order.executed_quantity?.toString() || '0',
    
    // 价格字段
    price: order.price?.toString() || order.submittedPrice?.toString() || '',
    executedPrice: order.executedPrice?.toString() || order.executed_price?.toString() || '0',
    lastDone: order.lastDone?.toString() || order.last_done?.toString() || '',
    
    // 时间字段
    submittedAt: formatTimestamp(order.submittedAt || order.submitted_at),
    updatedAt: formatTimestamp(order.updatedAt || order.updated_at),
    triggerAt: formatTimestamp(order.triggerAt || order.trigger_at),
    expireDate: order.expireDate || order.expire_date || '',
    
    // 条件单字段
    triggerPrice: order.triggerPrice?.toString() || order.trigger_price?.toString() || '',
    triggerStatus: order.triggerStatus || order.trigger_status || 'NOT_USED',
    
    // 跟踪单字段
    trailingAmount: order.trailingAmount?.toString() || order.trailing_amount?.toString() || '',
    trailingPercent: order.trailingPercent?.toString() || order.trailing_percent?.toString() || '',
    limitOffset: order.limitOffset?.toString() || order.limit_offset?.toString() || '',
    
    // 其他字段
    currency: order.currency || '',
    msg: order.msg || order.remark || '',
    tag: order.tag || 'Normal',
    timeInForce: order.timeInForce || order.time_in_force || 'Day',
    outsideRth: order.outsideRth || order.outside_rth || 'UnknownOutsideRth',
    remark: order.remark || '',
  }
}

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp: any): string {
  if (!timestamp) return ''
  if (typeof timestamp === 'string') {
    if (timestamp.includes('T') || timestamp.includes('-')) {
      return timestamp
    }
    const ts = parseInt(timestamp)
    if (!isNaN(ts)) {
      return new Date(ts * 1000).toISOString()
    }
  }
  if (typeof timestamp === 'number') {
    return new Date(timestamp * 1000).toISOString()
  }
  if (timestamp instanceof Date) {
    return timestamp.toISOString()
  }
  return ''
}
```

### 步骤2：添加历史订单查询接口（使用SDK）

**后端实现（`api/src/routes/orders.ts`）：**

```typescript
// 导入必要的枚举类型
import { getTradeContext, Decimal, OrderType, OrderSide, TimeInForceType, OrderStatus, Market } from '../config/longport';

/**
 * 将字符串状态转换为OrderStatus枚举值
 */
function parseOrderStatus(statusStr: string): OrderStatus | undefined {
  // 根据官方文档：https://open.longbridge.com/zh-CN/docs/trade/trade-definition#orderstatus
  const statusMap: Record<string, OrderStatus> = {
    'NotReported': OrderStatus.NotReported,
    'ReplacedNotReported': OrderStatus.ReplacedNotReported,
    'ProtectedNotReported': OrderStatus.ProtectedNotReported,
    'VarietiesNotReported': OrderStatus.VarietiesNotReported,
    'Filled': OrderStatus.Filled,
    'FilledStatus': OrderStatus.Filled,
    'PartialFilled': OrderStatus.PartialFilled,
    'PartialFilledStatus': OrderStatus.PartialFilled,
    'New': OrderStatus.New,
    'NewStatus': OrderStatus.New,
    'WaitToNew': OrderStatus.WaitToNew,
    'Canceled': OrderStatus.Canceled,
    'CanceledStatus': OrderStatus.Canceled,
    'PendingCancelStatus': OrderStatus.PendingCancelStatus,
    'WaitToCancel': OrderStatus.WaitToCancel,
    'Rejected': OrderStatus.Rejected,
    'RejectedStatus': OrderStatus.Rejected,
    'Expired': OrderStatus.Expired,
    'ExpiredStatus': OrderStatus.Expired,
    'WaitToReplace': OrderStatus.WaitToReplace,
    'PendingReplaceStatus': OrderStatus.PendingReplaceStatus,
    'ReplacedStatus': OrderStatus.ReplacedStatus,
    'PartialWithdrawal': OrderStatus.PartialWithdrawal,
  };
  return statusMap[statusStr];
}

/**
 * 解析日期参数（支持时间戳秒、ISO字符串、Date对象）
 */
function parseDate(dateInput: any): Date {
  if (dateInput instanceof Date) {
    return dateInput;
  }
  if (typeof dateInput === 'string') {
    // ISO字符串
    if (dateInput.includes('T') || dateInput.includes('-')) {
      return new Date(dateInput);
    }
    // 时间戳字符串（秒）
    const ts = parseInt(dateInput);
    if (!isNaN(ts)) {
      return new Date(ts * 1000);
    }
  }
  if (typeof dateInput === 'number') {
    // 时间戳（秒）
    return new Date(dateInput * 1000);
  }
  throw new Error(`Invalid date format: ${dateInput}`);
}

/**
 * GET /api/orders/history
 * 查询历史订单（过去90天）
 * 使用SDK: tradeCtx.historyOrders(options)
 * 参考：https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#historyorders
 */
ordersRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const { symbol, status, side, market, start_at, end_at } = req.query;

    const tradeCtx = await getTradeContext();
    
    // 构建查询选项（SDK格式，使用枚举值）
    const options: any = {};
    
    if (symbol) {
      options.symbol = symbol as string;
    }
    
    if (status) {
      // status可以是逗号分隔的字符串，如："Filled,New" 或数组
      const statusList = typeof status === 'string' 
        ? status.split(',').map(s => s.trim())
        : Array.isArray(status) ? status : [];
      
      // 转换为OrderStatus枚举值数组
      const statusEnums = statusList
        .map(s => parseOrderStatus(s))
        .filter((s): s is OrderStatus => s !== undefined);
      
      if (statusEnums.length > 0) {
        options.status = statusEnums;
      }
    }
    
    if (side) {
      // 使用OrderSide枚举值
      options.side = side === 'Buy' || side === 'buy' ? OrderSide.Buy : OrderSide.Sell;
    }
    
    if (market) {
      // 使用Market枚举值
      options.market = market === 'US' || market === 'us' ? Market.US : Market.HK;
    }
    
    if (start_at) {
      // SDK需要Date对象
      options.startAt = parseDate(start_at);
    }
    
    if (end_at) {
      // SDK需要Date对象
      options.endAt = parseDate(end_at);
    }
    
    // 调用SDK查询历史订单
    // 参考官方示例：ctx.historyOrders({ symbol: "700.HK", status: [OrderStatus.Filled, OrderStatus.New], ... })
    const orders = await tradeCtx.historyOrders(options);
    
    // 使用统一映射函数
    const mappedOrders = orders.map(mapOrderData);
    
    res.json({
      success: true,
      data: {
        orders: mappedOrders,
        // 注意：SDK返回的是Order[]数组，没有hasMore字段
        // 如果需要分页，需要根据返回数量判断（每次最多1000条）
        hasMore: orders.length >= 1000,
      },
    });
  } catch (error: any) {
    console.error('查询历史订单失败:', error);
    
    // 处理频率限制错误
    if (error.message && (error.message.includes('429') || error.message.includes('429002'))) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: 'API请求频率过高，请稍后再试。',
        },
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'QUERY_HISTORY_ORDERS_FAILED',
        message: error.message || '查询历史订单失败',
      },
    });
  }
})
```

**前端API实现（`frontend/lib/api.ts`）：**

```typescript
export const ordersApi = {
  // ... 现有方法
  
  /**
   * 查询历史订单
   */
  getHistoryOrders: (params?: {
    symbol?: string
    status?: string[]
    side?: 'Buy' | 'Sell'
    market?: 'US' | 'HK'
    start_at?: number | string  // 时间戳（秒）或ISO字符串
    end_at?: number | string    // 时间戳（秒）或ISO字符串
  }) => {
    return api.get('/orders/history', { params })
  },
}
```

**时间参数处理：**
- 前端可以传递：时间戳（秒）、ISO字符串、Date对象
- 后端需要转换为 `Date` 对象传递给SDK
- 如果不提供时间参数，SDK默认查询最近90天
- SDK要求：`startAt` 和 `endAt` 必须是 `Date` 对象

---

### 步骤3：完善今日订单查询接口（使用SDK）

**后端优化（`api/src/routes/orders.ts`）：**

```typescript
/**
 * GET /api/orders/today
 * 查询今日订单（增强版）
 * 使用SDK: tradeCtx.todayOrders(options)
 * 参考：https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#todayorders
 */
ordersRouter.get('/today', async (req: Request, res: Response) => {
  try {
    const { symbol, status, side, market, order_id } = req.query;

    const tradeCtx = await getTradeContext();
    
    // 构建查询选项（SDK格式，使用枚举值）
    const options: any = {};
    
    if (symbol) {
      options.symbol = symbol as string;
    }
    
    if (status) {
      // status可以是逗号分隔的字符串，如："Filled,New" 或数组
      const statusList = typeof status === 'string' 
        ? status.split(',').map(s => s.trim())
        : Array.isArray(status) ? status : [];
      
      // 转换为OrderStatus枚举值数组
      const statusEnums = statusList
        .map(s => parseOrderStatus(s))
        .filter((s): s is OrderStatus => s !== undefined);
      
      if (statusEnums.length > 0) {
        options.status = statusEnums;
      }
    }
    
    if (side) {
      // 使用OrderSide枚举值
      options.side = side === 'Buy' || side === 'buy' ? OrderSide.Buy : OrderSide.Sell;
    }
    
    if (market) {
      // 使用Market枚举值
      options.market = market === 'US' || market === 'us' ? Market.US : Market.HK;
    }
    
    if (order_id) {
      options.orderId = order_id as string;
    }
    
    // 调用SDK查询今日订单
    // 参考官方示例：ctx.todayOrders({ symbol: "700.HK", status: [OrderStatus.Filled, OrderStatus.New], ... })
    const orders = await tradeCtx.todayOrders(options);
    
    // 使用统一映射函数（移除数据库同步逻辑）
    const mappedOrders = orders.map(mapOrderData);
    
    res.json({
      success: true,
      data: {
        orders: mappedOrders,
      },
    });
  } catch (error: any) {
    console.error('查询今日订单失败:', error);
    
    // 处理频率限制错误
    if (error.message && (error.message.includes('429') || error.message.includes('429002'))) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT',
          message: 'API请求频率过高，请稍后再试。',
        },
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'QUERY_TODAY_ORDERS_FAILED',
        message: error.message || '查询今日订单失败',
      },
    });
  }
})
```

**关键变更：**
- ✅ 移除数据库同步逻辑（不再更新trades表）
- ✅ 使用统一映射函数 `mapOrderData()`
- ✅ 支持新增筛选参数（side, market, order_id）
- ✅ **使用枚举值**：`OrderStatus.Filled`, `OrderSide.Buy`, `Market.HK`

**前端API优化（`frontend/lib/api.ts`）：**

```typescript
getTodayOrders: (params?: {
  symbol?: string
  status?: string[]
  side?: 'Buy' | 'Sell'      // 新增
  market?: 'US' | 'HK'       // 新增
  order_id?: string          // 新增
}) => {
  return api.get('/orders/today', { params })
}
```

---

### 步骤4：优化订单详情查询（使用SDK）

**后端优化（`api/src/routes/orders.ts`）：**

```typescript
/**
 * GET /api/orders/:orderId
 * 查询订单详情
 * 使用SDK: tradeCtx.orderDetail(orderId)
 * 参考：https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#orderdetail
 */
ordersRouter.get('/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少订单ID',
        },
      });
    }

    const tradeCtx = await getTradeContext();
    
    // 调用SDK查询订单详情
    // 参考官方示例：ctx.orderDetail("701276261045858304")
    const orderDetail = await tradeCtx.orderDetail(orderId);
    
    // 使用统一映射函数
    const mappedOrder = mapOrderData(orderDetail);
    
    res.json({
      success: true,
      data: {
        order: mappedOrder,
      },
    });
  } catch (error: any) {
    console.error('查询订单详情失败:', error);
    
    // 处理订单不存在错误
    if (error.message && (error.message.includes('602023') || error.message.includes('not found'))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: '订单不存在或已过期',
        },
      });
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'QUERY_ORDER_DETAIL_FAILED',
        message: error.message || '查询订单详情失败',
      },
    });
  }
})
```

**关键变更：**
- ✅ 移除数据库更新逻辑（不再更新trades表）
- ✅ 使用统一映射函数 `mapOrderData()`
- ✅ 返回完整订单信息（所有官方字段）
- ✅ **直接使用SDK**：`tradeCtx.orderDetail(orderId)`

---

### 步骤5：移除数据库查询接口

**后端移除（`api/src/routes/trades.ts`）：**

```typescript
// ❌ 移除或废弃以下接口：
// GET /api/trades - 不再从数据库查询交易记录
// 或者保留但标记为废弃，重定向到订单API
```

**前端API更新（`frontend/lib/api.ts`）：**

```typescript
// ❌ 移除或废弃：
// tradesApi.getTrades() - 不再使用数据库查询

// ✅ 新增：
export const ordersApi = {
  // ... 现有方法
  
  /**
   * 查询历史订单
   */
  getHistoryOrders: (params?: {
    symbol?: string
    status?: string[]
    side?: 'Buy' | 'Sell'
    market?: 'US' | 'HK'
    start_at?: number | string  // 时间戳（秒）或ISO字符串
    end_at?: number | string    // 时间戳（秒）或ISO字符串
  }) => {
    return api.get('/orders/history', { params })
  },
  
  // 更新今日订单查询（新增参数）
  getTodayOrders: (params?: {
    symbol?: string
    status?: string[]
    side?: 'Buy' | 'Sell'      // 新增
    market?: 'US' | 'HK'       // 新增
    order_id?: string          // 新增
  }) => {
    return api.get('/orders/today', { params })
  },
}
```

### 步骤6：重构前端页面（统一订单管理）

**方案A：统一订单管理页面（推荐）**

创建新的统一订单管理页面 `frontend/app/orders/page.tsx`：

```typescript
// 功能特性：
// 1. Tab切换：今日订单 / 历史订单
// 2. 统一的筛选器：
//    - 标的代码
//    - 订单状态
//    - 买卖方向（Buy/Sell）
//    - 市场（US/HK）
//    - 订单ID搜索
//    - 时间范围（历史订单）
// 3. 统一的订单列表展示
// 4. 订单详情弹窗
// 5. 订单操作（取消、修改）

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState<'today' | 'history'>('today')
  const [filters, setFilters] = useState({
    symbol: '',
    status: [] as string[],
    side: '' as 'Buy' | 'Sell' | '',
    market: '' as 'US' | 'HK' | '',
    order_id: '',
    start_at: '',
    end_at: '',
  })
  
  // 查询今日订单
  const fetchTodayOrders = async () => {
    const response = await ordersApi.getTodayOrders({
      symbol: filters.symbol || undefined,
      status: filters.status.length > 0 ? filters.status : undefined,
      side: filters.side || undefined,
      market: filters.market || undefined,
      order_id: filters.order_id || undefined,
    })
    // ...
  }
  
  // 查询历史订单
  const fetchHistoryOrders = async () => {
    const response = await ordersApi.getHistoryOrders({
      symbol: filters.symbol || undefined,
      status: filters.status.length > 0 ? filters.status : undefined,
      side: filters.side || undefined,
      market: filters.market || undefined,
      start_at: filters.start_at || undefined,
      end_at: filters.end_at || undefined,
    })
    // ...
  }
  
  // ...
}
```

**方案B：保留分离页面但统一数据源**

- `frontend/app/orders/page.tsx` - 今日订单（使用SDK）
- `frontend/app/orders/history/page.tsx` - 历史订单（使用SDK）
- `frontend/app/trades/page.tsx` - **重构为使用订单API，不再查询数据库**

**推荐方案A**：统一页面，用户体验更好。

### 步骤7：移除或重构交易记录页面

**选项1：完全移除 `frontend/app/trades/page.tsx`**
- 所有功能整合到订单管理页面

**选项2：重构为订单查询页面**
- 移除数据库查询逻辑
- 使用订单API（今日+历史）
- 保留页面但改变数据源

---

### 步骤8：更新API文档

**更新 `TRADE_RECORD_ORDER_MANAGEMENT.md`：**

1. ✅ 添加历史订单查询接口文档（使用SDK）
2. ✅ 更新今日订单查询接口文档（新增参数，使用SDK）
3. ✅ 更新订单数据字段说明（完整字段列表）
4. ✅ 更新使用示例（SDK调用方式）
5. ✅ **标记数据库查询接口为废弃**（`GET /api/trades`）

---

### 步骤9：测试验证

**测试清单：**

1. **历史订单查询**
   - ✅ 查询最近90天订单
   - ✅ 按时间范围查询
   - ✅ 按标的代码筛选
   - ✅ 按状态筛选
   - ✅ 按买卖方向筛选
   - ✅ 按市场筛选
   - ✅ 分页查询（hasMore）

2. **今日订单查询**
   - ✅ 新增筛选参数（side, market, order_id）
   - ✅ 向后兼容（不传新参数也能正常工作）

3. **订单详情查询**
   - ✅ 返回完整字段
   - ✅ 时间字段格式化正确

4. **数据一致性**
   - ✅ 所有接口返回的订单数据格式一致
   - ✅ 字段命名统一（camelCase）

---

## 四、实施优先级

### 高优先级（核心功能 - 必须完成）

1. ✅ **步骤1：创建统一的订单数据映射函数**
   - 保证数据一致性
   - 避免重复代码
   - 所有后续步骤依赖此函数

2. ✅ **步骤2：添加历史订单查询接口（使用SDK）**
   - 这是缺失的核心功能
   - 使用 `tradeCtx.historyOrders()`
   - 用户需要查询历史订单

3. ✅ **步骤3：完善今日订单查询接口（使用SDK）**
   - 移除数据库同步逻辑
   - 增强筛选能力（side, market, order_id）
   - 使用统一映射函数

4. ✅ **步骤4：优化订单详情查询（使用SDK）**
   - 移除数据库更新逻辑
   - 使用统一映射函数
   - 返回完整字段

5. ✅ **步骤5：移除数据库查询接口**
   - 废弃 `GET /api/trades`
   - 更新前端API，移除 `tradesApi.getTrades()`

### 中优先级（重要功能）

6. ✅ **步骤6：重构前端页面（统一订单管理）**
   - 创建统一的订单管理页面
   - 整合今日订单和历史订单
   - 优化用户体验

7. ✅ **步骤7：移除或重构交易记录页面**
   - 移除数据库查询逻辑
   - 使用订单API替代

### 低优先级（文档和测试）

8. ✅ **步骤8：更新API文档**
   - 保持文档同步
   - 标记废弃接口

9. ✅ **步骤9：测试验证**
   - 在开发过程中逐步测试
   - 确保功能正常

---

## 五、注意事项

### 5.1 SDK调用方式

**重要：必须使用Longbridge SDK，不是HTTP API**

参考官方文档：
- [historyOrders](https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#historyorders)
- [todayOrders](https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#todayorders)
- [orderDetail](https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#orderdetail)
- [交易命名词典](https://open.longbridge.com/zh-CN/docs/trade/trade-definition)

```typescript
// ✅ 正确：使用SDK
const tradeCtx = await getTradeContext();
const orders = await tradeCtx.todayOrders(options);
const historyOrders = await tradeCtx.historyOrders(options);
const orderDetail = await tradeCtx.orderDetail(orderId);

// ❌ 错误：不要直接调用HTTP API
// fetch('https://openapi.longportapp.com/v1/trade/order/today')
```

**SDK参数格式（必须使用枚举值）：**

```typescript
// ✅ 正确：使用枚举值
const options = {
  symbol: "700.HK",
  status: [OrderStatus.Filled, OrderStatus.New],  // 枚举值数组
  side: OrderSide.Buy,                            // 枚举值
  market: Market.HK,                              // 枚举值
  startAt: new Date(2022, 5, 9),                 // Date对象
  endAt: new Date(2022, 5, 12),                   // Date对象
  orderId: "701276261045858304"                   // 字符串
};

// ❌ 错误：不要使用字符串
const wrongOptions = {
  status: ["Filled", "New"],  // ❌ 错误
  side: "Buy",                // ❌ 错误
  market: "HK",               // ❌ 错误
};
```

**枚举值导入：**

```typescript
import { 
  getTradeContext, 
  OrderType, 
  OrderSide, 
  OrderStatus,    // 需要导入
  Market,         // 需要导入
  TimeInForceType,
  Decimal 
} from '../config/longport';
```

**OrderStatus枚举值（参考官方文档）：**
- `OrderStatus.NotReported` - 待提交
- `OrderStatus.Filled` - 已成交
- `OrderStatus.PartialFilled` - 部分成交
- `OrderStatus.New` - 已委托
- `OrderStatus.Canceled` - 已撤单
- `OrderStatus.Rejected` - 已拒绝
- `OrderStatus.Expired` - 已过期
- 等等（参考[交易命名词典](https://open.longbridge.com/zh-CN/docs/trade/trade-definition#orderstatus)）

**OrderSide枚举值：**
- `OrderSide.Buy` - 买入
- `OrderSide.Sell` - 卖出

**Market枚举值：**
- `Market.US` - 美股
- `Market.HK` - 港股

**时间参数：**
- `startAt` / `endAt`: 必须是 `Date` 对象
- 示例：`new Date(2022, 5, 9)` 或 `new Date('2022-05-09T00:00:00Z')`

### 5.2 数据一致性

- ✅ **订单查询完全从Longbridge SDK获取**（唯一数据源）
- ✅ **数据库（trades表）仅作为日志记录**（不再查询）
- ⚠️ **sync-status接口可以保留**（用于批量同步日志，但不影响查询）

### 5.3 向后兼容性

- ⚠️ **破坏性变更**：`GET /api/trades` 接口将被废弃
- ✅ **新增接口**：`GET /api/orders/history`（不影响现有功能）
- ✅ **增强接口**：`GET /api/orders/today`（新增参数可选，向后兼容）

### 5.4 频率限制

- Longbridge SDK有频率限制
- 历史订单查询建议添加缓存（可选）
- 前端自动刷新间隔保持30秒
- 处理429错误（频率限制）

### 5.5 错误处理

- 统一错误处理格式
- 处理频率限制错误（429）
- 处理无效参数错误（400）
- 处理SDK初始化错误

### 5.6 时间参数格式

- 支持时间戳（秒）：`1650410999`
- 支持ISO字符串：`2022-05-09T00:00:00Z`
- 支持Date对象（前端）
- SDK需要Date对象或时间戳（秒）

---

## 六、预期效果

### 6.1 功能完善

- ✅ **完全基于SDK**：所有订单查询使用Longbridge SDK
- ✅ **支持查询历史订单**：过去90天的订单
- ✅ **支持更多筛选条件**：side, market, order_id, 时间范围
- ✅ **返回完整的订单信息**：所有官方字段（lastDone, triggerPrice等）

### 6.2 代码质量

- ✅ **统一的数据映射函数**：避免重复代码
- ✅ **统一的数据格式**：保证一致性
- ✅ **清晰的代码结构**：易于维护
- ✅ **移除数据库查询逻辑**：简化代码，减少维护成本

### 6.3 用户体验

- ✅ **统一的订单管理页面**：今日订单和历史订单整合
- ✅ **更强大的查询能力**：多维度筛选
- ✅ **更完整的订单信息**：显示所有字段
- ✅ **更好的筛选体验**：统一的筛选器UI
- ✅ **数据实时性**：直接从SDK获取最新数据

---

## 七、风险评估

### 7.1 需要注意的风险

- ⚠️ **破坏性变更**：废弃 `GET /api/trades` 接口
  - 影响：前端交易记录页面需要重构
  - 缓解：可以保留接口但标记为废弃，逐步迁移

- ⚠️ **频率限制**：需要合理控制查询频率
  - 影响：频繁查询可能触发429错误
  - 缓解：添加缓存，控制刷新间隔

- ⚠️ **数据量**：历史订单可能很多，需要分页
  - 影响：一次性查询可能返回大量数据
  - 缓解：SDK支持分页（hasMore字段）

- ⚠️ **时间格式**：需要统一处理不同格式
  - 影响：前端传递的时间格式可能不一致
  - 缓解：统一时间格式转换函数

- ⚠️ **SDK版本兼容性**：确保SDK版本正确
  - 影响：SDK API可能变化
  - 缓解：使用官方文档的最新版本

### 7.2 低风险

- ✅ SDK稳定：Longbridge SDK经过验证
- ✅ 数据可靠：直接从官方SDK获取数据
- ✅ 向后兼容：新增参数可选，不影响现有功能

---

## 八、后续优化建议

1. **添加订单缓存**
   - 缓存今日订单（5分钟）
   - 缓存历史订单（按日期缓存）
   - 减少SDK调用次数

2. **添加订单统计**
   - 按日期统计订单数量
   - 按状态统计订单分布
   - 按标的代码统计交易量
   - 盈亏统计

3. **添加订单导出**
   - 导出为CSV格式
   - 导出为Excel格式
   - 支持自定义字段

4. **添加订单搜索**
   - 全文搜索订单信息
   - 按订单ID快速查找
   - 高级搜索（多条件组合）

5. **优化页面性能**
   - 虚拟滚动（大量订单）
   - 懒加载（分页加载）
   - 防抖搜索（减少API调用）

---

## 九、总结

本次重构的核心目标是：

1. **✅ 完全基于Longbridge SDK** - 所有订单查询直接使用SDK（`tradeCtx.todayOrders()`, `tradeCtx.historyOrders()`, `tradeCtx.orderDetail()`）
2. **✅ 抛弃数据库查询** - 移除所有从数据库查询订单的逻辑，数据库仅作为日志记录
3. **✅ 统一数据格式** - 使用统一的映射函数，保证数据一致性
4. **✅ 完善查询功能** - 添加历史订单查询，增强筛选能力
5. **✅ 重构前端页面** - 统一订单管理页面，优化用户体验

**关键变更：**
- ❌ 移除：`GET /api/trades` 数据库查询接口
- ❌ 移除：前端 `tradesApi.getTrades()` 数据库查询
- ✅ 新增：`GET /api/orders/history` SDK查询接口
- ✅ 增强：`GET /api/orders/today` 支持更多筛选参数
- ✅ 重构：前端统一订单管理页面

**SDK调用关键点：**

1. **必须使用枚举值**（不是字符串）：
   ```typescript
   // ✅ 正确
   status: [OrderStatus.Filled, OrderStatus.New]
   side: OrderSide.Buy
   market: Market.HK
   
   // ❌ 错误
   status: ["Filled", "New"]
   side: "Buy"
   market: "HK"
   ```

2. **时间参数必须是Date对象**：
   ```typescript
   // ✅ 正确
   startAt: new Date(2022, 5, 9)
   endAt: new Date('2022-05-12T00:00:00Z')
   
   // ❌ 错误
   startAt: "2022-05-09"
   startAt: 1650410999
   ```

3. **导入必要的枚举类型**：
   ```typescript
   import { 
     OrderStatus,  // 新增
     Market,       // 新增
     OrderSide, 
     OrderType 
   } from '../config/longport';
   ```

4. **参考官方文档**：
   - [historyOrders](https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#historyorders)
   - [todayOrders](https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#todayorders)
   - [orderDetail](https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#orderdetail)
   - [交易命名词典](https://open.longbridge.com/zh-CN/docs/trade/trade-definition)

重构后，订单管理功能将更加完善、统一、可靠，完全基于官方SDK，数据实时准确。

