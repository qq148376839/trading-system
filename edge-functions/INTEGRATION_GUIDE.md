# Moomoo API 边缘函数集成指南

## 概述

本文档说明如何在后端代码中集成Moomoo API边缘函数代理，以解决大陆IP无法访问的问题。

## 配置边缘函数URL

首先，在环境变量或配置文件中添加边缘函数的URL：

```typescript
// api/src/config/futunn.ts 或环境变量
const EDGE_FUNCTION_URL = process.env.MOOMOO_EDGE_FUNCTION_URL || 'https://your-worker.workers.dev';
```

## 修改搜索接口

### 原始代码（`api/src/services/futunn-option-quote.service.ts`）

```typescript
async function searchStock(keyword: string): Promise<{
  stockId: string;
  marketType: number;
} | null> {
  const url = 'https://www.moomoo.com/api/headfoot-search';
  const params = {
    keyword: keyword.toLowerCase(),
    lang: 'zh-cn',
    site: 'sg',
  };
  
  const headers = await getFutunnSearchHeaders('https://www.moomoo.com/');
  const response = await axios.get(url, { params, headers, timeout: 10000 });
  // ...
}
```

### 修改后的代码

```typescript
async function searchStock(keyword: string): Promise<{
  stockId: string;
  marketType: number;
} | null> {
  const edgeFunctionUrl = process.env.MOOMOO_EDGE_FUNCTION_URL || 'https://your-worker.workers.dev';
  const useEdgeFunction = process.env.USE_MOOMOO_EDGE_FUNCTION === 'true';
  
  let url: string;
  let params: any;
  let headers: any;
  
  if (useEdgeFunction) {
    // 使用边缘函数代理
    url = `${edgeFunctionUrl}/api/moomooapi`;
    const searchHeaders = await getFutunnSearchHeaders('https://www.moomoo.com/');
    
    params = {
      path: '/api/headfoot-search',
      keyword: keyword.toLowerCase(),
      lang: 'zh-cn',
      site: 'sg',
      cookies: searchHeaders['Cookie'],
      csrf_token: searchHeaders['futu-x-csrf-token'],
    };
    
    // 边缘函数不需要这些headers
    headers = {
      'Content-Type': 'application/json',
    };
  } else {
    // 直接访问（原有逻辑）
    url = 'https://www.moomoo.com/api/headfoot-search';
    params = {
      keyword: keyword.toLowerCase(),
      lang: 'zh-cn',
      site: 'sg',
    };
    headers = await getFutunnSearchHeaders('https://www.moomoo.com/');
  }
  
  try {
    const response = await axios.get(url, { params, headers, timeout: 10000 });
    
    // 如果使用边缘函数，需要提取data字段
    const responseData = useEdgeFunction && response.data.success 
      ? response.data.data 
      : response.data;
    
    // 处理响应数据...
    if (responseData?.code === 0 && responseData?.data?.stock) {
      // ...
    }
  } catch (error) {
    // 错误处理...
  }
}
```

## 修改行情接口

### 原始代码（`api/src/services/market-data.service.ts`）

```typescript
async getCandlesticksIntraday(...) {
  const url = `${this.baseUrl}/get-kline`;
  const headers = this.getHeaders(referer);
  headers['quote-token'] = quoteToken;
  
  const response = await axios.get(url, {
    params: requestParams,
    headers,
    timeout: 15000,
  });
  // ...
}
```

### 修改后的代码

```typescript
async getCandlesticksIntraday(...) {
  const edgeFunctionUrl = process.env.MOOMOO_EDGE_FUNCTION_URL || 'https://your-worker.workers.dev';
  const useEdgeFunction = process.env.USE_MOOMOO_EDGE_FUNCTION === 'true';
  
  let url: string;
  let params: any;
  let headers: any;
  
  if (useEdgeFunction) {
    // 使用边缘函数代理
    url = `${edgeFunctionUrl}/api/moomooapi`;
    const baseHeaders = this.getHeaders(referer);
    
    params = {
      path: isIntraday ? '/quote-api/quote-v2/get-quote-minute' : '/quote-api/quote-v2/get-kline',
      ...requestParams,
      cookies: baseHeaders['Cookie'],
      csrf_token: baseHeaders['futu-x-csrf-token'],
      quote_token: quoteToken,
      referer: referer,
    };
    
    headers = {
      'Content-Type': 'application/json',
    };
  } else {
    // 直接访问（原有逻辑）
    url = isIntraday 
      ? `${this.baseUrl}/get-quote-minute`
      : `${this.baseUrl}/get-kline`;
    headers = this.getHeaders(referer);
    headers['quote-token'] = quoteToken;
    params = requestParams;
  }
  
  try {
    const response = await axios.get(url, {
      params,
      headers,
      timeout: 15000,
    });
    
    // 如果使用边缘函数，需要提取data字段
    const responseData = useEdgeFunction && response.data.success 
      ? response.data.data 
      : response.data;
    
    if (responseData && responseData.code === 0) {
      // 处理数据...
    }
  } catch (error) {
    // 错误处理...
  }
}
```

