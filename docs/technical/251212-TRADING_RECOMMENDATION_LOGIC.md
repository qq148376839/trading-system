# 交易推荐逻辑总结

**最后更新**: 2025-12-02

## 📋 概述

交易推荐系统基于**多市场综合分析**和**技术指标**，为US股票生成BUY/SELL/HOLD建议，并提供精确的入场价、止损价、止盈价。系统综合考虑SPX指数、USD指数、BTC市场数据以及股票自身技术面，确保风险收益比≥1.5。

---

## 🔄 核心流程

### 阶段1: 数据获取

#### 1.1 市场数据获取（使用缓存）
```typescript
// 获取SPX、USD Index、BTC的K线数据（最近100天）
const marketData = await marketDataCacheService.getMarketData();
```
- **SPX**: 标普500指数（市场Code: 24, InstrumentType: 6, SubInstrumentType: 6001）
- **USD Index**: 美元指数
- **BTC**: 比特币（市场Code: 360, InstrumentType: 11, SubInstrumentType: 11002）
- **缓存策略**: 根据交易时间动态调整缓存时长（交易时间缓存更短，非交易时间缓存更长）

#### 1.2 股票K线数据获取
```typescript
// 获取目标股票的K线数据（最近100天，日K线）
const stockCandlesticks = await this.getStockCandlesticks(symbol);
```
- **数据要求**: 至少需要50天数据才能计算推荐
- **数据源**: 长桥证券API（LongPort）

---

### 阶段2: 市场分析

#### 2.1 SPX分析（标普500指数）
计算以下指标：
- **当前价格**: `current_price`
- **20日均价**: `avg_20`（最近20天收盘价平均）
- **10日均价**: `avg_10`（最近10天收盘价平均）
- **50日最高**: `high_50`
- **50日最低**: `low_50`
- **趋势判断**: 
  - `上升趋势`: 当前价 > 20日均价 × 1.01
  - `下降趋势`: 当前价 < 20日均价 × 0.99
  - `盘整`: 其他情况
- **短期趋势**: 基于10日均价判断（阈值0.5%）
- **市场位置**: 
  - `高位区间`: 位置百分比 > 70%
  - `低位区间`: 位置百分比 < 30%
  - `中位区间`: 其他
- **趋势强度**: `((current_price - avg_20) / avg_20) × 100`
  - 如果上升趋势且接近50日高点（>95%），强度+20
  - 如果下降趋势且接近50日低点（<105%），强度-20
- **偏离度**: `((current_price - avg_20) / avg_20) × 100`

#### 2.2 USD Index分析（美元指数）
- **计算方式**: 与SPX分析相同
- **特殊处理**: USD上升对股市是**负面影响**（USD上升利空股市）
- **影响强度**: `usd_impact_strength = -usdAnalysis.trend_strength × 0.3`

#### 2.3 BTC分析（比特币）
- **基础分析**: 与SPX分析相同
- **特殊指标**:
  - **SPX影响强度** (`spx_impact_strength`):
    - BTC企稳（盘整 + 位置30-70%）: `|trend_strength| × 0.5`
    - BTC上升趋势: `|trend_strength| × 0.5`
    - BTC下降趋势且位置<30%: `-|trend_strength| × 0.3`
  - **稳定性判断** (`is_stable`): 盘整 + 位置30-70%

#### 2.4 SPX与BTC关联分析
- **Pearson相关系数**: 计算最近50天价格变化率的相关系数
- **趋势一致性**: 计算同向变化的比例
- **关系判断**:
  - `强正相关`: 相关系数 > 0.7
  - `中等正相关`: 相关系数 > 0.3
  - `负相关`: 相关系数 < -0.3
  - `弱相关`: 其他
- **共振判断** (`is_resonant`): 相关系数 > 0.5

#### 2.5 股票自身分析
- **计算方式**: 与SPX分析相同
- **关键指标**: 趋势、位置、强度、偏离度

---

