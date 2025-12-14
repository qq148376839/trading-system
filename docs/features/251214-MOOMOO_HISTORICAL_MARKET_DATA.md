# Moomoo边缘函数获取历史市场数据说明

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-14
- **文档作者**：AI Product Manager
- **状态**：待研究优化

---

## 1. 概述

本文档说明当前通过Moomoo边缘函数获取历史市场数据（SPX、USD Index、BTC）的实现方式、现状和潜在问题，供后续研究和优化参考。

---

## 2. 当前实现方式

### 2.1 数据获取流程

```
回测服务
  ↓
marketDataService.getHistoricalMarketData()
  ↓
getSPXCandlesticks() / getUSDIndexCandlesticks() / getBTCCandlesticks()
  ↓
getCandlesticksIntraday() (type=2, 日K数据)
  ↓
moomooProxy() → 边缘函数 moomooapi.js
  ↓
Moomoo API: /quote-api/quote-v2/get-kline
  ↓
返回历史K线数据
  ↓
filterDataBeforeDate() 过滤到目标日期
```

### 2.2 关键代码位置

**服务层**：
- `api/src/services/market-data.service.ts`
  - `getHistoricalMarketData()`: 批量获取历史市场数据
  - `getSPXCandlesticks()`: 获取SPX日K数据
  - `getUSDIndexCandlesticks()`: 获取USD Index日K数据
  - `getBTCCandlesticks()`: 获取BTC日K数据
  - `filterDataBeforeDate()`: 过滤数据到目标日期

**边缘函数**：
- `edge-functions/moomooapi.js`
  - 代理Moomoo API请求
  - 处理Cookies和CSRF Token
  - 生成quote-token

**代理层**：
- `api/src/utils/moomoo-proxy.ts`
  - 调用Cloudflare边缘函数
  - 处理请求和响应

---

## 3. 当前状态

### 3.1 日K数据获取 ✅ 正常

**测试结果**（目标日期：2025-11-14，需要100条数据）：

| 数据类型 | 原始数据量 | 过滤后数据量 | 状态 |
|---------|-----------|------------|------|
| SPX日K | 130条 | 100条 | ✅ 正常 |
| USD Index日K | 130条 | 100条 | ✅ 正常 |
| BTC日K | 130条 | 100条 | ✅ 正常 |

**数据时间范围**：
- SPX：2025-06-26 至 2025-11-14
- USD Index：正常
- BTC：正常

**API接口**：
- `/quote-api/quote-v2/get-kline`
- 参数：`type=2`（日K数据）

### 3.2 分时数据获取 ❌ 不支持历史日期

**问题描述**：
- `get-quote-minute` API只返回**最新**分时数据
- 不支持历史日期参数
- 所有分时数据的时间戳都是**今天**（2025-12-14）

**测试结果**（目标日期：2025-11-14）：

| 数据类型 | 原始数据量 | 过滤后数据量 | 状态 |
|---------|-----------|------------|------|
| USD Index分时 | 130条 | 0条 | ❌ 全部被过滤（时间戳都是今天） |
| BTC分时 | 130条 | 0条 | ❌ 全部被过滤（时间戳都是今天） |

**数据时间戳示例**：
```
第一条数据时间戳: 1765724736000 (2025-12-14T15:05:36.000Z)
最后一条数据时间戳: 1765724736000 (2025-12-14T15:05:36.000Z)
目标时间戳: 1763135999999 (2025-11-14T15:59:59.999Z)
比较结果: 第一条>目标, 最后一条>目标
```

**API接口**：
- `/quote-api/quote-v2/get-quote-minute`
- 参数：`type=1`（分时数据）

**影响**：
- ⚠️ 分时数据在回测中为空
- ✅ **不影响回测功能**：分时数据是可选的，回测主要使用日K数据

---

## 4. 技术细节

### 4.1 数据过滤逻辑

**实现位置**：`market-data.service.ts::filterDataBeforeDate()`

**关键修复**：

1. **时间戳单位统一**：
   ```typescript
   // 判断是秒级还是毫秒级（如果小于1e10则是秒级，否则是毫秒级）
   itemTimestampMs = item.timestamp < 1e10 ? item.timestamp * 1000 : item.timestamp;
   ```

2. **日期时间设置**：
   ```typescript
   // 使用目标日期的结束时间（23:59:59），确保包含目标日期当天的数据
   const targetDateEnd = new Date(targetDate);
   targetDateEnd.setHours(23, 59, 59, 999);
   const targetTimestampMs = targetDateEnd.getTime(); // 毫秒级时间戳
   ```

3. **过滤条件**：
   ```typescript
   // 过滤出目标日期及之前的数据（timestamp <= targetTimestamp）
   return itemTimestampMs <= targetTimestampMs;
   ```

### 4.2 数据获取参数

**SPX配置**：
```typescript
{
  stockId: '200003',
  marketId: '2',
  marketCode: '24',
  instrumentType: '6',
  subInstrumentType: '6001',
}
```

