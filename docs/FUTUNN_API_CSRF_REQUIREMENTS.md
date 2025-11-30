# 富途API接口 CSRF Token 需求分析

本文档总结了富途牛牛/Moomoo API接口对 `futu-x-csrf-token` header 的需求情况。

## 接口分类

### 1. 需要 `futu-x-csrf-token` 的接口

这些接口**必须**包含 `futu-x-csrf-token` header，否则可能返回错误或被拒绝：

#### `/quote-api/quote-v2/*` 系列（行情API）

所有行情API接口都需要 `futu-x-csrf-token`，因为它们需要：
- `quote-token`（基于参数计算的HMAC-SHA512 + SHA256 token）
- `futu-x-csrf-token`（CSRF保护）
- `Cookie`（包含 `csrfToken` 和 `futu-csrf`）

**具体接口：**

1. **`/quote-api/quote-v2/get-kline`** - K线数据
   - 需要：`futu-x-csrf-token` + `quote-token` + `Cookie`
   - 用途：获取日K、周K、月K等K线数据

2. **`/quote-api/quote-v2/get-quote-minute`** - 分时数据
   - 需要：`futu-x-csrf-token` + `quote-token` + `Cookie`
   - 用途：获取分时数据（1分钟、5分钟等）

3. **`/quote-api/quote-v2/get-stock-quote`** - 股票行情
   - 需要：`futu-x-csrf-token` + `quote-token` + `Cookie`
   - 用途：获取股票实时报价、买卖盘等

4. **`/quote-api/quote-v2/get-option-chain`** - 期权链
   - 需要：`futu-x-csrf-token` + `quote-token` + `Cookie`
   - 用途：获取指定到期日的期权链数据

5. **`/quote-api/quote-v2/get-option-strike-dates`** - 期权到期日期
   - 需要：`futu-x-csrf-token` + `quote-token` + `Cookie`
   - 用途：获取期权到期日期列表

### 2. 可能不需要 `futu-x-csrf-token` 的接口

这些接口**可能**不需要 `futu-x-csrf-token`，但仍需要 `Cookie`：

#### `/api/headfoot-search` - 搜索接口

- **当前实现**：代码中使用了 `futu-x-csrf-token`
- **可能情况**：浏览器直接访问时可能不需要 `futu-x-csrf-token`，只需要 `Cookie`
- **建议**：如果遇到超时或连接重置错误，可以尝试移除 `futu-x-csrf-token` header

**测试方法：**
```bash
# 测试不带 futu-x-csrf-token 的请求
curl -X GET "https://www.moomoo.com/api/headfoot-search?keyword=tsla&lang=zh-cn&site=sg" \
  -H "Cookie: csrfToken=xxx; futu-csrf=xxx; ..." \
  -H "Referer: https://www.moomoo.com/"
```

## 当前代码实现

### 所有接口都使用 `getFutunnHeaders()`

当前代码中，所有富途API接口都通过 `getFutunnHeaders()` 获取headers，该函数**总是**会添加：
- `futu-x-csrf-token`
- `Cookie`

**文件位置：**
- `api/src/config/futunn.ts` - `getFutunnHeaders()` 函数

**使用该函数的服务：**
1. `api/src/services/market-data.service.ts` - K线数据、分时数据
2. `api/src/services/futunn-option-quote.service.ts` - 期权行情、搜索
3. `api/src/services/futunn-option-chain.service.ts` - 期权链、搜索
4. `api/src/routes/forex.ts` - 外汇行情
5. `api/src/routes/futunn-test.ts` - 测试接口

## 优化建议

### 如果 `headfoot-search` 接口超时

如果 `/api/headfoot-search` 接口出现超时或连接重置错误，可以尝试：

1. **创建不带 CSRF token 的 headers 函数**
   ```typescript
   export function getFutunnHeadersWithoutCSRF(referer: string = 'https://www.moomoo.com/'): Record<string, string> {
     const config = getFutunnConfig();
     
     const headers: Record<string, string> = {
       'authority': 'www.moomoo.com',
       'accept': 'application/json, text/plain, */*',
       'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
       'referer': referer,
       'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
     };
     
     // 只添加 Cookie，不添加 futu-x-csrf-token
     headers['Cookie'] = config.cookies;
     
     return headers;
   }
   ```

2. **在搜索接口中使用不带 CSRF 的 headers**
   ```typescript
   // 在 futunn-option-quote.service.ts 的 searchStock 函数中
   const headers = getFutunnHeadersWithoutCSRF('https://www.moomoo.com/');
   ```

### 验证方法

1. **浏览器测试**：在浏览器开发者工具中查看 Network 标签，检查哪些请求包含 `futu-x-csrf-token`
2. **curl 测试**：使用 curl 分别测试带和不带 `futu-x-csrf-token` 的请求
3. **日志对比**：对比浏览器请求和代码请求的 headers，找出差异

## 总结

| 接口 | 需要 `futu-x-csrf-token` | 需要 `quote-token` | 需要 `Cookie` |
|------|-------------------------|-------------------|--------------|
| `/quote-api/quote-v2/get-kline` | ✅ 是 | ✅ 是 | ✅ 是 |
| `/quote-api/quote-v2/get-quote-minute` | ✅ 是 | ✅ 是 | ✅ 是 |
| `/quote-api/quote-v2/get-stock-quote` | ✅ 是 | ✅ 是 | ✅ 是 |
| `/quote-api/quote-v2/get-option-chain` | ✅ 是 | ✅ 是 | ✅ 是 |
| `/quote-api/quote-v2/get-option-strike-dates` | ✅ 是 | ✅ 是 | ✅ 是 |
| `/api/headfoot-search` | ❓ 可能不需要 | ❌ 否 | ✅ 是 |

**注意**：`/api/headfoot-search` 接口如果遇到超时问题，建议尝试移除 `futu-x-csrf-token` header。

