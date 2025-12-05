# 策略执行优化总结

## 更新日期：2025-01-28

## 概述

本次更新主要修复了策略执行中的关键问题，包括数量计算、价格精度、持仓检查和订单追踪等功能，大幅提升了策略执行的可靠性和准确性。

## 修复的问题

### 1. 数量计算问题 ✅

**问题描述**：
- 策略每次下单数量只有1，没有根据资金分配计算实际购买数量
- 导致资金利用率低，无法充分利用可用资金

**修复方案**：
- 在 `strategy-scheduler.service.ts` 中改进了数量计算逻辑
- 使用可用资金的10%计算数量：`Math.floor(tradeAmount / intent.entryPrice)`
- 确保数量至少为1：`Math.max(1, calculatedQuantity)`
- 添加了详细的日志输出，便于调试

**代码位置**：
- `api/src/services/strategy-scheduler.service.ts` (第189-194行)

**效果**：
- ✅ 策略现在会根据可用资金正确计算购买数量
- ✅ 提高了资金利用率
- ✅ 添加了详细的日志，便于追踪数量计算过程

### 2. 价格精度问题 ✅

**问题描述**：
- 价格小数点保留有问题（如 `430.16999999999996`）
- 导致下单失败，错误信息：`Wrong bid size, please change the price`

**修复方案**：
- 在 `basic-execution.service.ts` 中添加了价格格式化逻辑
- 美股：保留2位小数（`Math.round(price * 100) / 100`）
- 港股：保留3位小数（`Math.round(price * 1000) / 1000`）
- 其他市场：默认保留2位小数

**代码位置**：
- `api/src/services/basic-execution.service.ts` (第121-140行)

**效果**：
- ✅ 价格格式正确，避免下单失败
- ✅ 根据市场类型自动选择合适的小数位数
- ✅ 确保价格大于0，添加了验证逻辑

### 3. 持仓检查缺失 ✅

**问题描述**：
- 策略未考虑是否已持仓，可能重复买入同一标的
- 导致资金浪费和风险增加

**修复方案**：
- 在 `strategy-scheduler.service.ts` 中添加了 `checkExistingPosition` 方法
- 检查策略实例状态（数据库）
- 检查实际持仓（从 LongPort SDK）
- 在下单前检查，如果已有持仓则跳过

**代码位置**：
- `api/src/services/strategy-scheduler.service.ts` (第250-295行)

**效果**：
- ✅ 避免重复买入同一标的
- ✅ 同时检查数据库状态和实际持仓，确保准确性
- ✅ 提高了资金使用效率

### 4. 订单追踪缺失 ✅

**问题描述**：
- 策略没有追踪已提交但未成交的订单
- 无法根据市场变化更新订单价格
- 导致订单可能长时间无法成交

**修复方案**：
- 在 `strategy-scheduler.service.ts` 中添加了 `trackPendingOrders` 方法
- 在 `runStrategyCycle` 中调用订单追踪
- 查询未成交的买入订单（1小时内）
- 获取当前行情，如果价格差异超过2%，自动更新订单价格
- 使用 `replaceOrder` API 更新订单价格（比当前价格高1%，确保能成交）

**代码位置**：
- `api/src/services/strategy-scheduler.service.ts` (第146-158行, 第297-365行)

**效果**：
- ✅ 自动追踪未成交订单
- ✅ 根据市场变化自动更新订单价格
- ✅ 提高订单成交率

### 5. 未成交订单检查 ✅

**额外改进**：
- 添加了 `checkPendingOrder` 方法
- 在下单前检查是否有未成交的订单
- 如果有未成交订单，跳过新的买入信号

**代码位置**：
- `api/src/services/strategy-scheduler.service.ts` (第297-310行)

**效果**：
- ✅ 避免同一标的同时存在多个未成交订单
- ✅ 减少订单管理复杂度

## 技术细节

### 数量计算逻辑

```typescript
// 计算数量（如果没有指定）
if (!intent.quantity && intent.entryPrice) {
  // 使用可用资金的 10% 计算数量（可根据配置调整）
  const tradeAmount = availableCapital * 0.1;
  const calculatedQuantity = Math.floor(tradeAmount / intent.entryPrice);
  
  // 确保数量至少为1
  intent.quantity = Math.max(1, calculatedQuantity);
  
  console.log(`策略 ${strategyId} 标的 ${symbol} 计算数量: 可用资金=${availableCapital.toFixed(2)}, 交易金额=${tradeAmount.toFixed(2)}, 价格=${intent.entryPrice}, 数量=${intent.quantity}`);
}
```

