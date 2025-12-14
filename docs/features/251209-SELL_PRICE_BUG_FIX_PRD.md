# 卖出价格错误修复 - 产品需求文档（PRD）

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-09
- **最后更新**：2025-12-09
- **文档作者**：AI Product Manager
- **审核状态**：待审核
- **优先级**：P0（紧急）

---

## 1. 背景与目标

### 1.1 业务背景

交易系统在实际运行过程中，出现卖出价格错误的情况，导致交易亏损。通过分析监控日志和订单数据，发现系统在自动卖出持仓时，错误地将当前市场价格作为`entryPrice`（入场价）传递，然后又错误地将这个`entryPrice`作为卖出订单的价格，导致卖出价格不正确。

### 1.2 用户痛点

**核心问题**：
- 系统在卖出持仓时，价格计算错误
- 导致实际成交价格与预期不符，造成亏损
- 影响交易策略的执行效果和盈利能力

**具体表现**：
- 卖出订单的价格使用了错误的`entryPrice`值
- `entryPrice`应该是实际的买入价格，但被错误地设置为当前市场价格
- 卖出价格应该是当前市场价格（或略低于市场价格以确保成交），但使用了错误的`entryPrice`

### 1.3 业务目标

- **主要目标**：
  1. 修复卖出价格计算错误，确保卖出订单使用正确的价格
  2. 全面审查和统一整个交易系统的价格计算框架
  3. 确保买入、卖出、做空等所有订单类型的价格计算逻辑准确无误
  
- **成功指标**：
  - 所有订单类型的价格正确率 = 100%
  - 卖出价格与当前市场价格的偏差 ≤ 0.5%
  - 买入价格与市场价格的偏差 ≤ 1%（考虑限价单的合理范围）
  - 不再出现因价格错误导致的亏损订单
  - 价格计算逻辑统一，代码可维护性提升

### 1.4 项目范围

- **包含范围**：
  - **平仓卖出价格修复**：
    - 修复`processHoldingPosition`中的卖出价格计算逻辑
    - 修复`executeSellIntent`中的价格传递逻辑
    - 确保`entryPrice`正确使用实际的买入价格（用于记录和计算盈亏）
    - 确保卖出价格使用当前市场价格（用于提交订单）
  
  - **买入价格逻辑审查**：
    - 审查`executeBuyIntent`中的价格使用逻辑
    - 确保买入时`entryPrice`正确作为买入价格使用
    - 验证买入价格获取和传递流程的准确性
  
  - **做空价格逻辑审查**：
    - 审查做空（SELL信号）场景的价格计算逻辑
    - 确保做空时`entryPrice`正确作为做空价格（卖出价格）使用
    - 验证做空和平仓的逻辑区分是否正确
  
  - **价格计算框架统一**：
    - 统一所有订单类型的价格计算逻辑
    - 明确`entryPrice`和`sellPrice`的语义和使用场景
    - 建立完整的价格计算和验证机制
  
  - **价格验证和监控**：
    - 添加价格合理性验证
    - 增强价格计算过程的日志记录
    - 添加价格异常监控和告警

**重要说明**：
虽然最初只关注卖出价格错误，但考虑到量化交易系统的整体准确性，本次修复将全面审查和修复所有订单类型的价格计算逻辑，确保整个交易框架的准确性和一致性。

---

## 2. 用户与场景

### 2.1 目标用户

- **主要用户**：交易系统管理员、策略开发者
- **用户特征**：需要系统自动执行交易策略，对价格准确性要求极高

### 2.2 使用场景

**场景1：自动止盈卖出**
- **用户**：交易系统
- **时间**：持仓监控周期（每30秒）
- **地点**：服务器端
- **行为**：系统检测到持仓价格达到止盈价，触发自动卖出
- **目标**：以当前市场价格（或略低于市场价格）卖出持仓，确保订单能够成交

**场景2：自动止损卖出**
- **用户**：交易系统
- **时间**：持仓监控周期（每30秒）
- **地点**：服务器端
- **行为**：系统检测到持仓价格跌破止损价，触发自动卖出
- **目标**：以当前市场价格（或略低于市场价格）卖出持仓，及时止损

### 2.3 用户故事