### 阶段3: 综合市场强度计算

#### 3.1 USD影响
```typescript
const usd_impact_strength = -usdAnalysis.trend_strength × 0.3;
```

#### 3.2 BTC支持
```typescript
let btc_support = 0;
if (spxBtcCorrelation.is_resonant) {
  if (btcAnalysis.is_stable || btcAnalysis.trend === '上升趋势') {
    btc_support = btcAnalysis.spx_impact_strength;
  }
}
```

#### 3.3 综合市场强度
```typescript
const comprehensive_market_strength = 
  spxAnalysis.trend_strength + 
  usd_impact_strength + 
  btc_support;
```

#### 3.4 SPX与USD趋势一致性
- **一致利好**: SPX上升 + USD下降
- **一致利空**: SPX下降 + USD上升
- **趋势冲突**: 其他情况

#### 3.5 市场环境评估
```typescript
let market_environment: '良好' | '较差' | '中性' = '中性';
```
评估逻辑：
1. **良好**:
   - 趋势一致利好 + 综合强度 > 50
   - BTC企稳 + 综合强度 > 50
   - BTC企稳 + 综合强度 > 0（中性偏利好）
2. **较差**:
   - 趋势一致利空 + 综合强度 < -50
   - 综合强度 < -50
3. **中性**:
   - 趋势冲突
   - 其他情况

**BTC共振调整**:
- BTC企稳 + 中性 → 提升为良好
- BTC下降 + 良好 → 降级为中性

---

### 阶段4: 交易决策计算

#### 4.1 ATR（平均真实波幅）计算
```typescript
const atr = this.calculateATR(stockCandlesticks, 14);
```
- **用途**: 衡量市场波动性，用于动态设置止损止盈
- **计算方式**: 
  - True Range (TR) = max(high-low, |high-prevClose|, |low-prevClose|)
  - ATR = 最近14个TR的平均值
- **ATR百分比**: `atrMultiplier = atr / current_price`

#### 4.2 止损止盈倍数（根据波动性调整）
```typescript
// 低波动（ATR < 1.5%）: 止损1.5倍ATR，止盈2.5倍ATR
// 中波动（ATR 1.5-3%）: 止损2.0倍ATR，止盈3.0倍ATR
// 高波动（ATR > 3%）: 止损2.5倍ATR，止盈3.5倍ATR
```

#### 4.3 BUY逻辑（买入/做多）

**触发条件**:
- `market_environment === '良好'` AND (`stockAnalysis.trend === '上升趋势'` OR `stockAnalysis.trend === '盘整'`)

**入场价范围**:
```typescript
const entryRange = Math.max(atr × 0.5, current_price × 0.01);
entry_min = min(current_price - entryRange × 0.5, max(current_price × 0.98, low_50 × 1.01));
entry_max = max(current_price + entryRange × 0.5, min(current_price × 1.02, high_50 × 0.99));
```

**止损价**（价格下跌会亏损）:
```typescript
const avgEntry = (entry_min + entry_max) / 2;
stop_loss = max(avgEntry - atr × stopLossMultiplier, min(entry_min × 0.95, low_50 × 1.02));
```

**止盈价**（价格上涨会盈利）:
```typescript
// 1. 计算交易费用
const estimatedQuantity = estimateTradeQuantity(avgEntry); // 默认1000 USD
const buyFees = calculateTradingFees(avgEntry, estimatedQuantity, false);
const sellFees = calculateTradingFees(avgEntry, estimatedQuantity, true);
const totalFees = buyFees + sellFees;
const feesPerShare = totalFees / estimatedQuantity;

// 2. 确保风险收益比 >= 1.5
const potential_loss = avgEntry - stop_loss;
const min_profit = potential_loss × 1.5;
const minTakeProfit = avgEntry + min_profit + feesPerShare × 2;

// 3. 计算止盈（必须覆盖费用和最小盈利）
take_profit = max(
  avgEntry + atr × takeProfitMultiplier + feesPerShare,
  minTakeProfit,
  min(entry_max × 1.08, high_50 × 0.98)
);

// 4. 确保止盈 > entry_max
if (take_profit <= entry_max) {
  take_profit = entry_max + atr × 1.5 + feesPerShare;
}

// 5. 验证盈利能覆盖费用
const netProfit = take_profit - avgEntry - feesPerShare;
if (netProfit <= 0) {
  take_profit = avgEntry + feesPerShare × 2 + atr × 1.0;
}
```

