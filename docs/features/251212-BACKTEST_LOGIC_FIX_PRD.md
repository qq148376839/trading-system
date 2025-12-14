# 回测逻辑修复需求文档（PRD）

## 📋 文档信息
- **文档版本**：v1.3
- **创建时间**：2025-12-12
- **最后更新**：2025-12-14
- **文档作者**：AI Product Manager
- **审核状态**：部分完成
- **优先级**：🔴 P0 - 立即修复

---

## 1. 背景与目标

### 1.1 业务背景

回测功能是量化交易系统的核心功能之一，用于验证策略的历史表现，帮助评估策略优化效果和参数调整。当前回测功能存在两个严重问题：

1. **回测逻辑与实际交易逻辑不一致**：回测中的买入卖出逻辑没有正确参照实际项目使用的买入、卖出逻辑，导致回测结果不可信
2. **Docker部署后性能问题**：回测在Docker环境中运行很久仍无法完成，即使是一个月的回测周期也无法完成

### 1.2 用户痛点

- **回测结果不可信**：用户无法依赖回测结果评估策略效果，可能导致错误的策略决策
- **回测功能不可用**：Docker部署后回测功能基本无法使用，严重影响用户体验
- **时间成本高**：回测运行时间过长，用户需要等待很久才能看到结果

### 1.3 业务目标

- **主要目标**：修复回测逻辑，确保回测结果与实际交易逻辑一致，提升回测结果的可信度
- **次要目标**：优化回测性能，确保Docker环境下回测能够正常完成，提升用户体验
- **成功指标**：
  - 回测逻辑与实际交易逻辑一致性 ≥ 95%
  - Docker环境下1个月回测周期完成时间 ≤ 5分钟
  - 回测成功率 ≥ 98%（排除数据获取失败等外部因素）

### 1.4 项目范围

- **包含范围**：
  - 修复回测买入逻辑，参照实际交易的买入流程
  - 修复回测卖出逻辑，参照实际交易的卖出流程
  - 优化回测性能，添加进度监控和超时机制
  - 添加回测日志和错误处理
- **不包含范围**：
  - 回测可视化优化（后续迭代）
  - 回测参数优化功能（后续迭代）
  - 回测结果对比分析（后续迭代）

---

## 2. 用户与场景

### 2.1 目标用户

- **主要用户**：量化交易策略开发者、系统管理员
- **用户特征**：需要频繁使用回测功能验证策略效果，对回测结果的准确性要求高

### 2.2 使用场景

**场景1：策略回测验证**
- **用户**：策略开发者
- **时间**：策略开发完成后
- **地点**：开发环境或生产环境
- **行为**：使用回测功能验证策略的历史表现，评估策略优化效果
- **目标**：获得可信的回测结果，用于策略决策

**场景2：Docker环境回测**
- **用户**：系统管理员
- **时间**：Docker部署后
- **地点**：生产环境
- **行为**：在Docker环境中执行回测，等待回测结果
- **目标**：回测能够正常完成，在合理时间内获得结果

### 2.3 用户故事

- As a 策略开发者, I want 回测逻辑与实际交易逻辑一致, So that 回测结果能够准确反映策略的真实表现
- As a 系统管理员, I want 回测在Docker环境中能够正常完成, So that 回测功能能够正常使用
- As a 策略开发者, I want 回测有进度监控和日志输出, So that 能够了解回测执行状态和问题

---

## 3. 问题分析

### 3.1 问题1：回测逻辑与实际交易逻辑不一致 ⚠️ **最严重**

#### 3.1.1 问题描述

回测中的买入卖出逻辑没有正确参照实际项目使用的买入、卖出逻辑，导致回测结果不可信。

#### 3.1.2 问题定位

**买入逻辑差异**：

| 维度 | 回测逻辑（backtest.service.ts） | 实际交易逻辑（strategy-scheduler.service.ts + basic-execution.service.ts） |
|------|-------------------------------|---------------------------------------------------------------------------|
| **资金计算** | 固定使用10%资金：`currentCapital * 0.1` | 动态计算：`Math.min(availableCapital, maxPositionPerSymbol)` |
| **数量计算** | `Math.floor(tradeAmount / price)` | `Math.floor(maxAmountForThisSymbol / intent.entryPrice)` |
| **价格验证** | ❌ 无价格验证 | ✅ 价格验证（偏差超过5%拒绝） |
| **持仓检查** | ❌ 无持仓检查 | ✅ 检查是否已有持仓，避免重复买入 |
| **资金申请** | ❌ 无资金申请流程 | ✅ 资金申请和分配流程 |
| **价格格式化** | ❌ 无价格格式化 | ✅ 根据市场类型格式化价格（美股2位，港股3位） |
| **订单提交** | ❌ 直接模拟成交 | ✅ 提交订单到交易所，等待成交 |

**卖出逻辑差异**：

| 维度 | 回测逻辑（backtest.service.ts） | 实际交易逻辑（strategy-scheduler.service.ts + basic-execution.service.ts） |
|------|-------------------------------|---------------------------------------------------------------------------|
| **止损止盈** | 使用买入时保存的止损止盈 | ✅ 动态调整止损止盈（基于ATR和市场环境） |
| **价格验证** | ❌ 无价格验证 | ✅ 价格验证（偏差超过20%拒绝） |
| **持仓验证** | ❌ 无持仓验证 | ✅ 验证可用持仓，避免卖空 |
| **订单提交** | ❌ 直接模拟成交 | ✅ 提交订单到交易所，等待成交 |

#### 3.1.3 业务影响

- 🔴 **回测结果不可信**：回测结果无法反映实际交易表现，用户无法依赖回测结果做决策
- 🔴 **策略评估错误**：基于错误的回测结果，用户可能做出错误的策略决策
- 🔴 **用户信任危机**：回测功能不可信，严重影响用户对系统的信任

#### 3.1.4 根本原因

1. **回测实现简化**：回测实现时为了简化逻辑，没有参照实际交易的完整流程
2. **缺乏代码复用**：回测逻辑和实际交易逻辑没有复用相同的代码，导致逻辑不一致
3. **缺乏验证机制**：没有机制验证回测逻辑与实际交易逻辑的一致性

### 3.2 问题2：回测完成但无交易数据 ⚠️ **新发现**

#### 3.2.1 问题描述

通过日志发现，回测实际上已经完成（状态为 `COMPLETED`），但是没有任何交易数据（`total_trades = 0`，所有指标都是0），从外部看误以为回测没有完成。

#### 3.2.2 问题定位

**可能原因分析**：

1. **策略未生成买入信号**：
   - 策略逻辑可能没有生成任何买入信号
   - 市场条件不满足策略的买入条件
   - 策略参数设置不合理

2. **买入逻辑问题导致无法买入**：
   - 价格验证太严格，所有订单都被拒绝（偏差超过5%）
   - 资金计算有问题，导致可用资金为0或不足
   - 持仓检查逻辑错误，误判为已有持仓
   - 数量计算错误，导致数量为0

3. **数据获取问题**：
   - K线数据获取失败或为空
   - 日期范围过滤有问题，导致没有有效数据
   - 数据格式转换错误

4. **日志不足导致无法诊断**：
   - 没有记录为什么没有生成买入信号
   - 没有记录为什么买入被拒绝
   - 没有记录数据获取的详细情况

#### 3.2.3 业务影响