- As a 交易系统, I want 在所有订单类型中使用正确的价格, So that 订单能够以合理的价格成交，避免因价格错误导致的亏损
- As a 策略开发者, I want 系统正确记录买入价格和卖出价格, So that 能够准确计算盈亏和评估策略效果
- As a 系统管理员, I want 整个交易框架的价格计算逻辑统一且准确, So that 确保量化交易系统的整体可靠性和盈利能力

---

## 3. 问题分析

### 3.1 问题定位

**核心问题代码位置**：
1. `api/src/services/strategy-scheduler.service.ts` 第1550行（平仓卖出）
2. `api/src/services/basic-execution.service.ts` 第74行（卖出执行）

**问题代码**：

```typescript
// 问题代码1：strategy-scheduler.service.ts 第1550行（平仓卖出）
const sellIntent = {
  action: 'SELL' as const,
  symbol,
  entryPrice: latestPrice, // ❌ 错误：将最新市场价格作为entryPrice
  quantity: quantity,
  reason: `自动卖出: ${exitReason}`,
};

// 问题代码2：basic-execution.service.ts 第74行（卖出执行）
return await this.submitOrder(
  intent.symbol,
  'SELL',
  intent.quantity,
  intent.entryPrice, // ❌ 错误：将entryPrice作为卖出价格
  strategyId
);
```

### 3.2 交易场景分析

**场景1：买入（BUY）**
- **状态流转**：IDLE → OPENING → HOLDING
- **价格逻辑**：`entryPrice` = 买入价格（限价单价格）
- **当前实现**：✅ 正确 - `executeBuyIntent`使用`intent.entryPrice`作为买入价格
- **需要审查**：验证价格获取和传递流程的准确性

**场景2：平仓卖出（CLOSING）**
- **状态流转**：HOLDING → CLOSING → IDLE
- **价格逻辑**：
  - `entryPrice` = 实际买入价格（用于记录和计算盈亏）
  - `sellPrice` = 当前市场价格（用于提交卖出订单）
- **当前实现**：❌ 错误 - 将`latestPrice`作为`entryPrice`，然后又将`entryPrice`作为卖出价格
- **需要修复**：明确区分`entryPrice`和`sellPrice`的用途

**场景3：做空卖出（SELL信号，无持仓）**
- **状态流转**：IDLE → OPENING（做空）
- **价格逻辑**：`entryPrice` = 做空价格（卖出价格）
- **当前实现**：✅ 逻辑正确 - 做空时`entryPrice`就是卖出价格
- **需要审查**：确保与平仓卖出的逻辑区分清晰，避免混淆

### 3.3 根本原因

1. **概念混淆**：
   - `entryPrice`在不同场景下的语义不一致：
     - **买入场景**：`entryPrice` = 买入价格 ✅
     - **平仓场景**：`entryPrice` = 买入价格（用于记录），但代码错误地使用了`latestPrice` ❌
     - **做空场景**：`entryPrice` = 做空价格（卖出价格）✅
   - 缺乏明确的价格字段区分不同场景

2. **价格传递错误**：
   - `executeSellIntent`方法直接将`intent.entryPrice`作为卖出价格传递给`submitOrder`
   - 没有区分"平仓卖出"和"做空卖出"两种场景
   - 平仓时应该使用当前市场价格，而不是`entryPrice`

3. **数据流问题**：
   - 在`processHoldingPosition`中，`context.entryPrice`存储的是实际的买入价格
   - 但在创建卖出意图时，没有使用`context.entryPrice`，而是使用了`latestPrice`
   - 导致`entryPrice`和卖出价格都使用了错误的值

4. **框架设计问题**：
   - `TradingIntent`接口设计不够完善，缺乏对不同交易场景的支持
   - 没有明确的价格字段语义定义和使用规范
   - 缺乏统一的价格计算和验证机制

### 3.4 影响分析

**直接影响**：
- **平仓卖出**：价格计算错误，可能导致订单无法成交或成交价格不合理
- **盈亏计算**：`entryPrice`错误导致盈亏计算不准确
- **策略评估**：价格错误影响策略效果的准确评估

**潜在风险**：
- **价格获取失败**：如果`latestPrice`获取失败，会使用`currentPrice`（可能过时的价格）
- **价格偏差**：如果`currentPrice`也过时，可能导致卖出价格严重偏离市场价格
- **框架一致性**：如果只修复卖出场景，不统一整个框架，可能导致其他场景也存在类似问题

**实际案例**（从日志和订单数据分析）：
- COIN.US：买入价274.72，卖出价274.87（价格接近，但`entryPrice`可能错误）
- CRSP.US：买入价58.18，卖出价56.88（价格差异较大，可能存在价格错误）

