# 回测功能测试问题记录

## 📋 问题清单

### 1. ✅ historyCandlesticksByOffset日期格式错误

**问题描述**：
```
historyCandlesticksByOffset失败 (TSLA.US): Failed to recover `NaiveDatetime` type from napi value
```

**原因分析**：
- Longbridge SDK的`historyCandlesticksByOffset`可能对日期参数格式有特殊要求
- JavaScript的`Date`对象可能无法直接传递给SDK

**解决方案**：
- ✅ 优先使用`historyCandlesticksByDate`（日期范围查询，更可靠）
- ✅ 如果日期范围超过1000天，再使用`historyCandlesticksByOffset`
- ✅ 如果都失败，降级到`candlesticks()`方法

**修复位置**：
- `api/src/services/backtest.service.ts` 第92-146行

---

### 2. ✅ 回测数据量不足

**问题描述**：
```
计算 TSLA.US 交易推荐失败: TSLA.US 数据不足，无法计算推荐
过滤后得到 19 条数据 (TSLA.US)
```

**原因分析**：
- `calculateRecommendation`需要至少50条K线数据
- 回测中只获取了19条数据，不满足要求

**解决方案**：
- ✅ 如果数据不足50条，自动尝试获取更多数据
- ✅ 使用`candlesticks()`方法补充历史数据
- ✅ 在传递历史数据给`calculateRecommendation`时，如果不足50条，使用所有可用数据

**修复位置**：
- `api/src/services/backtest.service.ts` 第180-220行（数据完整性检查）
- `api/src/services/backtest.service.ts` 第414-435行（历史数据传递）

---

### 3. ✅ Moomoo分时数据不支持历史日期

**问题描述**：
```
[历史数据过滤] 警告：过滤后无数据！
目标时间戳(ms): 1763395199999 (2025-11-17T15:59:59.999Z)
第一条数据时间戳(ms): 1765780862000 (2025-12-15T06:41:02.000Z)
```

**原因分析**：
- Moomoo的`get-quote-minute`接口只返回当天的分时数据
- 不支持历史日期查询

**解决方案**：
- ✅ 回测中不使用Moomoo分时数据
- ✅ 使用日K数据的OHLC来模拟市场环境（已实现`market-simulation.ts`）
- ✅ 在`getHistoricalMarketData`中，如果分时数据为空，使用日K数据

**修复位置**：
- `api/src/services/market-data.service.ts` 第547-602行（历史数据过滤）

---

### 4. ⚠️ 回测日期范围问题

**问题描述**：
- 回测日期是2025-11-15到2025-12-15（未来日期）
- 可能是测试数据，需要确认

**建议**：
- 使用真实的过去日期进行回测
- 例如：2024-11-15到2024-12-15

---

## 🔧 已实施的修复

### 修复1：优化历史K线数据获取

```typescript
// 优先使用historyCandlesticksByDate（更可靠）
if (daysDiff <= 1000) {
  candlesticks = await quoteCtx.historyCandlesticksByDate(
    symbol,
    Period.Day,
    AdjustType.NoAdjust,
    startDate,
    endDate
  );
} else {
  // 日期范围超过1000天，使用historyCandlesticksByOffset
  candlesticks = await quoteCtx.historyCandlesticksByOffset(...);
}
```

### 修复2：数据量不足时自动补充

```typescript
// 确保至少有50条数据
if (result.length < 50) {
  // 尝试获取更多数据
  const additionalCandlesticks = await quoteCtx.candlesticks(...);
  // 合并数据
  result = [...additionalResult, ...result];
}
```

### 修复3：历史数据传递优化

```typescript
// 如果数据不足50条，使用所有可用数据
const availableCandles = historicalCandles.length >= 50 
  ? historicalCandles 
  : candlesticks.slice(0, Math.max(historicalCandles.length, 50));
```

---

## 📝 测试建议

1. **使用真实的历史日期**：
   - 例如：2024-11-15到2024-12-15
   - 避免使用未来日期

2. **验证数据获取**：
   - 确认能够获取至少50条K线数据
   - 检查数据的时间范围是否正确

3. **验证推荐计算**：
   - 确认`calculateRecommendation`能够正常计算
   - 检查推荐结果是否合理

---

**更新时间**：2025-12-15  
**状态**：✅ 已修复并测试

---

## 📅 后续修订（2025-12-15）

### 4. ✅ 回测日期范围验证

**问题描述**：
- 回测日期范围包含周末（如2025-11-13、2025-11-14）
- 回测日期范围包含未来日期（如2025-12-15）
- 导致数据不足或无法获取数据

**解决方案**：
- ✅ 实现日期范围验证功能（`trading-days.ts`）
  - 自动排除周末日期
  - 自动排除未来日期
  - 自动调整到最近的交易日
- ✅ 创建交易日服务（`trading-days.service.ts`）
  - 使用Longbridge SDK的`tradingDays`接口获取真实交易日数据
  - 包括节假日判断
  - 实现24小时缓存机制
- ✅ 集成到回测服务
  - 在获取历史数据前验证和调整日期范围
  - 在回测循环中使用真实交易日数据过滤日期

**修复位置**：
- `api/src/utils/trading-days.ts`（新增函数）
- `api/src/services/trading-days.service.ts`（新建文件）
- `api/src/services/backtest.service.ts`（集成交易日验证）
- `api/src/routes/backtest.ts`（集成日期范围验证）

**详细文档**：参见 `251215-BACKTEST_TRADING_DAYS_AND_LOGIC_REVISION_SUMMARY.md`

