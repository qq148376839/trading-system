# 策略Bug修复说明

**修复日期**: 2025-12-03  
**问题描述**: 策略出现高买低卖和重复卖出单问题

## 🐛 问题分析

### 问题1: 高买低卖

**现象**:
- IONQ: 买入 49.175，卖出 47.11（亏损）
- CRSP: 买入 52.8，卖出 51.86（亏损）
- NVDA: 买入 184.63，卖出 180.14/180.2（亏损）

**根本原因**:
- 在 `processHoldingPosition` 函数中，持仓时会调用 `strategyInstance.generateSignal` 生成信号
- 如果策略生成 `SELL` 信号（用于做空），就会立即卖出持仓
- **关键问题**: 策略的 `SELL` 信号是用于做空的，不是用于平仓的！
- 当市场环境变差时，策略会生成 `SELL` 信号，导致高买低卖

### 问题2: 重复卖出单

**现象**:
- NVDA: 同时提交了两个卖出单（180.14 和 180.2）
- PLTR: 同时提交了两个卖出单（170.03 和 170.21）

**根本原因**:
- `checkPendingSellOrder` 使用60秒缓存，但订单可能在30秒内就提交了
- 存在竞态条件：两个策略周期同时执行，都检查到没有未成交订单，然后都提交卖出单
- 缓存更新不及时，导致检查时看不到刚提交的订单

## ✅ 修复方案

### 修复1: 移除持仓时的策略信号检查

**修改文件**: `api/src/services/strategy-scheduler.service.ts`

**修改内容**:
```typescript
// 修改前：会调用 generateSignal 生成卖出信号
else {
  const intent = await strategyInstance.generateSignal(symbol, undefined);
  if (intent && intent.action === 'SELL') {
    shouldSell = true;
    exitReason = 'STRATEGY_SIGNAL';
    ...
  }
}

// 修改后：只检查止盈/止损
else {
  // 没有触发卖出条件，记录监控状态
  // 注意：移除了根据策略信号卖出的逻辑，避免高买低卖
  // 持仓时应该只基于止盈/止损卖出，不应该根据市场环境变化而卖出
  logger.debug(`策略 ${strategyId} 标的 ${symbol}: 持仓监控 - 未触发卖出条件 ...`);
}
```

**修复效果**:
- 持仓时只检查止盈/止损，不会因为市场环境变化而卖出
- 避免高买低卖问题
- 策略的 `SELL` 信号仅用于做空，不用于平仓

### 修复2: 加强重复卖出单检查

**修改内容**:

1. **添加强制刷新参数**:
```typescript
// 修改前
const hasPendingSellOrder = await this.checkPendingSellOrder(strategyId, symbol);

// 修改后
const hasPendingSellOrder = await this.checkPendingSellOrder(strategyId, symbol, true);
```

2. **添加双重检查（数据库查询）**:
```typescript
// 双重检查：在更新状态前再次检查（防止竞态条件）
const dbCheckResult = await pool.query(
  `SELECT eo.order_id, eo.current_status 
   FROM execution_orders eo
   WHERE eo.strategy_id = $1 
   AND eo.symbol = $2 
   AND eo.side IN ('SELL', 'Sell', '2')
   AND eo.current_status IN ('SUBMITTED', 'NEW', 'PARTIALLY_FILLED')
   AND eo.created_at >= NOW() - INTERVAL '1 hour'
   ORDER BY eo.created_at DESC
   LIMIT 1`,
  [strategyId, symbol]
);

if (dbCheckResult.rows.length > 0) {
  logger.log(`策略 ${strategyId} 标的 ${symbol}: 数据库检查发现已有未成交卖出订单，跳过`);
  return;
}
```

3. **改进 `checkPendingSellOrder` 函数**:
```typescript
private async checkPendingSellOrder(
  _strategyId: number, 
  symbol: string, 
  forceRefresh: boolean = false  // 新增参数
): Promise<boolean> {
  // 如果强制刷新，清除缓存并重新获取订单
  const todayOrders = await this.getTodayOrders(forceRefresh);
  ...
}
```

**修复效果**:
- 强制刷新订单缓存，避免缓存延迟问题
- 双重检查机制，防止竞态条件
- 数据库查询检查，确保不会重复提交订单

## 📋 修复后的逻辑流程

### 持仓监控流程

```
1. 获取持仓上下文（入场价、止损、止盈、数量）
2. 获取当前价格
3. 检查触发条件：
   ✅ 止损触发：currentPrice <= stopLoss → 卖出
   ✅ 止盈触发：currentPrice >= takeProfit → 卖出
   ❌ 移除：策略信号检查（避免高买低卖）
4. 如果需要卖出：
   a. 检查API订单（强制刷新缓存）
   b. 检查数据库订单（双重检查）
   c. 如果都没有，才提交卖出订单
```

## 🔍 验证方法

1. **验证高买低卖修复**:
   - 观察持仓监控日志，确认不再出现 `STRATEGY_SIGNAL` 卖出
   - 确认卖出原因只有 `STOP_LOSS` 或 `TAKE_PROFIT`

2. **验证重复卖出单修复**:
   - 观察日志，确认有 `数据库检查发现已有未成交卖出订单` 的提示
   - 确认同一标的不会同时出现多个卖出订单

## 📝 注意事项

1. **策略信号用途**:
   - `BUY` 信号：用于开仓（做多）
   - `SELL` 信号：用于开仓（做空），**不是用于平仓**
   - 平仓只能通过止盈/止损触发

2. **持仓保护**:
   - 持仓时不应该根据市场环境变化而卖出
   - 只应该基于止盈/止损卖出
   - 这样可以避免高买低卖问题

3. **订单检查**:
   - 使用双重检查机制（API + 数据库）
   - 强制刷新缓存，避免缓存延迟
   - 防止竞态条件导致的重复提交

## 🎯 预期效果

1. **不再出现高买低卖**:
   - 持仓时只检查止盈/止损
   - 不会因为市场环境变化而卖出

2. **不再出现重复卖出单**:
   - 双重检查机制确保不会重复提交
   - 强制刷新缓存，避免缓存延迟

3. **更稳定的交易执行**:
   - 持仓保护机制确保交易逻辑正确
   - 订单检查机制确保不会重复提交

---

**修复完成时间**: 2025-12-03  
**修复文件**: `api/src/services/strategy-scheduler.service.ts`  
**影响范围**: 策略持仓监控逻辑、订单提交逻辑

