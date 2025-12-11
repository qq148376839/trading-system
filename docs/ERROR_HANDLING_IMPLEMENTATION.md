# 错误处理统一实施文档

**创建日期**: 2025-12-08  
**当前状态**: ✅ `quant.ts` 100%完成 | 🔄 其他路由进行中（90%完成）  
**预计完成**: 2025-12-09

---

## 📋 实施目标

建立统一的错误处理机制，包括：
1. ✅ 错误分类和错误码体系
2. ✅ 统一的错误处理中间件
3. 🔄 逐步迁移现有路由使用新错误处理系统
4. ⏳ 错误监控和告警机制

---

## ✅ 已完成工作

### 1. 错误分类和错误码体系

**文件**: `api/src/utils/errors.ts`

**实现内容**:
- ✅ 定义了 `ErrorCode` 枚举（30+个错误码）
- ✅ 定义了 `ErrorSeverity` 枚举（LOW, MEDIUM, HIGH, CRITICAL）
- ✅ 定义了 `ErrorCategory` 枚举（CLIENT_ERROR, SERVER_ERROR, EXTERNAL_ERROR, BUSINESS_ERROR）
- ✅ 创建了 `AppError` 类，包含完整的错误信息
- ✅ 实现了错误码到HTTP状态码的映射
- ✅ 实现了错误码到严重程度的映射
- ✅ 实现了错误码到错误分类的映射
- ✅ 创建了 `ErrorFactory` 工厂函数，方便创建常见错误
- ✅ 实现了 `normalizeError` 函数，将未知错误转换为标准错误

**错误码分类**:
- **通用错误** (1000-1999): INTERNAL_ERROR, INVALID_REQUEST, MISSING_PARAMETER, VALIDATION_ERROR
- **认证授权错误** (2000-2999): UNAUTHORIZED, TOKEN_EXPIRED, TOKEN_INVALID, PERMISSION_DENIED
- **资源错误** (3000-3999): NOT_FOUND, RESOURCE_CONFLICT, RESOURCE_EXHAUSTED
- **API限制错误** (4000-4999): RATE_LIMIT, QUOTA_EXCEEDED
- **业务逻辑错误** (5000-5999): CAPITAL_INSUFFICIENT, ORDER_SUBMIT_FAILED, SYNC_FAILED, STRATEGY_EXECUTION_FAILED
- **外部服务错误** (6000-6999): EXTERNAL_API_ERROR, DATABASE_ERROR, NETWORK_ERROR

### 2. 统一错误处理中间件

**文件**: `api/src/middleware/errorHandler.ts`

**实现内容**:
- ✅ 增强了错误处理中间件，支持 `AppError` 类型
- ✅ 根据错误严重程度记录不同级别的日志
- ✅ 在生产环境中隐藏敏感错误信息
- ✅ 提供统一的错误响应格式
- ✅ 在开发环境中提供详细的错误信息（包括堆栈跟踪）

