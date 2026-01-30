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

**具体接口**：

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

**测试方法**：
1. 尝试不使用 `futu-x-csrf-token` header
2. 只使用 `Cookie` header
3. 观察是否正常工作

## 实现建议

### 1. 统一Headers管理

建议创建一个统一的headers管理函数，根据接口类型自动添加必要的headers：

```typescript
export async function getFutunnHeaders(
  endpoint: string,
  referer?: string
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 ...',
    'Referer': referer || 'https://www.moomoo.com/',
    'Cookie': await getFutunnCookies(),
  };
  
  // 如果是行情API，添加CSRF token和quote-token
  if (endpoint.startsWith('/quote-api/quote-v2/')) {
    headers['futu-x-csrf-token'] = await getCsrfToken();
    headers['quote-token'] = await calculateQuoteToken(endpoint);
  }
  
  // 如果是搜索接口，可能不需要CSRF token
  if (endpoint === '/api/headfoot-search') {
    // 可选：添加CSRF token
    // headers['futu-x-csrf-token'] = await getCsrfToken();
  }
  
  return headers;
}
```

### 2. 错误处理

如果接口返回403或401错误，可以尝试：

1. **检查CSRF token**：
   - 确认CSRF token是否正确
   - 确认CSRF token是否过期

2. **移除CSRF token**（仅对搜索接口）：
   - 如果搜索接口不需要CSRF token，尝试移除
   - 观察是否解决问题

3. **更新Cookies**：
   - 如果CSRF token无效，可能需要更新cookies
   - 重新获取有效的cookies和CSRF token

## 当前实现状态

### 已实现的接口

- ✅ `/quote-api/quote-v2/get-kline` - 使用CSRF token
- ✅ `/quote-api/quote-v2/get-quote-minute` - 使用CSRF token
- ✅ `/quote-api/quote-v2/get-stock-quote` - 使用CSRF token
- ✅ `/quote-api/quote-v2/get-option-chain` - 使用CSRF token
- ✅ `/quote-api/quote-v2/get-option-strike-dates` - 使用CSRF token
- ✅ `/api/headfoot-search` - 使用CSRF token（可能需要优化）

### 需要优化的接口

- ⚠️ `/api/headfoot-search` - 可能需要移除CSRF token，只使用Cookie

## 相关文件

- `api/src/config/futunn.ts` - Futunn配置和headers函数
- `api/src/services/futunn-option-quote.service.ts` - 期权报价服务
- `api/src/services/futunn-option-chain.service.ts` - 期权链服务
- `api/src/services/market-data.service.ts` - 市场数据服务

## 测试建议

### 测试CSRF Token需求

1. **测试行情API**：
   - 尝试不使用CSRF token调用行情API
   - 观察是否返回403错误
   - 确认CSRF token是必需的

2. **测试搜索接口**：
   - 尝试不使用CSRF token调用搜索接口
   - 观察是否正常工作
   - 如果正常，可以移除CSRF token

3. **测试CSRF Token有效性**：
   - 使用过期的CSRF token调用接口
   - 观察错误响应
   - 确认需要更新CSRF token

---

**创建时间**：2025-12-12  
**最后更新**：2025-12-12






