# 富途 API 连接重置问题修复

## 问题描述

获取富途分时数据时出现 `read ECONNRESET` 错误，导致数据获取失败。

**错误示例：**
```
获取富途分时数据失败 (stockId=200003, type=2): read ECONNRESET
获取富途分时数据失败 (stockId=72000025, type=1): read ECONNRESET
获取富途分时数据失败 (stockId=12000015, type=2): read ECONNRESET
```

## 问题原因分析

1. **网络连接不稳定**：`ECONNRESET` 表示连接被服务器重置，可能是网络波动或服务器限流
2. **Referer 不匹配**：代码中使用固定的 referer，而浏览器请求使用动态 referer
3. **缺少重试机制**：网络错误时没有自动重试
4. **超时时间过短**：10秒超时可能不足以完成请求
5. **并发请求过多**：同时发起多个请求可能触发限流

## 解决方案

### 1. 添加重试机制

**文件：** `api/src/services/market-data.service.ts`

- 添加了3次重试机制
- 重试延迟：1秒、2秒、3秒（递增延迟）
- 只对网络错误（ECONNRESET、ETIMEDOUT、ECONNREFUSED、ENOTFOUND）进行重试
- 4xx错误不重试（认证错误等）

### 2. 优化 Referer 设置

根据不同的 stockId 使用不同的 referer，更接近浏览器行为：

```typescript
let referer = 'https://www.moomoo.com/';
if (stockId === '200003') {
  referer = 'https://www.moomoo.com/ja/index/.SPX-US'; // SPX
} else if (stockId === '72000025') {
  referer = 'https://www.moomoo.com/currency/USDINDEX-FX'; // USD Index
} else if (stockId === '12000015') {
  referer = 'https://www.moomoo.com/currency/BTC-FX'; // BTC
}
```

### 3. 增加超时时间

- 从 10 秒增加到 15 秒
- 给网络请求更多时间完成

### 4. 改进错误处理

- 添加了 `validateStatus` 配置，避免5xx错误被自动抛出
- 区分不同类型的错误，只对网络错误重试
- 添加详细的错误日志，包含重试次数和错误代码

## 代码变更

### 主要修改

```typescript
// 添加重试机制
let response: any = null;
const maxRetries = 3;
const retryDelay = 1000;

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    response = await axios.get(url, {
      params: requestParams,
      headers,
      timeout: 15000, // 增加超时时间
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });
    
    if (response.status === 200) {
      break; // 成功，跳出重试循环
    }
  } catch (error: any) {
    // 只对网络错误重试
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || ...) {
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, attempt * retryDelay));
        continue; // 重试
      }
    } else {
      throw error; // 其他错误不重试
    }
  }
}
```

## 验证修复

### 1. 查看日志

修复后，如果出现网络错误，会看到重试日志：

```
获取富途数据失败 (stockId=200003, type=2, 尝试 1/3): ECONNRESET, 1000ms后重试...
获取富途数据失败 (stockId=200003, type=2, 尝试 2/3): ECONNRESET, 2000ms后重试...
```

### 2. 测试 API

```bash
# 测试 SPX 日K数据
curl "http://localhost:3001/api/forex/candlestick?product=SPX&type=day"

# 测试 USD Index 分时数据
curl "http://localhost:3001/api/forex/candlestick?product=USDINDEX&type=minute"
```

### 3. 监控错误率

观察日志中的错误频率，应该看到：
- 重试后成功的情况增加
- 最终失败的情况减少

## 进一步优化建议

### 1. 请求限流

如果仍然遇到连接重置，可以考虑添加请求限流：

```typescript
// 添加请求间隔，避免并发请求过多
await new Promise(resolve => setTimeout(resolve, 200)); // 200ms间隔
```

### 2. 更新 Cookies

如果错误持续出现，可能需要更新硬编码的游客 cookies：

1. 在浏览器中访问 `https://www.moomoo.com`
2. 打开开发者工具 → Network
3. 复制最新的 cookies
4. 更新 `api/src/config/futunn.ts` 中的 `MOOMOO_GUEST_CONFIG`

### 3. 使用数据库配置

考虑将富途配置存储在数据库中，便于动态更新：

```sql
UPDATE system_config 
SET config_value = '新的cookies值' 
WHERE config_key = 'futunn_cookies';
```

## 相关文件

- `api/src/services/market-data.service.ts` - 市场数据服务（主要修改）
- `api/src/config/futunn.ts` - 富途配置（cookies和CSRF token）

## 故障排除

### 问题 1：仍然出现 ECONNRESET

**可能原因：**
- Cookies 已过期
- 请求频率过高
- 网络不稳定

**解决方案：**
1. 更新 cookies（见上方"进一步优化建议"）
2. 增加请求间隔
3. 检查网络连接

### 问题 2：重试后仍然失败

**可能原因：**
- 富途 API 临时不可用
- 配置错误（stockId、marketCode等）

**解决方案：**
1. 检查富途网站是否可访问
2. 验证请求参数是否正确
3. 查看完整错误日志

### 问题 3：4xx 错误（认证失败）

**可能原因：**
- CSRF token 过期
- Cookies 无效

**解决方案：**
1. 更新 `futunn_csrf_token` 配置
2. 更新 `futunn_cookies` 配置
3. 确保 cookies 中包含有效的 CSRF token