**系统整体影响**：
- 如果价格计算框架不统一，可能导致：
  - 买入价格计算也可能存在问题
  - 做空价格计算可能与其他场景混淆
  - 整个交易系统的准确性受到质疑

---

## 4. 功能需求

### 4.1 功能概览

| 功能 | 优先级 | 说明 |
|------|--------|------|
| **平仓卖出价格修复** | | |
| 修复entryPrice赋值逻辑 | P0 | 确保entryPrice使用实际的买入价格 |
| 修复卖出价格计算逻辑 | P0 | 确保卖出价格使用当前市场价格 |
| **买入价格逻辑审查** | | |
| 审查买入价格计算逻辑 | P0 | 验证买入时entryPrice的正确使用 |
| 验证买入价格获取流程 | P1 | 确保买入价格获取和传递的准确性 |
| **做空价格逻辑审查** | | |
| 审查做空价格计算逻辑 | P0 | 验证做空时entryPrice的正确使用 |
| 区分做空和平仓逻辑 | P0 | 确保做空和平仓的逻辑区分清晰 |
| **价格框架统一** | | |
| 统一价格计算框架 | P0 | 建立统一的价格计算和验证机制 |
| 明确价格字段语义 | P0 | 定义entryPrice和sellPrice的使用规范 |
| **价格验证和监控** | | |
| 添加价格验证逻辑 | P1 | 验证所有订单类型的价格合理性 |
| 增强日志记录 | P1 | 记录价格计算过程，便于调试 |
| 添加价格异常监控 | P1 | 监控价格异常，及时告警 |

### 4.2 功能详细说明

#### 功能1：修复entryPrice赋值逻辑
**优先级**：P0

**功能描述**：
在`processHoldingPosition`中创建卖出意图时，`entryPrice`应该使用`context.entryPrice`（实际的买入价格），而不是`latestPrice`（最新市场价格）。

**交互流程**：
1. 系统检测到需要卖出持仓（触发止盈/止损）
2. 获取持仓上下文（`context`），其中包含`entryPrice`（实际买入价格）
3. 获取最新市场价格（`latestPrice`）
4. 创建卖出意图，`entryPrice`使用`context.entryPrice`，卖出价格使用`latestPrice`

**输入输出**：
- **输入**：
  - `context.entryPrice`：实际的买入价格
  - `latestPrice`：最新市场价格
  - `quantity`：卖出数量
- **输出**：
  - `sellIntent`：卖出意图，包含正确的`entryPrice`和卖出价格

**边界条件**：
- `context.entryPrice`不存在：使用`latestPrice`作为fallback，并记录警告日志
- `latestPrice`获取失败：使用`currentPrice`作为fallback，并记录警告日志
- `currentPrice`也不存在：返回错误，不提交订单

**验收标准**：
- [ ] `entryPrice`使用`context.entryPrice`（实际买入价格）
- [ ] 如果`context.entryPrice`不存在，使用`latestPrice`作为fallback
- [ ] 记录价格来源的日志，便于调试

#### 功能2：修复卖出价格计算逻辑
**优先级**：P0

**功能描述**：
修改`executeSellIntent`方法，使其接受一个可选的`sellPrice`参数。如果没有提供`sellPrice`，则使用`entryPrice`（仅用于做空场景）。对于平仓场景，必须提供`sellPrice`。

**交互流程**：
1. `processHoldingPosition`调用`executeSellIntent`，传递`sellPrice`（当前市场价格）
2. `executeSellIntent`检查是否有`sellPrice`参数
3. 如果有`sellPrice`，使用`sellPrice`作为卖出价格
4. 如果没有`sellPrice`，使用`entryPrice`（仅用于做空场景）

**输入输出**：
- **输入**：
  - `intent.entryPrice`：买入价格（用于记录）
  - `intent.sellPrice`：卖出价格（可选，用于平仓）
  - `intent.quantity`：卖出数量
- **输出**：
  - `ExecutionResult`：订单执行结果

**边界条件**：
- `sellPrice`不存在且`entryPrice`不存在：返回错误
- `sellPrice` <= 0：返回错误
- `sellPrice`与`entryPrice`差异过大（>20%）：记录警告日志，但仍提交订单

