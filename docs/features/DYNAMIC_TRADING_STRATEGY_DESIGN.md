# 动态交易策略设计文档

**版本**: v1.0  
**创建日期**: 2025-12-03  
**状态**: 已实施 ✅

## 📋 目录

- [问题分析](#问题分析)
- [设计目标](#设计目标)
- [核心策略框架](#核心策略框架)
- [持仓管理策略](#持仓管理策略)
- [动态止盈止损调整](#动态止盈止损调整)
- [市场环境响应机制](#市场环境响应机制)
- [风险控制机制](#风险控制机制)
- [实现方案](#实现方案)
- [测试验证](#测试验证)

---

## 🔍 问题分析

### 当前问题

1. **高买低卖问题**
   - 现象：IONQ买入49.175，卖出47.11；CRSP买入52.8，卖出51.86
   - 原因：持仓时简单根据市场环境变化就卖出，没有考虑持仓成本和盈亏情况
   - 影响：造成不必要的亏损

2. **错过机会问题**
   - 现象：如果完全移除市场环境检查，可能错过最佳卖出时机
   - 原因：市场环境变化可能预示着趋势反转，但需要智能判断
   - 影响：可能错过止盈机会或增加亏损风险

### 根本原因

- **策略过于简单**：只考虑市场环境变化，没有综合考虑持仓成本、盈亏、时间等因素
- **缺乏动态调整**：止盈/止损设置后不再调整，无法适应市场变化
- **缺乏风险保护**：没有考虑持仓时间、波动性等因素

---

## 🎯 设计目标

### 核心目标

1. **避免高买低卖**：持仓时不应该简单地因为市场环境变化就卖出
2. **抓住机会**：在市场环境明显恶化时，应该能够及时止损或止盈
3. **动态调整**：根据市场变化动态调整止盈/止损，而不是固定不变
4. **风险控制**：综合考虑持仓成本、盈亏、时间、波动性等因素

### 设计原则

1. **成本优先**：优先考虑持仓成本，避免亏损卖出
2. **盈亏平衡**：在盈亏平衡点附近设置保护机制
3. **动态调整**：根据市场变化动态调整止盈/止损
4. **风险控制**：设置多重风险保护机制

---

## 🏗️ 核心策略框架

### 策略状态机

```
IDLE → OPENING → HOLDING → CLOSING → IDLE
         ↓          ↓          ↓
      (买入)    (持仓监控)  (卖出监控)
```

### 持仓监控决策树

```
持仓监控
├── 固定止盈/止损检查
│   ├── 触发止损 → 立即卖出
│   └── 触发止盈 → 立即卖出
│
├── 动态止盈/止损调整
│   ├── 市场环境变化 → 调整止盈/止损
│   ├── 持仓时间 → 调整止盈/止损
│   └── 波动性变化 → 调整止盈/止损
│
├── 市场环境响应
│   ├── 市场环境恶化 + 盈利 → 收紧止盈/止损
│   ├── 市场环境恶化 + 亏损 → 评估是否止损
│   └── 市场环境改善 + 亏损 → 放宽止损
│
└── 风险保护机制
    ├── 盈亏平衡保护
    ├── 持仓时间保护
    └── 波动性保护
```

---

## 📊 持仓管理策略

### 1. 持仓状态分类

根据持仓成本和当前价格，将持仓分为以下状态：

| 状态 | 条件 | 策略 |
|------|------|------|
| **深度亏损** | `currentPrice < entryPrice × 0.95` | 严格止损，不轻易卖出 |
| **轻度亏损** | `entryPrice × 0.95 ≤ currentPrice < entryPrice` | 谨慎持有，设置保护止损 |
| **盈亏平衡** | `entryPrice ≤ currentPrice < entryPrice × 1.02` | 设置盈亏平衡保护 |
| **轻度盈利** | `entryPrice × 1.02 ≤ currentPrice < takeProfit` | 正常持有，动态调整止盈 |
| **接近止盈** | `takeProfit × 0.95 ≤ currentPrice < takeProfit` | 收紧止盈，准备卖出 |
| **超过止盈** | `currentPrice ≥ takeProfit` | 立即卖出或分批卖出 |

### 2. 持仓时间分类

根据持仓时间，设置不同的策略：

| 持仓时间 | 策略调整 |
|----------|----------|
| **< 1小时** | 严格止损，避免快速亏损 |
| **1-4小时** | 正常持有，动态调整 |
| **4-24小时** | 放宽止损，给更多时间 |
| **> 24小时** | 考虑时间成本，收紧止盈 |

### 3. 盈亏情况响应

根据盈亏情况，设置不同的响应策略：

```typescript
// 盈亏百分比
const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

if (pnlPercent < -5) {
  // 深度亏损：严格止损，不轻易卖出
  // 除非市场环境极度恶化，否则持有
} else if (pnlPercent < 0) {
  // 轻度亏损：谨慎持有，设置保护止损
  // 如果市场环境恶化，考虑止损
} else if (pnlPercent < 2) {
  // 盈亏平衡：设置盈亏平衡保护
  // 如果市场环境恶化，考虑止盈
} else if (pnlPercent < 5) {
  // 轻度盈利：正常持有，动态调整止盈
} else {
  // 接近或超过止盈：准备卖出
}
```

---

## 🔄 动态止盈止损调整

### 1. 调整触发条件

止盈/止损调整在以下情况下触发：

1. **市场环境变化**
   - 市场环境从"良好"变为"较差" → 收紧止盈/止损
   - 市场环境从"较差"变为"良好" → 放宽止损

2. **持仓时间变化**
   - 持仓时间超过阈值 → 调整止盈/止损

3. **波动性变化**
   - ATR变化超过阈值 → 调整止盈/止损

4. **价格变化**
   - 价格接近止盈/止损 → 动态调整

### 2. 调整策略

#### 市场环境恶化时的调整

```typescript
// 市场环境从"良好"变为"较差"或"中性利空"
if (previousMarketEnv === '良好' && currentMarketEnv === '较差') {
  if (pnlPercent > 0) {
    // 盈利状态：收紧止盈，保护利润
    // 将止盈调整为当前价格 + 1% 或 原止盈的 95%，取较小值
    takeProfit = Math.min(
      currentPrice * 1.01,
      originalTakeProfit * 0.95
    );
  } else if (pnlPercent > -2) {
    // 轻度亏损：收紧止损，避免进一步亏损
    // 将止损调整为当前价格 - 1% 或 原止损的 105%，取较大值
    stopLoss = Math.max(
      currentPrice * 0.99,
      originalStopLoss * 1.05
    );
  } else {
    // 深度亏损：保持原止损，不轻易调整
    // 除非市场环境极度恶化，否则持有
  }
}
```

#### 市场环境改善时的调整

```typescript
// 市场环境从"较差"变为"良好"或"中性利好"
if (previousMarketEnv === '较差' && currentMarketEnv === '良好') {
  if (pnlPercent < 0) {
    // 亏损状态：放宽止损，给更多时间
    // 将止损调整为原止损的 95%
    stopLoss = originalStopLoss * 0.95;
  } else {
    // 盈利状态：放宽止盈，追求更高收益
    // 将止盈调整为原止盈的 105%
    takeProfit = originalTakeProfit * 1.05;
  }
}
```

#### 持仓时间调整

```typescript
// 持仓时间超过阈值
const holdingHours = (Date.now() - entryTime) / (1000 * 60 * 60);

if (holdingHours > 24) {
  // 持仓超过24小时：收紧止盈，考虑时间成本
  if (pnlPercent > 0) {
    // 盈利状态：收紧止盈，尽快卖出
    takeProfit = Math.min(
      currentPrice * 1.02,
      originalTakeProfit * 0.98
    );
  }
} else if (holdingHours < 1) {
  // 持仓不足1小时：严格止损，避免快速亏损
  if (pnlPercent < -2) {
    // 快速亏损：收紧止损
    stopLoss = Math.max(
      currentPrice * 0.98,
      originalStopLoss * 1.02
    );
  }
}
```

#### 波动性调整

```typescript
// ATR变化超过阈值
const atrChange = (currentATR - originalATR) / originalATR;

if (Math.abs(atrChange) > 0.2) {
  // ATR变化超过20%：调整止盈/止损
  if (atrChange > 0) {
    // 波动性增加：放宽止盈/止损
    takeProfit = originalTakeProfit * (1 + atrChange * 0.5);
    stopLoss = originalStopLoss * (1 - atrChange * 0.5);
  } else {
    // 波动性减少：收紧止盈/止损
    takeProfit = originalTakeProfit * (1 + atrChange * 0.5);
    stopLoss = originalStopLoss * (1 - atrChange * 0.5);
  }
}
```

---

## 🌍 市场环境响应机制

### 1. 市场环境评估

市场环境分为以下等级：

| 等级 | 条件 | 持仓策略 |
|------|------|----------|
| **良好** | 趋势一致利好 + 综合强度 > 50 | 正常持有，追求更高收益 |
| **中性利好** | 综合强度 > 10 | 正常持有，动态调整 |
| **中性** | 综合强度在 -10 到 10 之间 | 谨慎持有，设置保护 |
| **中性利空** | 综合强度 < -10 | 收紧止盈/止损 |
| **较差** | 趋势一致利空 + 综合强度 < -50 | 考虑止损或止盈 |

### 2. 市场环境响应策略

#### 市场环境恶化响应

```typescript
// 市场环境从"良好"或"中性利好"变为"较差"或"中性利空"
if (
  (previousMarketEnv === '良好' || previousMarketEnv === '中性利好') &&
  (currentMarketEnv === '较差' || currentMarketEnv === '中性利空')
) {
  // 计算市场环境恶化程度
  const marketDeterioration = calculateMarketDeterioration(
    previousMarketEnv,
    currentMarketEnv,
    previousStrength,
    currentStrength
  );
  
  if (pnlPercent > 3) {
    // 盈利超过3%：收紧止盈，保护利润
    // 止盈调整为：当前价格 + 1% 或 原止盈的 95%
    takeProfit = Math.min(
      currentPrice * 1.01,
      originalTakeProfit * 0.95
    );
    
    // 如果市场环境极度恶化，考虑立即止盈
    if (marketDeterioration > 0.5) {
      shouldSell = true;
      exitReason = 'MARKET_DETERIORATION_PROFIT_PROTECTION';
    }
  } else if (pnlPercent > 0) {
    // 轻度盈利：收紧止盈，保护利润
    takeProfit = Math.min(
      currentPrice * 1.02,
      originalTakeProfit * 0.97
    );
  } else if (pnlPercent > -2) {
    // 轻度亏损：收紧止损，避免进一步亏损
    stopLoss = Math.max(
      currentPrice * 0.99,
      originalStopLoss * 1.03
    );
    
    // 如果市场环境极度恶化，考虑止损
    if (marketDeterioration > 0.7) {
      shouldSell = true;
      exitReason = 'MARKET_DETERIORATION_STOP_LOSS';
    }
  } else {
    // 深度亏损：保持原止损，不轻易调整
    // 除非市场环境极度恶化，否则持有
    if (marketDeterioration > 0.8) {
      shouldSell = true;
      exitReason = 'MARKET_DETERIORATION_DEEP_LOSS';
    }
  }
}
```

#### 市场环境改善响应

```typescript
// 市场环境从"较差"或"中性利空"变为"良好"或"中性利好"
if (
  (previousMarketEnv === '较差' || previousMarketEnv === '中性利空') &&
  (currentMarketEnv === '良好' || currentMarketEnv === '中性利好')
) {
  if (pnlPercent < 0) {
    // 亏损状态：放宽止损，给更多时间
    stopLoss = Math.max(
      originalStopLoss * 0.95,
      entryPrice * 0.92  // 最多放宽到入场价的92%
    );
  } else {
    // 盈利状态：放宽止盈，追求更高收益
    takeProfit = Math.min(
      originalTakeProfit * 1.05,
      entryPrice * 1.15  // 最多放宽到入场价的115%
    );
  }
}
```

### 3. 市场环境变化计算

```typescript
function calculateMarketDeterioration(
  previousEnv: string,
  currentEnv: string,
  previousStrength: number,
  currentStrength: number
): number {
  // 市场环境等级映射
  const envLevels: Record<string, number> = {
    '良好': 5,
    '中性利好': 4,
    '中性': 3,
    '中性利空': 2,
    '较差': 1,
  };
  
  const previousLevel = envLevels[previousEnv] || 3;
  const currentLevel = envLevels[currentEnv] || 3;
  
  // 环境等级变化（0-4）
  const levelChange = previousLevel - currentLevel;
  
  // 强度变化（归一化到0-1）
  const strengthChange = Math.max(0, (previousStrength - currentStrength) / 100);
  
  // 综合恶化程度（0-1）
  const deterioration = Math.min(1, (levelChange / 4) * 0.6 + strengthChange * 0.4);
  
  return deterioration;
}
```

---

## 🛡️ 风险控制机制

### 1. 盈亏平衡保护

在盈亏平衡点附近设置保护机制：

```typescript
// 盈亏平衡保护
const breakEvenPrice = entryPrice * 1.01; // 考虑交易费用

if (currentPrice >= breakEvenPrice && currentPrice < breakEvenPrice * 1.02) {
  // 在盈亏平衡点附近：设置保护止损
  // 止损不低于盈亏平衡点
  stopLoss = Math.max(stopLoss, breakEvenPrice * 0.99);
  
  // 如果市场环境恶化，考虑止盈
  if (currentMarketEnv === '较差' || currentMarketEnv === '中性利空') {
    shouldSell = true;
    exitReason = 'BREAK_EVEN_PROTECTION';
  }
}
```

### 2. 持仓时间保护

根据持仓时间设置保护机制：

```typescript
// 持仓时间保护
const holdingHours = (Date.now() - entryTime) / (1000 * 60 * 60);

if (holdingHours > 48) {
  // 持仓超过48小时：强制评估
  if (pnlPercent > 0) {
    // 盈利状态：考虑止盈
    if (currentPrice >= takeProfit * 0.95) {
      shouldSell = true;
      exitReason = 'HOLDING_TIME_PROFIT';
    }
  } else if (pnlPercent < -3) {
    // 亏损超过3%：考虑止损
    if (currentPrice <= stopLoss * 1.05) {
      shouldSell = true;
      exitReason = 'HOLDING_TIME_LOSS';
    }
  }
}
```

### 3. 波动性保护

根据波动性设置保护机制：

```typescript
// 波动性保护
const currentATR = calculateATR(candlesticks, 14);
const atrPercent = currentATR / currentPrice;

if (atrPercent > 0.05) {
  // 波动性超过5%：收紧止盈/止损
  if (pnlPercent > 0) {
    // 盈利状态：收紧止盈，保护利润
    takeProfit = Math.min(
      currentPrice * 1.03,
      originalTakeProfit * 0.97
    );
  } else {
    // 亏损状态：收紧止损，避免进一步亏损
    stopLoss = Math.max(
      currentPrice * 0.97,
      originalStopLoss * 1.03
    );
  }
}
```

---

## 💻 实现方案

### 1. 数据结构设计

```typescript
interface PositionContext {
  // 基础信息
  entryPrice: number;
  quantity: number;
  entryTime: Date;
  
  // 止盈止损
  originalStopLoss: number;
  originalTakeProfit: number;
  currentStopLoss: number;
  currentTakeProfit: number;
  
  // 市场环境
  entryMarketEnv: string;
  entryMarketStrength: number;
  previousMarketEnv: string;
  previousMarketStrength: number;
  
  // 波动性
  originalATR: number;
  currentATR: number;
  
  // 调整历史
  adjustmentHistory: Array<{
    timestamp: Date;
    reason: string;
    stopLoss: number;
    takeProfit: number;
  }>;
}
```

### 2. 核心函数设计

#### 持仓监控主函数

```typescript
async function processHoldingPosition(
  strategyInstance: StrategyBase,
  strategyId: number,
  symbol: string
): Promise<void> {
  // 1. 获取持仓上下文
  const context = await getPositionContext(strategyId, symbol);
  
  // 2. 获取当前价格和市场环境
  const currentPrice = await getCurrentPrice(symbol);
  const currentMarketEnv = await getCurrentMarketEnvironment();
  
  // 3. 计算盈亏
  const pnlPercent = ((currentPrice - context.entryPrice) / context.entryPrice) * 100;
  
  // 4. 检查固定止盈/止损
  if (currentPrice <= context.currentStopLoss) {
    await executeSell(strategyId, symbol, 'STOP_LOSS', currentPrice);
    return;
  }
  
  if (currentPrice >= context.currentTakeProfit) {
    await executeSell(strategyId, symbol, 'TAKE_PROFIT', currentPrice);
    return;
  }
  
  // 5. 动态调整止盈/止损
  const adjusted = await adjustStopLossTakeProfit(
    context,
    currentPrice,
    currentMarketEnv
  );
  
  if (adjusted.shouldSell) {
    await executeSell(strategyId, symbol, adjusted.exitReason, currentPrice);
    return;
  }
  
  // 6. 更新持仓上下文
  await updatePositionContext(strategyId, symbol, adjusted.context);
}
```

#### 动态调整函数

```typescript
async function adjustStopLossTakeProfit(
  context: PositionContext,
  currentPrice: number,
  currentMarketEnv: string
): Promise<{
  shouldSell: boolean;
  exitReason?: string;
  context: PositionContext;
}> {
  const pnlPercent = ((currentPrice - context.entryPrice) / context.entryPrice) * 100;
  const holdingHours = (Date.now() - context.entryTime.getTime()) / (1000 * 60 * 60);
  
  let newStopLoss = context.currentStopLoss;
  let newTakeProfit = context.currentTakeProfit;
  let shouldSell = false;
  let exitReason = '';
  
  // 1. 市场环境变化调整
  if (context.previousMarketEnv !== currentMarketEnv) {
    const adjustment = adjustByMarketEnvironment(
      context,
      currentPrice,
      currentMarketEnv,
      pnlPercent
    );
    newStopLoss = adjustment.stopLoss;
    newTakeProfit = adjustment.takeProfit;
    if (adjustment.shouldSell) {
      shouldSell = true;
      exitReason = adjustment.exitReason;
    }
  }
  
  // 2. 持仓时间调整
  const timeAdjustment = adjustByHoldingTime(
    context,
    currentPrice,
    holdingHours,
    pnlPercent
  );
  newStopLoss = Math.max(newStopLoss, timeAdjustment.stopLoss);
  newTakeProfit = Math.min(newTakeProfit, timeAdjustment.takeProfit);
  if (timeAdjustment.shouldSell && !shouldSell) {
    shouldSell = true;
    exitReason = timeAdjustment.exitReason;
  }
  
  // 3. 波动性调整
  const volatilityAdjustment = adjustByVolatility(
    context,
    currentPrice,
    pnlPercent
  );
  newStopLoss = Math.max(newStopLoss, volatilityAdjustment.stopLoss);
  newTakeProfit = Math.min(newTakeProfit, volatilityAdjustment.takeProfit);
  
  // 4. 风险保护检查
  const protectionCheck = checkRiskProtection(
    context,
    currentPrice,
    pnlPercent,
    holdingHours
  );
  if (protectionCheck.shouldSell && !shouldSell) {
    shouldSell = true;
    exitReason = protectionCheck.exitReason;
  }
  
  // 5. 更新上下文
  const updatedContext: PositionContext = {
    ...context,
    currentStopLoss: newStopLoss,
    currentTakeProfit: newTakeProfit,
    previousMarketEnv: currentMarketEnv,
    adjustmentHistory: [
      ...context.adjustmentHistory,
      {
        timestamp: new Date(),
        reason: exitReason || 'DYNAMIC_ADJUSTMENT',
        stopLoss: newStopLoss,
        takeProfit: newTakeProfit,
      },
    ],
  };
  
  return {
    shouldSell,
    exitReason,
    context: updatedContext,
  };
}
```

---

## 🧪 测试验证

### 1. 单元测试

- 测试市场环境变化调整逻辑
- 测试持仓时间调整逻辑
- 测试波动性调整逻辑
- 测试风险保护机制

### 2. 回测验证

- 使用历史数据回测策略
- 对比修复前后的表现
- 验证是否解决了高买低卖问题
- 验证是否能够抓住机会

### 3. 实盘验证

- 小资金实盘测试
- 监控策略执行情况
- 收集实际数据
- 持续优化策略

---

## 📝 实施计划

### 阶段1: 核心功能实现（1-2周）

1. 实现持仓上下文管理
2. 实现动态止盈/止损调整
3. 实现市场环境响应机制
4. 实现风险保护机制

### 阶段2: 测试优化（1周）

1. 单元测试
2. 回测验证
3. 性能优化
4. Bug修复

### 阶段3: 实盘验证（2-4周）

1. 小资金实盘测试
2. 数据收集和分析
3. 策略优化
4. 文档完善

---

## 📚 参考资料

- [交易推荐逻辑文档](technical/TRADING_RECOMMENDATION_LOGIC.md)
- [策略逻辑审查文档](technical/STRATEGY_LOGIC_REVIEW.md)
- [订单提交优化方案](archive/ORDER_SUBMIT_OPTIMIZATION.md)

---

**文档状态**: 设计完成，等待实施  
**最后更新**: 2025-12-03

