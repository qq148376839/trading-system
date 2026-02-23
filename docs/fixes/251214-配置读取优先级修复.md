# 配置读取优先级修复文档

## 问题描述

在Docker部署环境中发现长桥API初始化失败,错误提示:
```
openapi error: code=403204: apikey not exists
```

通过日志分析发现,系统使用了占位符配置 `your_app_key` 和 `your_app_secret`,而不是数据库中的真实配置。

## 根本原因

### 原始设计
系统配置经历了两个阶段:
1. **早期设计**: 所有配置存储在 `.env` 文件中
2. **后期升级**: 配置迁移到数据库,通过设置页面管理

### 配置读取逻辑
代码逻辑是:先从数据库读取配置,如果数据库没有则使用环境变量作为fallback。

### Bug根源
在 `api/src/config/longport.ts` 中的配置读取逻辑存在缺陷:

```typescript
// ❌ 错误的实现
appKey = appKey || process.env.LONGPORT_APP_KEY || null;
appSecret = appSecret || process.env.LONGPORT_APP_SECRET || null;
accessToken = accessToken || process.env.LONGPORT_ACCESS_TOKEN || null;
```

**问题**: JavaScript的 `||` 运算符将以下值视为falsy:
- `null`
- `undefined`
- `""` (空字符串)
- `0`
- `false`

当数据库返回**空字符串**时,`||` 运算符会认为这是falsy值,导致使用环境变量覆盖数据库配置。

### 实际影响

**本地环境**:
- `.env` 文件包含真实的API凭证
- 即使逻辑有bug,也能正常工作

**线上Docker环境**:
- 数据库配置可能是空字符串或不完整
- docker-compose.yml 中设置了默认值: `${LONGPORT_APP_KEY:-your_app_key}`
- 导致使用占位符值,API调用失败

## 修复方案

### 代码修改

修改文件: `api/src/config/longport.ts` (两处)

#### 1. QuoteContext初始化 (第123-180行)

**修改前**:
```typescript
if (service) {
  try {
    appKey = await service.getConfig('longport_app_key');
    appSecret = await service.getConfig('longport_app_secret');
    accessToken = await service.getConfig('longport_access_token');
    enableOvernight = await service.getConfig('longport_enable_overnight');
  } catch (error: any) {
    console.warn('从数据库读取配置失败，使用环境变量:', error.message);
  }
}

// Fallback到环境变量
appKey = appKey || process.env.LONGPORT_APP_KEY || null;
appSecret = appSecret || process.env.LONGPORT_APP_SECRET || null;
accessToken = accessToken || process.env.LONGPORT_ACCESS_TOKEN || null;
```

**修改后**:
```typescript
// 记录从数据库读取的值（用于判断配置来源）
let dbAppKey: string | null = null;
let dbAppSecret: string | null = null;
let dbAccessToken: string | null = null;

if (service) {
  try {
    dbAppKey = await service.getConfig('longport_app_key');
    dbAppSecret = await service.getConfig('longport_app_secret');
    dbAccessToken = await service.getConfig('longport_access_token');
    enableOvernight = await service.getConfig('longport_enable_overnight');

    appKey = dbAppKey;
    appSecret = dbAppSecret;
    accessToken = dbAccessToken;
  } catch (error: any) {
    console.warn('从数据库读取配置失败，使用环境变量:', error.message);
  }
}

// 只有当数据库返回 null/undefined 时才使用环境变量（不使用 || 运算符，避免空字符串被覆盖）
if (appKey == null) appKey = process.env.LONGPORT_APP_KEY || null;
if (appSecret == null) appSecret = process.env.LONGPORT_APP_SECRET || null;
if (accessToken == null) accessToken = process.env.LONGPORT_ACCESS_TOKEN || null;

// 记录配置来源
const appKeySource = dbAppKey != null ? '数据库' : '环境变量';
const appSecretSource = dbAppSecret != null ? '数据库' : '环境变量';
const accessTokenSource = dbAccessToken != null ? '数据库' : '环境变量';
```

#### 2. TradeContext初始化 (第307-365行)

相同的修改应用于 `initTradeContext()` 函数。

### 关键改进

1. **严格的null检查**: 使用 `== null` 而不是 `||` 运算符
   - `== null` 只匹配 `null` 和 `undefined`
   - 空字符串 `""` 不会触发fallback

