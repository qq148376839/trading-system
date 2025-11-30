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

**功能特点：**
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

### 2. 设置搜索专用Cookies

通过配置管理API或直接更新数据库：

**方法1：通过配置管理API（推荐）**
```bash
# 使用管理员账户登录后，通过API设置
POST /api/config
{
  "key": "futunn_search_cookies",
  "value": "你的搜索接口cookies字符串",
  "encrypted": true
}
```

**方法2：直接更新数据库**
```sql
UPDATE system_config 
SET config_value = '你的搜索接口cookies字符串（加密后）'
WHERE config_key = 'futunn_search_cookies';
```

### 3. 测试搜索接口

使用测试脚本验证配置：

```bash
cd api
npx tsx scripts/test-search-cookies.ts TSLA
```

## 配置优先级

搜索接口的cookies配置按以下优先级顺序：

1. **`futunn_search_cookies`**（数据库）- 搜索接口专用配置
2. **`futunn_cookies`**（数据库）- 主API配置
3. **硬编码默认配置** - 游客配置（fallback）

## 日志输出

搜索接口会输出详细的配置信息：

```
[富途搜索配置] 使用数据库中的搜索专用cookies（长度: 1708）
[富途搜索配置] 配置来源: 数据库（搜索专用）
[富途搜索配置] CSRF Token: _8Bl5E-0g3ZK...
```

## 优势

1. **独立配置**：搜索接口可以有自己的cookies，不影响主API接口
2. **灵活回退**：如果搜索专用配置不存在，自动使用主配置
3. **易于调试**：详细的日志输出，方便排查问题
4. **向后兼容**：如果未配置搜索专用cookies，自动使用现有配置

## 注意事项

1. **Cookies格式**：cookies字符串应该是完整的cookie字符串，格式如：`key1=value1; key2=value2; ...`
2. **加密存储**：`futunn_search_cookies` 配置项默认加密存储，确保安全性
3. **CSRF Token**：函数会自动从cookies中提取CSRF token，或使用主配置的CSRF token
4. **超时设置**：搜索接口的超时时间设置为10秒，如果遇到超时问题，可能需要检查网络连接或cookies有效性

## 故障排查

如果搜索接口仍然超时或失败：

1. **检查cookies有效性**：确保cookies未过期
2. **验证CSRF Token**：确保CSRF token与cookies中的一致
3. **网络连接**：检查是否能正常访问 `https://www.moomoo.com`
4. **查看日志**：检查配置来源和headers信息
5. **测试脚本**：使用 `test-search-cookies.ts` 脚本进行独立测试

## 相关文件

- `api/migrations/007_add_futunn_search_cookies.sql` - 数据库迁移脚本
- `api/src/config/futunn.ts` - 配置函数实现
- `api/src/services/futunn-option-quote.service.ts` - 期权行情服务
- `api/src/services/futunn-option-chain.service.ts` - 期权链服务
- `api/scripts/test-search-cookies.ts` - 测试脚本

