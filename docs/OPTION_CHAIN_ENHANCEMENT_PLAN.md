# 期权链功能优化计划

## 📋 文档概述

本文档记录期权链功能的后续优化计划和新功能需求，包括用户体验改进、功能增强和交易集成。

**文档日期**: 2025-01-XX  
**项目**: trading-system  
**功能模块**: 期权链展示和交易

---

## 🎯 新功能需求

### 1. 主页股票跳转到期权链功能

**需求描述**:
- 在主页（或其他股票列表页面）中，为每个股票添加"查看期权"按钮
- 点击后跳转到该股票的期权链页面
- 支持返回功能（返回按钮）

**实现方案**:
- 在股票列表组件中添加"期权"按钮/链接
- 使用Next.js路由跳转：`/options/chain?symbol={symbol}`
- 期权链页面已有返回按钮，无需额外实现

**涉及文件**:
- `frontend/app/page.tsx` - 主页
- `frontend/app/quote/page.tsx` - 行情页面（如果需要在行情页面添加）
- `frontend/app/options/chain/page.tsx` - 期权链页面（已有返回按钮）

**优先级**: P0（高优先级）

---

### 2. 期权链表格自动滚动到当前价格附近

**需求描述**:
- 当跳转到期权链页面时，自动获取正股当前价格
- 期权链表格自动滚动到距离当前价格最近的行权价附近
- 高亮显示当前价格所在的行权价行

**实现方案**:
1. **获取正股当前价格**:
   - 新增API接口：获取正股行情（使用富途API）
   - 接口：`GET /api/options/underlying-quote?stockId={stockId}`
   - 返回正股当前价格

2. **计算最近行权价**:
   - 在期权链数据加载完成后，计算所有行权价与当前价格的差值
   - 找到差值最小的行权价

3. **自动滚动**:
   - 使用React的`useRef`和`scrollIntoView`实现滚动
   - 在期权链表格渲染完成后执行滚动

4. **高亮显示**:
   - 为当前价格所在行添加特殊样式（如背景色）

**涉及文件**:
- `api/src/services/futunn-option-chain.service.ts` - 添加获取正股行情函数
- `api/src/routes/options.ts` - 添加获取正股行情路由
- `frontend/app/options/chain/page.tsx` - 实现自动滚动和高亮

**API接口**:

**获取正股行情**:
```typescript
GET /api/options/underlying-quote?stockId={stockId}&symbol={symbol}
```

**请求参数**:
- `stockId`: string (可选) - 正股ID
- `symbol`: string (可选) - 股票代码（如 TSLA.US）

**响应格式**:
```json
{
  "success": true,
  "data": {
    "price": 426.58,
    "change": 7.18,
    "changeRatio": 1.71,
    "priceOpen": 423.95,
    "priceHighest": 426.94,
    "priceLowest": 416.89,
    "volume": 63463000,
    "turnover": 26796000000,
    "priceBid": 426.55,
    "priceAsk": 426.58,
    "volumeBid": 40,
    "volumeAsk": 80,
    "marketStatus": 11,
    "marketStatusText": "休市中"
  }
}
```

**优先级**: P0（高优先级）

---

### 3. 期权交易功能

**需求描述**:
- 在期权详情页添加"交易"按钮
- 点击后打开交易模态框，支持买入/卖出期权
- 集成现有的订单提交API（`/api/orders/submit`）

**实现方案**:
1. **交易模态框**:
   - 复用现有的`TradeModal`组件或创建新的`OptionTradeModal`组件
   - 支持选择：买入/卖出、数量、价格类型（限价/市价）

2. **订单提交**:
   - 使用现有的`ordersApi.submitOrder()`方法
   - 期权代码格式：`TSLA251205P395000.US`
   - 需要验证期权交易权限（长桥API）

3. **交易确认**:
   - 显示订单预览（标的、方向、数量、价格等）
   - 确认后提交订单

**涉及文件**:
- `frontend/components/OptionTradeModal.tsx` - 新建期权交易模态框组件
- `frontend/app/options/[optionCode]/page.tsx` - 添加交易按钮
- `frontend/lib/api.ts` - 已有订单API，无需修改

**交易流程**:
1. 用户在期权详情页点击"交易"按钮
2. 打开交易模态框，显示期权信息
3. 用户选择：买入/卖出、数量、价格类型
4. 点击"提交订单"
5. 调用`ordersApi.submitOrder()`提交订单
6. 显示订单结果（成功/失败）