2. **配置来源跟踪**: 记录配置实际来源,便于调试
   ```typescript
   const appKeySource = dbAppKey != null ? '数据库' : '环境变量';
   ```

3. **增强的日志输出**:
   ```typescript
   console.log(`  APP_KEY: ${appKey.substring(0, 8)}... (来源: ${appKeySource})`);
   console.log(`  APP_SECRET: ${appSecret.substring(0, 8)}... (来源: ${appSecretSource})`);
   console.log(`  ACCESS_TOKEN: ${tokenDisplay} (来源: ${accessTokenSource})`);
   ```

## 部署说明

### 本地测试

```bash
# 1. 构建代码
cd api
pnpm run build

# 2. 启动开发服务器
pnpm run dev

# 3. 检查日志输出
# 应该看到: APP_KEY: xxxxxxxx... (来源: 数据库)
```

### Docker部署

```bash
# 1. 拉取最新代码
git pull

# 2. 重新构建镜像（不使用缓存）
docker-compose build --no-cache

# 3. 重启容器
docker-compose down
docker-compose up -d

# 4. 查看日志确认
docker logs -f trading-app

# 预期输出:
# 使用长桥API配置:
#   APP_KEY: d31b1c43... (来源: 数据库)
#   APP_SECRET: 65affcfb... (来源: 数据库)
#   ACCESS_TOKEN: ...PdGW5bwbC2dfIzX3z9dw (来源: 数据库)
```

## 验证方法

### 1. 检查配置来源

启动服务后,查看日志中的配置来源标识:
- ✅ **正确**: `(来源: 数据库)`
- ❌ **错误**: `(来源: 环境变量)`

### 2. 测试数据库配置优先级

```sql
-- 查看当前数据库配置
SELECT key, value FROM system_config
WHERE key IN ('longport_app_key', 'longport_app_secret', 'longport_access_token');

-- 如果数据库有配置，应该优先使用数据库配置
-- 即使 .env 文件中也有配置
```

### 3. API调用测试

```bash
# 测试行情接口
curl http://localhost:3001/api/quotes/AAPL

# 应该返回正常的股票数据，而不是 403204 错误
```

## 注意事项

### 1. 环境变量优先级

修复后的优先级顺序:
1. **数据库配置** (最高优先级)
2. **环境变量** (fallback)
3. **docker-compose.yml默认值** (最后)

### 2. 空字符串处理

- 数据库返回空字符串 `""` 时,仍然使用数据库配置
- 如果不希望使用空字符串,应该在数据库中存储 `NULL` 而不是 `""`

### 3. 配置更新

修改配置后:
- 通过设置页面更新: 立即生效(需要重启服务)
- 修改 `.env` 文件: 只有数据库配置为NULL时才生效

## 影响范围

### 受影响的功能
- 长桥API所有接口
  - 行情数据获取
  - 交易订单提交
  - 账户信息查询
  - 期权策略执行

### 不受影响的功能
- 数据库连接
- 富途牛牛API
- 前端页面显示
- 历史数据查询

## 相关问题

### Q1: 为什么本地环境没有问题?

A: 本地 `.env` 文件包含真实的API凭证,即使逻辑有bug也能正常工作。

### Q2: 数据库配置应该如何设置?

A: 通过系统设置页面配置,或直接操作数据库:

```sql
-- 插入或更新配置
INSERT INTO system_config (key, value)
VALUES ('longport_app_key', 'your_real_app_key')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

### Q3: 如何清除错误的配置?

A: 将配置设置为NULL而不是空字符串:

```sql
UPDATE system_config
SET value = NULL
WHERE key = 'longport_app_key';
```

## 后续优化建议

1. **配置验证**: 在设置页面添加API凭证验证
2. **配置备份**: 自动备份配置变更历史
3. **错误提示**: 当API凭证无效时,提供更明确的错误信息
4. **健康检查**: 定期检查API凭证有效性

## 修复时间线

- **2026-02-05**: 发现问题
- **2026-02-05**: 定位根本原因
- **2026-02-05**: 实施修复并提交
- **待定**: 部署到生产环境

## 参考资料

- Issue: 数据库备份恢复后Docker环境API初始化失败
- 相关文件: `api/src/config/longport.ts`
- 提交: fix: 修复配置读取优先级逻辑,确保数据库配置优先于环境变量