### 价格格式化逻辑

```typescript
// 格式化价格（根据市场确定小数位数）
const market = detectMarket(symbol);
let formattedPrice: number;

if (market === 'US') {
  formattedPrice = Math.round(price * 100) / 100; // 2位小数
} else if (market === 'HK') {
  formattedPrice = Math.round(price * 1000) / 1000; // 3位小数
} else {
  formattedPrice = Math.round(price * 100) / 100; // 默认2位小数
}
```

### 持仓检查逻辑

```typescript
// 检查是否已有持仓（避免重复买入）
const hasPosition = await this.checkExistingPosition(strategyId, symbol);
if (hasPosition) {
  console.log(`策略 ${strategyId} 标的 ${symbol} 已有持仓，跳过买入`);
  return;
}
```

### 订单追踪逻辑

```typescript
// 如果当前价格与订单价格差异超过2%，更新订单价格
const priceDiff = Math.abs(currentPrice - orderPrice) / orderPrice;
if (priceDiff > 0.02) {
  const newPrice = currentPrice * 1.01; // 比当前价格高1%，确保能成交
  await tradeCtx.replaceOrder({
    orderId: order.order_id,
    price: new Decimal(formattedPrice.toString()),
  });
}
```

## 文件变更

### 修改的文件

1. **`api/src/services/strategy-scheduler.service.ts`**
   - 添加了数量计算逻辑（第189-194行）
   - 添加了持仓检查方法 `checkExistingPosition`（第250-295行）
   - 添加了未成交订单检查方法 `checkPendingOrder`（第297-310行）
   - 添加了订单追踪方法 `trackPendingOrders`（第297-365行）
   - 在 `runStrategyCycle` 中调用订单追踪（第146-158行）

2. **`api/src/services/basic-execution.service.ts`**
   - 添加了价格格式化逻辑（第121-140行）
   - 根据市场类型选择合适的小数位数
   - 添加了价格验证逻辑

## 使用说明

### 策略执行流程

1. **订单追踪**：每个策略周期开始时，先追踪并更新未成交订单
2. **持仓检查**：在处理每个标的时，先检查是否已有持仓
3. **未成交订单检查**：检查是否有未成交的订单
4. **信号生成**：生成交易信号
5. **数量计算**：根据可用资金计算购买数量
6. **价格格式化**：格式化价格到正确的小数位数
7. **订单提交**：提交订单到交易所

### 配置说明

- **数量计算比例**：默认使用可用资金的10%，可在代码中调整
- **价格更新阈值**：默认2%，可在 `trackPendingOrders` 方法中调整
- **价格调整幅度**：默认比当前价格高1%，可在 `trackPendingOrders` 方法中调整

## 测试建议

1. **数量计算测试**：
   - 验证策略能根据可用资金正确计算数量
   - 验证数量至少为1
   - 验证日志输出正确

2. **价格精度测试**：
   - 验证美股价格保留2位小数
   - 验证港股价格保留3位小数
   - 验证价格格式化后能成功下单

3. **持仓检查测试**：
   - 验证已有持仓时不会重复买入
   - 验证持仓检查逻辑正确

4. **订单追踪测试**：
   - 验证未成交订单能被正确追踪
   - 验证价格差异超过阈值时能自动更新
   - 验证订单更新后能成功成交

## 后续优化建议

1. **配置化**：
   - 将数量计算比例、价格更新阈值等参数配置化
   - 支持在策略配置中设置这些参数

2. **订单管理**：
   - 添加订单取消逻辑（如果价格差异过大）
   - 添加订单超时处理（超过一定时间自动取消）

3. **风险控制**：
   - 添加单笔订单最大金额限制
   - 添加单日订单数量限制
   - 添加单标的持仓上限

4. **监控和告警**：
   - 添加订单追踪监控
   - 添加异常订单告警
   - 添加策略执行统计

## 相关文档

- [量化交易集成总结](./QUANT_INTEGRATION_SUMMARY.md)
- [策略执行代码审查](./QUANT_CODE_REVIEW.md)
- [量化交易第一阶段完成](./QUANT_PHASE1_COMPLETION.md)

