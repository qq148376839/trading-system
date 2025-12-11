# 期权图表功能 API 缺失分析

**状态**: ✅ 已完成  
**完成日期**: 2025-12-08  
**实施总结**: [期权图表功能实施总结](features/OPTION_CHART_IMPLEMENTATION.md)

## 📋 概述

期权详情页面（`/options/[optionCode]`）图表功能已实现，支持以下图表类型：
- **分时图**（minute）：实时价格走势 ✅
- **5日图**（5day）：5日K线走势 ✅
- **日K图**（day）：日K线数据 ✅

## 🔍 API 分析

### 1. 日K线 API

**接口地址：**
```
GET https://www.moomoo.com/quote-api/quote-v2/get-kline
```

**请求参数：**
- `stockId`: 期权ID（例如：63746133）
- `marketType`: 市场类型（2 = 美股）
- `type`: K线类型（2 = 日K）
- `marketCode`: 市场代码（41）
- `instrumentType`: 工具类型（8 = 期权）
- `subInstrumentType`: 子工具类型（8002）
- `_`: 时间戳（毫秒级，防缓存）

**响应数据结构：**
```json
{
  "code": 0,
  "message": "成功",
  "data": {
    "list": [
      {
        "k": 1761796800,      // 时间戳（秒）
        "o": "49.13",          // 开盘价
        "c": "46.6",           // 收盘价
        "h": "49.4",           // 最高价
        "l": "44.42",          // 最低价
        "v": 12,               // 成交量
        "t": 56523,            // 成交额
        "r": null,
        "lc": 49.13,           // 昨收
        "cp": "-2.53",         // 涨跌额
        "oi": "9"              // 持仓量（可选）
      }
    ]
  }
}
```

### 2. 分时图 API

**接口地址：**
```
GET https://www.moomoo.com/quote-api/quote-v2/get-quote-minute
```

**请求参数：**
- `stockId`: 期权ID（例如：63746133）
- `marketType`: 市场类型（2 = 美股）
- `type`: 数据类型（1 = 分时）
- `marketCode`: 市场代码（41）
- `instrumentType`: 工具类型（8 = 期权）
- `subInstrumentType`: 子工具类型（8002）
- `_`: 时间戳（毫秒级，防缓存）

**响应数据结构：**
```json
{
  "code": 0,
  "message": "成功",
  "data": {
    "stockId": 63746133,
    "list": [
      {
        "time": 1765204260,    // 时间戳（秒）
        "price": 28850,        // 价格（分，需要除以1000）
        "cc_price": 28.85,     // 价格（元）
        "volume": 3,            // 成交量
        "turnover": 8770,       // 成交额
        "ratio": "-21.28",     // 涨跌幅（%）
        "change_price": -7.8    // 涨跌额
      }
    ]
  }
}
```

### 3. 5日图

5日图可以通过日K线API获取最近5天的数据，前端进行筛选显示。

## 🛠️ 实现方案

### 后端实现

#### 1. 服务层 (`futunn-option-chain.service.ts`)

添加两个新函数：

```typescript
/**
 * 获取期权K线数据（日K）
 * @param optionId 期权ID
 * @param marketType 市场类型（默认2=美股）
 * @param count 数据条数（默认100）
 */
export async function getOptionKline(
  optionId: string,
  marketType: number = 2,
  count: number = 100
): Promise<Array<{
  timestamp: number;      // 时间戳（秒）
  open: number;           // 开盘价
  close: number;          // 收盘价
  high: number;           // 最高价
  low: number;            // 最低价
  volume: number;         // 成交量
  turnover: number;       // 成交额
  prevClose: number;      // 昨收
  change: number;         // 涨跌额
  openInterest?: number;  // 持仓量（可选）
}>>

/**
 * 获取期权分时数据
 * @param optionId 期权ID
 * @param marketType 市场类型（默认2=美股）
 */
export async function getOptionMinute(
  optionId: string,
  marketType: number = 2
): Promise<Array<{
  timestamp: number;      // 时间戳（秒）
  price: number;          // 价格
  volume: number;         // 成交量
  turnover: number;       // 成交额
  changeRatio: number;    // 涨跌幅（%）
  changePrice: number;    // 涨跌额
}>>
```

#### 2. 路由层 (`options.ts`)

添加两个新端点：

```typescript
/**
 * GET /api/options/kline
 * 获取期权K线数据（日K）
 * 
 * 请求参数：
 * - optionId: string (必需) - 期权ID
 * - marketType: number (可选) - 市场类型，默认2（美股）
 * - count: number (可选) - 数据条数，默认100
 */
optionsRouter.get('/kline', rateLimiter, async (req, res, next) => {
  // 实现逻辑
})

/**
 * GET /api/options/minute
 * 获取期权分时数据
 * 
 * 请求参数：
 * - optionId: string (必需) - 期权ID
 * - marketType: number (可选) - 市场类型，默认2（美股）
 */
optionsRouter.get('/minute', rateLimiter, async (req, res, next) => {
  // 实现逻辑
})
```

### 前端实现

#### 1. API 客户端 (`lib/api.ts`)

在 `optionsApi` 中添加：

```typescript
/**
 * 获取期权K线数据（日K）
 * @param optionId 期权ID
 * @param marketType 市场类型（可选，默认2=美股）
 * @param count 数据条数（可选，默认100）
 */
getOptionKline: (params: {
  optionId: string
  marketType?: number
  count?: number
}) => {
  return api.get('/options/kline', { params })
},

/**
 * 获取期权分时数据
 * @param optionId 期权ID
 * @param marketType 市场类型（可选，默认2=美股）
 */
getOptionMinute: (params: {
  optionId: string
  marketType?: number
}) => {
  return api.get('/options/minute', { params })
},
```

#### 2. 期权详情页面 (`app/options/[optionCode]/page.tsx`)

实现图表功能：
- 使用 `Recharts` 库绘制图表（项目中已安装）
- 根据 `chartType` 状态切换显示不同的图表
- 分时图：使用 `LineChart` 显示价格走势
- 日K图：使用 `CandlestickChart` 或 `BarChart` 显示K线
- 5日图：从日K数据中筛选最近5天，使用相同图表类型

## 📝 注意事项

1. **认证信息**：需要使用 `moomooProxy` 工具，它会自动处理 cookies、CSRF token 和 quote-token
2. **数据格式转换**：
   - 分时数据中的 `price` 字段可能是分（需要除以1000）或元（`cc_price`），优先使用 `cc_price`
   - 时间戳需要转换为 Date 对象用于图表显示
3. **错误处理**：API 调用失败时应显示友好的错误提示
4. **加载状态**：数据加载时显示 `Spin` 组件
5. **数据缓存**：可以考虑在前端缓存数据，避免频繁请求

## 🎯 实现优先级

1. **P0（高优先级）**：
   - 日K线数据获取和显示
   - 分时数据获取和显示

2. **P1（中优先级）**：
   - 5日图（从日K数据筛选）
   - 图表交互功能（缩放、提示等）

3. **P2（低优先级）**：
   - 数据缓存优化
   - 图表样式美化

## 🔗 相关文件

- 后端服务：`trading-system/api/src/services/futunn-option-chain.service.ts`
- 后端路由：`trading-system/api/src/routes/options.ts`
- 前端API：`trading-system/frontend/lib/api.ts`
- 前端页面：`trading-system/frontend/app/options/[optionCode]/page.tsx`
- 代理工具：`trading-system/api/src/utils/moomoo-proxy.ts`
- 参考实现：`trading-system/api/src/services/market-data.service.ts`

