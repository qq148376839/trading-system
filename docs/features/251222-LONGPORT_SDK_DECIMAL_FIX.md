# 长桥SDK Decimal类型修复

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-22
- **最后更新**：2025-12-22
- **文档作者**：AI Product Manager
- **审核状态**：待审核

---

## 1. 背景与目标

### 1.1 问题背景
长桥SDK升级到最新版本后，`SubmitOrderOptions.submittedQuantity` 字段的类型要求从 `number` 变更为 `Decimal` 类型。导致订单提交时出现类型错误：

```
策略 5 标的 PLTR.US 卖出失败: Unwrap value [longport_nodejs::decimal::Decimal] from class failed on SubmitOrderOptions.submittedQuantity
```

### 1.2 用户痛点
- 订单提交失败，影响交易策略执行
- 错误信息不够明确，难以快速定位问题
- 需要手动修复代码才能恢复正常交易

### 1.3 业务目标
- **主要目标**：修复订单提交功能，确保策略能正常执行
- **成功指标**：
  - 订单提交成功率恢复至 100%
  - 所有订单类型（买入/卖出）都能正常提交
  - 修复后无类型错误

### 1.4 项目范围
- **包含范围**：
  - 修复 `basic-execution.service.ts` 中的 `submittedQuantity` 类型问题
  - 修复 `orders.ts` 中的 `submittedQuantity` 类型问题
  - 确保所有订单提交路径都使用正确的 `Decimal` 类型
- **不包含范围**：
  - 其他字段的类型检查（如 `submittedPrice` 已正确使用 `Decimal`）
  - SDK版本回退方案（采用适配新版本的方式）

---

## 2. 问题分析

### 2.1 根本原因
长桥SDK升级后，`SubmitOrderOptions` 接口中的 `submittedQuantity` 字段类型从 `number` 变更为 `Decimal`，但代码中仍在使用 `number` 类型直接赋值。

### 2.2 影响范围
- **受影响文件**：
  1. `trading-system/api/src/services/basic-execution.service.ts` (第537行)
  2. `trading-system/api/src/routes/orders.ts` (第1492行)
- **受影响功能**：
  - 策略自动交易（买入/卖出）
  - 手动订单提交
  - 所有通过 `submitOrder` 方法提交的订单

### 2.3 错误示例
```typescript
// ❌ 错误代码（修复前）
const orderOptions: any = {
  symbol,
  orderType: OrderType.LO,
  side: OrderSide.Sell,
  submittedQuantity: quantity,  // number 类型，不符合新SDK要求
  submittedPrice: new Decimal(formattedPrice.toString()),
  timeInForce: TimeInForceType.Day,
};
```

---

## 3. 解决方案

### 3.1 修复方案
将 `submittedQuantity` 字段从 `number` 类型改为 `Decimal` 类型，使用 `new Decimal()` 构造函数进行转换。

### 3.2 修复代码

#### 修复1：`basic-execution.service.ts`
```typescript
// ✅ 修复后代码
const orderOptions: any = {
  symbol,
  orderType: OrderType.LO,
  side: side === 'BUY' ? OrderSide.Buy : OrderSide.Sell,
  submittedQuantity: new Decimal(quantity.toString()),  // 使用 Decimal 类型
  submittedPrice: new Decimal(formattedPrice.toString()),
  timeInForce: TimeInForceType.Day,
};
```

#### 修复2：`orders.ts`
```typescript
// ✅ 修复后代码
const orderOptions: any = {
  symbol: normalizedParams.symbol,
  orderType: orderTypeEnum,
  side: sideEnum,
  submittedQuantity: new Decimal(normalizedParams.submitted_quantity),  // 使用 Decimal 类型
  timeInForce: timeInForceEnum,
};
```

### 3.3 技术细节

#### Decimal 类型使用
- `Decimal` 类来自长桥SDK：`import { Decimal } from '../config/longport'`
- 构造函数接受字符串或数字：`new Decimal(value)` 或 `new Decimal(value.toString())`
- 与 `submittedPrice` 的处理方式保持一致

#### 参考实现
在 `coin_tool/server/src/services/longport.order.service.ts` 中已有正确实现：
```typescript
submittedQuantity: new Decimal(params.quantity),
```

---

## 4. 验收标准

### 4.1 功能验收
- [ ] 买入订单可以正常提交
- [ ] 卖出订单可以正常提交
- [ ] 策略自动交易功能恢复正常
- [ ] 手动订单提交功能恢复正常
- [ ] 所有订单类型（限价单、市价单等）都能正常提交

### 4.2 代码验收
- [ ] `basic-execution.service.ts` 中 `submittedQuantity` 使用 `Decimal` 类型
- [ ] `orders.ts` 中 `submittedQuantity` 使用 `Decimal` 类型
- [ ] 代码编译通过，无类型错误
- [ ] 代码风格与现有代码保持一致

### 4.3 测试用例

#### 测试用例1：策略自动卖出
```
前置条件：策略5持有PLTR.US股票
操作：触发卖出信号
预期结果：订单提交成功，返回订单ID
```

#### 测试用例2：手动订单提交
```
前置条件：用户登录系统
操作：通过前端提交买入订单（数量：10，价格：25.50）
预期结果：订单提交成功，返回订单ID
```

#### 测试用例3：不同类型订单
```
前置条件：用户登录系统
操作：分别提交限价单、市价单
预期结果：所有订单类型都能正常提交
```

---

## 5. 风险评估

### 5.1 技术风险
- **风险**：Decimal 类型转换可能影响精度
- **影响**：低（数量通常为整数，精度影响可忽略）
- **应对**：使用 `toString()` 确保字符串转换的准确性

### 5.2 兼容性风险
- **风险**：如果SDK版本回退，可能导致类型不匹配
- **影响**：低（SDK版本通常向前兼容）
- **应对**：保持SDK版本在最新稳定版本

### 5.3 回归风险
- **风险**：修复可能影响其他订单相关功能
- **影响**：低（仅修改类型转换，不改变业务逻辑）
- **应对**：进行全面测试，确保所有订单功能正常

---

## 6. 后续优化建议

### 6.1 类型安全
- 考虑将 `orderOptions: any` 改为明确的类型定义
- 添加类型检查，避免类似问题再次发生

### 6.2 错误处理
- 增强错误提示，明确说明类型不匹配的原因
- 添加SDK版本检查，提前发现兼容性问题

### 6.3 代码审查
- 在代码审查中重点关注SDK相关字段的类型使用
- 建立SDK升级检查清单，确保所有相关代码同步更新

---

## 7. 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-22 | 初始版本，修复 submittedQuantity 类型问题 | AI Product Manager |

---

## 8. 相关文档

- [长桥SDK文档](https://longportapp.github.io/longport-nodejs/)
- [订单提交接口文档](trading-system/api/src/routes/orders.ts)
- [基础执行服务文档](trading-system/api/src/services/basic-execution.service.ts)


