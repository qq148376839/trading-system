# Quote-Token 实现说明

## 概述

边缘函数已实现自动计算 `quote-token` 的功能，确保行情接口可以正常访问。

## 实现细节

### 1. Quote-Token 计算逻辑

使用 Web Crypto API（兼容 Cloudflare Workers）实现：

```javascript
async function generateQuoteToken(params) {
    // 1. 将参数转换为JSON字符串
    const dataStr = JSON.stringify(params);
    
    // 2. HMAC-SHA512加密（密钥：'quote_web'）
    const hmacHex = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    
    // 3. 取前10位
    const firstSlice = hmacHex.substring(0, 10);
    
    // 4. SHA256哈希
    const sha256Hex = await crypto.subtle.digest('SHA-256', sha256Bytes);
    
    // 5. 取前10位作为token
    return sha256Hex.substring(0, 10);
}
```

### 2. 自动检测需要 Quote-Token 的接口

以下接口会自动计算并添加 `quote-token`：

- `/quote-api/quote-v2/get-kline` - K线数据
- `/quote-api/quote-v2/get-quote-minute` - 分时数据
- `/quote-api/quote-v2/get-stock-quote` - 股票行情
- `/quote-api/quote-v2/get-option-chain` - 期权链
- `/quote-api/quote-v2/get-option-strike-dates` - 期权到期日期

### 3. 参数提取规则

根据不同的接口，提取不同的参数用于计算 token：

#### K线/分时数据
```javascript
{
  stockId: "200003",
  marketType: "2",
  type: "2",
  marketCode: "24",
  instrumentType: "6",
  subInstrumentType: "6001",
  _: "1764480110455"
}
```

#### 股票行情
```javascript
{
  stockId: "201335",
  marketType: "2",
  marketCode: "11",
  lotSize: "1",
  spreadCode: "45",
  underlyingStockId: "0",
  instrumentType: "3",
  subInstrumentType: "3002",
  _: "1764480110455"
}
```

#### 期权链
```javascript
{
  stockId: "201335",
  strikeDate: "1735689600",
  expiration: "1",
  _: "1764480110455"
}
```

#### 期权到期日期
```javascript
{
  stockId: "201335",
  _: "1764480110455"
}
```

**重要**：参数顺序必须与后端代码保持一致！

### 4. 默认配置

边缘函数包含默认的 cookies 和 CSRF token：

```javascript
const DEFAULT_COOKIES = 'cipher_device_id=1763971814778021; ...';
const DEFAULT_CSRF_TOKEN = 'f51O2KPxQvir0tU5zDCVQpMm';
```

如果请求中没有提供 cookies 或 CSRF token，会自动使用默认值。

## 使用方式

### 后端代码

后端代码无需修改，边缘函数会自动处理：

```typescript
// 后端代码（无需传递quoteToken）
const responseData = await moomooProxy({
  path: '/quote-api/quote-v2/get-kline',
  params: {
    stockId: 200003,
    marketType: 2,
    type: 2,
    marketCode: 24,
    instrumentType: 6,
    subInstrumentType: 6001,
    _: Date.now(),
  },
  cookies: headers['Cookie'],
  csrfToken: headers['futu-x-csrf-token'],
  referer: 'https://www.moomoo.com/',
});
```

### 直接调用边缘函数

```bash
# K线数据（自动计算quote-token）
curl "https://cfapi.riowang.win/api/moomooapi?path=/quote-api/quote-v2/get-kline&stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001&_=1764480110455"

# 如果提供了cookies和csrf_token，会优先使用
curl "https://cfapi.riowang.win/api/moomooapi?path=/quote-api/quote-v2/get-kline&stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001&_=1764480110455&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN"
```

## 测试

### 测试 K线数据

```bash
curl "https://cfapi.riowang.win/api/moomooapi?path=/quote-api/quote-v2/get-kline&stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001&_=$(date +%s)000"
```

### 测试分时数据

```bash
curl "https://cfapi.riowang.win/api/moomooapi?path=/quote-api/quote-v2/get-quote-minute&stockId=200003&marketType=2&type=1&marketCode=24&instrumentType=6&subInstrumentType=6001&_=$(date +%s)000"
```

## 日志

边缘函数会输出计算日志：

```
[边缘函数] 自动计算quote-token: 1d8502584e (路径: /quote-api/quote-v2/get-kline)
```

## 注意事项

1. **参数顺序**：参数顺序必须与后端代码保持一致，否则计算的 token 会不正确
2. **参数类型**：所有参数值必须是字符串类型（JSON.stringify 会自动转换）
3. **时间戳**：`_` 参数通常是当前时间戳（毫秒）
4. **默认值**：如果 cookies 或 CSRF token 过期，需要更新边缘函数中的默认值

## 故障排查

### 1. 返回 "Params Error"

- 检查参数是否完整
- 检查参数顺序是否正确
- 检查参数类型是否正确（数字会被转换为字符串）

### 2. Quote-Token 计算错误

- 检查参数顺序是否与后端代码一致
- 检查是否有参数缺失
- 查看边缘函数日志中的计算过程

### 3. Cookies 或 CSRF Token 无效

- 更新边缘函数中的默认值
- 或通过查询参数传递最新的 cookies 和 CSRF token

## 更新默认值

如果需要更新默认的 cookies 和 CSRF token：

1. 从浏览器中获取最新的 cookies 和 CSRF token
2. 更新 `moomooapi.js` 中的 `DEFAULT_COOKIES` 和 `DEFAULT_CSRF_TOKEN`
3. 重新部署边缘函数