- 🔴 **用户困惑**：回测显示完成但数据全为0，用户不知道是策略问题还是系统问题
- 🔴 **无法诊断**：缺乏日志导致无法定位问题原因
- 🔴 **功能不可用**：用户无法获得有效的回测结果

#### 3.2.4 根本原因

1. **缺乏诊断日志**：回测过程中没有记录关键步骤的执行情况
2. **缺乏数据验证**：没有验证数据获取是否成功、策略是否生成信号
3. **缺乏状态区分**：没有区分"回测完成但无交易"和"回测未完成"的状态

### 3.3 问题3：Docker环境下回测性能问题 ⚠️

#### 3.3.1 问题描述

部署到Docker上后，回测后台运行了很久，还是没有出来结果，回测周期只有一个月的也出不来。

**注意**：结合问题2，可能回测已经完成但无交易数据，导致误以为回测未完成。

#### 3.3.2 问题定位

**性能问题分析**：

1. **API调用频率限制**：
   - 回测需要获取大量历史K线数据
   - Longbridge API有频率限制，可能导致请求被限流
   - 没有实现请求重试和退避机制

2. **异步执行缺乏监控**：
   - 回测是异步执行的，但没有进度监控
   - 无法了解回测执行状态，用户不知道是否卡住
   - 没有超时机制，可能导致回测无限期运行

3. **数据获取效率低**：
   - 每个标的都需要单独获取历史数据
   - 没有批量获取或缓存机制
   - 数据获取失败时没有重试机制

4. **日志输出不足**：
   - 回测执行过程中日志输出不足
   - 无法定位性能瓶颈
   - 错误信息不够详细

#### 3.3.3 业务影响

- 🟠 **功能不可用**：Docker环境下回测功能基本无法使用
- 🟠 **用户体验差**：用户需要等待很久，不知道回测是否在执行
- 🟠 **资源浪费**：回测长时间运行占用系统资源

#### 3.3.4 根本原因

1. **缺乏性能优化**：回测实现时没有考虑性能优化
2. **缺乏监控机制**：没有进度监控和超时机制
3. **缺乏错误处理**：API调用失败时没有完善的错误处理和重试机制

---

### 3.4 问题2：回测使用实时数据而非历史数据 ⚠️ **最严重**（新发现）

#### 3.4.1 问题描述

回测中策略生成信号时使用的是**实时市场数据**（SPX、USD、BTC等），而不是回测日期对应的**历史市场数据**，导致回测结果完全不可信。

#### 3.4.2 问题定位

**诊断日志分析**（回测ID=2，策略ID=3，2025-11-14至2025-12-14）：
- ✅ 数据获取成功：20个标的，每个20条K线数据
- ✅ 信号生成：400个信号（20天 × 20个标的）
- ❌ **没有任何 BUY 信号**：只有 SELL 信号和 null 信号
- ❌ **买入尝试数：0**：因为只有 `action === 'BUY'` 时才会尝试买入
- ❌ **买入成功数：0**

**代码分析**：

```typescript
// backtest.service.ts:269
const intent = await strategy.generateSignal(symbol, undefined);

// recommendation-strategy.ts:21
const recommendation = await tradingRecommendationService.calculateRecommendation(symbol);

// trading-recommendation.service.ts:70
const marketData = await marketDataCacheService.getMarketData(100, true);
```

**问题根源**：
1. `RecommendationStrategy.generateSignal()` 调用 `tradingRecommendationService.calculateRecommendation()`
2. `calculateRecommendation()` 总是获取**实时市场数据**（通过 `marketDataCacheService.getMarketData()`）
3. 回测中需要的是**历史某个时间点的市场数据**，而不是当前时间的数据
4. 因此策略在回测时看到的都是"当前"的市场状态，而不是历史状态

**影响**：
- 策略基于当前市场条件判断，而不是历史市场条件
- 如果当前市场不满足买入条件，回测中永远不会生成 BUY 信号
- 回测结果完全不可信，无法反映策略的历史表现

#### 3.4.3 业务影响

- 🔴 **回测功能完全失效**：回测结果完全不可信，无法用于策略评估
- 🔴 **用户信任度下降**：用户发现回测结果与实际不符，对系统失去信任
- 🔴 **策略优化受阻**：无法通过回测验证策略优化效果

#### 3.4.4 根本原因

1. **架构设计问题**：`tradingRecommendationService` 设计为实时服务，不支持历史数据
2. **回测实现缺陷**：回测直接调用实时服务，没有考虑历史数据需求
3. **缺乏历史数据服务**：没有专门的历史市场数据获取服务

#### 3.4.5 解决方案

**方案1：修改 `tradingRecommendationService` 支持历史数据**（推荐）
- 修改 `calculateRecommendation()` 方法，支持传入历史日期参数
- 修改 `getMarketData()` 方法，支持获取指定日期的历史市场数据
- 回测中传入历史日期，获取对应的历史市场数据

**方案2：创建历史数据推荐服务**
- 创建 `HistoricalTradingRecommendationService`，专门用于回测
- 基于历史K线数据计算推荐，不依赖实时市场数据
- 简化逻辑，只使用股票K线数据，不使用SPX/USD/BTC等市场数据

**方案3：回测中使用简化的信号生成逻辑**
- 回测中不调用 `tradingRecommendationService`
- 基于历史K线数据直接计算技术指标（如RSI、MACD等）
- 根据技术指标生成买入/卖出信号

**推荐方案**：方案1，因为：
- 保持回测逻辑与实际交易逻辑一致
- 充分利用现有的推荐服务逻辑
- 只需要扩展现有服务，不需要重写

---

## 4. 功能需求

### 4.1 功能概览

| 功能 | 优先级 | 说明 |
|------|--------|------|
| **修复回测数据问题** | **P0** | **回测使用历史数据而非实时数据，确保策略基于历史市场条件生成信号** |
| 修复回测买入逻辑 | P0 | 参照实际交易的买入流程，包括资金计算、数量计算、价格验证等 |
| 修复回测卖出逻辑 | P0 | 参照实际交易的卖出流程，包括止损止盈、价格验证、持仓验证等 |
| 添加回测进度监控 | P1 | 添加进度监控，实时显示回测执行状态 |
| 优化回测性能 | P1 | 优化数据获取效率，添加请求重试和退避机制 |
| 添加回测超时机制 | P1 | 添加超时机制，避免回测无限期运行 |
| 添加回测日志 | P1 | 添加详细的日志输出，便于问题定位 |

### 4.2 功能详细说明

#### 功能0：修复回测数据问题（新增，最高优先级）
**优先级**：P0

**功能描述**：
修复回测中使用实时数据而非历史数据的问题，确保策略基于历史市场条件生成信号。

**实现方案**：

1. **修改 `tradingRecommendationService.calculateRecommendation()` 支持历史数据**：
   ```typescript
   async calculateRecommendation(
     symbol: string,
     targetDate?: Date  // 新增：目标日期，如果提供则使用历史数据
   ): Promise<TradingRecommendation>
   ```

2. **修改 `marketDataCacheService.getMarketData()` 支持历史数据**：
   ```typescript
   async getMarketData(
     count: number,
     includeIntraday: boolean,
     targetDate?: Date  // 新增：目标日期
   ): Promise<MarketData>
   ```

3. **实现历史市场数据获取**：
   - 获取指定日期的SPX历史K线数据
   - 获取指定日期的USD Index历史K线数据
   - 获取指定日期的BTC历史K线数据
   - 确保数据截止到目标日期，不包含未来数据