**错误响应格式**:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误消息",
    "details": {}  // 可选，仅在开发环境
  },
  "stack": "...",  // 可选，仅在开发环境
  "severity": "MEDIUM",  // 可选，仅在开发环境
  "category": "CLIENT_ERROR"  // 可选，仅在开发环境
}
```

### 3. 路由迁移（部分完成）

**已迁移的路由**:
- ✅ `quant.ts` - **100%完成** ✅（25+个路由）
- ✅ `quote.ts` - **100%完成** ✅（3个路由）
  - ✅ GET `/`（获取行情）
  - ✅ GET `/security-list`（标的列表）
  - ✅ GET `/option`（期权行情）
- ✅ `candlesticks.ts` - **100%完成** ✅（1个路由）
  - ✅ GET `/`（K线数据）
- ✅ `trades.ts` - **100%完成** ✅（1个路由）
  - ✅ GET `/`（交易记录查询）
- ✅ `health.ts` - **100%完成** ✅（1个路由）
  - ✅ GET `/`（健康检查）
- ✅ `orders.ts` - **100%完成** ✅（10个路由）
  - ✅ GET `/account-balance`（账户余额查询）
  - ✅ POST `/sync-status`（同步订单状态和持仓）
  - ✅ GET `/history`（历史订单查询）
  - ✅ GET `/today`（今日订单查询）
  - ✅ POST `/submit`（提交订单）
  - ✅ GET `/security-info`（标的基础信息）
  - ✅ GET `/estimate-max-quantity`（预估最大购买数量）
  - ✅ PUT `/:orderId`（修改订单）
  - ✅ GET `/:orderId`（查询订单详情）
  - ✅ DELETE `/:orderId`（取消订单）
- ✅ `positions.ts` - **100%完成** ✅（4个路由）
  - ✅ GET `/`（获取持仓列表）
  - ✅ GET `/:symbol`（获取单个持仓详情）
  - ✅ POST `/`（创建或更新持仓）
  - ✅ DELETE `/:symbol`（删除持仓）
- ✅ `backtest.ts` - **100%完成** ✅（8个路由）
  - ✅ POST `/`（创建回测任务）
  - ✅ GET `/:id`（获取回测结果）
  - ✅ GET `/:id/status`（获取回测状态）
  - ✅ POST `/:id/retry`（重试失败的回测任务）
  - ✅ GET `/strategy/:strategyId`（获取策略的回测结果列表）
  - ✅ GET `/:id/export`（导出回测结果）
  - ✅ DELETE `/batch`（批量删除回测结果）
  - ✅ DELETE `/:id`（删除回测结果）
- ✅ `token-refresh.ts` - **100%完成** ✅（3个路由）
  - ✅ POST `/refresh`（手动刷新Token）
  - ✅ GET `/status`（检查Token状态）
  - ✅ POST `/auto-refresh`（触发自动刷新检查）
- ✅ `trading-recommendation.ts` - **100%完成** ✅（2个路由）
  - ✅ GET `/`（获取交易推荐列表）
  - ✅ GET `/:symbol`（获取单个股票的交易推荐）
- ✅ `watchlist.ts` - **100%完成** ✅（4个路由）
  - ✅ GET `/`（获取关注股票列表）
  - ✅ POST `/`（添加关注股票）
  - ✅ DELETE `/:symbol`（移除关注股票）
  - ✅ PUT `/:symbol`（启用/禁用关注股票）
- ✅ `trading-rules.ts` - **100%完成** ✅（5个路由）
  - ✅ GET `/`（获取交易规则列表）
  - ✅ GET `/:id`（获取单个交易规则详情）
  - ✅ POST `/`（创建交易规则）
  - ✅ PUT `/:id`（更新交易规则）
  - ✅ DELETE `/:id`（删除交易规则）
- ✅ `options.ts` - **100%完成** ✅（4个路由）
  - ✅ GET `/strike-dates`（获取期权到期日期列表）
  - ✅ GET `/chain`（获取期权链数据）
  - ✅ GET `/detail`（获取期权详情）
  - ✅ GET `/underlying-quote`（获取正股行情）
- ✅ `forex.ts` - **100%完成** ✅（4个路由）
  - ✅ GET `/products`（获取支持的外汇产品列表）
  - ✅ GET `/quote`（获取外汇实时报价）
  - ✅ GET `/candlestick`（获取外汇K线数据）
  - ✅ GET `/test-btc`（测试BTC API请求）
- ✅ `config.ts` - **100%完成** ✅（10个路由+1个中间件）
  - ✅ `requireAdmin`中间件（管理员认证）
  - ✅ POST `/auth`（管理员登录验证）
  - ✅ GET `/`（获取所有配置）
  - ✅ POST `/`（获取所有配置，支持POST）
  - ✅ GET `/:key`（获取单个配置值）
  - ✅ PUT `/:key`（更新配置）
  - ✅ POST `/batch`（批量更新配置）
  - ✅ DELETE `/:key`（删除配置）
  - ✅ POST `/admin/list`（获取所有管理员账户列表）
  - ✅ PUT `/admin/:id`（更新管理员账户）
  - ✅ POST `/admin`（创建管理员账户）

**迁移示例**:
```typescript
// 旧方式
catch (error: any) {
  console.error('操作失败:', error);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: error.message },
  });
}

