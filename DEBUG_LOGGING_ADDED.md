# 富途 API 调试日志增强

## 新增的调试信息

### 1. 请求前日志

**位置：** `api/src/services/market-data.service.ts`

**显示内容：**
- 完整的请求 URL（包含所有参数）
- 请求方法（GET）
- 请求参数（数字格式）
- Headers 预览：
  - `futu-x-csrf-token`（前12位）
  - `quote-token`（完整值）
  - `referer`
  - `user-agent`（前50位）
  - `cookie`（前100位 + 长度）
  - `accept` 和 `accept-language`
- 超时设置

**示例输出：**
```
[富途API请求] 开始请求 (尝试 1/3): {
  fullUrl: 'https://www.moomoo.com/quote-api/quote-v2/get-kline?stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001&_=1764340163382',
  baseUrl: 'https://www.moomoo.com/quote-api/quote-v2/get-kline',
  method: 'GET',
  params: { stockId: 200003, marketType: 2, type: 2, ... },
  headers: { ... },
  timeout: 15000
}
```

### 2. 响应日志

**显示内容：**
- HTTP 状态码和状态文本
- 请求耗时（毫秒）
- 响应 Headers（content-type, content-length）
- 响应数据：
  - `code`（API 返回码）
  - `message`（API 返回消息）
  - 数据键列表
  - 数据长度
  - 数据预览（前200字符）

**示例输出：**
```
[富途API响应] stockId=200003, type=2 (尝试 1/3): {
  status: 200,
  statusText: 'OK',
  duration: '1234ms',
  headers: { 'content-type': 'application/json', ... },
  dataCode: 0,
  dataMessage: 'success',
  dataKeys: ['code', 'data', 'message'],
  dataLength: 12345,
  dataPreview: '{"code":0,"data":[...]}'
}
```

### 3. 错误日志

**显示内容：**
- 错误代码（error.code）
- 错误消息（error.message）
- 错误名称（error.name）
- 错误类型标识：
  - `isTimeout`: 是否超时
  - `isConnectionReset`: 是否连接重置
  - `isConnectionRefused`: 是否连接被拒绝
  - `isDNSFailure`: 是否DNS解析失败
- 响应详情（如果有）：
  - HTTP 状态码
  - 状态文本
  - 响应 Headers
  - 响应数据
- 请求详情（如果有）：
  - 请求 URL
  - 请求方法
  - 超时设置
  - Headers 预览
- 配置详情（如果有）：
  - URL
  - 方法
  - 超时
  - 参数

**示例输出：**
```
[富途API错误] stockId=200003, type=2 (尝试 1/3): {
  "errorCode": "ETIMEDOUT",
  "errorMessage": "timeout of 15000ms exceeded",
  "errorName": "Error",
  "isTimeout": true,
  "isConnectionReset": false,
  "isConnectionRefused": false,
  "isDNSFailure": false,
  "request": {
    "url": "https://www.moomoo.com/quote-api/quote-v2/get-kline",
    "method": "get",
    "timeout": 15000,
    "headers": { ... }
  },
  "config": {
    "url": "https://www.moomoo.com/quote-api/quote-v2/get-kline",
    "method": "get",
    "timeout": 15000,
    "params": { ... }
  }
}
```

### 4. 搜索正股日志

**位置：** `api/src/services/futunn-option-quote.service.ts`

**显示内容：**
- 搜索关键词
- 请求 URL
- 请求参数
- Headers 预览
- 超时设置
- 响应状态和耗时
- 错误详情（如果失败）

**示例输出：**
```
[富途搜索] 搜索正股: TSLA {
  url: 'https://www.moomoo.com/api/headfoot-search',
  params: { keyword: 'tsla', lang: 'zh-cn', site: 'sg' },
  headers: { ... },
  timeout: 5000
}

[富途搜索响应] TSLA: {
  status: 200,
  duration: '1234ms',
  dataLength: 12345
}
```

或错误时：
```
[富途搜索错误] 搜索正股失败: {
  "keyword": "TSLA",
  "errorCode": "ETIMEDOUT",
  "errorMessage": "timeout of 5000ms exceeded",
  "isTimeout": true,
  ...
}
```

## 使用方法