**验收标准**：
- [ ] 平仓时使用`sellPrice`作为卖出价格
- [ ] 做空时使用`entryPrice`作为卖出价格
- [ ] 价格验证逻辑正确执行
- [ ] 错误情况正确处理

#### 功能3：添加价格验证逻辑
**优先级**：P1

**功能描述**：
在提交卖出订单前，验证卖出价格的合理性：
1. 卖出价格应该接近当前市场价格（偏差不超过5%）
2. 卖出价格应该大于0
3. 如果卖出价格与当前市场价格差异过大，记录警告日志

**交互流程**：
1. 获取当前市场价格
2. 计算卖出价格与市场价格的偏差
3. 如果偏差超过阈值，记录警告日志
4. 如果偏差过大（>20%），返回错误，不提交订单

**输入输出**：
- **输入**：
  - `sellPrice`：卖出价格
  - `currentPrice`：当前市场价格
- **输出**：
  - `valid`：价格是否有效
  - `warning`：警告信息（如果有）

**边界条件**：
- 当前市场价格获取失败：跳过验证，记录警告日志
- 偏差在5%-20%之间：记录警告日志，但仍提交订单
- 偏差超过20%：返回错误，不提交订单

**验收标准**：
- [ ] 价格验证逻辑正确执行
- [ ] 警告日志正确记录
- [ ] 错误情况正确处理

#### 功能4：审查买入价格计算逻辑
**优先级**：P0

**功能描述**：
审查`executeBuyIntent`中的价格使用逻辑，确保买入时`entryPrice`正确作为买入价格使用。

**审查要点**：
1. 验证`executeBuyIntent`中`entryPrice`的使用是否正确
2. 检查买入价格的获取和传递流程
3. 确认买入价格与市场价格的合理性

**验收标准**：
- [ ] 买入时`entryPrice`正确作为买入价格使用
- [ ] 价格获取和传递流程正确
- [ ] 价格合理性验证通过

#### 功能5：审查做空价格计算逻辑
**优先级**：P0

**功能描述**：
审查做空（SELL信号）场景的价格计算逻辑，确保做空时`entryPrice`正确作为做空价格（卖出价格）使用，并与平仓逻辑区分清晰。

**审查要点**：
1. 验证做空时`entryPrice`的使用是否正确
2. 检查做空和平仓的逻辑区分
3. 确认做空价格的合理性

**验收标准**：
- [ ] 做空时`entryPrice`正确作为做空价格使用
- [ ] 做空和平仓逻辑区分清晰
- [ ] 价格合理性验证通过

#### 功能6：统一价格计算框架
**优先级**：P0

**功能描述**：
建立统一的价格计算和验证机制，明确`entryPrice`和`sellPrice`的语义和使用场景。

**框架设计**：
1. **价格字段语义定义**：
   - `entryPrice`：入场价格
     - 买入场景：买入价格
     - 平仓场景：买入价格（用于记录和计算盈亏）
     - 做空场景：做空价格（卖出价格）
   - `sellPrice`：卖出价格（新增）
     - 平仓场景：当前市场价格（用于提交订单）
     - 做空场景：不使用（使用`entryPrice`）

2. **价格计算规范**：
   - 买入：使用`entryPrice`作为买入价格
   - 平仓：使用`sellPrice`作为卖出价格，`entryPrice`用于记录
   - 做空：使用`entryPrice`作为做空价格

**验收标准**：
- [ ] 价格字段语义定义清晰
- [ ] 价格计算规范统一
- [ ] 价格验证机制完善

#### 功能7：增强日志记录
**优先级**：P1

**功能描述**：
在价格计算和订单提交过程中，记录详细的日志信息，包括：
1. 买入价格（`entryPrice`）的来源和值
2. 卖出价格（`sellPrice`）的来源和值
3. 当前市场价格（`latestPrice`）的值
4. 价格计算的过程和结果
5. 交易场景（买入/平仓/做空）

**验收标准**：
- [ ] 日志记录包含所有关键价格信息
- [ ] 日志格式清晰，便于调试
- [ ] 日志级别正确设置
- [ ] 交易场景标识清晰

---

## 5. 技术方案

### 5.1 技术选型

- **编程语言**：TypeScript
- **修改文件**：
  1. `api/src/services/strategy-scheduler.service.ts`
  2. `api/src/services/basic-execution.service.ts`
  3. `api/src/services/strategies/strategy-base.ts`（可选，扩展接口）

### 5.2 架构设计

