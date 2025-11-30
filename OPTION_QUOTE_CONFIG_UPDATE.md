# 期权行情查询配置更新

## 更新内容

### 1. 添加富途配置打印

在长桥 API 配置加载时，同时打印富途牛牛 API 配置信息，方便检查配置是否正确加载。

**文件：** `api/src/config/longport.ts`

**功能：**
- 优先从数据库读取富途配置（`futunn_csrf_token`、`futunn_cookies`）
- 如果数据库中没有配置，使用硬编码的游客配置
- 打印配置来源（数据库或硬编码）和配置值（部分隐藏）

**输出示例：**
```
使用长桥API配置（来源: 数据库）:
  APP_KEY: d31b1c43...
  APP_SECRET: 65affcfb...
  ACCESS_TOKEN: ...PdGW5bwbC2dfIzX3z9dw
使用富途牛牛API配置（来源: 硬编码（游客配置））:
  CSRF_TOKEN: f51O2KPx...
  COOKIES: cipher_device_id=1763971814778021; ftreport-jssdk%40new_user=1...
```

### 2. 添加长桥期权查询开关配置

新增配置项 `longport_enable_option_quote`，用于控制是否启用长桥 API 的期权行情查询。

**文件：** `api/migrations/006_add_option_quote_config.sql`

**配置项：**
- **键名：** `longport_enable_option_quote`
- **默认值：** `false`（关闭，使用富途 API）
- **类型：** 字符串（`'true'` 或 `'false'`）
- **加密：** 否
- **描述：** Enable LongPort API for option quotes (default: false, use Futunn API instead)

**文件：** `api/src/routes/positions.ts`

**逻辑：**
- 读取配置 `longport_enable_option_quote`
- 如果为 `false`（默认值），直接跳过长桥 API 查询，使用富途牛牛 API
- 如果为 `true`，先尝试长桥 API，失败后再使用富途牛牛 API 作为备用

## 使用方法

### 1. 运行数据库迁移

```bash
# 本地环境
psql -U postgres -d trading_db -f api/migrations/006_add_option_quote_config.sql

# Docker 环境
docker-compose exec postgres psql -U trading_user -d trading_db -f /docker-entrypoint-initdb.d/006_add_option_quote_config.sql
```

### 2. 配置选项

#### 方式 1：通过配置管理页面

1. 访问 `http://localhost:3000/config`
2. 登录管理员账户
3. 找到 `longport_enable_option_quote` 配置项
4. 设置为 `true` 启用长桥期权查询，或 `false` 使用富途 API（默认）

#### 方式 2：通过数据库直接更新

```sql
-- 启用长桥期权查询
UPDATE system_config 
SET config_value = 'true' 
WHERE config_key = 'longport_enable_option_quote';

-- 禁用长桥期权查询（使用富途 API）
UPDATE system_config 
SET config_value = 'false' 
WHERE config_key = 'longport_enable_option_quote';
```

### 3. 验证配置

重启 API 服务后，查看日志：

**禁用长桥期权查询（默认）：**
```
[期权行情] 准备获取 1 个期权行情: [ 'TSLA251205P410000.US' ]
[期权行情] 长桥期权查询已禁用（配置: longport_enable_option_quote=false），直接使用富途牛牛API
[期权行情] 尝试使用富途牛牛API获取 1 个期权行情...
```

**启用长桥期权查询：**
```
[期权行情] 准备获取 1 个期权行情: [ 'TSLA251205P410000.US' ]
获取期权行情失败（长桥API）: [Error: response error: 7: detail:Some(WsResponseErrorDetail { code: 301604, msg: "no quote access" })]
期权行情权限不足（301604），尝试使用富途牛牛API作为备用方案...
[期权行情] 尝试使用富途牛牛API获取 1 个期权行情...
```

## 配置说明

### 为什么默认使用富途 API？

1. **权限问题：** 长桥 API 的期权行情需要额外权限（错误码 301604），大多数账户没有此权限
2. **性能：** 富途 API 查询速度更快，不会因为权限错误而延迟
3. **稳定性：** 富途 API 作为备用方案更可靠

### 何时启用长桥期权查询？

只有在以下情况下才建议启用：
- 账户已开通长桥 API 的期权行情权限
- 需要更准确的期权数据（隐含波动率、持仓量等）
- 富途 API 无法获取到所需期权数据

### 富途配置管理

富途配置有两种来源：

1. **数据库配置（推荐）：**
   - `futunn_csrf_token`：CSRF Token
   - `futunn_cookies`：Cookies 字符串
   - 通过配置管理页面更新

2. **硬编码配置（默认）：**
   - 使用 Moomoo 游客配置
   - 无需配置，开箱即用
   - 可能在某些情况下失效，需要更新

**建议：** 如果富途 API 查询失败，检查配置是否正确加载。如果使用硬编码配置，可能需要更新 `api/src/config/futunn.ts` 中的游客配置。

## 相关文件

- `api/migrations/006_add_option_quote_config.sql` - 数据库迁移脚本
- `api/src/config/longport.ts` - 长桥和富途配置加载
- `api/src/routes/positions.ts` - 持仓查询路由（期权行情逻辑）
- `api/src/config/futunn.ts` - 富途配置（硬编码）

## 故障排除

### 问题 1：富途配置显示为硬编码，但数据库中有配置

**原因：** 配置值可能为空字符串，系统会视为未配置

**解决：** 检查数据库中的配置值是否为空：
```sql
SELECT config_key, config_value, encrypted 
FROM system_config 
WHERE config_key IN ('futunn_csrf_token', 'futunn_cookies');
```

### 问题 2：期权行情查询仍然使用长桥 API

**原因：** 配置可能未正确读取

**解决：**
1. 检查配置值是否为字符串 `'true'`（不是布尔值）
2. 重启 API 服务
3. 查看日志确认配置读取情况

### 问题 3：富途 API 查询超时

**原因：** 网络问题或 API 服务不稳定

**解决：**
- 检查网络连接
- 查看富途配置是否正确
- 考虑更新硬编码的游客配置

