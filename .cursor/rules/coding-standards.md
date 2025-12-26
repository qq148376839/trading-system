# 编码规范

## 💻 TypeScript 规范

### 类型定义

- ✅ 所有函数必须定义明确的参数类型和返回类型
- ✅ 使用 `interface` 定义对象结构，使用 `type` 定义联合类型和工具类型
- ✅ 避免使用 `any`，优先使用 `unknown` 或具体类型
- ✅ 数据库查询结果必须定义类型

### 命名规范

- **文件命名**: 使用 kebab-case（如 `strategy-scheduler.service.ts`）
- **类命名**: 使用 PascalCase（如 `StrategyScheduler`）
- **函数/变量命名**: 使用 camelCase（如 `executeStrategy`）
- **常量命名**: 使用 UPPER_SNAKE_CASE（如 `MAX_RETRY_COUNT`）
- **接口命名**: 使用 PascalCase，以 `I` 开头或描述性名称（如 `IStrategyConfig` 或 `StrategyExecutionSummary`）

### 代码组织

- ✅ 每个服务文件只包含一个主要类或服务
- ✅ 工具函数放在 `utils/` 目录
- ✅ 配置相关代码放在 `config/` 目录
- ✅ 路由处理函数应该简洁，业务逻辑放在服务层

## 🔄 错误处理规范

### 统一错误处理

- ✅ 使用 `AppError` 类（定义在 `utils/error-handler.ts`）
- ✅ 错误码格式: `{category}_{code}`（如 `TRADING_ORDER_NOT_FOUND`）
- ✅ 错误分类: `TRADING`, `MARKET_DATA`, `SYSTEM`, `VALIDATION`
- ✅ 严重程度: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`

### 错误处理模式

```typescript
// ✅ 正确：使用 try-catch 和统一错误处理
try {
  const result = await someOperation();
  return result;
} catch (error) {
  if (error instanceof AppError) {
    throw error;
  }
  throw new AppError('OPERATION_FAILED', '操作失败', error);
}
```

## 📝 日志规范

### 日志级别

- `logger.error()` - 错误和异常
- `logger.warn()` - 警告信息
- `logger.info()` - 重要业务信息（策略执行、订单提交等）
- `logger.debug()` - 调试信息（仅在开发环境）

### 结构化日志

- ✅ 使用 `LogService` 记录结构化日志
- ✅ 包含模块名称、TraceID、元数据
- ✅ 关键操作必须记录日志（订单提交、策略执行、状态变更）

### 日志聚合

- ✅ 策略执行日志使用聚合模式（避免每个标的都输出日志）
- ✅ 只有状态变更、信号生成或错误时才记录详细日志
- ✅ 常规执行仅记录统计摘要

## 🗄️ 数据库规范

### 查询规范

- ✅ 使用参数化查询防止 SQL 注入
- ✅ 使用事务处理多步操作
- ✅ 查询结果必须定义类型

### 迁移脚本

- ✅ 所有数据库变更必须通过迁移脚本
- ✅ 迁移脚本放在 `migrations/` 目录
- ✅ 迁移脚本必须可重复执行（幂等性）

## 📝 代码注释

### 函数注释

```typescript
/**
 * 执行策略周期
 * @param strategyId - 策略ID
 * @param targets - 标的列表
 * @returns 执行结果摘要
 */
async executeStrategy(strategyId: number, targets: string[]): Promise<StrategyExecutionSummary> {
  // ...
}
```

### 复杂逻辑注释

- ✅ 复杂算法必须添加注释说明
- ✅ 业务规则必须注释说明
- ✅ TODO 和 FIXME 注释必须包含问题描述

## ⚠️ 代码质量约束

### 禁止事项

- ❌ 禁止使用 `any` 类型（除非绝对必要）
- ❌ 禁止硬编码配置值
- ❌ 禁止忽略错误处理
- ❌ 禁止提交包含敏感信息的代码

### 必须事项

- ✅ 所有 API 路由必须包含错误处理
- ✅ 所有数据库操作必须使用事务（多步操作）
- ✅ 所有关键操作必须记录日志
- ✅ 所有新功能必须编写文档