**修改方案1：扩展TradingIntent接口（推荐）**

```typescript
// strategy-base.ts
export interface TradingIntent {
  action: 'BUY' | 'SELL' | 'HOLD';
  symbol: string;
  entryPrice?: number;        // 买入价格（入场价）
  sellPrice?: number;         // 卖出价格（新增，用于平仓）
  entryPriceRange?: { min: number; max: number };
  stopLoss?: number;
  takeProfit?: number;
  quantity?: number;
  reason: string;
  metadata?: Record<string, any>;
}
```

**修改方案2：修改executeSellIntent方法签名**

```typescript
// basic-execution.service.ts
async executeSellIntent(
  intent: TradingIntent,
  strategyId: number,
  sellPrice?: number  // 新增参数，用于指定卖出价格
): Promise<ExecutionResult> {
  // 优先使用sellPrice，如果没有则使用entryPrice（仅用于做空）
  const price = sellPrice || intent.entryPrice;
  if (!price) {
    return {
      success: false,
      error: '缺少卖出价格信息',
    };
  }
  // ...
}
```

**推荐方案**：方案1（扩展接口），因为：
- 更符合面向对象设计原则
- 代码更清晰，意图更明确
- 不需要修改方法签名，影响范围更小

### 5.3 代码修改详情

#### 修改1：strategy-scheduler.service.ts

**位置**：`processHoldingPosition`方法，约第1546-1553行

**修改前**：
```typescript
// 创建卖出意图（使用最新价格）
const sellIntent = {
  action: 'SELL' as const,
  symbol,
  entryPrice: latestPrice, // ❌ 错误：使用最新市场价格
  quantity: quantity,
  reason: `自动卖出: ${exitReason}`,
};
```

**修改后**：
```typescript
// 创建卖出意图
// entryPrice: 使用实际的买入价格（从context获取）
// sellPrice: 使用最新市场价格（用于提交订单）
const sellIntent = {
  action: 'SELL' as const,
  symbol,
  entryPrice: context.entryPrice || latestPrice, // ✅ 使用实际买入价格
  sellPrice: latestPrice, // ✅ 使用最新市场价格作为卖出价格
  quantity: quantity,
  reason: `自动卖出: ${exitReason}`,
};

// 记录价格信息，便于调试
logger.log(`策略 ${strategyId} 标的 ${symbol}: 创建卖出意图 - ` +
  `买入价=${sellIntent.entryPrice?.toFixed(2)}, ` +
  `卖出价=${sellIntent.sellPrice?.toFixed(2)}, ` +
  `数量=${quantity}, ` +
  `原因=${exitReason}`);
```

#### 修改2：basic-execution.service.ts

**位置**：`executeSellIntent`方法，约第58-84行

**修改前**：
```typescript
async executeSellIntent(
  intent: TradingIntent,
  strategyId: number
): Promise<ExecutionResult> {
  if (!intent.quantity || !intent.entryPrice) {
    return {
      success: false,
      error: '缺少数量或价格信息',
    };
  }

  try {
    return await this.submitOrder(
      intent.symbol,
      'SELL',
      intent.quantity,
      intent.entryPrice, // ❌ 错误：使用entryPrice作为卖出价格
      strategyId
    );
  } catch (error: any) {
    // ...
  }
}
```

**修改后**：
```typescript
async executeSellIntent(
  intent: TradingIntent,
  strategyId: number
): Promise<ExecutionResult> {
  // 验证必要参数
  if (!intent.quantity) {
    return {
      success: false,
      error: '缺少数量信息',
    };
  }

  // 确定卖出价格
  // 优先级：sellPrice > entryPrice
  // sellPrice: 用于平仓场景（推荐）
  // entryPrice: 用于做空场景（fallback）
  const sellPrice = intent.sellPrice || intent.entryPrice;
  
  if (!sellPrice || sellPrice <= 0) {
    return {
      success: false,
      error: `缺少有效的卖出价格信息 (sellPrice=${intent.sellPrice}, entryPrice=${intent.entryPrice})`,
    };
  }

  // 记录价格信息，便于调试
  logger.log(`策略 ${strategyId} 执行卖出意图: ` +
    `标的=${intent.symbol}, ` +
    `数量=${intent.quantity}, ` +
    `卖出价=${sellPrice.toFixed(2)}, ` +
    `买入价=${intent.entryPrice?.toFixed(2) || 'N/A'}, ` +
    `原因=${intent.reason}`);

  try {
    return await this.submitOrder(
      intent.symbol,
      'SELL',
      intent.quantity,
      sellPrice, // ✅ 使用正确的卖出价格
      strategyId
    );
  } catch (error: any) {
    logger.error(`执行卖出失败 (${intent.symbol}):`, error);
    return {
      success: false,
      error: error.message || '未知错误',
    };
  }
}
```