#### 4.4 SELL逻辑（做空）

**触发条件**:
- `market_environment === '较差'` OR `stockAnalysis.trend === '下降趋势'`

**入场价范围**:
```typescript
const entryRange = Math.max(atr × 0.5, current_price × 0.01);
entry_max = max(current_price + entryRange × 0.5, min(current_price × 1.02, high_50 × 0.99));
entry_min = min(current_price - entryRange × 0.5, max(current_price × 0.98, low_50 × 1.01));
```

**止损价**（价格上涨会亏损，因为做空后价格上涨会亏钱）:
```typescript
const avgEntry = (entry_min + entry_max) / 2;
stop_loss = min(avgEntry + atr × stopLossMultiplier, max(entry_max × 1.05, high_50 × 0.98));
```

**止盈价**（价格下跌会盈利，因为做空后价格下跌会赚钱）:
```typescript
// 1. 计算交易费用（做空：卖出+买回）
const sellFees = calculateTradingFees(avgEntry, estimatedQuantity, true);
const buyBackFees = calculateTradingFees(avgEntry, estimatedQuantity, false);
const totalFees = sellFees + buyBackFees;
const feesPerShare = totalFees / estimatedQuantity;

// 2. 确保风险收益比 >= 1.5
const potential_loss = stop_loss - avgEntry;
const min_profit = potential_loss × 1.5;
const minTakeProfit = avgEntry - min_profit - feesPerShare × 2;

// 3. 计算止盈（价格下跌）
take_profit = min(
  avgEntry - atr × takeProfitMultiplier - feesPerShare,
  minTakeProfit,
  max(entry_min × 0.92, low_50 × 1.02)
);

// 4. 确保止盈 < entry_min
if (take_profit >= entry_min) {
  take_profit = entry_min - atr × 1.5 - feesPerShare;
}

// 5. 验证盈利能覆盖费用
const netProfit = avgEntry - take_profit - feesPerShare;
if (netProfit <= 0) {
  take_profit = avgEntry - feesPerShare × 2 - atr × 1.0;
}
```

#### 4.5 HOLD逻辑（持有/观望）

**触发条件**: 市场环境中性，不满足BUY或SELL条件

**入场价范围**:
```typescript
const entryRange = Math.max(atr × 0.3, current_price × 0.005); // 范围更小
entry_min = max(current_price - entryRange, current_price × 0.995);
entry_max = min(current_price + entryRange, current_price × 1.005);
```

**止损止盈**:
```typescript
const avgEntry = (entry_min + entry_max) / 2;
stop_loss = max(avgEntry - atr × stopLossMultiplier × 0.8, low_50 × 1.01);
take_profit = min(avgEntry + atr × takeProfitMultiplier × 0.8, high_50 × 0.99);
```

---

### 阶段5: 风险收益比验证

#### 5.1 风险收益比计算
```typescript
// BUY
const potential_loss = entry_min - stop_loss;
const potential_profit = take_profit - entry_min;
risk_reward_ratio = potential_profit / potential_loss;

// SELL
const potential_loss = stop_loss - entry_max;
const potential_profit = entry_max - take_profit;
risk_reward_ratio = potential_profit / potential_loss;
```

#### 5.2 验证要求
- **强制要求**: `risk_reward_ratio >= 1.5`
- 如果不足1.5，系统会在计算止盈时自动调整以满足要求

---

### 阶段6: 交易费用计算