**注意事项**:
- 期权交易需要长桥API的期权交易权限
- 期权代码格式必须正确：`{SYMBOL}{YYMMDD}{C/P}{STRIKE}.US`
- 需要验证账户是否有足够的资金/保证金

**优先级**: P1（中优先级）

---

## 📊 新增API接口

### 获取正股行情接口

**接口地址**: `GET /api/options/underlying-quote`

**功能**: 获取正股的实时行情（用于期权链页面显示当前价格）

**请求参数**:
- `stockId`: string (可选) - 正股ID
- `symbol`: string (可选) - 股票代码（如 TSLA.US）

**实现位置**:
- 后端服务: `api/src/services/futunn-option-chain.service.ts`
- 后端路由: `api/src/routes/options.ts`

**富途API接口**:
```
GET https://www.moomoo.com/quote-api/quote-v2/get-stock-quote
参数:
  - stockId: 正股ID（如 201335）
  - marketType: 2（美股）
  - marketCode: 11（美股股票）
  - lotSize: 1
  - spreadCode: 45
  - underlyingStockId: 0
  - instrumentType: 3（股票）
  - subInstrumentType: 3002
  - _: 时间戳（毫秒）
```

**响应数据字段**:
- `price`: 当前价格
- `change`: 涨跌额
- `changeRatio`: 涨跌幅
- `priceOpen`: 开盘价
- `priceHighest`: 最高价
- `priceLowest`: 最低价
- `volume`: 成交量
- `turnover`: 成交额
- `priceBid`: 买盘价
- `priceAsk`: 卖盘价
- `volumeBid`: 买盘量
- `volumeAsk`: 卖盘量
- `marketStatus`: 市场状态
- `marketStatusText`: 市场状态文本

---

## 🔧 实现计划

### 阶段1: 主页跳转功能（预计1天）

**任务清单**:
1. ✅ 在主页添加"查看期权"按钮/链接
2. ✅ 测试跳转功能
3. ✅ 验证返回按钮功能

**文件修改**:
- `frontend/app/page.tsx` - 添加期权链接

---

### 阶段2: 自动滚动功能（预计2-3天）

**任务清单**:
1. ✅ 实现获取正股行情API接口
   - 后端服务函数：`getUnderlyingStockQuote()`
   - 后端路由：`GET /api/options/underlying-quote`
   - 前端API客户端：`optionsApi.getUnderlyingQuote()`

2. ✅ 实现自动滚动逻辑
   - 在期权链页面获取正股当前价格
   - 计算最近行权价
   - 实现表格自动滚动
   - 添加高亮样式

3. ✅ 测试和优化
   - 测试不同价格的股票
   - 测试边界情况（价格超出行权价范围）
   - 优化滚动动画

**文件修改**:
- `api/src/services/futunn-option-chain.service.ts` - 添加获取正股行情函数
- `api/src/routes/options.ts` - 添加获取正股行情路由
- `frontend/lib/api.ts` - 添加前端API方法
- `frontend/app/options/chain/page.tsx` - 实现自动滚动和高亮

---

### 阶段3: 期权交易功能（预计3-5天）

**任务清单**:
1. ✅ 创建期权交易模态框组件
   - `frontend/components/OptionTradeModal.tsx`
   - 支持买入/卖出选择
   - 支持数量输入
   - 支持价格类型选择（限价/市价）
   - 显示订单预览

2. ✅ 集成到期权详情页
   - 在详情页添加"交易"按钮
   - 打开交易模态框
   - 处理订单提交

3. ✅ 错误处理和验证
   - 验证期权代码格式
   - 验证交易权限
   - 验证账户余额
   - 错误提示

4. ✅ 测试
   - 测试买入期权
   - 测试卖出期权
   - 测试错误情况

**文件修改**:
- `frontend/components/OptionTradeModal.tsx` - 新建组件
- `frontend/app/options/[optionCode]/page.tsx` - 添加交易按钮和逻辑

---

## 📝 详细实现说明

### 1. 获取正股行情API实现

**后端服务函数** (`api/src/services/futunn-option-chain.service.ts`):