// 新方式
catch (error: any) {
  const appError = normalizeError(error);
  return next(appError);
}
```

---

## 🔄 进行中的工作

### 1. 路由迁移

**待迁移的路由文件**:
- [ ] `routes/quant.ts` - 剩余部分（策略管理、资金使用等）
- [ ] `routes/quote.ts` - 行情API
- [ ] `routes/orders.ts` - 订单API
- [ ] `routes/candlesticks.ts` - K线数据API
- [ ] `routes/positions.ts` - 持仓API
- [ ] `routes/trades.ts` - 交易记录API
- [ ] 其他路由文件

**迁移步骤**:
1. 导入错误处理工具：`import { ErrorFactory, normalizeError } from '../utils/errors';`
2. 在路由处理函数中添加 `NextFunction` 参数
3. 将 `catch` 块中的错误处理改为使用 `next(appError)`
4. 将直接返回错误响应的代码改为使用 `ErrorFactory` 创建错误并调用 `next()`

### 2. 错误监控和告警机制

**计划实现**:
- [ ] 集成错误监控服务（如 Sentry）
- [ ] 实现错误统计和报告
- [ ] 设置关键错误的告警通知
- [ ] 实现错误趋势分析

---

## 📝 使用指南

### 创建错误

```typescript
import { ErrorFactory } from '../utils/errors';

// 使用工厂函数创建错误
throw ErrorFactory.missingParameter('userId');
throw ErrorFactory.notFound('用户');
throw ErrorFactory.rateLimit('请求频率过高');
throw ErrorFactory.capitalInsufficient('资金不足');
```

### 在路由中处理错误

```typescript
import { Request, Response, NextFunction } from 'express';
import { ErrorFactory, normalizeError } from '../utils/errors';

router.get('/example', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 业务逻辑
    if (!req.query.id) {
      return next(ErrorFactory.missingParameter('id'));
    }
    
    // 更多业务逻辑...
  } catch (error: any) {
    const appError = normalizeError(error);
    return next(appError);
  }
});
```

### 自定义错误

```typescript
import { createError, ErrorCode, ErrorSeverity, ErrorCategory } from '../utils/errors';

const customError = createError(
  ErrorCode.VALIDATION_ERROR,
  '自定义错误消息',
  { field: 'email', reason: '格式不正确' }
);
```

---

## 🎯 下一步计划

1. **完成路由迁移**（预计2-3天）
   - 优先迁移核心业务路由（quant, orders）
   - 逐步迁移其他路由
   - 确保所有错误都使用统一格式

2. **错误监控集成**（预计1-2天）
   - 选择并集成错误监控服务
   - 配置错误告警规则
   - 实现错误统计和报告

3. **测试和验证**（预计1天）
   - 测试各种错误场景
   - 验证错误响应格式
   - 验证错误日志记录

---

## 📚 相关文档

- [错误码参考](./ERROR_CODES_REFERENCE.md) - 完整的错误码列表和说明
- [FIX_IMPLEMENTATION_GUIDE.md](./FIX_IMPLEMENTATION_GUIDE.md) - 修复实施指南
- [NEXT_STEPS_GUIDE.md](./NEXT_STEPS_GUIDE.md) - 下一步行动计划

---

**最后更新**: 2025-12-08  
**当前进度**: 100% ✅  
**完成状态**: 
1. ✅ 完成 `quant.ts` 所有API迁移（已完成，25+个路由）
2. ✅ 完成 `quote.ts` 所有API迁移（已完成，3个路由）
3. ✅ 完成 `candlesticks.ts` 所有API迁移（已完成，1个路由）
4. ✅ 完成 `trades.ts` 所有API迁移（已完成，1个路由）
5. ✅ 完成 `health.ts` 所有API迁移（已完成，1个路由）
6. ✅ 完成 `orders.ts` 所有API迁移（已完成，10个路由）
7. ✅ 完成 `positions.ts` 所有API迁移（已完成，4个路由）
8. ✅ 完成 `backtest.ts` 所有API迁移（已完成，8个路由）
9. ✅ 完成 `token-refresh.ts` 所有API迁移（已完成，3个路由）
10. ✅ 完成 `trading-recommendation.ts` 所有API迁移（已完成，2个路由）
11. ✅ 完成 `watchlist.ts` 所有API迁移（已完成，4个路由）
12. ✅ 完成 `trading-rules.ts` 所有API迁移（已完成，5个路由）
13. ✅ 完成 `options.ts` 所有API迁移（已完成，4个路由）
14. ✅ 完成 `forex.ts` 所有API迁移（已完成，4个路由）
15. ✅ 完成 `config.ts` 所有API迁移（已完成，10个路由+1个中间件）
16. ⏳ 实现错误监控和告警机制（后续优化）