#### 修改3：strategy-base.ts（扩展接口）

**位置**：`TradingIntent`接口定义，约第9-19行

**修改前**：
```typescript
export interface TradingIntent {
  action: 'BUY' | 'SELL' | 'HOLD';
  symbol: string;
  entryPrice?: number;
  entryPriceRange?: { min: number; max: number };
  stopLoss?: number;
  takeProfit?: number;
  quantity?: number;
  reason: string;
  metadata?: Record<string, any>;
}
```

**修改后**：
```typescript
export interface TradingIntent {
  action: 'BUY' | 'SELL' | 'HOLD';
  symbol: string;
  entryPrice?: number;        // 买入价格（入场价），用于记录和计算盈亏
  sellPrice?: number;         // 卖出价格（新增），用于平仓场景
  entryPriceRange?: { min: number; max: number };
  stopLoss?: number;
  takeProfit?: number;
  quantity?: number;
  reason: string;
  metadata?: Record<string, any>;
}
```

### 5.4 接口设计

**无需新增接口**，只需扩展现有接口。

### 5.5 数据模型

**无需修改数据模型**，价格信息通过`TradingIntent`接口传递。

---

## 6. 风险评估

### 6.1 技术风险

**风险1：向后兼容性问题**
- **风险描述**：扩展`TradingIntent`接口可能影响现有代码
- **影响**：中（可能影响其他使用`TradingIntent`的地方）
- **应对**：
  - `sellPrice`字段为可选字段，不影响现有代码
  - 如果没有提供`sellPrice`，使用`entryPrice`作为fallback（保持向后兼容）
  - 全面测试所有使用`TradingIntent`的地方

**风险2：价格获取失败**
- **风险描述**：如果`latestPrice`获取失败，可能使用过时的价格
- **影响**：高（可能导致订单价格错误）
- **应对**：
  - 添加价格验证逻辑
  - 如果价格获取失败，记录错误日志，不提交订单
  - 添加价格合理性检查（偏差不超过5%）

**风险3：做空场景误用**
- **风险描述**：如果做空场景也使用了`sellPrice`，可能导致逻辑错误
- **影响**：中（可能影响做空功能）
- **应对**：
  - 明确区分平仓场景和做空场景
  - 平仓场景：使用`sellPrice`（当前市场价格）
  - 做空场景：使用`entryPrice`（做空价格）
  - 添加注释说明使用场景

### 6.2 业务风险

**风险1：修复不彻底**
- **风险描述**：如果还有其他地方也存在类似问题，可能导致修复不彻底
- **影响**：高（可能仍有价格错误）
- **应对**：
  - 全面搜索代码库，查找所有使用`entryPrice`作为卖出价格的地方
  - 添加代码审查，确保修复完整
  - 添加单元测试，覆盖所有场景

**风险2：测试不充分**
- **风险描述**：如果测试不充分，可能遗漏边界情况
- **影响**：中（可能在生产环境出现问题）
- **应对**：
  - 编写完整的单元测试
  - 编写集成测试，测试完整流程
  - 在测试环境充分测试后再部署到生产环境

### 6.3 时间风险

**风险1：修复时间过长**
- **风险描述**：如果修复时间过长，可能导致问题持续存在
- **影响**：高（持续亏损）
- **应对**：
  - 优先修复核心问题（P0功能）
  - 分阶段修复，先修复核心逻辑，再优化其他功能
  - 预计修复时间：2-4小时

---

## 7. 测试计划

### 7.1 单元测试

**测试用例1：entryPrice正确使用实际买入价格**
- **输入**：`context.entryPrice = 100`, `latestPrice = 105`
- **预期**：`sellIntent.entryPrice = 100`, `sellIntent.sellPrice = 105`
- **验证**：检查`sellIntent`对象的字段值

**测试用例2：entryPrice不存在时使用latestPrice**
- **输入**：`context.entryPrice = undefined`, `latestPrice = 105`
- **预期**：`sellIntent.entryPrice = 105`, `sellIntent.sellPrice = 105`
- **验证**：检查`sellIntent`对象的字段值