4. **修改回测逻辑**：
   ```typescript
   // backtest.service.ts
   const intent = await strategy.generateSignal(symbol, {
     targetDate: currentDate,  // 传入当前回测日期
     historicalCandlesticks: candlesticks  // 传入历史K线数据
   });
   ```

5. **修改 `RecommendationStrategy.generateSignal()` 支持历史数据**：
   ```typescript
   async generateSignal(
     symbol: string,
     marketData?: any,
     targetDate?: Date  // 新增：目标日期
   ): Promise<TradingIntent | null>
   ```

**技术细节**：

- **历史数据获取**：
  - 使用 Longbridge API 获取历史K线数据
  - 确保数据截止到目标日期（不包含未来数据）
  - 缓存历史数据，避免重复请求

- **数据一致性**：
  - 确保所有市场数据（SPX、USD、BTC）都使用相同的目标日期
  - 确保股票K线数据也使用相同的目标日期
  - 避免使用未来数据（look-ahead bias）

- **性能优化**：
  - 批量获取历史数据，减少API调用
  - 缓存历史数据，避免重复计算
  - 并行获取多个市场数据

**验收标准**：
- [ ] 回测中使用历史市场数据，而非实时数据
- [ ] 策略基于历史市场条件生成信号
- [ ] 回测能够生成 BUY 信号（如果历史市场条件满足）
- [ ] 回测结果反映策略的历史表现
- [ ] 数据截止到目标日期，不包含未来数据

#### 功能1：修复回测买入逻辑
**优先级**：P0

**功能描述**：
修复回测买入逻辑，参照实际交易的买入流程，确保回测结果与实际交易逻辑一致。

**实现方案**：

1. **资金计算逻辑**：
   - 参照 `strategy-scheduler.service.ts` 的资金计算逻辑
   - 使用 `capitalManager.getAvailableCapital()` 获取可用资金
   - 使用 `capitalManager.getMaxPositionPerSymbol()` 获取标的级限制
   - 计算数量：`Math.min(availableCapital, maxPositionPerSymbol) / entryPrice`

2. **价格验证**：
   - 参照 `basic-execution.service.ts` 的价格验证逻辑
   - 验证买入价格与市场价格的偏差（超过5%拒绝）
   - 记录价格验证日志

3. **持仓检查**：
   - 参照 `strategy-scheduler.service.ts` 的持仓检查逻辑
   - 检查是否已有持仓，避免重复买入
   - 检查是否有未成交订单

4. **价格格式化**：
   - 参照 `basic-execution.service.ts` 的价格格式化逻辑
   - 美股：保留2位小数
   - 港股：保留3位小数

**验收标准**：
- [ ] 回测买入逻辑与实际交易逻辑一致
- [ ] 资金计算逻辑正确
- [ ] 价格验证逻辑正确
- [ ] 持仓检查逻辑正确
- [ ] 价格格式化逻辑正确

#### 功能2：修复回测卖出逻辑
**优先级**：P0

**功能描述**：
修复回测卖出逻辑，参照实际交易的卖出流程，确保回测结果与实际交易逻辑一致。

**实现方案**：

1. **止损止盈逻辑**：
   - 参照 `strategy-scheduler.service.ts` 的止损止盈逻辑
   - 使用动态止损止盈（基于ATR和市场环境）
   - 保存买入时的止损止盈，但允许动态调整

2. **价格验证**：
   - 参照 `basic-execution.service.ts` 的价格验证逻辑
   - 验证卖出价格与市场价格的偏差（超过20%拒绝）
   - 记录价格验证日志

3. **持仓验证**：
   - 参照 `basic-execution.service.ts` 的持仓验证逻辑
   - 验证可用持仓，避免卖空
   - 检查未成交卖出订单占用

**验收标准**：
- [ ] 回测卖出逻辑与实际交易逻辑一致
- [ ] 止损止盈逻辑正确
- [ ] 价格验证逻辑正确
- [ ] 持仓验证逻辑正确

#### 功能3：添加回测进度监控
**优先级**：P1

**功能描述**：
添加回测进度监控，实时显示回测执行状态，提升用户体验。

**实现方案**：

1. **进度计算**：
   - 计算已处理日期数 / 总日期数
   - 计算已处理标的数 / 总标的数
   - 计算预计剩余时间

2. **进度更新**：
   - 每处理10%进度更新一次数据库
   - 提供API接口查询回测进度
   - 前端可以轮询查询进度

3. **状态显示**：
   - 显示当前处理的日期和标的
   - 显示已完成的交易数
   - 显示预计剩余时间

**验收标准**：
- [ ] 回测进度能够实时更新
- [ ] 前端能够查询回测进度
- [ ] 进度信息准确可靠

#### 功能4：优化回测性能
**优先级**：P1

**功能描述**：
优化回测性能，确保Docker环境下回测能够正常完成。

**实现方案**：

1. **数据获取优化**：
   - 批量获取历史数据，减少API调用次数
   - 添加数据缓存机制，避免重复获取
   - 使用并发请求，提高数据获取效率

2. **请求重试机制**：
   - 添加请求重试机制，处理API频率限制
   - 实现指数退避策略，避免频繁重试
   - 记录重试日志，便于问题定位

3. **性能监控**：
   - 记录每个步骤的执行时间
   - 识别性能瓶颈
   - 输出性能报告

**验收标准**：
- [ ] Docker环境下1个月回测周期完成时间 ≤ 5分钟
- [ ] API调用失败时有重试机制
- [ ] 性能监控数据准确

#### 功能5：添加回测超时机制
**优先级**：P1

**功能描述**：
添加回测超时机制，避免回测无限期运行。

**实现方案**：

1. **超时设置**：
   - 根据回测时间范围设置超时时间
   - 默认超时时间：回测天数 * 1分钟（最少5分钟，最多30分钟）
   - 允许用户自定义超时时间

2. **超时处理**：
   - 超时后停止回测执行
   - 更新回测状态为 `FAILED`
   - 记录超时错误信息

3. **超时通知**：
   - 记录超时日志
   - 返回超时错误信息给用户

**验收标准**：
- [ ] 回测超时后能够正确停止
- [ ] 超时错误信息准确
- [ ] 超时时间设置合理

#### 功能6：添加诊断日志（新增）
**优先级**：P0

**功能描述**：
添加详细的诊断日志，记录为什么没有交易数据，帮助定位问题。

**实现方案**：

1. **信号生成日志**：
   - 记录每个日期是否调用策略生成信号
   - 记录策略返回的信号结果（BUY/SELL/HOLD）
   - 记录信号生成失败的原因
   - 记录信号生成的总次数和成功次数

2. **买入尝试日志**：
   - 记录每次买入尝试的详细信息
   - 记录买入被拒绝的原因（价格偏差、资金不足、持仓检查等）
   - 记录买入成功的详细信息（价格、数量、成本等）
   - 统计买入尝试次数、成功次数、失败次数及失败原因分布

3. **数据获取日志**：
   - 记录每个标的的数据获取情况
   - 记录获取到的K线数据条数
   - 记录数据过滤后的有效数据条数
   - 记录数据获取失败的原因

4. **资金计算日志**：
   - 记录每次买入时的资金计算过程
   - 记录可用资金、标的级限制、计算出的数量
   - 记录资金不足的情况

