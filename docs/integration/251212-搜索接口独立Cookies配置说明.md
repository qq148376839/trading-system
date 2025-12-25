# 搜索接口独立Cookies配置说明

## 概述

为了优化搜索接口（`/api/headfoot-search`）的稳定性，我们创建了一个独立的cookies配置机制，允许为搜索接口单独配置cookies，与主API接口的cookies分离。

## 实现的功能

### 1. 数据库配置项

新增了 `futunn_search_cookies` 配置项，专门用于存储搜索接口的cookies：

```sql
-- 配置项已通过迁移脚本添加
INSERT INTO system_config (config_key, config_value, encrypted, description) VALUES
    ('futunn_search_cookies', '', true, 'Futunn API Cookies for search endpoint (headfoot-search), separate from main API cookies')
ON CONFLICT (config_key) DO NOTHING;
```

### 2. 专用Headers函数

在 `api/src/config/futunn.ts` 中新增了 `getFutunnSearchHeaders()` 函数：

```typescript
export async function getFutunnSearchHeaders(referer: string = 'https://www.moomoo.com/'): Promise<Record<string, string>>
```

**功能特点**：
- 优先使用数据库中的 `futunn_search_cookies` 配置
- 如果搜索专用cookies不存在，回退到主配置 `futunn_cookies`
- 如果主配置也不存在，使用硬编码的默认配置
- 自动从cookies中提取CSRF token，或从数据库获取
- 包含完整的浏览器headers（User-Agent, Referer等）

### 3. 更新的服务

以下服务已更新为使用搜索专用headers：

1. **`api/src/services/futunn-option-quote.service.ts`**
   - `searchStock()` 函数现在使用 `getFutunnSearchHeaders()`

2. **`api/src/services/futunn-option-chain.service.ts`**
   - `searchStock()` 函数现在使用 `getFutunnSearchHeaders()`

## 使用方法

### 1. 运行迁移脚本

```bash
psql -d trading_db -f api/migrations/007_add_futunn_search_cookies.sql
```

### 2. 配置搜索Cookies

通过配置管理页面或直接更新数据库：

**通过配置管理页面**：
1. 登录系统
2. 进入"配置管理"页面
3. 找到 `futunn_search_cookies` 配置项
4. 输入搜索接口专用的cookies
5. 保存配置

**直接更新数据库**：
```sql
UPDATE system_config 
SET config_value = 'your_search_cookies_here' 
WHERE config_key = 'futunn_search_cookies';
```

### 3. 验证配置

调用搜索接口，检查是否正常工作：

```bash
curl -X POST http://localhost:3001/api/options/search \
  -H "Content-Type: application/json" \
  -d '{"query": "AAPL"}'
```

## 配置优先级

搜索接口的cookies配置按以下优先级使用：

1. **`futunn_search_cookies`**（数据库配置）- 最高优先级
2. **`futunn_cookies`**（主配置）- 回退选项
3. **硬编码默认配置** - 最后回退

## 注意事项

1. **Cookies格式**：
   - Cookies应该是完整的cookie字符串，格式如：`cookie1=value1; cookie2=value2`
   - 确保包含必要的认证信息（如 `csrfToken`, `futu-csrf` 等）

2. **加密存储**：
   - `futunn_search_cookies` 配置项设置为加密存储（`encrypted: true`）
   - 确保配置管理密钥（`CONFIG_ENCRYPTION_KEY`）已正确设置

3. **CSRF Token**：
   - 如果cookies中包含CSRF token，会自动提取
   - 如果没有，会从数据库的 `futunn_csrf_token` 配置项获取

4. **独立配置的优势**：
   - 搜索接口可以使用不同的cookies，避免与主API接口冲突
   - 如果搜索接口需要特殊的认证信息，可以单独配置
   - 不影响主API接口的cookies配置

## 相关文件

- `api/migrations/007_add_futunn_search_cookies.sql` - 数据库迁移脚本
- `api/src/config/futunn.ts` - Futunn配置和headers函数
- `api/src/services/futunn-option-quote.service.ts` - 期权报价服务
- `api/src/services/futunn-option-chain.service.ts` - 期权链服务

## 故障排除

### 问题1: 搜索接口返回403或401错误

**可能原因**：
- Cookies配置不正确或已过期
- CSRF token缺失或无效

**解决方案**：
1. 检查 `futunn_search_cookies` 配置是否正确
2. 确认cookies中包含必要的认证信息
3. 尝试更新cookies配置

### 问题2: 搜索接口超时

**可能原因**：
- Cookies配置的域名或路径不正确
- 网络连接问题

**解决方案**：
1. 检查cookies的域名和路径设置
2. 确认网络连接正常
3. 检查代理配置（如果使用）

---

**创建时间**：2025-12-12  
**最后更新**：2025-12-12




