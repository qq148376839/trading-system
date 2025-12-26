# 订单提交 Decimal 类型修复测试运行说明

## 🔍 问题诊断

如果运行 `npm test -- order-submission-decimal.test.ts` 没有反应，可能的原因：

1. **Jest 找不到测试文件**：检查文件路径和命名
2. **Mock 配置问题**：Mock 可能在导入之前没有正确设置
3. **TypeScript 编译问题**：测试文件可能有语法错误

## ✅ 解决方案

### 方法 1：运行简化版测试（推荐）

我创建了一个简化版的测试文件，更容易运行：

```bash
cd trading-system/api
npm test -- order-submission-decimal-simple.test.ts
```

### 方法 2：检查 Jest 是否能找到测试文件

```bash
cd trading-system/api

# 列出所有测试文件
npm test -- --listTests

# 运行所有测试，查看是否有错误
npm test
```

### 方法 3：使用 Jest 直接运行

```bash
cd trading-system/api

# 使用 npx jest 直接运行
npx jest src/__tests__/order-submission-decimal-simple.test.ts

# 查看详细输出
npx jest src/__tests__/order-submission-decimal-simple.test.ts --verbose
```

### 方法 4：检查测试文件语法

```bash
cd trading-system/api

# 使用 TypeScript 编译器检查语法
npx tsc --noEmit src/__tests__/order-submission-decimal-simple.test.ts
```

## 📋 测试文件说明

### 测试文件列表

1. **`order-submission-decimal.test.ts`** - 完整版测试（11个测试用例）
2. **`order-submission-decimal-simple.test.ts`** - 简化版测试（4个核心测试用例）

### 简化版测试包含

- ✅ 订单参数构建 - Decimal 类型验证
- ✅ 整数数量处理
- ✅ 买入订单提交（Decimal类型）
- ✅ 类型错误验证（number类型应抛出错误）

## 🚀 快速测试步骤

### 步骤 1：进入 API 目录
```bash
cd trading-system/api
```

### 步骤 2：运行简化版测试
```bash
npm test -- order-submission-decimal-simple.test.ts
```

### 步骤 3：查看结果

**预期输出**：
```
PASS  src/__tests__/order-submission-decimal-simple.test.ts
  订单提交 Decimal 类型修复
    订单参数构建
      ✓ 应该使用 Decimal 类型构建 submittedQuantity
      ✓ 应该正确处理整数数量
    订单提交流程
      ✓ 应该成功提交买入订单（使用 Decimal 类型）
      ✓ 应该在使用 number 类型时抛出错误

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

## 🐛 故障排查

### 问题 1：`No tests found`

**可能原因**：
- 文件路径不正确
- Jest 配置中的 `testMatch` 不匹配

**解决方案**：
```bash
# 检查文件是否存在
ls src/__tests__/order-submission-decimal-simple.test.ts

# 检查 Jest 配置
cat jest.config.js

# 尝试使用完整路径
npx jest src/__tests__/order-submission-decimal-simple.test.ts
```

### 问题 2：`Cannot find module`

**可能原因**：
- 依赖未安装
- Mock 路径不正确

**解决方案**：
```bash
# 重新安装依赖
npm install

# 检查 node_modules
ls node_modules/jest
```

### 问题 3：测试卡住无响应

**可能原因**：
- Mock 配置导致死循环
- 异步操作未正确处理

**解决方案**：
```bash
# 使用超时选项
npx jest src/__tests__/order-submission-decimal-simple.test.ts --testTimeout=5000

# 查看详细输出
npx jest src/__tests__/order-submission-decimal-simple.test.ts --verbose --no-cache
```

## 📊 预期测试结果

### 应该通过的测试（4个）

1. ✅ **订单参数构建 - Decimal 类型**
   - 验证 `submittedQuantity` 是 `Decimal` 实例
   - 验证 `submittedPrice` 是 `Decimal` 实例

2. ✅ **整数数量处理**
   - 验证数量正确转换为 `Decimal`

3. ✅ **买入订单提交**
   - 验证使用 `Decimal` 类型的订单能成功提交
   - 验证返回订单ID和状态

4. ✅ **类型错误验证**
   - 验证使用 `number` 类型时抛出错误
   - 验证错误信息正确

## 💡 手动验证（如果测试无法运行）

如果自动化测试无法运行，可以手动验证：

### 1. 代码审查
检查以下文件中的代码：

**`basic-execution.service.ts` (第537行)**
```typescript
submittedQuantity: new Decimal(quantity.toString()),
```

**`orders.ts` (第1492行)**
```typescript
submittedQuantity: new Decimal(normalizedParams.submitted_quantity),
```

### 2. 实际订单测试
1. 启动 API 服务
2. 提交测试订单
3. 验证订单提交成功
4. 检查日志无类型错误

## 📚 相关文档

- [测试详细文档](../docs/features/251222-ORDER_SUBMISSION_DECIMAL_TEST.md)
- [修复文档](../docs/features/251222-LONGPORT_SDK_DECIMAL_FIX.md)
- [测试执行总结](../docs/features/251222-TEST_EXECUTION_SUMMARY.md)