5. **日志存储**：
   - 日志存储到数据库（backtest_results表的`diagnostic_log`字段）
   - 提供API接口查询诊断日志
   - 前端显示诊断日志，帮助用户理解为什么没有交易数据

**验收标准**：
- [ ] 能够清楚看到为什么没有交易数据
- [ ] 能够看到信号生成情况
- [ ] 能够看到买入尝试和失败原因
- [ ] 能够看到数据获取情况
- [ ] 诊断日志能够帮助用户理解问题

#### 功能7：添加回测日志
**优先级**：P1

**功能描述**：
添加详细的回测日志，便于问题定位和性能分析。

**实现方案**：

1. **日志级别**：
   - INFO：回测开始、结束、关键步骤
   - DEBUG：详细执行过程
   - WARN：警告信息（价格偏差、数据缺失等）
   - ERROR：错误信息

2. **日志内容**：
   - 回测配置信息
   - 数据获取状态
   - 交易执行状态
   - 性能指标

3. **日志存储**：
   - 日志存储到数据库（backtest_results表）
   - 提供API接口查询日志
   - 支持日志导出

**验收标准**：
- [ ] 回测日志详细完整
- [ ] 日志能够帮助定位问题
- [ ] 日志查询接口正常

---

## 5. 非功能需求

### 5.1 性能要求

- **回测完成时间**：
  - Docker环境下1个月回测周期完成时间 ≤ 5分钟
  - Docker环境下3个月回测周期完成时间 ≤ 15分钟
  - Docker环境下6个月回测周期完成时间 ≤ 30分钟

- **API调用效率**：
  - 数据获取失败重试次数 ≤ 3次
  - 请求重试间隔：指数退避（1s, 2s, 4s）

### 5.2 可靠性要求

- **回测成功率**：≥ 98%（排除数据获取失败等外部因素）
- **数据一致性**：回测逻辑与实际交易逻辑一致性 ≥ 95%
- **错误处理**：API调用失败时有完善的错误处理和重试机制

### 5.3 可维护性要求

- **代码复用**：回测逻辑和实际交易逻辑复用相同的代码
- **日志完善**：详细的日志输出，便于问题定位
- **文档完善**：更新回测功能使用指南和技术文档

---

## 6. 技术方案

### 6.1 架构设计

**核心原则**：
1. **代码复用**：回测逻辑和实际交易逻辑复用相同的服务类
2. **抽象层设计**：创建抽象的执行器接口，回测和实际交易都实现该接口
3. **性能优化**：批量获取数据，添加缓存和重试机制

**架构图**：

```
回测服务 (backtest.service.ts)
    ↓
抽象执行器接口 (ExecutionAdapter)
    ↓
实际交易执行器 (BasicExecutionService) ← 回测模拟执行器 (BacktestExecutionAdapter)
    ↓
策略服务 (StrategyService)
    ↓
资金管理服务 (CapitalManager)
```

### 6.2 实现方案

#### 方案1：创建回测执行适配器（推荐）

**优点**：
- 代码复用率高，回测和实际交易使用相同的业务逻辑
- 维护成本低，修改实际交易逻辑时回测逻辑自动同步
- 测试覆盖率高，可以复用实际交易的测试用例

**缺点**：
- 需要重构现有代码，工作量较大
- 需要设计良好的抽象接口

**实现步骤**：
1. 创建 `ExecutionAdapter` 抽象接口
2. 将 `BasicExecutionService` 改造为实际交易执行器
3. 创建 `BacktestExecutionAdapter` 实现回测模拟执行
4. 修改回测服务使用 `BacktestExecutionAdapter`

#### 方案2：直接修改回测逻辑（快速修复）

**优点**：
- 实现简单，工作量小
- 可以快速修复问题

**缺点**：
- 代码重复，维护成本高
- 回测逻辑和实际交易逻辑可能再次不一致

**实现步骤**：
1. 直接修改 `backtest.service.ts` 的买入卖出逻辑
2. 参照实际交易逻辑实现相同的验证和计算逻辑
3. 添加性能优化和监控

**推荐方案**：方案1（创建回测执行适配器）

虽然工作量较大，但长期来看更有利于代码维护和一致性保证。

### 6.3 性能优化方案

1. **数据获取优化**：
   - 批量获取历史数据（一次获取多个标的）
   - 添加数据缓存（相同标的的历史数据缓存）
   - 使用并发请求（限制并发数，避免频率限制）

2. **请求重试机制**：
   - 实现指数退避策略
   - 记录重试次数和原因
   - 超过最大重试次数后标记为失败

3. **进度监控**：
   - 每处理10%进度更新一次数据库
   - 提供轻量级API查询进度
   - 前端轮询间隔：2秒

---

## 7. 风险评估

### 7.1 技术风险

**风险1：代码重构风险**
- **风险**：重构现有代码可能引入新的bug
- **影响**：高（可能影响实际交易功能）
- **应对**：
  - 充分测试重构后的代码
  - 保留原有代码作为备份
  - 分阶段重构，逐步迁移

**风险2：性能优化风险**
- **风险**：性能优化可能引入新的问题（如并发问题）
- **影响**：中（可能影响回测性能）
- **应对**：
  - 充分测试性能优化方案
  - 添加性能监控和日志
  - 逐步优化，避免一次性改动过大

### 7.2 业务风险

**风险1：回测结果变化**
- **风险**：修复回测逻辑后，回测结果可能发生变化
- **影响**：中（用户可能需要重新评估策略）
- **应对**：
  - 明确告知用户回测逻辑已修复
  - 提供回测结果对比功能
  - 更新回测功能使用指南

**风险2：Docker环境兼容性**
- **风险**：性能优化可能在Docker环境中失效
- **影响**：中（可能无法解决Docker环境问题）
- **应对**：
  - 在Docker环境中充分测试
  - 添加Docker环境特定的优化
  - 提供Docker环境故障排查指南

---

## 8. 迭代计划

### 8.1 MVP范围（Phase 1）

**目标**：修复回测逻辑，确保回测结果与实际交易逻辑一致

**包含功能**：
1. ✅ 修复回测买入逻辑（资金计算、数量计算、价格验证、持仓检查）
2. ✅ 修复回测卖出逻辑（止损止盈、价格验证、持仓验证）
3. ✅ 添加基础日志输出

**预计时间**：1-2周

### 8.2 性能优化（Phase 2）

**目标**：优化回测性能，确保Docker环境下回测能够正常完成

**包含功能**：
1. ✅ 添加回测进度监控
2. ✅ 优化数据获取效率
3. ✅ 添加请求重试机制
4. ✅ 添加回测超时机制

**预计时间**：1-2周

### 8.3 长期优化（Phase 3）

**目标**：持续优化回测功能和用户体验

**包含功能**：
1. 回测可视化优化
2. 回测参数优化功能
3. 回测结果对比分析
4. 回测性能报告

**预计时间**：持续优化

---

## 9. 验收标准

### 9.1 功能验收

- [ ] 回测买入逻辑与实际交易逻辑一致（资金计算、数量计算、价格验证、持仓检查）
- [ ] 回测卖出逻辑与实际交易逻辑一致（止损止盈、价格验证、持仓验证）
- [ ] 诊断日志能够清楚显示为什么没有交易数据（信号生成、买入尝试、失败原因等）
- [ ] 回测完成但无交易数据时，能够通过诊断日志定位原因
- [ ] Docker环境下1个月回测周期完成时间 ≤ 5分钟
- [ ] 回测成功率 ≥ 98%
- [ ] 回测进度能够实时查询
- [ ] 回测超时机制正常工作
- [ ] 回测日志详细完整