```typescript
/**
 * 获取正股行情
 * 
 * @param stockId 正股ID
 * @param marketType 市场类型（美股为2）
 * @returns 正股行情数据
 */
export async function getUnderlyingStockQuote(
  stockId: string,
  marketType: number = 2
): Promise<{
  price: number;
  change: number;
  changeRatio: number;
  priceOpen: number;
  priceHighest: number;
  priceLowest: number;
  volume: number;
  turnover: number;
  priceBid: number;
  priceAsk: number;
  volumeBid: number;
  volumeAsk: number;
  marketStatus: number;
  marketStatusText: string;
} | null> {
  const futunnConfig = getFutunnConfig();
  if (!futunnConfig) {
    throw new Error('富途牛牛配置未设置');
  }
  
  const url = 'https://www.moomoo.com/quote-api/quote-v2/get-stock-quote';
  const timestamp = Date.now();
  
  // Token生成使用字符串类型参数
  const paramsForToken = {
    stockId: stockId,
    marketType: String(marketType),
    marketCode: '11', // 美股股票
    lotSize: '1',
    spreadCode: '45',
    underlyingStockId: '0',
    instrumentType: '3', // 股票
    subInstrumentType: '3002',
    _: String(timestamp),
  };
  
  const quoteToken = generateQuoteToken(paramsForToken);
  
  // 使用统一的富途牛牛配置获取headers
  const headers = getFutunnHeaders('https://www.moomoo.com/hans/stock/TSLA-US/options-chain');
  headers['quote-token'] = quoteToken;
  
  // URL参数使用数字类型
  const params: any = {
    stockId: Number(stockId),
    marketType: marketType,
    marketCode: 11,
    lotSize: 1,
    spreadCode: 45,
    underlyingStockId: 0,
    instrumentType: 3,
    subInstrumentType: 3002,
    _: timestamp,
  };
  
  try {
    const response = await axios.get(url, { params, headers, timeout: 10000 });
    
    if (response.data?.code === 0 && response.data?.data) {
      const data = response.data.data;
      
      return {
        price: parsePrice(data.price || '0'),
        change: parsePrice(data.change || '0'),
        changeRatio: parsePercentage(data.changeRatio || '0'),
        priceOpen: parsePrice(data.priceOpen || '0'),
        priceHighest: parsePrice(data.priceHighest || '0'),
        priceLowest: parsePrice(data.priceLowest || '0'),
        volume: parseVolume(data.volume || '0'),
        turnover: parsePrice(data.turnover || '0'),
        priceBid: parsePrice(data.priceBid || '0'),
        priceAsk: parsePrice(data.priceAsk || '0'),
        volumeBid: parseInt(String(data.volumeBid || '0')) || 0,
        volumeAsk: parseInt(String(data.volumeAsk || '0')) || 0,
        marketStatus: data.market_status || 0,
        marketStatusText: data.market_status_text || '',
      };
    }
    
    console.error('获取正股行情失败:', response.data);
    return null;
  } catch (error: any) {
    console.error('获取正股行情失败:', error.message);
    if (error.response) {
      console.error('API响应状态:', error.response.status, error.response.data);
    }
    return null;
  }
}
```

**后端路由** (`api/src/routes/options.ts`):

```typescript
/**
 * GET /api/options/underlying-quote
 * 获取正股行情
 * 
 * 请求参数：
 * - stockId: string (可选) - 正股ID
 * - symbol: string (可选) - 股票代码
 */
optionsRouter.get('/underlying-quote', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { stockId, symbol } = req.query;

    let finalStockId: string | null = null;

    if (stockId && typeof stockId === 'string') {
      finalStockId = stockId;
    } else if (symbol && typeof symbol === 'string') {
      finalStockId = await getStockIdBySymbol(symbol);
      if (!finalStockId) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'STOCK_NOT_FOUND',
            message: `未找到股票: ${symbol}`,
          },
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: '缺少必需参数: stockId 或 symbol',
        },
      });
    }

    const result = await getUnderlyingStockQuote(finalStockId);

    if (!result) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'API_ERROR',
          message: '获取正股行情失败',
        },
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('获取正股行情失败:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || '服务器内部错误',
      },
    });
  }
});
```

---

### 2. 自动滚动实现

**前端实现** (`frontend/app/options/chain/page.tsx`):

