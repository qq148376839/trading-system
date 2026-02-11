# Moomoo 多 Cookie 管理与边缘代理优化

## 文档信息

- **创建时间**: 2026-02-11
- **更新时间**: 2026-02-11
- **状态**: 已完成
- **类型**: 新功能

---

## 概述

实现 Moomoo Cookie 的多账户管理 UI、后端 DB 驱动配置加载、Cookie 测试 API，以及边缘函数 URL 的 DB 配置化。同时将 Cloudflare Worker 从 `wrangler.toml` 迁移到 `wrangler.jsonc`（wrangler v4 兼容）并完成部署。

---

## 实现内容

### 1. 前端多 Cookie 管理 UI (`frontend/app/config/page.tsx`)

- 新增 `MoomooCookieRow` 接口和状态管理
- Moomoo Cookie 管理卡片，支持逐行添加/删除/测试/保存
- 状态标签：unknown / testing / valid / expired，测试后显示结果
- 登录后从 DB 加载，保存时以 JSON 格式写入 `moomoo_guest_cookies` 配置项
- Config 表列表现在过滤掉 `moomoo_guest_cookies`、`futunn_cookies`、`futunn_csrf_token`、`futunn_search_cookies`（这些由专用 UI 管理）

### 2. 后端 DB 驱动 Cookie 加载 (`api/src/config/futunn.ts`)

- `refreshDBConfigs()`: 从 DB 读取 `moomoo_guest_cookies`，5 分钟 TTL 缓存
- `getEffectiveConfigs()`: 优先返回 DB 配置，无可用时降级到硬编码默认值
- `getFutunnConfig()`: 保持同步接口不变，下游无需改动
- `initFutunnConfig()`: 启动时异步加载 DB 配置 + `setInterval` 定期刷新

### 3. Cookie 测试 API (`api/src/routes/config.ts`)

- `POST /api/config/get-value`: 返回解密后的配置值
- `POST /api/config/test-moomoo-cookie`: 使用指定 Cookie 通过边缘代理请求 SPX 日K 数据，验证 Cookie 有效性

### 4. 前端 API 方法 (`frontend/lib/api.ts`)

- `configApi.getConfigValue(key, username, password)`: 获取配置值
- `configApi.testMoomooCookie(cookies, csrfToken, username, password)`: 测试指定 Cookie

### 5. 边缘函数 URL 从 DB 加载 (`api/src/utils/moomoo-proxy.ts`)

- 从 DB 读取 `moomoo_edge_function_url` 和 `use_moomoo_edge_function`
- 5 分钟缓存 TTL，环境变量作为 fallback
- `getProxyMode()` 改为 async（调用方已同步调整）

### 6. DB 迁移 (`api/migrations/000_init_schema.sql`)

新增种子数据：
- `moomoo_guest_cookies`: 默认为空 JSON 数组 `[]`
- `moomoo_edge_function_url`: 边缘函数 URL
- `use_moomoo_edge_function`: 是否启用边缘代理（默认 `true`）

### 7. Cloudflare Worker 部署 (`edge-functions/moomoo-proxy/`)

- 配置文件从 `wrangler.toml` 迁移到 `wrangler.jsonc`（wrangler v4 兼容）
- KV namespace `MOOMOO_CACHE` 已创建（id: `792746a2ab82498cbbf143ba30c1731c`）
- Routes 启用：`moomoo-api.riowang.win/*`
- 已部署到 Cloudflare Workers

---

## 技术细节

### Cookie 配置数据流

```
前端 config 页面
  -> POST /api/config (保存 moomoo_guest_cookies JSON)
  -> DB system_config 表
  -> futunn.ts refreshDBConfigs() 每5分钟拉取
  -> getEffectiveConfigs() 返回有效配置
  -> moomoo-proxy.ts / market-data.service.ts 使用
```

### 边缘代理配置数据流

```
DB system_config.moomoo_edge_function_url
  -> moomoo-proxy.ts getEdgeFunctionConfig() 每5分钟缓存
  -> getProxyMode() async 判断是否走代理
  -> moomooProxy() 请求时选择直连或代理
```

### Cookie 测试流程

```
前端点击"测试" -> POST /api/config/test-moomoo-cookie
  -> 构造 headers (cookies + csrf-token)
  -> 调用边缘代理 get-security-kline (SPX 日K)
  -> 返回 success/error + 响应时间
```

---

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/app/config/page.tsx` | 修改 | 多 Cookie 管理 UI |
| `frontend/lib/api.ts` | 修改 | 新增 configApi 方法 |
| `api/src/config/futunn.ts` | 修改 | DB 驱动 Cookie 加载 |
| `api/src/routes/config.ts` | 修改 | 新增测试/获取值 API |
| `api/src/utils/moomoo-proxy.ts` | 修改 | 边缘函数 URL 从 DB 加载 |
| `api/src/routes/forex.ts` | 修改 | 适配 async getProxyMode |
| `api/src/routes/futunn-test.ts` | 修改 | 适配 async getProxyMode |
| `api/src/routes/options.ts` | 修改 | 适配 async getProxyMode |
| `api/src/services/futunn-option-chain.service.ts` | 修改 | 适配 async getProxyMode |
| `api/src/services/futunn-option-quote.service.ts` | 修改 | 适配 async getProxyMode |
| `api/src/services/institution-stock-selector.service.ts` | 修改 | 适配 async getProxyMode |
| `api/src/services/market-data.service.ts` | 修改 | 适配 async getProxyMode |
| `api/src/utils/moomoo-quote-token.ts` | 新增 | Quote token 计算工具 |
| `api/migrations/000_init_schema.sql` | 修改 | 新增种子数据 |
| `edge-functions/moomoo-proxy/wrangler.jsonc` | 新增 | Cloudflare Worker 配置 (v4) |
| `edge-functions/moomoo-proxy/` | 新增 | Worker 部署目录 |

---

## 相关文档

- [Moomoo API 边缘函数集成](../integration/251212-Moomoo-API边缘函数集成完成.md)
- [搜索接口独立 Cookies 配置说明](../integration/251212-搜索接口独立Cookies配置说明.md)
- [Moomoo 403 限频问题分析](../analysis/260210-Moomoo-403限频问题分析.md)
