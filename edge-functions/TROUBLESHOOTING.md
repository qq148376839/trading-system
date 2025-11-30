# 边缘函数故障排查指南

## 常见问题

### 1. 返回 "Params Error"

**症状**：Moomoo API返回 "Params Error" 或 "Params Error"

**可能原因**：
1. quote-token计算不正确
2. 参数顺序不正确
3. 参数类型不正确（应该是字符串）
4. 缺少必需的参数

**解决方法**：
1. 检查边缘函数日志中的token参数详情
2. 确认参数顺序与后端代码一致
3. 确认所有参数都已转换为字符串类型
4. 检查是否所有必需参数都已传递

### 2. 返回空数据（0条）

**症状**：API调用成功但返回0条数据

**可能原因**：
1. cookies或CSRF token过期
2. quote-token计算错误
3. 参数值不正确

**解决方法**：
1. 更新边缘函数中的默认cookies和CSRF token
2. 检查quote-token计算日志
3. 验证参数值是否正确

### 3. 超时错误

**症状**：请求超时（504错误）

**可能原因**：
1. Moomoo API响应慢
2. 网络问题
3. 边缘函数超时设置过短

**解决方法**：
1. 检查Moomoo API状态
2. 增加超时时间（当前25秒）
3. 检查网络连接

## 调试步骤

### 1. 查看边缘函数日志

在Cloudflare Workers Dashboard中查看日志：
- 查找 `[边缘函数]` 开头的日志
- 检查quote-token计算过程
- 检查请求参数

### 2. 测试单个接口

使用curl直接测试边缘函数：

```bash
# 测试K线数据
curl "https://cfapi.riowang.win/api/moomooapi?path=/quote-api/quote-v2/get-kline&stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001&_=$(date +%s)000"

# 测试分时数据
curl "https://cfapi.riowang.win/api/moomooapi?path=/quote-api/quote-v2/get-quote-minute&stockId=200003&marketType=2&type=1&marketCode=24&instrumentType=6&subInstrumentType=6001&_=$(date +%s)000"
```

### 3. 验证quote-token计算

检查日志中的token参数：
```
[边缘函数] Token参数详情: {"stockId":"200003","marketType":"2","type":"2","marketCode":"24","instrumentType":"6","subInstrumentType":"6001","_":"1764480110455"}
```

确认：
- 所有参数都存在
- 参数顺序正确
- 参数值都是字符串类型

### 4. 检查响应格式

边缘函数返回的格式：
```json
{
  "success": true,
  "status": 200,
  "data": {
    "code": 0,
    "message": "成功",
    "data": [...]
  }
}
```

如果 `success: false`，检查 `error` 字段获取错误信息。

## 参数检查清单

### K线/分时数据接口

必需参数：
- ✅ `stockId` - 股票ID（字符串）
- ✅ `marketType` - 市场类型（字符串）
- ✅ `type` - 数据类型：1=分时，2=日K（字符串）
- ✅ `marketCode` - 市场代码（字符串）
- ✅ `instrumentType` - 工具类型（字符串）
- ✅ `subInstrumentType` - 子工具类型（字符串）
- ✅ `_` - 时间戳（字符串，毫秒）

参数顺序（用于计算quote-token）：
1. stockId
2. marketType
3. type
4. marketCode
5. instrumentType
6. subInstrumentType
7. _

### 示例

```javascript
// 正确的参数格式
{
  stockId: "200003",
  marketType: "2",
  type: "2",
  marketCode: "24",
  instrumentType: "6",
  subInstrumentType: "6001",
  _: "1764480110455"
}
```

## 更新默认配置

如果默认的cookies或CSRF token过期：

1. 从浏览器获取最新的cookies和CSRF token
2. 更新 `moomooapi.js` 中的默认值：
   ```javascript
   const DEFAULT_COOKIES = '新的cookies字符串';
   const DEFAULT_CSRF_TOKEN = '新的CSRF token';
   ```
3. 重新部署边缘函数

## 联系支持

如果问题仍然存在，请提供：
1. 边缘函数日志（包含quote-token计算过程）
2. 请求参数详情
3. 错误响应内容
4. 测试用的curl命令和结果

