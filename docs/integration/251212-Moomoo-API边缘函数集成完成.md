# Moomoo API 边缘函数集成完成

## 概述

已成功将后端代码修改为使用边缘函数代理访问Moomoo API，解决了大陆IP无法直接访问的问题。

## 修改的文件

### 1. 新增文件

- `api/src/utils/moomoo-proxy.ts` - 统一的Moomoo API代理工具函数
- `api/.env.example` - 环境变量配置示例（已更新）

### 2. 修改的文件

- `api/src/services/futunn-option-quote.service.ts`
  - `searchStock()` - 搜索接口使用边缘函数
  - `getOptionFromChain()` - 期权链接口使用边缘函数
  - `getOptionQuote()` - 期权行情接口使用边缘函数

- `api/src/services/market-data.service.ts`
  - `getCandlesticksIntraday()` - K线和分时数据接口使用边缘函数

- `api/src/services/futunn-option-chain.service.ts`
  - `searchStock()` - 搜索接口使用边缘函数

## 配置说明

### 环境变量

在 `.env` 文件中添加以下配置：

```bash
# Moomoo边缘函数配置
MOOMOO_EDGE_FUNCTION_URL=https://cfapi.riowang.win
USE_MOOMOO_EDGE_FUNCTION=true
```

### 配置选项

- `MOOMOO_EDGE_FUNCTION_URL`: 边缘函数的URL（默认：`https://cfapi.riowang.win`）
- `USE_MOOMOO_EDGE_FUNCTION`: 是否使用边缘函数（`true`=使用边缘函数，`false`=直接访问，默认：`true`）

## 使用方式

### 自动切换

代码会自动根据 `USE_MOOMOO_EDGE_FUNCTION` 环境变量选择使用边缘函数或直接访问：

- **启用边缘函数**（默认）：所有Moomoo API请求通过边缘函数代理
- **禁用边缘函数**：直接访问Moomoo API（需要能够访问）

### 手动切换

如果需要临时切换，可以修改环境变量：

```bash
# 使用边缘函数
USE_MOOMOO_EDGE_FUNCTION=true

# 直接访问（如果IP可以访问）
USE_MOOMOO_EDGE_FUNCTION=false
```

## 实现细节

### 代理函数

`moomoo-proxy.ts` 提供了统一的代理函数：

```typescript
export async function proxyMoomooRequest(
  url: string,
  options?: RequestInit
): Promise<Response>
```

**功能**：
- 自动检测是否使用边缘函数
- 如果使用边缘函数，将请求转发到边缘函数
- 如果直接访问，直接调用Moomoo API
- 统一处理错误和响应

### 边缘函数请求格式

边缘函数接收以下格式的请求：

```typescript
POST https://cfapi.riowang.win/proxy
{
  "url": "https://www.moomoo.com/api/headfoot-search",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "Cookie": "...",
    ...
  },
  "body": "..."
}
```

边缘函数会：
1. 接收代理请求
2. 转发到目标URL
3. 返回响应

## 优势

### 1. 解决IP限制问题

- ✅ 大陆IP无法直接访问Moomoo API的问题已解决
- ✅ 通过边缘函数代理，可以正常访问所有接口

### 2. 灵活切换

- ✅ 可以通过环境变量轻松切换
- ✅ 不需要修改代码
- ✅ 支持不同环境的配置

### 3. 统一管理

- ✅ 所有Moomoo API请求都通过统一的代理函数
- ✅ 便于维护和调试
- ✅ 可以统一添加日志和监控

## 测试验证

### 1. 测试搜索接口

```bash
curl -X POST http://localhost:3001/api/options/search \
  -H "Content-Type: application/json" \
  -d '{"query": "AAPL"}'
```

### 2. 测试K线数据

```bash
curl -X GET "http://localhost:3001/api/market-data/candlesticks?symbol=AAPL.US&period=1d&count=100"
```

### 3. 测试期权链

```bash
curl -X GET "http://localhost:3001/api/options/chain?symbol=AAPL.US&expiry=2025-01-17"
```

## 故障排除

### 问题1: 边缘函数返回错误

**可能原因**：
- 边缘函数URL配置错误
- 边缘函数服务不可用

**解决方案**：
1. 检查 `MOOMOO_EDGE_FUNCTION_URL` 配置是否正确
2. 测试边缘函数是否可访问
3. 如果边缘函数不可用，可以临时切换到直接访问模式

### 问题2: 直接访问模式失败

**可能原因**：
- IP被限制
- 网络连接问题

**解决方案**：
1. 确认 `USE_MOOMOO_EDGE_FUNCTION=true`
2. 使用边缘函数代理模式

### 问题3: 响应超时

**可能原因**：
- 边缘函数响应慢
- 网络延迟

**解决方案**：
1. 增加请求超时时间
2. 检查边缘函数性能
3. 考虑使用多个边缘函数实例

## 相关文件

- `api/src/utils/moomoo-proxy.ts` - Moomoo代理工具函数
- `api/src/services/futunn-option-quote.service.ts` - 期权报价服务
- `api/src/services/market-data.service.ts` - 市场数据服务
- `api/src/services/futunn-option-chain.service.ts` - 期权链服务

## 后续优化建议

1. **边缘函数监控**：
   - 添加边缘函数响应时间监控
   - 添加边缘函数错误率监控
   - 设置告警阈值

2. **边缘函数负载均衡**：
   - 如果请求量大，可以考虑使用多个边缘函数实例
   - 实现负载均衡和故障转移

3. **缓存优化**：
   - 在边缘函数层面添加缓存
   - 减少对Moomoo API的请求频率

---

**创建时间**：2025-12-12  
**最后更新**：2025-12-12