### 1. 重启 API 服务

重启后，所有富途 API 请求都会显示详细的调试信息。

### 2. 查看日志

查看控制台输出，关注以下信息：

1. **请求 URL**：确认参数是否正确
2. **quote-token**：确认计算是否正确
3. **Headers**：确认 cookies 和 CSRF token 是否正确
4. **响应状态**：确认是否收到响应
5. **错误类型**：确认是超时、连接重置还是其他错误

### 3. 对比浏览器请求

1. 打开浏览器开发者工具（F12）
2. 访问 `https://www.moomoo.com`
3. 在 Network 标签中查看请求
4. 对比日志中的信息：
   - URL 和参数
   - Headers（特别是 cookies 和 CSRF token）
   - 响应状态

## 排查步骤

### 步骤 1：检查请求 URL

对比日志中的 `fullUrl` 和浏览器中的请求 URL，确认：
- 参数名称是否一致
- 参数值是否一致
- 参数顺序是否一致（虽然 URL 参数顺序通常不重要，但 quote-token 计算依赖顺序）

### 步骤 2：检查 Headers

对比日志中的 headers 和浏览器中的 headers：
- `futu-x-csrf-token` 是否一致
- `quote-token` 是否一致（需要计算验证）
- `cookie` 是否一致（至少前100位应该匹配）
- `referer` 是否匹配

### 步骤 3：检查错误类型

根据错误类型采取不同措施：

**ETIMEDOUT（超时）：**
- 检查网络连接
- 检查富途网站是否可访问
- 可能需要增加超时时间（当前15秒）

**ECONNRESET（连接重置）：**
- 可能是 cookies 过期
- 可能是请求频率过高
- 已实现重试机制

**ECONNREFUSED（连接被拒绝）：**
- 检查网络连接
- 检查防火墙设置

**ENOTFOUND（DNS 失败）：**
- 检查 DNS 设置
- 检查网络连接

### 步骤 4：检查响应数据

如果收到响应但状态码不是 200：
- 查看 `errorResponse.data` 了解 API 返回的错误信息
- 查看 `errorResponse.status` 了解 HTTP 状态码
- 4xx 错误通常是认证或参数问题
- 5xx 错误通常是服务器问题

## 常见问题排查

### 问题 1：所有请求都超时

**可能原因：**
- 网络连接问题
- 富途网站不可访问
- 防火墙阻止

**排查：**
1. 检查网络连接：`ping www.moomoo.com`
2. 在浏览器中访问 `https://www.moomoo.com`
3. 检查防火墙设置

### 问题 2：quote-token 不匹配

**可能原因：**
- 参数顺序错误
- 参数类型错误（数字 vs 字符串）

**排查：**
1. 使用 `api/scripts/test-quote-token.js` 验证计算
2. 对比日志中的 `tokenParams` 和浏览器请求的参数
3. 确认所有参数都是字符串类型

### 问题 3：Cookies 过期

**可能原因：**
- Cookies 已过期
- CSRF Token 已过期

**排查：**
1. 在浏览器中测试相同的请求
2. 如果浏览器也失败，说明 cookies 过期
3. 更新数据库中的 `futunn_cookies` 配置

### 问题 4：搜索正股超时

**可能原因：**
- 搜索 API 响应慢
- 网络问题
- Cookies 过期

**排查：**
1. 查看搜索请求的详细日志
2. 检查是否收到响应（即使超时）
3. 尝试增加超时时间（当前5秒）

## 相关文件

- `api/src/services/market-data.service.ts` - 市场数据服务（K线数据请求）
- `api/src/services/futunn-option-quote.service.ts` - 期权行情服务（搜索正股）
- `api/scripts/test-quote-token.js` - quote-token 计算测试脚本

## 下一步

重启 API 服务后，查看详细的调试日志，根据日志信息定位问题：

1. **如果所有请求都超时** → 检查网络连接或 cookies
2. **如果 quote-token 不匹配** → 检查参数顺序和类型
3. **如果收到 4xx 错误** → 检查认证信息（cookies、CSRF token）
4. **如果收到 5xx 错误** → 可能是服务器问题，稍后重试

根据日志中的详细信息，可以更准确地定位问题所在。