**测试用例3：sellPrice优先于entryPrice**
- **输入**：`intent.sellPrice = 105`, `intent.entryPrice = 100`
- **预期**：`submitOrder`使用价格`105`
- **验证**：检查`submitOrder`调用参数

**测试用例4：sellPrice不存在时使用entryPrice**
- **输入**：`intent.sellPrice = undefined`, `intent.entryPrice = 100`
- **预期**：`submitOrder`使用价格`100`
- **验证**：检查`submitOrder`调用参数

**测试用例5：价格验证逻辑**
- **输入**：`sellPrice = 105`, `currentPrice = 100`（偏差5%）
- **预期**：记录警告日志，但仍提交订单
- **验证**：检查日志和订单提交结果

### 7.2 集成测试

**测试场景1：完整卖出流程**
1. 创建持仓（买入价格100）
2. 触发止盈卖出（当前价格105）
3. 验证卖出订单价格 = 105
4. 验证`entryPrice`记录 = 100

**测试场景2：价格获取失败处理**
1. 模拟价格获取失败
2. 验证系统正确处理错误
3. 验证不提交错误价格的订单

**测试场景3：做空场景**
1. 创建做空信号（`action = 'SELL'`, 无持仓）
2. 验证使用`entryPrice`作为卖出价格
3. 验证不影响做空功能

### 7.3 回归测试

**测试范围**：
- 所有使用`TradingIntent`的地方
- 所有调用`executeSellIntent`的地方
- 所有调用`processHoldingPosition`的地方

**测试重点**：
- 确保不影响现有功能
- 确保向后兼容性
- 确保价格计算正确

---

## 8. 迭代计划

### 8.1 MVP范围（本次修复）

**必须修复（P0）**：
1. ✅ 修复`entryPrice`赋值逻辑（平仓时使用实际买入价格）
2. ✅ 修复卖出价格计算逻辑（平仓时使用当前市场价格）
3. ✅ 扩展`TradingIntent`接口（添加`sellPrice`字段）
4. ✅ 审查买入价格计算逻辑（确保正确性）
5. ✅ 审查做空价格计算逻辑（确保正确性）
6. ✅ 统一价格计算框架（建立规范和验证机制）
7. ✅ 增强日志记录（记录价格计算过程）

**预计时间**：4-6小时（包含全面审查和测试）

**分阶段实施建议**：
- **第一阶段（紧急，2-3小时）**：修复平仓卖出价格错误
  - 修复`entryPrice`赋值逻辑
  - 修复卖出价格计算逻辑
  - 扩展`TradingIntent`接口
  - 基础测试验证
  
- **第二阶段（重要，1-2小时）**：审查买入和做空逻辑
  - 审查买入价格计算逻辑
  - 审查做空价格计算逻辑
  - 验证逻辑区分清晰
  
- **第三阶段（完善，1小时）**：统一框架和增强监控
  - 统一价格计算框架
  - 增强日志记录
  - 添加价格验证逻辑

### 8.2 后续优化（可选）

**优化1：价格验证逻辑**
- 添加价格合理性检查
- 添加价格偏差警告
- 预计时间：1-2小时

**优化2：价格获取优化**
- 优化价格获取逻辑，减少失败率
- 添加价格缓存机制
- 预计时间：2-3小时

**优化3：监控和告警**
- 添加价格异常监控
- 添加价格偏差告警
- 预计时间：2-3小时

---

## 9. 验收标准

### 9.1 功能验收

- [ ] **entryPrice正确性**：
  - `entryPrice`使用`context.entryPrice`（实际买入价格）
  - 如果`context.entryPrice`不存在，使用`latestPrice`作为fallback
  - 记录价格来源的日志

- [ ] **卖出价格正确性**：
  - 卖出价格使用`latestPrice`（当前市场价格）
  - 如果`latestPrice`获取失败，使用`currentPrice`作为fallback
  - 价格验证逻辑正确执行

- [ ] **向后兼容性**：
  - 现有代码无需修改即可正常工作
  - 做空场景功能正常
  - 不影响其他使用`TradingIntent`的地方

- [ ] **日志记录**：
  - 记录所有关键价格信息
  - 日志格式清晰，便于调试
  - 日志级别正确设置

### 9.2 性能验收