### 9.2 性能验收

- [ ] Docker环境下1个月回测周期完成时间 ≤ 5分钟
- [ ] Docker环境下3个月回测周期完成时间 ≤ 15分钟
- [ ] API调用失败时有重试机制
- [ ] 数据获取效率提升 ≥ 50%

### 9.3 质量验收

- [ ] 代码覆盖率 ≥ 80%
- [ ] 所有测试用例通过
- [ ] 代码审查通过
- [ ] 文档更新完成

---

## 10. 附录

### 10.1 相关文档

- [回测功能实施计划](250101-BACKTEST_FEATURE_PLAN.md)
- [回测功能使用指南](250101-BACKTEST_USAGE_GUIDE.md)
- [策略逻辑审查](../technical/251202-STRATEGY_LOGIC_REVIEW.md)
- [严重问题分析报告](../fixes/251208-PRODUCT_CRITICAL_ISSUES_ANALYSIS.md)

### 10.2 代码参考

- `api/src/services/backtest.service.ts` - 回测服务
- `api/src/services/basic-execution.service.ts` - 实际交易执行服务
- `api/src/services/strategy-scheduler.service.ts` - 策略调度服务
- `api/src/services/capital-manager.service.ts` - 资金管理服务

### 10.3 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-12 | 初始版本 | AI Product Manager |

---

## 11. 具体开发实现细节

### 11.1 Phase 1: 修复回测买入逻辑

#### 11.1.1 修改 `simulateBuy` 方法

**文件位置**：`api/src/services/backtest.service.ts`

**当前代码**（第388-433行）：
```typescript
private simulateBuy(
  symbol: string,
  date: string,
  price: number,
  reason: string,
  currentCapital: number,
  positions: Map<string, BacktestTrade>,
  stopLoss: number,
  takeProfit: number,
  onCapitalChange: (amount: number) => void
): boolean {
  if (positions.has(symbol)) {
    return false;
  }

  const tradeAmount = currentCapital * 0.1;  // ❌ 固定10%资金
  const quantity = Math.floor(tradeAmount / price);

  if (quantity <= 0) {
    return false;
  }

  const actualCost = price * quantity;
  // ... 创建交易记录
}
```

**修改方案**：

1. **添加资金管理服务依赖**：
```typescript
import capitalManager from './capital-manager.service';
import { detectMarket } from '../utils/order-validation';
```

2. **修改 `simulateBuy` 方法签名**，添加 `strategyId` 参数：
```typescript
private simulateBuy(
  symbol: string,
  date: string,
  price: number,
  reason: string,
  currentCapital: number,
  positions: Map<string, BacktestTrade>,
  stopLoss: number,
  takeProfit: number,
  strategyId: number,  // ✅ 新增参数
  onCapitalChange: (amount: number) => void
): boolean {
```

3. **参照实际交易逻辑修改资金计算**：
```typescript
// ✅ 参照 strategy-scheduler.service.ts 第935-959行
// 获取可用资金（回测中使用模拟资金）
const availableCapital = currentCapital * 0.9; // 保留10%作为缓冲

// ✅ 获取标的级限制（从策略配置或使用默认值）
const maxPositionPerSymbol = await capitalManager.getMaxPositionPerSymbol(strategyId);
// 如果获取失败，使用默认值：可用资金的10%
const defaultMaxPosition = availableCapital * 0.1;
const maxPosition = maxPositionPerSymbol > 0 ? maxPositionPerSymbol : defaultMaxPosition;

// ✅ 使用标的级限制和可用资金中的较小值来计算数量
const maxAmountForThisSymbol = Math.min(availableCapital, maxPosition);
const maxAffordableQuantity = Math.floor(maxAmountForThisSymbol / price);
const quantity = Math.max(1, maxAffordableQuantity);

if (quantity <= 0) {
  logger.warn(`回测 ${symbol} ${date}: 计算数量失败，可用资金=${availableCapital.toFixed(2)}, 价格=${price.toFixed(2)}`);
  return false;
}
```

4. **添加价格验证**（参照 `basic-execution.service.ts` 第33-72行）：
```typescript
// ✅ 价格验证：验证买入价格与市场价格的偏差
// 回测中使用当前K线收盘价作为市场价格
const currentMarketPrice = price; // 回测中价格就是当前K线收盘价
const priceDeviation = Math.abs((price - currentMarketPrice) / currentMarketPrice) * 100;

// 偏差超过5%：拒绝订单
if (priceDeviation > 5) {
  logger.warn(`回测 ${symbol} ${date}: 买入价格偏差过大 (${priceDeviation.toFixed(2)}%)，跳过买入`);
  return false;
}

// 偏差在1%-5%之间：记录警告，但仍允许买入
if (priceDeviation > 1) {
  logger.warn(`回测 ${symbol} ${date}: 买入价格偏差较大 (${priceDeviation.toFixed(2)}%)`);
}
```

5. **添加价格格式化**（参照 `basic-execution.service.ts` 第508-521行）：
```typescript
// ✅ 格式化价格（根据市场确定小数位数）
const market = detectMarket(symbol);
let formattedPrice: number;

if (market === 'US') {
  // 美股：保留2位小数
  formattedPrice = Math.round(price * 100) / 100;
} else if (market === 'HK') {
  // 港股：保留3位小数
  formattedPrice = Math.round(price * 1000) / 1000;
} else {
  // 其他市场：保留2位小数
  formattedPrice = Math.round(price * 100) / 100;
}

// 使用格式化后的价格计算实际成本
const actualCost = formattedPrice * quantity;
```

6. **更新调用处**（第272行）：
```typescript
this.simulateBuy(
  symbol, 
  dateStr, 
  currentPrice, 
  intent.reason || 'BUY_SIGNAL', 
  currentCapital, 
  positions, 
  stopLoss,
  takeProfit,
  strategyId,  // ✅ 新增参数
  (amount) => {
    currentCapital += amount;
  }
);
```

#### 11.1.2 添加持仓检查逻辑

**在 `runBacktest` 方法中，买入前添加持仓检查**（第210行之前）：

```typescript
// ✅ 参照 strategy-scheduler.service.ts 第876-882行
// 检查是否已有持仓（避免重复买入）
if (positions.has(symbol)) {
  logger.log(`回测 ${symbol} ${dateStr}: 已有持仓，跳过买入`);
  continue; // 跳过这个标的，继续处理下一个
}

// ✅ 检查是否有未成交订单（回测中简化处理，直接检查positions）
// 实际交易中会检查 execution_orders 表，回测中positions已经包含了所有持仓
```

### 11.2 Phase 1: 修复回测卖出逻辑

#### 11.2.1 修改 `simulateSell` 方法

**文件位置**：`api/src/services/backtest.service.ts`

**当前代码**（第438-466行）：
```typescript
private simulateSell(
  symbol: string,
  date: string,
  price: number,
  reason: string,
  trade: BacktestTrade,
  positions: Map<string, BacktestTrade>,
  trades: BacktestTrade[],
  onCapitalChange: (amount: number) => void
): void {
  // ❌ 无价格验证
  // ❌ 无持仓验证
  const pnl = (price - trade.entryPrice) * trade.quantity;
  // ...
}
```

**修改方案**：