#### 6.1 长桥证券美国市场费率（参考）
- **佣金**: `0.0049 USD/股`，最低 `0.99 USD/订单`
- **平台费**: 阶梯费率（根据每月交易股数）
  - ≤5,000股: `0.0070 USD/股`
  - ≤10,000股: `0.0060 USD/股`
  - ≤100,000股: `0.0050 USD/股`
  - ≤1,000,000股: `0.0040 USD/股`
  - >1,000,000股: `0.0030 USD/股`
  - 最低: `1.0 USD/订单`
- **交收费**: `0.003 USD/股`，最高 `交易金额 × 7%`
- **交易活动费**（仅卖出）: `0.000166 USD/股`，最低 `0.01 USD`，最高 `8.30 USD`
- **CAT费**: `0.000046 USD/股`，最低 `0.01 USD/订单`

#### 6.2 费用估算
- **默认交易金额**: 1000 USD
- **估算股数**: `Math.floor(1000 / price)`
- **费用包含**: 买入/卖出（或做空/买回）的所有费用

---

## 📊 输出结果

### TradingRecommendation接口
```typescript
{
  symbol: string;                    // 股票代码（如：AAPL.US）
  action: 'BUY' | 'SELL' | 'HOLD';  // 操作建议
  entry_price_range: {               // 入场价范围
    min: number;
    max: number;
  };
  stop_loss: number;                 // 止损价
  take_profit: number;               // 止盈价
  risk_reward_ratio: number;        // 风险收益比（≥1.5）
  market_environment: '良好' | '较差' | '中性';  // 市场环境
  comprehensive_market_strength: number;  // 综合市场强度
  trend_consistency: string;         // SPX-USD趋势一致性
  analysis_summary: string;          // 分析摘要
  risk_note: string;                 // 风险提示
  spx_usd_relationship_analysis?: string;  // SPX-USD关系详细分析
}
```

---

## 🔑 关键特性

### 1. 多市场综合分析
- **SPX**: 代表整体股市趋势
- **USD Index**: 美元强弱对股市的影响（USD上升利空股市）
- **BTC**: 风险资产情绪指标，与SPX共振时增强信号

### 2. 动态止损止盈
- **基于ATR**: 根据市场波动性动态调整
- **波动性分级**: 低/中/高波动使用不同的ATR倍数
- **边界保护**: 止损止盈不会超出50日高低点范围

### 3. 风险控制
- **风险收益比**: 强制≥1.5
- **费用考虑**: 止盈必须覆盖交易费用
- **边界检查**: 确保入场价、止损、止盈的逻辑正确性

### 4. 智能缓存
- **交易时间**: 缓存时间较短（数据更新频繁）
- **非交易时间**: 缓存时间较长（节省API调用）

---

## ⚠️ 风险提示生成

系统会根据以下条件生成风险提示：
1. **市场环境较差**: "市场环境较差，谨慎操作"
2. **风险收益比不足**: "风险收益比不足1.5，建议等待更好的入场时机"
3. **高位风险**: "股票处于高位，注意回调风险"（位置>80%）
4. **低位机会**: "股票处于低位，关注反弹机会"（位置<20%）

---

## 📝 注意事项

1. **数据要求**: 股票至少需要50天K线数据才能计算推荐
2. **市场数据不足**: 如果SPX/USD/BTC数据不足，会使用默认中性值继续计算
3. **只支持US股票**: API只处理以`.US`结尾的股票代码
4. **批量计算**: 支持并行计算多个股票的推荐，提高效率
5. **费用估算**: 使用固定1000 USD交易金额估算费用，实际费用可能因交易量而异

---

## 🔗 相关文件

- `api/src/services/trading-recommendation.service.ts` - 核心计算逻辑
- `api/src/routes/trading-recommendation.ts` - API路由
- `api/src/services/market-data.service.ts` - 市场数据获取
- `api/src/services/market-data-cache.service.ts` - 市场数据缓存
- `api/src/utils/trading-hours.ts` - 交易时间工具

