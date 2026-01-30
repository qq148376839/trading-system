# API 设计规范

## 🔄 RESTful API 规范

### 路由命名

- ✅ 使用复数名词（如 `/api/orders`, `/api/strategies`）
- ✅ 嵌套资源使用 `/api/strategies/:id/signals`
- ✅ 使用 HTTP 动词: GET, POST, PUT, DELETE, PATCH

### 响应格式

```typescript
// 成功响应
{
  "success": true,
  "data": { ... },
  "message": "操作成功"
}

// 错误响应
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": { ... }
  }
}
```

### 状态码

- `200` - 成功
- `201` - 创建成功
- `400` - 请求参数错误
- `401` - 未授权
- `404` - 资源不存在
- `500` - 服务器错误

## 🔌 Longbridge SDK 使用规范

### SDK 调用

- ✅ 所有订单操作必须使用 Longbridge SDK
- ✅ 使用 `getLongPortContext()` 获取 SDK 上下文
- ✅ 错误处理必须捕获 SDK 异常

### 数据映射

- ✅ SDK 返回的数字枚举值必须转换为字符串枚举值
- ✅ 订单状态、订单类型等字段提供中文翻译
- ✅ 使用 `utils/enum-mapper.ts` 进行枚举映射

## 📊 API 优化

- ✅ 使用缓存减少重复查询
- ✅ 分页查询大量数据
- ✅ 使用批量操作减少请求次数






