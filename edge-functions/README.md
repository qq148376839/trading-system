# Moomoo API 边缘函数代理

## 概述

这是一个用于代理Moomoo API请求的Cloudflare Workers边缘函数，用于解决大陆IP无法直接访问Moomoo API的问题。

## 文件说明

- `moomooapi.js` - Moomoo API代理核心逻辑
- `index.js` - 主入口文件（已添加 `/api/moomooapi` 路由）

## 使用方法

### 1. 搜索接口

```
GET /api/moomooapi?path=/api/headfoot-search&keyword=tsla&lang=zh-cn&site=sg&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN
```

### 2. K线数据

```
GET /api/moomooapi?path=/quote-api/quote-v2/get-kline&stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN&quote_token=YOUR_QUOTE_TOKEN
```

### 3. 分时数据

```
GET /api/moomooapi?path=/quote-api/quote-v2/get-quote-minute&stockId=200003&marketType=2&type=1&marketCode=24&instrumentType=6&subInstrumentType=6001&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN&quote_token=YOUR_QUOTE_TOKEN
```

### 4. 股票行情

```
GET /api/moomooapi?path=/quote-api/quote-v2/get-stock-quote&stockId=201335&marketType=2&marketCode=11&instrumentType=3&subInstrumentType=3002&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN&quote_token=YOUR_QUOTE_TOKEN
```

### 5. 期权链

```
GET /api/moomooapi?path=/quote-api/quote-v2/get-option-chain&stockId=201335&strikeDate=1735689600&expiration=1&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN&quote_token=YOUR_QUOTE_TOKEN
```

### 6. 期权到期日期

```
GET /api/moomooapi?path=/quote-api/quote-v2/get-option-strike-dates&stockId=201335&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN&quote_token=YOUR_QUOTE_TOKEN
```

## 参数说明

### 必需参数

- `path` 或 `api_path` - Moomoo API的路径（例如：`/api/headfoot-search`）

### 可选参数

- `cookies` - Cookie字符串（用于认证）
- `csrf_token` 或 `csrfToken` - CSRF Token（用于认证）
- `quote_token` 或 `quoteToken` - Quote Token（用于行情接口）
- `referer` - Referer header（默认为 `https://www.moomoo.com/`）
- 其他参数 - 会直接传递给Moomoo API

## 响应格式

### 成功响应

```json
{
  "success": true,
  "status": 200,
  "data": {
    // Moomoo API返回的原始数据
  },
  "headers": {
    "content-type": "application/json"
  }
}
```

### 错误响应

```json
{
  "error": "错误描述",
  "message": "详细错误信息",
  "status": 400
}
```

## 部署说明

### Cloudflare Workers

1. 登录 Cloudflare Dashboard
2. 进入 Workers & Pages
3. 创建新的 Worker
4. 将 `index.js` 和 `moomooapi.js` 的内容复制到对应的文件中
5. 确保其他依赖文件（如 `xhs.js`, `another.js` 等）也已上传
6. 部署

### 环境变量（可选）

如果需要，可以在Cloudflare Workers中设置环境变量来存储默认的cookies和CSRF token：

- `MOOMOO_DEFAULT_COOKIES` - 默认cookies
- `MOOMOO_DEFAULT_CSRF_TOKEN` - 默认CSRF token

## 后端集成

在后端代码中，可以将Moomoo API的请求改为通过边缘函数代理：

```typescript
// 原来的代码
const response = await axios.get('https://www.moomoo.com/api/headfoot-search', {
  params: { keyword: 'tsla', lang: 'zh-cn', site: 'sg' },
  headers: { ... }
});

// 改为通过边缘函数代理
const edgeFunctionUrl = 'https://your-worker.workers.dev/api/moomooapi';
const response = await axios.get(edgeFunctionUrl, {
  params: {
    path: '/api/headfoot-search',
    keyword: 'tsla',
    lang: 'zh-cn',
    site: 'sg',
    cookies: futunnCookies,
    csrf_token: futunnCsrfToken,
  }
});

// 提取数据
const result = response.data.success ? response.data.data : null;
```

## 注意事项

1. **超时设置**：边缘函数设置了25秒超时，如果Moomoo API响应较慢可能会超时
2. **Cookies管理**：建议将cookies存储在数据库中，通过查询参数传递
3. **安全性**：如果cookies包含敏感信息，建议使用HTTPS传输
4. **CORS**：响应已包含CORS headers，支持跨域请求
5. **错误处理**：所有错误都会返回JSON格式的错误信息

## 测试示例

### 使用curl测试

```bash
# 搜索接口测试
curl "https://your-worker.workers.dev/api/moomooapi?path=/api/headfoot-search&keyword=tsla&lang=zh-cn&site=sg&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN"

# K线数据测试
curl "https://your-worker.workers.dev/api/moomooapi?path=/quote-api/quote-v2/get-kline&stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN&quote_token=YOUR_QUOTE_TOKEN"
```

## 支持的Moomoo API接口

- ✅ `/api/headfoot-search` - 搜索接口
- ✅ `/quote-api/quote-v2/get-kline` - K线数据
- ✅ `/quote-api/quote-v2/get-quote-minute` - 分时数据
- ✅ `/quote-api/quote-v2/get-stock-quote` - 股票行情
- ✅ `/quote-api/quote-v2/get-option-chain` - 期权链
- ✅ `/quote-api/quote-v2/get-option-strike-dates` - 期权到期日期

## 更新日志

- 2025-01-28: 初始版本，支持基本的GET请求代理

