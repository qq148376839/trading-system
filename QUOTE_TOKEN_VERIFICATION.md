# Quote-Token 验证结果

## 测试结果

使用浏览器请求的参数进行验证：

**浏览器请求参数：**
```
stockId=200002
marketType=2
type=2
marketCode=11
instrumentType=6
subInstrumentType=6001
_=1764339070127
```

**期望的 quote-token：** `bec6a5688a`

**计算结果：** `bec6a5688a` ✅ **匹配！**

## 关键发现

### 1. Quote-Token 计算逻辑正确

代码中的计算逻辑是正确的：
1. 使用 `JSON.stringify` 将参数对象转换为字符串
2. HMAC-SHA512 加密（密钥：`quote_web`）
3. 取前10位
4. SHA256 哈希
5. 取前10位作为最终 token

### 2. 参数顺序很重要

测试显示：
- ✅ 正确的参数顺序：`stockId, marketType, type, marketCode, instrumentType, subInstrumentType, _`
- ❌ 不同的参数顺序会产生不同的 token

### 3. 参数类型必须是字符串

测试显示：
- ✅ 字符串类型：`{"stockId":"200002",...}` → token: `bec6a5688a`
- ❌ 数字类型：`{"stockId":200002,...}` → token: `80daf64fc3`（不同）

## 代码验证

代码中已经正确实现了：
- ✅ 参数使用字符串类型
- ✅ 参数顺序正确（与浏览器一致）
- ✅ 计算逻辑正确

## 请求失败的可能原因

既然 quote-token 计算正确，CSRF Token 和 Cookies 也一致，请求失败可能是以下原因：

### 1. Cookies 已过期

虽然 CSRF Token 和 cookies 中的 csrfToken 一致，但 cookies 可能已经过期。

**验证方法：**
- 在浏览器中访问 `https://www.moomoo.com`
- 查看 Network 标签中的请求是否成功
- 如果浏览器请求也失败，说明 cookies 已过期

**解决方案：**
- 更新数据库中的 `futunn_cookies` 配置
- 或更新 `api/src/config/futunn.ts` 中的硬编码配置

### 2. 请求频率过高

富途 API 可能有请求频率限制，频繁请求可能被限流。

**解决方案：**
- 添加请求间隔（已在代码中实现重试延迟）
- 减少并发请求数量

### 3. Referer 不匹配

虽然已经根据 stockId 设置了不同的 referer，但可能还需要更精确的匹配。

**当前实现：**
```typescript
if (stockId === '200003') {
  referer = 'https://www.moomoo.com/ja/index/.SPX-US';
} else if (stockId === '72000025') {
  referer = 'https://www.moomoo.com/currency/USDINDEX-FX';
} else if (stockId === '12000015') {
  referer = 'https://www.moomoo.com/currency/BTC-FX';
}
```

**浏览器请求的 referer：** `https://www.moomoo.com/ja/index/.IXIC-US`

**注意：** 浏览器请求的是 `.IXIC-US`（纳斯达克指数），而代码中设置的是 `.SPX-US`（标普500）。如果请求的是不同的股票，referer 应该匹配。

### 4. User-Agent 或其他 Headers

代码中的 User-Agent 可能与浏览器不完全一致。

**当前 User-Agent：**
```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
```

**浏览器 User-Agent：**
```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
```

**差异：** 操作系统不同（Windows vs macOS）

### 5. 网络连接问题

`ECONNRESET` 错误可能是网络连接不稳定导致的。

**解决方案：**
- 已实现重试机制（3次重试，递增延迟）
- 增加超时时间到15秒

## 调试建议

### 1. 启用详细日志

代码中已添加调试日志，会显示：
- quote-token 的计算参数
- 计算的 quote-token 值
- 请求的完整参数

### 2. 对比浏览器请求

1. 打开浏览器开发者工具（F12）
2. 访问 `https://www.moomoo.com`
3. 在 Network 标签中查看请求
4. 对比：
   - Headers（特别是 User-Agent、Referer）
   - Cookies
   - 请求参数

### 3. 测试单个请求

使用测试脚本验证单个请求：

```bash
cd api
node scripts/test-quote-token.js
```

## 下一步行动

1. **检查 Cookies 是否过期**
   - 在浏览器中测试相同的请求
   - 如果浏览器也失败，更新 cookies

2. **对比完整的请求 Headers**
   - 确保所有 headers 都与浏览器一致
   - 特别注意 User-Agent、Referer

3. **检查请求参数**
   - 确保 stockId、marketCode 等参数正确
   - 确保参数顺序与浏览器一致

4. **监控重试日志**
   - 查看重试是否成功
   - 如果重试后仍然失败，可能是 cookies 过期

## 相关文件

- `api/scripts/test-quote-token.js` - quote-token 计算测试脚本
- `api/src/services/market-data.service.ts` - 市场数据服务（包含 quote-token 计算）
- `api/src/config/futunn.ts` - 富途配置（cookies 和 CSRF token）