1. **添加价格验证**（参照 `basic-execution.service.ts` 第153-192行）：
```typescript
private simulateSell(
  symbol: string,
  date: string,
  price: number,
  reason: string,
  trade: BacktestTrade,
  positions: Map<string, BacktestTrade>,
  trades: BacktestTrade[],
  onCapitalChange: (amount: number) => void
): void {
  // ✅ 价格验证：验证卖出价格与市场价格的偏差
  const currentMarketPrice = price; // 回测中价格就是当前K线收盘价
  const priceDeviation = Math.abs((price - currentMarketPrice) / currentMarketPrice) * 100;

  // 偏差超过20%：拒绝订单
  if (priceDeviation > 20) {
    logger.warn(`回测 ${symbol} ${date}: 卖出价格偏差过大 (${priceDeviation.toFixed(2)}%)，跳过卖出`);
    return;
  }

  // 偏差在5%-20%之间：记录警告，但仍允许卖出
  if (priceDeviation > 5) {
    logger.warn(`回测 ${symbol} ${date}: 卖出价格偏差较大 (${priceDeviation.toFixed(2)}%)`);
  }

  // ✅ 持仓验证：验证可用持仓
  if (!positions.has(symbol)) {
    logger.warn(`回测 ${symbol} ${date}: 无持仓，无法卖出`);
    return;
  }

  const actualPosition = positions.get(symbol)!;
  if (actualPosition.quantity < trade.quantity) {
    logger.warn(`回测 ${symbol} ${date}: 持仓不足，请求卖出=${trade.quantity}, 实际持仓=${actualPosition.quantity}`);
    return;
  }

  // ✅ 价格格式化（参照买入逻辑）
  const market = detectMarket(symbol);
  let formattedPrice: number;
  if (market === 'US') {
    formattedPrice = Math.round(price * 100) / 100;
  } else if (market === 'HK') {
    formattedPrice = Math.round(price * 1000) / 1000;
  } else {
    formattedPrice = Math.round(price * 100) / 100;
  }

  // 使用格式化后的价格计算盈亏
  const pnl = (formattedPrice - trade.entryPrice) * trade.quantity;
  const pnlPercent = ((formattedPrice - trade.entryPrice) / trade.entryPrice) * 100;

  trade.exitDate = date;
  trade.exitPrice = formattedPrice;  // ✅ 使用格式化后的价格
  trade.pnl = pnl;
  trade.pnlPercent = pnlPercent;
  trade.exitReason = reason;

  // 卖出时：收回卖出资金 = 卖出价格 * 数量
  const sellAmount = formattedPrice * trade.quantity;  // ✅ 使用格式化后的价格
  onCapitalChange(sellAmount);
  trades.push({ ...trade });
  positions.delete(symbol);
}
```

### 11.3 Phase 2: 添加回测进度监控

#### 11.3.1 数据库迁移：添加进度字段

**创建迁移文件**：`api/migrations/013_add_backtest_progress.sql`

```sql
-- 添加回测进度字段
ALTER TABLE backtest_results 
ADD COLUMN IF NOT EXISTS progress_percent DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS progress_message TEXT,
ADD COLUMN IF NOT EXISTS processed_dates INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_dates INTEGER DEFAULT 0;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_backtest_results_progress ON backtest_results(progress_percent);

COMMENT ON COLUMN backtest_results.progress_percent IS '回测进度百分比 (0-100)';
COMMENT ON COLUMN backtest_results.progress_message IS '进度消息（当前处理的日期和标的）';
COMMENT ON COLUMN backtest_results.processed_dates IS '已处理日期数';
COMMENT ON COLUMN backtest_results.total_dates IS '总日期数';
```

#### 11.3.2 修改 `BacktestResult` 接口

**文件位置**：`api/src/services/backtest.service.ts`

```typescript
export interface BacktestResult {
  // ... 现有字段
  progressPercent?: number;  // ✅ 新增
  progressMessage?: string;   // ✅ 新增
  processedDates?: number;   // ✅ 新增
  totalDates?: number;       // ✅ 新增
}
```

#### 11.3.3 修改 `runBacktest` 方法，添加进度更新

**在 `runBacktest` 方法中**（第175行之后）：

```typescript
// ✅ 计算总日期数
const totalDates = sortedDates.length;
let processedDates = 0;

// ✅ 更新进度：开始回测
await this.updateBacktestProgress(id, {
  progressPercent: 0,
  progressMessage: `开始回测: ${symbols.join(',')}`,
  processedDates: 0,
  totalDates,
});

// 按日期遍历
for (const dateStr of sortedDates) {
  processedDates++;
  
  // ✅ 每处理10%进度更新一次
  const progressPercent = Math.floor((processedDates / totalDates) * 100);
  if (processedDates % Math.max(1, Math.floor(totalDates / 10)) === 0 || processedDates === totalDates) {
    await this.updateBacktestProgress(id, {
      progressPercent,
      progressMessage: `处理中: ${dateStr} (${processedDates}/${totalDates})`,
      processedDates,
      totalDates,
    });
  }

  // ... 现有处理逻辑
}

// ✅ 更新进度：完成回测
await this.updateBacktestProgress(id, {
  progressPercent: 100,
  progressMessage: `回测完成: 共处理 ${totalDates} 个交易日`,
  processedDates: totalDates,
  totalDates,
});
```

#### 11.3.4 添加 `updateBacktestProgress` 方法

**文件位置**：`api/src/services/backtest.service.ts`

```typescript
/**
 * 更新回测进度
 */
async updateBacktestProgress(
  id: number,
  progress: {
    progressPercent: number;
    progressMessage?: string;
    processedDates?: number;
    totalDates?: number;
  }
): Promise<void> {
  const query = `
    UPDATE backtest_results
    SET progress_percent = $1,
        progress_message = $2,
        processed_dates = COALESCE($3, processed_dates),
        total_dates = COALESCE($4, total_dates),
        updated_at = NOW()
    WHERE id = $5
  `;

  await pool.query(query, [
    progress.progressPercent,
    progress.progressMessage || null,
    progress.processedDates || null,
    progress.totalDates || null,
    id,
  ]);
}
```

#### 11.3.5 修改 `executeBacktestAsync` 方法，传递 `id` 参数

**文件位置**：`api/src/services/backtest.service.ts`

```typescript
async executeBacktestAsync(
  id: number,
  strategyId: number,
  symbols: string[],
  startDate: Date,
  endDate: Date,
  config?: any
): Promise<void> {
  try {
    await this.updateBacktestStatus(id, 'RUNNING');

    // ✅ 修改 runBacktest 方法签名，添加 id 参数用于进度更新
    const result = await this.runBacktest(id, strategyId, symbols, startDate, endDate, config);

    await this.updateBacktestResult(id, {
      ...result,
      id,
      strategyId,
      startDate: result.startDate,
      endDate: result.endDate,
    });

    logger.log(`回测任务 ${id} 完成`);
  } catch (error: any) {
    logger.error(`回测任务 ${id} 失败:`, error);
    await this.updateBacktestStatus(id, 'FAILED', error.message || '回测执行失败');
  }
}
```

**修改 `runBacktest` 方法签名**：

```typescript
async runBacktest(
  id: number,  // ✅ 新增参数，用于进度更新
  strategyId: number,
  symbols: string[],
  startDate: Date,
  endDate: Date,
  config?: any
): Promise<BacktestResult> {
  // ... 现有逻辑
}
```

