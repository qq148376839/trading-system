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
- **禁用边缘函数**：回退到直接访问Moomoo API（如果服务器IP可以访问）

### 代理函数

所有Moomoo API请求现在都通过 `moomooProxy()` 函数统一处理：

```typescript
import { moomooProxy } from '../utils/moomoo-proxy';

const responseData = await moomooProxy({
  path: '/api/headfoot-search',
  params: {
    keyword: 'tsla',
    lang: 'zh-cn',
    site: 'sg',
  },
  cookies: headers['Cookie'],
  csrfToken: headers['futu-x-csrf-token'],
  referer: 'https://www.moomoo.com/',
  timeout: 10000,
});
```

## 支持的接口

以下接口已更新为使用边缘函数：

### 基础接口
1. ✅ `/api/headfoot-search` - 搜索接口

### 行情接口（需要quote-token）
2. ✅ `/quote-api/quote-v2/get-kline` - K线数据
3. ✅ `/quote-api/quote-v2/get-quote-minute` - 分时数据
4. ✅ `/quote-api/quote-v2/get-option-chain` - 期权链
5. ✅ `/quote-api/quote-v2/get-stock-quote` - 股票行情
6. ✅ `/quote-api/quote-v2/get-option-strike-dates` - 期权到期日期

### 机构选股接口（需要quote-token）
7. ✅ `/quote-api/quote-v2/get-popular-position` - 热门机构列表
8. ✅ `/quote-api/quote-v2/get-share-holding-list` - 机构持仓列表
9. ✅ `/quote-api/quote-v2/get-owner-position-list` - 机构列表（支持分页）

**注意**：所有需要 `quote-token` 的接口都会自动计算并添加token，无需手动传递。

## 测试

### 1. 测试搜索接口

```bash
# 启动后端服务
cd api
npm start

# 测试搜索功能（会触发搜索接口）
curl "http://localhost:3001/api/positions"
```

### 2. 查看日志

日志中会显示使用的代理模式：

```
[富途搜索] 搜索正股: TSLA (边缘函数 (https://cfapi.riowang.win))
[富途API请求] stockId=200003, type=2 (边缘函数 (https://cfapi.riowang.win))
```

## 优势

1. **解决IP限制**：通过边缘函数代理，解决了大陆IP无法访问的问题
2. **统一管理**：所有Moomoo API请求通过统一的代理函数管理
3. **灵活切换**：可以通过环境变量轻松切换代理模式
4. **向后兼容**：如果边缘函数不可用，可以回退到直接访问
5. **详细日志**：日志中会显示使用的代理模式，便于调试

## 故障排查

### 1. 边缘函数返回错误

如果边缘函数返回错误，可以：

1. 检查边缘函数URL是否正确
2. 检查边缘函数是否正常运行
3. 查看后端日志中的错误信息
4. 临时禁用边缘函数，回退到直接访问：
   ```bash
   USE_MOOMOO_EDGE_FUNCTION=false
   ```

### 2. 超时问题

如果请求超时：

1. 检查网络连接
2. 增加超时时间（在 `moomooProxy` 调用中设置 `timeout` 参数）
3. 检查边缘函数的超时设置（默认25秒）

### 3. Cookies或Token无效

如果返回认证错误：

1. 检查cookies和CSRF token是否正确
2. 检查cookies是否过期
3. 更新数据库中的cookies配置

## 性能影响

- **延迟**：边缘函数会增加少量延迟（通常<100ms）
- **可靠性**：边缘函数提供更好的可靠性，避免IP限制问题
- **缓存**：边缘函数可以添加缓存层，提高性能（未来优化）

## 下一步优化

1. **缓存机制**：在边缘函数中添加缓存，减少对Moomoo API的请求
2. **批量请求**：支持批量请求多个接口
3. **监控告警**：添加边缘函数健康检查和告警
4. **负载均衡**：如果流量较大，可以部署多个边缘函数实例

## 相关文档

- [边缘函数代码](../edge-functions/README.md)
- [集成指南](../edge-functions/INTEGRATION_GUIDE.md)
- [搜索Cookies配置](251212-SEARCH_COOKIES_SETUP.md)