```typescript
// 添加状态
const [underlyingPrice, setUnderlyingPrice] = useState<number | null>(null)
const [highlightedStrike, setHighlightedStrike] = useState<string | null>(null)
const tableRef = useRef<HTMLTableElement>(null)
const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())

// 获取正股当前价格
const fetchUnderlyingQuote = async () => {
  if (!symbol || !stockId) return
  
  try {
    const response = await optionsApi.getUnderlyingQuote({ stockId })
    if (response.success && response.data) {
      setUnderlyingPrice(response.data.price)
    }
  } catch (err) {
    console.error('获取正股行情失败:', err)
  }
}

// 计算最近行权价并滚动
useEffect(() => {
  if (optionChain.length > 0 && underlyingPrice !== null) {
    // 找到最近的行权价
    let minDiff = Infinity
    let closestStrike: string | null = null
    
    optionChain.forEach((row) => {
      const strikePrice = parseFloat(row.callOption?.strikePrice || row.putOption?.strikePrice || '0')
      const diff = Math.abs(strikePrice - underlyingPrice)
      if (diff < minDiff) {
        minDiff = diff
        closestStrike = strikePrice.toFixed(2)
      }
    })
    
    if (closestStrike) {
      setHighlightedStrike(closestStrike)
      
      // 延迟滚动，确保DOM已渲染
      setTimeout(() => {
        const rowElement = rowRefs.current.get(closestStrike!)
        if (rowElement) {
          rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 300)
    }
  }
}, [optionChain, underlyingPrice])

// 在获取期权链后获取正股价格
useEffect(() => {
  if (optionChain.length > 0 && stockId) {
    fetchUnderlyingQuote()
  }
}, [optionChain, stockId])

// 在表格行中添加ref和样式
{optionChain.map((row, index) => {
  const strikePrice = row.callOption?.strikePrice || row.putOption?.strikePrice || '0'
  const isHighlighted = highlightedStrike === strikePrice
  
  return (
    <tr
      key={index}
      ref={(el) => {
        if (el) rowRefs.current.set(strikePrice, el)
      }}
      className={`hover:bg-gray-50 ${isHighlighted ? 'bg-yellow-100 border-2 border-yellow-400' : ''}`}
    >
      {/* ... 表格内容 ... */}
    </tr>
  )
})}
```

---

### 3. 期权交易模态框组件

**组件结构** (`frontend/components/OptionTradeModal.tsx`):

```typescript
interface OptionTradeModalProps {
  isOpen: boolean
  onClose: () => void
  optionCode: string
  optionDetail: OptionDetail | null
}

export default function OptionTradeModal({
  isOpen,
  onClose,
  optionCode,
  optionDetail,
}: OptionTradeModalProps) {
  const [side, setSide] = useState<'Buy' | 'Sell'>('Buy')
  const [orderType, setOrderType] = useState<'LO' | 'MO'>('LO')
  const [quantity, setQuantity] = useState<string>('')
  const [price, setPrice] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    // 验证输入
    // 提交订单
    // 显示结果
  }

  return (
    // 模态框UI
  )
}
```

---

## ✅ 验收标准

### 功能1: 主页跳转
- ✅ 主页股票列表显示"期权"按钮/链接
- ✅ 点击后正确跳转到期权链页面
- ✅ 返回按钮正常工作

### 功能2: 自动滚动
- ✅ 期权链页面加载后自动获取正股价格
- ✅ 表格自动滚动到最近行权价
- ✅ 最近行权价行高亮显示
- ✅ 滚动动画流畅

### 功能3: 期权交易
- ✅ 期权详情页显示"交易"按钮
- ✅ 点击后打开交易模态框
- ✅ 可以成功提交买入订单
- ✅ 可以成功提交卖出订单
- ✅ 错误情况正确处理和提示

---

## 📅 时间估算

| 功能 | 预计工时 | 优先级 |
|------|----------|--------|
| 主页跳转功能 | 1天 | P0 |
| 自动滚动功能 | 2-3天 | P0 |
| 期权交易功能 | 3-5天 | P1 |
| **总计** | **6-9天** | |

---

## 🔗 相关文档

- [期权链可行性分析](OPTION_CHAIN_FEASIBILITY_ANALYSIS.md)
- [订单提交优化文档](ORDER_SUBMIT_OPTIMIZATION.md)
- [API文档](README.md)

---

**文档版本**: v1.0  
**最后更新**: 2025-01-XX  
**状态**: 待实施

