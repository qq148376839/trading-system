# 订单提交 Decimal 类型修复测试文档

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-22
- **最后更新**：2025-12-22
- **文档作者**：AI Product Manager
- **审核状态**：待审核

---

## 1. 测试概述

### 1.1 测试目标
验证订单提交功能中 `submittedQuantity` 字段正确使用 `Decimal` 类型，确保修复后的代码能够正常提交订单。

### 1.2 测试文件
- **测试文件路径**：`trading-system/api/src/__tests__/order-submission-decimal.test.ts`
- **测试框架**：Jest
- **测试类型**：单元测试

---

## 2. 测试用例

### 2.1 订单参数构建测试

#### 测试用例 1：使用 Decimal 类型构建 submittedQuantity
**描述**：验证订单参数构建时 `submittedQuantity` 正确使用 `Decimal` 类型

**测试步骤**：
1. 创建订单参数对象
2. 使用 `new Decimal(quantity.toString())` 设置 `submittedQuantity`
3. 验证 `submittedQuantity` 是 `Decimal` 实例

**预期结果**：
- `submittedQuantity` 是 `Decimal` 实例
- `submittedPrice` 也是 `Decimal` 实例
- 值正确转换

#### 测试用例 2：处理整数数量
**描述**：验证整数数量正确转换为 `Decimal`

**测试步骤**：
1. 设置数量为整数（如 100）
2. 转换为 `Decimal`
3. 验证类型和值

**预期结果**：
- `Decimal` 实例
- `toString()` 返回 "100"

#### 测试用例 3：处理小数价格
**描述**：验证小数价格正确转换为 `Decimal`

**测试步骤**：
1. 设置价格为小数（如 123.456）
2. 格式化价格（美股保留2位小数）
3. 转换为 `Decimal`
4. 验证类型和值

**预期结果**：
- `Decimal` 实例
- `toString()` 返回格式化后的价格（如 "123.46"）

---

### 2.2 订单提交流程测试

#### 测试用例 4：成功提交买入订单
**描述**：验证使用 `Decimal` 类型的买入订单能够成功提交

**测试步骤**：
1. 构建买入订单参数（`submittedQuantity` 使用 `Decimal`）
2. 调用 `submitOrder`
3. 验证返回结果

**预期结果**：
- 订单提交成功
- 返回订单ID和状态
- 不抛出类型错误

#### 测试用例 5：成功提交卖出订单
**描述**：验证使用 `Decimal` 类型的卖出订单能够成功提交

**测试步骤**：
1. 构建卖出订单参数（`submittedQuantity` 使用 `Decimal`）
2. 调用 `submitOrder`
3. 验证返回结果

**预期结果**：
- 订单提交成功
- 返回订单ID和状态
- 不抛出类型错误

#### 测试用例 6：使用 number 类型时抛出错误
**描述**：验证使用 `number` 类型时会抛出类型错误（确保修复生效）

**测试步骤**：
1. 构建订单参数（`submittedQuantity` 使用 `number` 类型）
2. 调用 `submitOrder`
3. 验证抛出错误

**预期结果**：
- 抛出类型错误
- 错误信息包含 "Unwrap value [longport_nodejs::decimal::Decimal]"

#### 测试用例 7：处理港股订单（3位小数）
**描述**：验证港股订单的价格格式化（保留3位小数）

**测试步骤**：
1. 构建港股订单参数
2. 价格格式化为3位小数
3. 转换为 `Decimal`
4. 验证提交成功

**预期结果**：
- 价格正确格式化为3位小数
- 订单提交成功

---

### 2.3 边界情况测试

#### 测试用例 8：数量为 1
**描述**：验证最小数量（1）的处理

**预期结果**：
- `Decimal` 实例
- `toString()` 返回 "1"

#### 测试用例 9：大数量
**描述**：验证大数量（1000000）的处理

**预期结果**：
- `Decimal` 实例
- `toString()` 返回 "1000000"

#### 测试用例 10：最小价格（0.01）
**描述**：验证最小价格的处理

**预期结果**：
- `Decimal` 实例
- `toString()` 返回 "0.01"

---

### 2.4 一致性测试

#### 测试用例 11：与 orders.ts 路由的一致性
**描述**：验证 `basic-execution.service.ts` 和 `orders.ts` 使用相同的 `Decimal` 转换方式

**预期结果**：
- 两个文件使用相同的转换逻辑
- 类型和值一致

---

## 3. 运行测试

### 3.1 前置条件
1. 确保已安装依赖：
   ```bash
   cd trading-system/api
   npm install
   ```

2. 确保 Jest 配置正确（`jest.config.js` 已存在）

### 3.2 运行测试命令

#### 运行所有测试
```bash
cd trading-system/api
npm test
```

#### 运行特定测试文件
```bash
cd trading-system/api
npm test -- order-submission-decimal.test.ts
```