### 11.4 Phase 2: 优化回测性能

#### 11.4.1 添加数据获取重试机制

**修改 `getHistoricalCandlesticks` 方法**（第59-129行）：

```typescript
private async getHistoricalCandlesticks(
  symbol: string,
  startDate: Date,
  endDate: Date,
  retryCount: number = 0
): Promise<Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>> {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [1000, 2000, 4000]; // 指数退避：1s, 2s, 4s

  try {
    const quoteCtx = await getQuoteContext();
    const longport = require('longport');
    const { Period, AdjustType } = longport;

    // ... 现有数据获取逻辑

    return result;
  } catch (error: any) {
    // ✅ 如果是频率限制错误，进行重试
    if (
      (error.message && (error.message.includes('429') || error.message.includes('429002'))) ||
      retryCount < MAX_RETRIES
    ) {
      const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      logger.warn(`获取历史数据失败 (${symbol})，${delay}ms后重试 (${retryCount + 1}/${MAX_RETRIES}):`, error.message);
      
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.getHistoricalCandlesticks(symbol, startDate, endDate, retryCount + 1);
    }

    logger.error(`获取历史数据失败 (${symbol}):`, error.message);
    throw error;
  }
}
```

#### 11.4.2 添加数据缓存机制

**在 `BacktestService` 类中添加缓存**：

```typescript
class BacktestService {
  private initialCapital: number = 10000;
  // ✅ 添加数据缓存
  private candlestickCache: Map<string, {
    data: Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>;
    timestamp: number;
  }> = new Map();
  private readonly CACHE_TTL = 3600000; // 1小时缓存

  private async getHistoricalCandlesticks(
    symbol: string,
    startDate: Date,
    endDate: Date,
    retryCount: number = 0
  ): Promise<Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>> {
    // ✅ 检查缓存
    const cacheKey = `${symbol}_${startDate.toISOString()}_${endDate.toISOString()}`;
    const cached = this.candlestickCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
      logger.log(`使用缓存数据 (${symbol})`);
      return cached.data;
    }

    try {
      // ... 现有数据获取逻辑

      // ✅ 更新缓存
      this.candlestickCache.set(cacheKey, {
        data: result,
        timestamp: now,
      });

      return result;
    } catch (error: any) {
      // ... 错误处理
    }
  }
}
```

### 11.5 Phase 2: 添加回测超时机制

#### 11.5.1 修改 `executeBacktestAsync` 方法，添加超时控制

**文件位置**：`api/src/services/backtest.service.ts`

```typescript
async executeBacktestAsync(
  id: number,
  strategyId: number,
  symbols: string[],
  startDate: Date,
  endDate: Date,
  config?: any
): Promise<void> {
  try {
    await this.updateBacktestStatus(id, 'RUNNING');

    // ✅ 计算超时时间：回测天数 * 1分钟（最少5分钟，最多30分钟）
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const timeoutMinutes = Math.min(Math.max(daysDiff, 5), 30);
    const timeoutMs = timeoutMinutes * 60 * 1000;

    logger.log(`回测任务 ${id} 开始执行，超时时间: ${timeoutMinutes} 分钟`);

    // ✅ 使用 Promise.race 实现超时控制
    const backtestPromise = this.runBacktest(id, strategyId, symbols, startDate, endDate, config);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`回测超时: 超过 ${timeoutMinutes} 分钟未完成`));
      }, timeoutMs);
    });

    const result = await Promise.race([backtestPromise, timeoutPromise]);

    await this.updateBacktestResult(id, {
      ...result,
      id,
      strategyId,
      startDate: result.startDate,
      endDate: result.endDate,
    });

    logger.log(`回测任务 ${id} 完成`);
  } catch (error: any) {
    logger.error(`回测任务 ${id} 失败:`, error);
    const errorMessage = error.message || '回测执行失败';
    await this.updateBacktestStatus(id, 'FAILED', errorMessage);
  }
}
```

### 11.6 数据库迁移

#### 11.6.1 创建迁移文件

**文件位置**：`api/migrations/013_add_backtest_progress.sql`

```sql
-- 添加回测进度字段
-- 创建时间: 2025-12-12
-- 描述: 为回测结果表添加进度监控字段

-- 添加进度相关字段
DO $$
BEGIN
    -- 添加进度百分比字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'progress_percent'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN progress_percent DECIMAL(5,2) DEFAULT 0;
    END IF;
    
    -- 添加进度消息字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'progress_message'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN progress_message TEXT;
    END IF;
    
    -- 添加已处理日期数字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'processed_dates'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN processed_dates INTEGER DEFAULT 0;
    END IF;
    
    -- 添加总日期数字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'backtest_results' AND column_name = 'total_dates'
    ) THEN
        ALTER TABLE backtest_results ADD COLUMN total_dates INTEGER DEFAULT 0;
    END IF;
END $$;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_backtest_results_progress ON backtest_results(progress_percent);

-- 添加注释
COMMENT ON COLUMN backtest_results.progress_percent IS '回测进度百分比 (0-100)';
COMMENT ON COLUMN backtest_results.progress_message IS '进度消息（当前处理的日期和标的）';
COMMENT ON COLUMN backtest_results.processed_dates IS '已处理日期数';
COMMENT ON COLUMN backtest_results.total_dates IS '总日期数';
```

### 11.7 测试指南

#### 11.7.1 单元测试

**创建测试文件**：`api/src/__tests__/backtest.service.test.ts`

```typescript
import backtestService from '../services/backtest.service';
import { RecommendationStrategy } from '../services/strategies/recommendation-strategy';

describe('BacktestService', () => {
  describe('simulateBuy', () => {
    it('应该使用正确的资金计算逻辑', async () => {
      // 测试资金计算是否与实际交易逻辑一致
      // 参照 strategy-scheduler.service.ts 的逻辑
    });

    it('应该进行价格验证', async () => {
      // 测试价格偏差超过5%时是否拒绝买入
    });

    it('应该进行价格格式化', async () => {
      // 测试美股价格保留2位小数，港股保留3位小数
    });
  });

  describe('simulateSell', () => {
    it('应该进行价格验证', async () => {
      // 测试价格偏差超过20%时是否拒绝卖出
    });

    it('应该进行持仓验证', async () => {
      // 测试持仓不足时是否拒绝卖出
    });
  });

  describe('runBacktest', () => {
    it('应该更新进度', async () => {
      // 测试进度是否正确更新
    });

    it('应该在超时后停止', async () => {
      // 测试超时机制是否正常工作
    });
  });
});
```

#### 11.7.2 集成测试

**测试场景**：

1. **回测逻辑一致性测试**：
   - 使用相同的策略和参数执行回测和实际交易
   - 对比买入卖出逻辑是否一致
   - 验证资金计算、数量计算、价格验证等是否一致

2. **性能测试**：
   - 测试1个月回测周期是否能在5分钟内完成
   - 测试数据获取重试机制是否正常工作
   - 测试缓存机制是否有效

3. **进度监控测试**：
   - 测试进度是否正确更新
   - 测试前端能否正确查询进度
   - 测试进度信息是否准确

### 11.8 部署注意事项

#### 11.8.1 向后兼容性

1. **数据库迁移**：
   - 使用 `IF NOT EXISTS` 确保迁移可以安全重复运行
   - 新字段使用默认值，不影响已有数据

2. **API兼容性**：
   - 新增字段使用可选参数
   - 保持现有API接口不变
   - 新增字段不影响现有调用方

