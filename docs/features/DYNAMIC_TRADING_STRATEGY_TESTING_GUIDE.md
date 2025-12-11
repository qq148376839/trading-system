# 动态交易策略测试指南

**创建日期**: 2025-12-03  
**状态**: 测试指南

## 📋 目录

- [数据库变更说明](#数据库变更说明)
- [功能测试](#功能测试)
- [集成测试](#集成测试)
- [回测功能说明](#回测功能说明)

---

## 🗄️ 数据库变更说明

### ✅ 不需要数据库变更

**原因**:
- `strategy_instances` 表的 `context` 字段是 **JSONB** 类型
- JSONB 可以存储任意 JSON 数据结构，无需修改表结构
- 新增的字段（`entryMarketEnv`, `entryMarketStrength`, `originalATR`, `adjustmentHistory` 等）可以直接存储在 JSONB 中

### 当前数据库结构

```sql
CREATE TABLE strategy_instances (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    current_state VARCHAR(50) NOT NULL,
    context JSONB,  -- ✅ JSONB类型，支持任意JSON结构
    last_updated TIMESTAMP DEFAULT NOW(),
    UNIQUE(strategy_id, symbol)
);
```

### 数据存储示例

**旧格式**（向后兼容）:
```json
{
  "entryPrice": 100.0,
  "quantity": 10,
  "stopLoss": 95.0,
  "takeProfit": 110.0,
  "orderId": "12345"
}
```

**新格式**（包含动态调整字段）:
```json
{
  "entryPrice": 100.0,
  "quantity": 10,
  "entryTime": "2025-12-03T10:00:00Z",
  "originalStopLoss": 95.0,
  "originalTakeProfit": 110.0,
  "currentStopLoss": 95.0,
  "currentTakeProfit": 110.0,
  "entryMarketEnv": "良好",
  "entryMarketStrength": 60,
  "previousMarketEnv": "良好",
  "previousMarketStrength": 60,
  "originalATR": 2.5,
  "currentATR": 2.5,
  "adjustmentHistory": [],
  "orderId": "12345"
}
```

### 向后兼容性

代码中已经处理了向后兼容：
- `getPositionContext()` 函数会自动补充缺失字段
- 如果缺少 `originalStopLoss`，会使用 `stopLoss`
- 如果缺少 `entryTime`，会使用当前时间
- 如果缺少 `adjustmentHistory`，会初始化为空数组

---

## 🧪 功能测试

### 1. 单元测试

#### 测试动态持仓管理服务

**文件**: `api/src/services/dynamic-position-manager.service.ts`

**测试用例**:

```typescript
// 测试文件: api/src/__tests__/dynamic-position-manager.test.ts

describe('DynamicPositionManager', () => {
  describe('getPositionContext', () => {
    it('应该从现有上下文构建完整的PositionContext', async () => {
      const oldContext = {
        entryPrice: 100,
        quantity: 10,
        stopLoss: 95,
        takeProfit: 110,
      };
      
      const context = await dynamicPositionManager.getPositionContext(
        1, 'AAPL.US', oldContext
      );
      
      expect(context.originalStopLoss).toBe(95);
      expect(context.currentStopLoss).toBe(95);
      expect(context.entryTime).toBeDefined();
    });
  });

  describe('calculateMarketDeterioration', () => {
    it('应该正确计算市场环境恶化程度', () => {
      const deterioration = dynamicPositionManager.calculateMarketDeterioration(
        '良好', '较差', 60, 20
      );
      
      expect(deterioration).toBeGreaterThan(0);
      expect(deterioration).toBeLessThanOrEqual(1);
    });
  });

  describe('adjustByMarketEnvironment', () => {
    it('市场环境恶化时应该收紧止盈', () => {
      const context = {
        entryPrice: 100,
        quantity: 10,
        entryTime: new Date().toISOString(),
        originalStopLoss: 95,
        originalTakeProfit: 110,
        currentStopLoss: 95,
        currentTakeProfit: 110,
        previousMarketEnv: '良好',
        previousMarketStrength: 60,
      };
      
      const result = dynamicPositionManager.adjustByMarketEnvironment(
        context, 105, '较差', 20, 5  // 盈利5%
      );
      
      expect(result.context.currentTakeProfit).toBeLessThan(110);
    });
  });
});
```

**运行测试**:
```bash
cd api
npm test -- dynamic-position-manager.test.ts
```

### 2. 手动测试步骤

#### 测试1: 买入时保存完整上下文

**步骤**:
1. 启动策略
2. 等待策略生成买入信号
3. 检查数据库 `strategy_instances` 表
4. 验证 `context` 字段包含所有新字段

**验证SQL**:
```sql
SELECT 
  symbol,
  current_state,
  context->>'entryPrice' as entry_price,
  context->>'entryTime' as entry_time,
  context->>'entryMarketEnv' as market_env,
  context->>'originalATR' as original_atr,
  context->'adjustmentHistory' as adjustment_history
FROM strategy_instances
WHERE current_state = 'HOLDING'
ORDER BY last_updated DESC
LIMIT 5;
```

**预期结果**:
- `entryTime` 不为空
- `entryMarketEnv` 不为空（应该是"良好"、"中性利好"等）
- `originalATR` 不为空（数字）
- `adjustmentHistory` 是空数组 `[]`

#### 测试2: 持仓监控动态调整

**步骤**:
1. 确保有持仓（状态为 HOLDING）
2. 观察日志输出
3. 检查是否有动态调整日志

**查看日志**:
```bash
# 查看策略日志
tail -f logs/strategy.log | grep "动态调整"
```

**预期日志**:
```
策略 {strategyId} 标的 {symbol}: 动态调整止盈/止损 - 止损: 95.00 -> 96.00, 止盈: 110.00 -> 108.00
```

**验证SQL**:
```sql
-- 查看调整历史
SELECT 
  symbol,
  context->'adjustmentHistory' as adjustments
FROM strategy_instances
WHERE current_state = 'HOLDING'
  AND jsonb_array_length(context->'adjustmentHistory') > 0;
```

#### 测试3: 市场环境变化响应

**步骤**:
1. 创建一个测试策略，持仓某个股票
2. 手动修改市场环境（模拟市场变化）
3. 观察动态调整是否触发

**注意**: 市场环境是从 `trading-recommendation.service` 获取的，需要实际市场数据。

**验证方法**:
- 查看日志中是否有市场环境变化相关的调整
- 检查数据库中的 `previousMarketEnv` 是否更新

#### 测试4: 持仓时间调整

**步骤**:
1. 创建一个持仓超过24小时的测试用例
2. 手动修改数据库中的 `entryTime` 为24小时前
3. 触发持仓监控
4. 观察是否有持仓时间相关的调整

**测试SQL**:
```sql
-- 修改entryTime为24小时前
UPDATE strategy_instances
SET context = jsonb_set(
  context,
  '{entryTime}',
  to_jsonb((NOW() - INTERVAL '25 hours')::text)
)
WHERE symbol = 'AAPL.US' AND current_state = 'HOLDING';
```

**预期结果**:
- 如果盈利，止盈应该收紧
- 日志中应该有持仓时间相关的调整信息

#### 测试5: 波动性调整

**步骤**:
1. 持仓一个波动性较大的股票
2. 观察ATR变化
3. 检查是否有波动性相关的调整

**验证方法**:
- 查看日志中的ATR信息
- 检查 `currentATR` 是否更新
- 如果波动性超过5%，应该有调整

### 3. 集成测试

#### 测试完整流程

**场景**: 买入 → 持仓监控 → 动态调整 → 卖出

**步骤**:
1. **启动策略**
   ```bash
   # 通过API启动策略
   curl -X POST http://localhost:3001/api/quant/strategies/1/start
   ```

2. **等待买入**
   - 策略每分钟运行一次
   - 等待生成买入信号并执行

3. **监控持仓**
   - 观察日志输出
   - 检查动态调整是否正常工作

4. **验证卖出**
   - 等待触发止盈/止损
   - 或等待动态调整建议卖出
   - 验证卖出订单是否正确提交

**验证SQL**:
```sql
-- 查看完整的交易流程
SELECT 
  si.symbol,
  si.current_state,
  si.context->>'entryPrice' as entry_price,
  si.context->>'currentStopLoss' as stop_loss,
  si.context->>'currentTakeProfit' as take_profit,
  si.context->'adjustmentHistory' as adjustments,
  eo.order_id,
  eo.side,
  eo.current_status
FROM strategy_instances si
LEFT JOIN execution_orders eo ON si.context->>'orderId' = eo.order_id
WHERE si.strategy_id = 1
ORDER BY si.last_updated DESC;
```

---

## 📊 回测功能说明

### 当前状态

**❌ 回测功能尚未实现**

回测功能在文档中作为"测试验证"的一部分被提及，但当前代码库中**没有实现回测功能**。

### 回测功能需求

回测功能应该包括：

1. **历史数据回测**
   - 使用历史K线数据
   - 使用历史市场环境数据
   - 模拟策略执行过程

2. **性能指标计算**
   - 总收益率
   - 最大回撤
   - 夏普比率
   - 胜率

3. **对比分析**
   - 修复前后的策略表现对比
   - 不同参数下的表现对比

### 回测功能实现方案

#### 方案1: 简单的回测脚本

**文件**: `api/scripts/backtest-strategy.ts`

**功能**:
- 读取历史数据
- 模拟策略执行
- 计算性能指标
- 生成报告

**实现步骤**:
1. 获取历史K线数据（从数据库或API）
2. 获取历史市场环境数据（SPX、USD、BTC）
3. 按时间顺序模拟策略执行
4. 记录每笔交易
5. 计算性能指标

#### 方案2: 完整的回测服务

**文件**: `api/src/services/backtest.service.ts`

**功能**:
- 回测引擎
- 性能分析
- 报告生成
- API接口

**API端点**:
- `POST /api/quant/backtest` - 执行回测
- `GET /api/quant/backtest/:id` - 获取回测结果
- `GET /api/quant/backtest/:id/report` - 获取回测报告

### 回测功能实施计划

**优先级**: 中（不是核心功能，但有助于验证策略）

**实施步骤**:
1. **Phase 1**: 简单的回测脚本（1-2天）
   - 读取历史数据
   - 模拟策略执行
   - 计算基本指标

2. **Phase 2**: 回测服务（3-5天）
   - 创建回测服务
   - 实现性能分析
   - 创建API接口

3. **Phase 3**: 前端展示（2-3天）
   - 回测结果展示
   - 性能图表
   - 对比分析

### 临时测试方案

在回测功能实现之前，可以使用以下方法验证策略：

1. **日志分析**
   - 分析实际运行日志
   - 统计交易记录
   - 计算盈亏情况

2. **数据库查询**
   - 查询 `auto_trades` 表
   - 查询 `execution_orders` 表
   - 计算实际表现

3. **手动回测**
   - 使用历史数据手动模拟
   - 记录每笔交易
   - 计算性能指标

**查询示例**:
```sql
-- 计算策略总盈亏
SELECT 
  strategy_id,
  symbol,
  SUM(CASE WHEN side = 'SELL' THEN pnl ELSE 0 END) as total_pnl,
  COUNT(*) as trade_count,
  AVG(CASE WHEN side = 'SELL' THEN pnl ELSE NULL END) as avg_pnl
FROM auto_trades
WHERE strategy_id = 1
  AND close_time IS NOT NULL
GROUP BY strategy_id, symbol
ORDER BY total_pnl DESC;
```

---

## 🔍 问题排查

### 常见问题

#### 1. 动态调整没有触发

**可能原因**:
- 市场环境没有变化
- 持仓时间不足
- 波动性没有变化

**排查方法**:
```sql
-- 检查持仓上下文
SELECT 
  symbol,
  context->>'previousMarketEnv' as prev_env,
  context->>'entryMarketEnv' as entry_env,
  context->>'entryTime' as entry_time,
  NOW() - (context->>'entryTime')::timestamp as holding_duration
FROM strategy_instances
WHERE current_state = 'HOLDING';
```

#### 2. 调整历史没有记录

**可能原因**:
- 止盈/止损没有实际变化
- 调整逻辑没有执行

**排查方法**:
- 查看日志中是否有调整信息
- 检查 `adjustmentHistory` 字段

#### 3. 市场环境获取失败

**可能原因**:
- 交易推荐服务异常
- API调用失败

**排查方法**:
- 查看日志中的错误信息
- 测试交易推荐API是否正常

---

## 📝 测试检查清单

### 功能测试

- [ ] 买入时保存完整上下文
- [ ] 持仓监控动态调整
- [ ] 市场环境变化响应
- [ ] 持仓时间调整
- [ ] 波动性调整
- [ ] 风险保护机制

### 数据验证

- [ ] 数据库上下文格式正确
- [ ] 调整历史正确记录
- [ ] 市场环境正确保存
- [ ] ATR正确保存

### 日志验证

- [ ] 动态调整日志输出
- [ ] 市场环境变化日志
- [ ] 调整原因记录

### 集成测试

- [ ] 完整买入→持仓→卖出流程
- [ ] 动态调整触发卖出
- [ ] 固定止盈/止损触发卖出

---

**最后更新**: 2025-12-03