**USD Index配置**：
```typescript
{
  stockId: '72000025',
  marketId: '11',
  marketCode: '121',
  instrumentType: '10',
  subInstrumentType: '10001',
}
```

**BTC配置**：
```typescript
{
  stockId: '12000015',
  marketId: '11',
  marketCode: '121',
  instrumentType: '11',
  subInstrumentType: '11001',
}
```

### 4.3 请求参数格式

**日K数据请求**：
```typescript
{
  stockId: Number(stockId),
  marketType: Number(marketId),
  type: 2,  // 日K数据
  marketCode: Number(marketCode),
  instrumentType: Number(instrumentType),
  subInstrumentType: Number(subInstrumentType),
  _: timestamp,  // 当前时间戳
}
```

**分时数据请求**：
```typescript
{
  stockId: Number(stockId),
  marketType: Number(marketId),
  type: 1,  // 分时数据
  marketCode: Number(marketCode),
  instrumentType: Number(instrumentType),
  subInstrumentType: Number(subInstrumentType),
  _: timestamp,  // 当前时间戳
}
```

---

## 5. 已知问题和限制

### 5.1 分时数据不支持历史日期 ⚠️

**问题**：
- `get-quote-minute` API只返回最新分时数据
- 无法获取历史某个时间点的分时数据

**影响**：
- 回测中分时数据为空
- 但分时数据是可选的，不影响回测功能

**可能的解决方案**：

1. **研究其他API**：
   - 检查Moomoo API文档，看是否有历史分时数据接口
   - 或是否有其他参数可以指定日期

2. **使用日K数据替代**：
   - 回测中不使用分时数据
   - 只使用日K数据进行策略计算

3. **数据预处理**：
   - 如果分时数据对策略很重要，可以考虑预先获取并存储
   - 但会增加存储成本和复杂度

### 5.2 数据量限制

**当前实现**：
- 最多获取1000条数据（API限制）
- 从目标日期到今天的天数 + 100条缓冲

**潜在问题**：
- 如果回测日期范围很长（如1年），可能无法获取足够的历史数据
- 需要确保 `requestCount` 计算正确

### 5.3 时间戳格式不一致

**问题**：
- API返回的时间戳可能是秒级或毫秒级
- 需要统一处理

**当前处理**：
- `filterDataBeforeDate()` 中判断时间戳单位
- 统一转换为毫秒级进行比较

---

## 6. 测试验证

### 6.1 测试脚本

创建测试脚本验证历史数据获取：

```typescript
// test-historical-market-data.ts
import marketDataService from './src/services/market-data.service';

const targetDate = new Date('2025-11-14');
targetDate.setHours(23, 59, 59, 999);

// 测试获取历史市场数据
const historicalData = await marketDataService.getHistoricalMarketData(
  targetDate, 
  100, 
  true  // includeIntraday
);

console.log('SPX历史数据:', historicalData.spx?.length);
console.log('USD Index历史数据:', historicalData.usdIndex?.length);
console.log('BTC历史数据:', historicalData.btc?.length);
```

### 6.2 测试结果

**日K数据**：✅ 正常
- SPX：100条
- USD Index：100条
- BTC：100条

**分时数据**：❌ 不支持历史日期
- USD Index分时：0条（全部被过滤）
- BTC分时：0条（全部被过滤）

---

## 7. 后续优化建议

### 7.1 短期优化

1. **文档化API限制**：
   - 明确说明分时数据不支持历史日期
   - 在代码中添加注释说明

2. **优化错误处理**：
   - 当分时数据为空时，给出明确的提示
   - 不影响回测功能，但需要用户了解

3. **添加数据验证**：
   - 验证获取的数据是否在预期范围内
   - 验证时间戳是否正确

### 7.2 长期优化

1. **研究历史分时数据获取方案**：
   - 检查Moomoo API文档
   - 或考虑使用其他数据源

2. **数据缓存策略**：
   - 如果历史数据获取成本高，可以考虑缓存
   - 但需要注意缓存失效和存储成本

3. **数据预处理**：
   - 如果分时数据对策略很重要，可以考虑预先获取并存储
   - 但会增加系统复杂度

---

## 8. 相关文档

- [回测逻辑修复PRD](./251212-BACKTEST_LOGIC_FIX_PRD.md)
- [Moomoo边缘函数集成指南](../integration/251212-MOOMOO_EDGE_FUNCTION_INTEGRATION.md)
- [Moomoo边缘函数README](../../edge-functions/README.md)

---

## 9. 更新记录

| 版本 | 日期 | 更新内容 | 作者 |
|------|------|----------|------|
| v1.0 | 2025-12-14 | 初始版本，记录当前实现和问题 | AI Product Manager |

---

**文档状态**：待研究优化  
**下一步行动**：研究历史分时数据获取方案，优化数据获取逻辑