3. **代码兼容性**：
   - 新增参数使用可选参数或默认值
   - 保持现有方法签名不变（通过重载或可选参数）

#### 11.8.2 回滚方案

如果修改后出现问题，可以：

1. **代码回滚**：
   - 回滚到修改前的代码版本
   - 数据库字段保留（不影响功能）

2. **功能开关**：
   - 可以通过配置开关禁用新功能
   - 保留原有逻辑作为fallback

### 11.9 注意事项

1. **不破坏现有功能**：
   - 所有修改都是增量添加，不删除现有代码
   - 新增参数使用可选参数或默认值
   - 保持向后兼容性
   - **重要**：修改 `simulateBuy` 和 `simulateSell` 方法时，确保不影响现有调用

2. **代码复用**：
   - 尽量复用现有的工具函数（如 `detectMarket`、`capitalManager`）
   - 参照实际交易逻辑的实现，确保一致性
   - **重要**：`capitalManager.getMaxPositionPerSymbol()` 可能返回0，需要处理这种情况

3. **错误处理**：
   - 所有新增逻辑都要有完善的错误处理
   - 记录详细的日志，便于问题定位
   - **重要**：API调用失败时要有重试机制，避免回测中断

4. **性能考虑**：
   - 进度更新不要太频繁（每10%更新一次）
   - 数据缓存要合理设置TTL
   - **重要**：避免在循环中进行数据库操作，使用批量更新

5. **测试**：
   - 修改后需要充分测试
   - 确保回测结果与实际交易逻辑一致
   - 确保性能优化有效
   - **重要**：测试时要覆盖各种边界情况（资金不足、价格偏差过大、持仓不足等）

### 11.10 实施顺序

**建议的实施顺序**：

1. **Phase 1.1**：修复回测买入逻辑（资金计算、数量计算、价格验证、价格格式化）
2. **Phase 1.2**：修复回测卖出逻辑（价格验证、持仓验证、价格格式化）
3. **Phase 1.3**：添加基础日志输出
4. **Phase 2.1**：数据库迁移（添加进度字段）
5. **Phase 2.2**：添加进度监控功能
6. **Phase 2.3**：优化数据获取（重试机制、缓存）
7. **Phase 2.4**：添加超时机制
8. **Phase 2.5**：测试和优化

**每个阶段完成后都要进行测试，确保功能正常后再进行下一阶段。**

---

---

## 12. 修复总结（2025-12-14）

### 12.1 已完成的修复

#### ✅ Phase 0.1：修复回测数据问题（已完成）

**问题**：回测使用实时数据而非历史数据，导致策略基于当前市场条件而非历史条件生成信号。

**修复内容**：

1. **修改 `marketDataService` 支持历史数据获取**：
   - 新增 `getHistoricalCandlesticks()` 方法：获取指定日期之前的历史K线数据
   - 新增 `getHistoricalMarketData()` 方法：批量获取SPX、USD Index、BTC的历史市场数据
   - 新增 `filterDataBeforeDate()` 方法：过滤数据，确保不包含未来数据
   - 修复时间戳单位问题：统一使用毫秒级时间戳进行比较
   - 修复日期时间设置：使用目标日期的结束时间（23:59:59）确保包含当天数据

2. **修改 `marketDataCacheService` 支持历史数据**：
   - 新增 `getHistoricalMarketData()` 方法：直接调用 `marketDataService`，不使用缓存（历史请求通常唯一）

3. **修改 `tradingRecommendationService` 支持历史日期参数**：
   - `calculateRecommendation()` 方法新增 `targetDate` 和 `historicalStockCandlesticks` 参数
   - 当提供 `targetDate` 时，使用历史市场数据而非实时数据
   - 当提供 `historicalStockCandlesticks` 时，使用历史股票K线数据

4. **修改 `RecommendationStrategy` 支持历史数据**：
   - `generateSignal()` 方法新增 `targetDate` 和 `historicalStockCandlesticks` 参数
   - 将历史日期和历史K线数据传递给 `tradingRecommendationService`

5. **修改 `backtest.service` 传入历史数据**：
   - 在回测循环中，为每个日期传入 `currentDate` 和过滤后的 `historicalCandles`
   - 确保策略基于历史市场条件生成信号

**测试结果**：
- ✅ SPX历史数据获取正常：100条（2025-06-26 至 2025-11-14）
- ✅ USD Index历史数据获取正常：100条
- ✅ BTC历史数据获取正常：100条
- ✅ 历史数据过滤逻辑正常：时间戳单位统一，日期时间设置正确
- ⚠️ 分时数据不支持历史日期：`get-quote-minute` 只返回最新数据（不影响回测，分时数据是可选的）

**相关文件**：
- `api/src/services/market-data.service.ts`
- `api/src/services/market-data-cache.service.ts`
- `api/src/services/trading-recommendation.service.ts`
- `api/src/services/strategies/recommendation-strategy.ts`
- `api/src/services/backtest.service.ts`

#### ✅ Phase 0.2：添加诊断日志（已完成）

**问题**：回测完成但无交易数据，无法诊断原因。

**修复内容**：

1. **数据库迁移**：
   - 新增 `diagnostic_log` 字段（JSONB类型）到 `backtest_results` 表
   - 记录数据获取、信号生成、买入尝试等详细信息

2. **回测服务增强**：
   - `runBacktest()` 方法收集诊断日志
   - `simulateBuy()` 方法返回失败原因
   - `saveDiagnosticLog()` 方法保存日志到数据库

3. **前端显示**：
   - 回测详情页显示诊断日志（当 `totalTrades === 0` 时）
   - 帮助用户理解为什么没有交易数据

**相关文件**：
- `api/migrations/014_add_backtest_diagnostic_log.sql`
- `api/migrations/000_init_schema.sql`
- `api/src/services/backtest.service.ts`
- `frontend/app/quant/backtest/[id]/page.tsx`

### 12.2 待完成的修复

#### ⏳ Phase 1：修复回测买入/卖出逻辑（待实施）

- 修复资金计算逻辑
- 修复数量计算逻辑
- 添加价格验证
- 添加持仓检查
- 参照实际交易逻辑

#### ⏳ Phase 2：性能优化和监控（待实施）

- 添加进度监控
- 优化数据获取效率
- 添加超时机制
- 添加详细日志

### 12.3 已知问题

1. **分时数据不支持历史日期**：
   - `get-quote-minute` API只返回最新分时数据，不支持历史日期参数
   - 影响：分时数据在回测中为空（但分时数据是可选的，不影响回测功能）
   - 解决方案：需要研究是否有其他API可以获取历史分时数据，或使用日K数据替代

2. **回测仍未生成BUY信号**：
   - 可能原因：策略逻辑本身不满足买入条件（这是正常的）
   - 需要进一步验证：策略在什么条件下会生成BUY信号

### 12.4 下一步计划

1. **研究分时数据获取方案**：
   - 检查moomoo API文档，看是否有历史分时数据接口
   - 或考虑使用日K数据替代分时数据

2. **验证策略逻辑**：
   - 检查策略生成BUY信号的条件
   - 测试不同日期范围，看是否能生成BUY信号

3. **继续实施Phase 1和Phase 2**：
   - 修复回测买入/卖出逻辑
   - 添加性能优化和监控

---

**文档状态**：部分完成  
**下一步行动**：继续实施Phase 1和Phase 2，研究分时数据获取方案