#### 运行测试并查看详细输出
```bash
cd trading-system/api
npm test -- order-submission-decimal.test.ts --verbose
```

#### 运行测试并查看覆盖率
```bash
cd trading-system/api
npm test -- order-submission-decimal.test.ts --coverage
```

---

## 4. 测试 Mock 说明

### 4.1 Mock 的长桥SDK
测试中 Mock 了以下内容：
- `Decimal` 类：模拟长桥SDK的 `Decimal` 类型
- `getTradeContext`：Mock 交易上下文，包含 `submitOrder` 方法
- `getQuoteContext`：Mock 行情上下文，包含 `staticInfo` 方法

### 4.2 Mock 验证逻辑
Mock 的 `submitOrder` 方法会验证：
- `submittedQuantity` 必须是 `Decimal` 实例
- `submittedPrice`（如果提供）必须是 `Decimal` 实例
- 如果类型不正确，抛出与实际SDK相同的错误

---

## 5. 预期测试结果

### 5.1 成功场景
所有使用 `Decimal` 类型的测试用例应该通过：
- ✅ 订单参数构建测试
- ✅ 买入订单提交测试
- ✅ 卖出订单提交测试
- ✅ 港股订单测试
- ✅ 边界情况测试
- ✅ 一致性测试

### 5.2 失败场景
使用 `number` 类型的测试用例应该失败（验证修复生效）：
- ✅ 类型错误测试应该抛出错误

---

## 6. 测试覆盖范围

### 6.1 代码覆盖
- ✅ `basic-execution.service.ts` 中的订单参数构建逻辑
- ✅ `orders.ts` 中的订单参数构建逻辑
- ✅ `Decimal` 类型转换逻辑
- ✅ 价格格式化逻辑（美股/港股）

### 6.2 场景覆盖
- ✅ 买入订单
- ✅ 卖出订单
- ✅ 美股订单
- ✅ 港股订单
- ✅ 边界情况（最小数量、大数量、最小价格）
- ✅ 错误场景（类型不匹配）

---

## 7. 故障排查

### 7.1 测试失败常见原因

#### 问题 1：找不到测试文件
**症状**：`No tests found`
**解决方案**：
- 确认文件路径：`src/__tests__/order-submission-decimal.test.ts`
- 确认文件命名：`.test.ts` 或 `.spec.ts`
- 检查 `jest.config.js` 中的 `testMatch` 配置

#### 问题 2：模块导入错误
**症状**：`Cannot find module`
**解决方案**：
- 确认所有依赖已安装：`npm install`
- 检查 `jest.config.js` 中的 `moduleNameMapper` 配置
- 确认 TypeScript 配置正确

#### 问题 3：Mock 不生效
**症状**：测试调用真实API
**解决方案**：
- 确认 Mock 在 `describe` 或 `it` 之前
- 检查 Mock 路径是否正确
- 使用 `jest.clearAllMocks()` 清理Mock状态

---

## 8. 手动验证步骤

如果无法运行自动化测试，可以手动验证：

### 8.1 代码审查
1. 检查 `basic-execution.service.ts` 第537行：
   ```typescript
   submittedQuantity: new Decimal(quantity.toString()),
   ```
   确认使用 `Decimal` 类型

2. 检查 `orders.ts` 第1492行：
   ```typescript
   submittedQuantity: new Decimal(normalizedParams.submitted_quantity),
   ```
   确认使用 `Decimal` 类型

### 8.2 实际订单测试
1. 启动API服务
2. 通过前端或API提交测试订单
3. 验证订单提交成功
4. 检查日志，确认无类型错误

---

## 9. 测试结果记录

### 9.1 测试执行记录
| 测试用例 | 状态 | 执行时间 | 备注 |
|---------|------|---------|------|
| 订单参数构建 | ⏳ 待执行 | - | - |
| 买入订单提交 | ⏳ 待执行 | - | - |
| 卖出订单提交 | ⏳ 待执行 | - | - |
| 类型错误验证 | ⏳ 待执行 | - | - |
| 港股订单 | ⏳ 待执行 | - | - |
| 边界情况 | ⏳ 待执行 | - | - |

### 9.2 测试覆盖率
- **目标覆盖率**：> 80%
- **当前覆盖率**：待测试后更新

---

## 10. 后续优化

### 10.1 集成测试
考虑添加集成测试，验证：
- 与实际长桥SDK的集成
- 端到端的订单提交流程
- 错误处理和重试机制

### 10.2 性能测试
考虑添加性能测试：
- 订单提交响应时间
- 并发订单提交性能

---

## 11. 相关文档

- [长桥SDK Decimal类型修复文档](251222-LONGPORT_SDK_DECIMAL_FIX.md)
- [测试规范](../../.cursor/rules/testing.md)
- [Jest配置](../../api/jest.config.js)

---

## 12. 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-22 | 初始版本，创建测试文档 | AI Product Manager |