- [ ] **响应时间**：价格计算和订单提交时间 ≤ 1秒
- [ ] **错误处理**：价格获取失败时正确处理，不阻塞流程
- [ ] **资源使用**：修复后资源使用无明显增加

### 9.3 质量验收

- [ ] **代码质量**：
  - 代码符合项目规范
  - 添加必要的注释
  - 通过代码审查

- [ ] **测试覆盖**：
  - 单元测试覆盖率 ≥ 80%
  - 集成测试覆盖主要场景
  - 回归测试通过

---

## 10. 附录

### 10.1 参考资料

- [策略Bug修复说明](251203-STRATEGY_BUG_FIX_20251203.md)
- [交易推荐逻辑文档](../technical/251212-TRADING_RECOMMENDATION_LOGIC.md)
- [动态交易策略实现文档](251203-DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md)

### 10.2 相关文件

- `api/src/services/strategy-scheduler.service.ts`
- `api/src/services/basic-execution.service.ts`
- `api/src/services/strategies/strategy-base.ts`

### 10.3 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-09 | 初始版本，聚焦卖出价格错误修复 | AI Product Manager |
| v1.1 | 2025-12-09 | 扩展修复范围，包含买入、做空等所有订单类型的价格计算逻辑审查和修复 | AI Product Manager |

---

## 11. 实施建议

### 11.1 实施步骤

1. **第一步：代码修改**
   - 修改`strategy-base.ts`，扩展`TradingIntent`接口
   - 修改`strategy-scheduler.service.ts`，修复`entryPrice`赋值逻辑
   - 修改`basic-execution.service.ts`，修复卖出价格计算逻辑

2. **第二步：测试验证**
   - 编写单元测试
   - 编写集成测试
   - 在测试环境验证修复效果

3. **第三步：代码审查**
   - 提交代码审查
   - 根据反馈修改代码
   - 确保代码质量

4. **第四步：部署上线**
   - 部署到生产环境
   - 监控系统运行情况
   - 验证修复效果

### 11.2 注意事项

1. **谨慎修改**：价格计算逻辑是关键功能，修改前要充分理解现有逻辑
2. **充分测试**：修复后要充分测试，确保不影响现有功能
3. **监控运行**：部署后要密切监控系统运行情况，及时发现问题
4. **文档更新**：修复后要及时更新相关文档

### 11.3 回滚方案

如果修复后出现问题，可以：
1. 立即回滚代码到修复前版本
2. 分析问题原因
3. 修复问题后重新部署

---

---

## 12. 总结与重要性说明

### 12.1 为什么需要全面修复

虽然最初只发现了卖出价格错误的问题，但考虑到量化交易系统的整体准确性，本次修复将全面审查和修复所有订单类型的价格计算逻辑。原因如下：

1. **系统整体性**：
   - 价格计算是量化交易系统的核心功能
   - 任何价格计算错误都会直接影响交易结果和盈利能力
   - 如果只修复卖出场景，可能遗漏其他场景的问题

2. **框架一致性**：
   - 统一的价格计算框架有助于代码维护和扩展
   - 明确的价格字段语义可以避免未来的混淆和错误
   - 完善的价格验证机制可以提高系统的可靠性

3. **风险控制**：
   - 价格错误可能导致直接的经济损失
   - 全面的审查和修复可以降低系统风险
   - 统一框架可以减少未来出现类似问题的可能性

### 12.2 修复优先级

**P0（紧急，必须修复）**：
- 平仓卖出价格错误（直接影响当前问题）
- 买入价格计算逻辑审查（确保正确性）
- 做空价格计算逻辑审查（确保正确性）
- 统一价格计算框架（建立规范）

**P1（重要，建议修复）**：
- 价格验证逻辑（提高可靠性）
- 增强日志记录（便于调试和监控）
- 价格异常监控（及时发现问题）

### 12.3 预期收益

1. **准确性提升**：
   - 所有订单类型的价格计算准确率 = 100%
   - 消除因价格错误导致的亏损

2. **可维护性提升**：
   - 统一的价格计算框架
   - 清晰的价格字段语义
   - 完善的日志和监控

3. **风险降低**：
   - 价格验证机制防止错误订单
   - 异常监控及时发现问题
   - 统一框架减少未来错误

---

**文档完成时间**：2025-12-09  
**文档版本**：v1.1（扩展修复范围）  
**下一步行动**：开发团队开始实施修复，优先修复P0功能