## 创建统一的代理函数

为了简化代码，可以创建一个统一的代理函数：

```typescript
// api/src/utils/moomoo-proxy.ts

import axios from 'axios';

const EDGE_FUNCTION_URL = process.env.MOOMOO_EDGE_FUNCTION_URL || 'https://your-worker.workers.dev';
const USE_EDGE_FUNCTION = process.env.USE_MOOMOO_EDGE_FUNCTION === 'true';

interface MoomooProxyOptions {
  path: string;
  params?: Record<string, any>;
  cookies?: string;
  csrfToken?: string;
  quoteToken?: string;
  referer?: string;
  timeout?: number;
}

export async function moomooProxy(options: MoomooProxyOptions) {
  const {
    path,
    params = {},
    cookies,
    csrfToken,
    quoteToken,
    referer = 'https://www.moomoo.com/',
    timeout = 15000,
  } = options;

  if (USE_EDGE_FUNCTION) {
    // 使用边缘函数代理
    const proxyParams = {
      path,
      ...params,
      cookies,
      csrf_token: csrfToken,
      quote_token: quoteToken,
      referer,
    };

    const response = await axios.get(`${EDGE_FUNCTION_URL}/api/moomooapi`, {
      params: proxyParams,
      timeout,
    });

    if (response.data.success) {
      return response.data.data;
    } else {
      throw new Error(response.data.error || 'Edge function request failed');
    }
  } else {
    // 直接访问Moomoo API
    const headers: Record<string, string> = {
      'authority': 'www.moomoo.com',
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
      'referer': referer,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };

    if (cookies) headers['Cookie'] = cookies;
    if (csrfToken) headers['futu-x-csrf-token'] = csrfToken;
    if (quoteToken) headers['quote-token'] = quoteToken;

    const response = await axios.get(`https://www.moomoo.com${path}`, {
      params,
      headers,
      timeout,
    });

    return response.data;
  }
}
```

### 使用统一代理函数

```typescript
// 搜索接口
import { moomooProxy } from '../utils/moomoo-proxy';

async function searchStock(keyword: string) {
  const searchHeaders = await getFutunnSearchHeaders('https://www.moomoo.com/');
  
  const responseData = await moomooProxy({
    path: '/api/headfoot-search',
    params: {
      keyword: keyword.toLowerCase(),
      lang: 'zh-cn',
      site: 'sg',
    },
    cookies: searchHeaders['Cookie'],
    csrfToken: searchHeaders['futu-x-csrf-token'],
  });
  
  // 处理响应...
}

// K线数据
async function getKlineData(...) {
  const headers = this.getHeaders(referer);
  const quoteToken = this.generateQuoteToken(tokenParams);
  
  const responseData = await moomooProxy({
    path: '/quote-api/quote-v2/get-kline',
    params: requestParams,
    cookies: headers['Cookie'],
    csrfToken: headers['futu-x-csrf-token'],
    quoteToken: quoteToken,
    referer: referer,
  });
  
  // 处理响应...
}
```

## 环境变量配置

在 `.env` 文件中添加：

```bash
# Moomoo边缘函数配置
MOOMOO_EDGE_FUNCTION_URL=https://your-worker.workers.dev
USE_MOOMOO_EDGE_FUNCTION=true
```

## 测试

### 1. 测试边缘函数是否正常工作

```bash
curl "https://your-worker.workers.dev/api/moomooapi?path=/api/headfoot-search&keyword=tsla&lang=zh-cn&site=sg&cookies=YOUR_COOKIES&csrf_token=YOUR_CSRF_TOKEN"
```

### 2. 测试后端集成

```bash
# 设置环境变量
export USE_MOOMOO_EDGE_FUNCTION=true
export MOOMOO_EDGE_FUNCTION_URL=https://your-worker.workers.dev

# 运行后端服务
npm start

# 测试搜索接口
curl "http://localhost:3001/api/positions"
```

## 故障排查

### 1. 边缘函数返回502错误

- 检查边缘函数URL是否正确
- 检查边缘函数是否已部署
- 查看Cloudflare Workers日志

### 2. 边缘函数返回超时错误

- 检查Moomoo API是否可访问（从边缘函数所在地区）
- 增加超时时间（边缘函数默认25秒）

### 3. 响应数据格式不正确

- 确保使用 `response.data.data` 提取数据（如果使用边缘函数）
- 检查边缘函数返回的数据结构

### 4. Cookies或CSRF Token无效

- 确保cookies和CSRF token正确传递
- 检查cookies是否过期
- 验证CSRF token与cookies中的是否一致

## 性能优化

1. **缓存**：对于不经常变化的数据（如期权链），可以添加缓存
2. **并发控制**：限制同时发起的请求数量
3. **重试机制**：对于失败的请求，实现指数退避重试

## 安全建议

1. **HTTPS**：确保边缘函数使用HTTPS
2. **Cookies加密**：如果cookies包含敏感信息，考虑加密传输
3. **访问控制**：可以添加API密钥验证，限制边缘函数的访问
4. **日志记录**：记录所有请求，便于排查问题

