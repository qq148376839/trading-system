# 交易订单重复提交防护机制 - 产品需求文档（PRD）

## 📋 文档信息
- **文档版本**：v1.2
- **创建时间**：2025-12-12
- **最后更新**：2025-12-12
- **文档作者**：AI Product Manager
- **审核状态**：待审核
- **文档说明**：本文档基于项目实际代码和架构设计，所有技术方案和接口设计均与现有代码保持一致

---

## 1. 背景与目标

### 1.1 业务背景

交易系统在夜间交易时段出现了大量订单拒绝问题，严重影响交易策略的正常执行和资金利用效率。系统需要建立完善的订单重复提交防护机制，确保交易决策的准确性和资金安全。

### 1.2 用户痛点

**核心问题**：
- **359单拒绝订单**：昨晚交易时段出现大量订单被拒绝，失败原因均为"持仓不足"
- **卖空风险**：股票卖出订单被重复提交，导致卖出数量超过实际持仓，产生卖空
- **资金占用错误**：买入订单因卖空未平仓而无法执行，导致资金占用计算错误
- **交易决策失效**：多买、多卖导致持仓状态与实际情况不一致，影响后续交易决策

**影响范围**：
- 交易策略执行失败率显著上升
- 资金利用效率下降
- 持仓状态与实际持仓不一致
- 存在合规风险（卖空限制）

### 1.3 业务目标

- **主要目标**：消除订单重复提交导致的持仓不足问题，确保交易订单提交的准确性
- **成功指标**：
  - 订单拒绝率（因持仓不足）降低至 **0%**
  - 重复订单提交事件减少至 **0次/天**
  - 持仓状态与实际持仓一致性达到 **100%**
  - 订单提交前持仓验证覆盖率 **100%**

### 1.4 项目范围

- **包含范围**：
  - 卖出订单提交前持仓数量验证
  - 买入订单提交前资金和持仓验证
  - 未成交订单占用持仓计算
  - 订单提交去重机制增强
  - 持仓状态实时同步机制
  - 卖空检测和防护机制

- **不包含范围**：
  - 订单价格优化（后续迭代）
  - 订单执行策略优化（后续迭代）
  - 多账户持仓管理（后续迭代）

---

## 2. 用户与场景

### 2.1 目标用户

- **主要用户**：量化交易系统、策略执行引擎
- **用户特征**：
  - 自动化交易，无人工干预
  - 高频交易，需要快速响应
  - 对准确性和可靠性要求极高
  - 需要实时持仓状态同步

### 2.2 使用场景

**场景1：卖出订单重复提交导致卖空**
- **时间**：夜间交易时段（2025-12-11 15:47-15:50）
- **标的**：ACHR.US
- **行为**：
  1. 系统检测到卖出信号，提交卖出订单（197股）
  2. 由于竞态条件或缓存延迟，系统再次提交卖出订单（197股）
  3. 两个订单都成交，实际持仓为0，但系统认为已卖出394股
  4. 后续买入订单因"持仓不足"被拒绝
- **目标**：防止重复提交卖出订单，确保卖出数量不超过实际持仓

**场景2：未成交订单占用持仓未计算**
- **时间**：订单提交后，订单成交前
- **行为**：
  1. 系统提交卖出订单（100股），订单状态为"NewStatus"（未成交）
  2. 系统再次检测到卖出信号，计算可用持仓时未考虑未成交订单
  3. 系统再次提交卖出订单（100股），导致卖出数量超过实际持仓
- **目标**：在计算可用持仓时，扣除未成交订单占用的持仓数量

**场景3：买入订单因卖空未平仓而失败**
- **时间**：卖空发生后，买入订单提交时
- **行为**：
  1. 系统因重复卖出导致卖空（-197股）
  2. 系统生成买入信号，尝试买入
  3. 由于存在卖空持仓，买入订单被拒绝（持仓不足）
  4. 系统无法自动平仓卖空持仓
- **目标**：检测卖空持仓，优先平仓卖空后再执行买入

### 2.3 用户故事

- As a **交易系统**, I want **在提交卖出订单前验证实际可用持仓**, So that **避免卖出数量超过实际持仓导致卖空**
- As a **策略执行引擎**, I want **计算可用持仓时考虑未成交订单**, So that **确保持仓计算的准确性**
- As a **风险控制系统**, I want **检测并阻止卖空操作**, So that **符合交易规则和合规要求**
- As a **订单管理系统**, I want **防止订单重复提交**, So that **避免竞态条件导致的重复订单**

---

## 3. 功能需求

### 3.1 功能概览

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 卖出订单持仓验证 | P0 | 提交卖出订单前验证实际可用持仓 |
| 未成交订单持仓计算 | P0 | 计算可用持仓时扣除未成交订单占用 |
| 订单提交去重增强 | P0 | 增强订单提交去重机制，防止竞态条件 |
| 卖空检测和防护 | P0 | 检测卖空持仓，阻止或自动平仓 |
| 交易推送集成 | P0 | 使用 Longbridge SDK 交易推送，实时更新订单状态和缓存 |
| 持仓状态实时同步 | P1 | 实时同步持仓状态，确保状态一致性 |
| 买入订单持仓验证 | P1 | 买入订单提交前验证资金和持仓状态 |

### 3.2 功能详细说明

#### 功能1：卖出订单持仓验证
**优先级**：P0

**功能描述**：
在提交卖出订单前，系统必须验证实际可用持仓数量，确保卖出数量不超过实际持仓。

**交互流程**：
1. 系统检测到卖出信号，准备提交卖出订单
2. 系统查询实际持仓数量（从券商API获取）
3. 系统查询未成交卖出订单占用的持仓数量
4. 系统计算可用持仓 = 实际持仓 - 未成交卖出订单占用
5. 如果卖出数量 > 可用持仓，拒绝提交并记录警告
6. 如果卖出数量 ≤ 可用持仓，允许提交订单

**输入输出**：
- **输入**：
  - 标的代码（symbol）
  - 卖出数量（quantity）
  - 策略ID（strategyId）
- **输出**：
  - 验证结果（valid: boolean）
  - 可用持仓数量（availableQuantity: number）
  - 拒绝原因（reason?: string）

**边界条件**：
- **实际持仓为0**：拒绝卖出，记录警告"标的 {symbol} 无持仓，无法卖出"
- **可用持仓不足**：拒绝卖出，记录警告"标的 {symbol} 可用持仓不足，实际持仓={actualQuantity}，未成交订单占用={pendingQuantity}，可用持仓={availableQuantity}，请求卖出={requestQuantity}"
- **持仓查询失败**：保守处理，拒绝卖出，记录错误"持仓查询失败，为安全起见拒绝卖出"
- **未成交订单查询失败**：保守处理，拒绝卖出，记录错误"未成交订单查询失败，为安全起见拒绝卖出"

**验收标准**：
- [ ] 卖出订单提交前必须验证实际可用持仓
- [ ] 验证失败时拒绝提交并记录详细日志
- [ ] 验证通过时允许提交订单
- [ ] 使用 Longbridge SDK `stockPositions()` 获取实际持仓
- [ ] 使用 Longbridge SDK `todayOrders()` 查询未成交订单占用持仓
- [ ] 在 `BasicExecutionService.executeSellIntent()` 中调用持仓验证

#### 功能2：未成交订单持仓计算
**优先级**：P0

**功能描述**：
在计算可用持仓时，系统必须考虑未成交订单占用的持仓数量，确保持仓计算的准确性。

**交互流程**：
1. 系统需要计算可用持仓（用于卖出订单验证或持仓监控）
2. 系统查询实际持仓数量（从券商API获取）
3. 系统查询未成交卖出订单列表（从数据库或API获取）
4. 系统计算未成交订单占用持仓 = SUM(未成交卖出订单数量)
5. 系统计算可用持仓 = 实际持仓 - 未成交订单占用
6. 返回可用持仓数量

**输入输出**：
- **输入**：
  - 标的代码（symbol）
  - 策略ID（strategyId，可选）
- **输出**：
  - 实际持仓数量（actualQuantity: number）
  - 未成交订单占用（pendingQuantity: number）
  - 可用持仓数量（availableQuantity: number）

**边界条件**：
- **无未成交订单**：可用持仓 = 实际持仓
- **未成交订单数量超过实际持仓**：可用持仓 = 0，记录警告"未成交订单占用超过实际持仓，可能存在数据不一致"
- **持仓查询失败**：返回null，记录错误
- **未成交订单查询失败**：保守处理，假设未成交订单占用 = 0，记录警告

**验收标准**：
- [ ] 计算可用持仓时正确扣除未成交订单占用
- [ ] 使用 Longbridge SDK `todayOrders()` 查询未成交订单（利用现有缓存机制）
- [ ] 处理查询失败的情况（保守处理，查询失败时假设未成交订单占用=0）
- [ ] 记录详细的持仓计算日志（使用 `utils/logger.ts`）
- [ ] 支持处理 `channels[].positions` 和 `positions.positions` 两种数据结构

#### 功能3：订单提交去重增强
**优先级**：P0

**功能描述**：
增强订单提交去重机制，防止竞态条件导致的重复订单提交。

**交互流程**：
1. 系统准备提交订单（买入或卖出）
2. 系统检查订单提交缓存（最近60秒内是否已提交相同订单）
3. 系统检查数据库是否有未成交订单（双重检查）
4. 系统使用分布式锁（如果支持）或数据库锁防止并发提交
5. 如果检查通过，提交订单并更新缓存
6. 如果检查失败，拒绝提交并记录警告

**输入输出**：
- **输入**：
  - 标的代码（symbol）
  - 订单方向（side: 'BUY' | 'SELL'）
  - 策略ID（strategyId）
- **输出**：
  - 是否允许提交（allowed: boolean）
  - 拒绝原因（reason?: string）

**边界条件**：
- **缓存命中**：拒绝提交，记录警告"标的 {symbol} 在最近60秒内已提交过 {side} 订单"
- **数据库检查发现未成交订单**：拒绝提交，记录警告"标的 {symbol} 已有未成交 {side} 订单"
- **分布式锁获取失败**：拒绝提交，记录警告"无法获取订单提交锁，可能存在并发提交"
- **缓存更新失败**：记录警告，但不阻止订单提交

**验收标准**：
- [ ] 订单提交前检查 `orderSubmissionCache`（60秒TTL）和 `todayOrders()` API
- [ ] 增强现有 `validateStrategyExecution()` 方法，添加持仓验证
- [ ] 订单提交成功后调用 `markOrderSubmitted()` 更新缓存
- [ ] 利用现有 `checkPendingOrder()` 和 `checkPendingSellOrder()` 方法
- [ ] 记录详细的去重检查日志（使用 `utils/logger.ts`）

#### 功能4：交易推送集成
**优先级**：P0

**功能描述**：
集成 Longbridge SDK 交易推送功能，实时接收订单状态变更通知，立即更新订单缓存和可用持仓计算，解决竞态条件问题。

**交互流程**：
1. 系统启动时，调用 `TradeContext.subscribe([TopicType.Private])` 订阅交易推送
2. 设置 `TradeContext.setOnOrderChanged()` 回调函数
3. 订单提交后，立即收到推送通知（订单ID、状态、成交数量等）
4. 收到推送后，立即更新 `orderSubmissionCache`（标记订单已提交）
5. 订单状态变更（成交、拒绝、取消）时，立即更新可用持仓计算
6. 订单拒绝时，立即释放资金和持仓占用

**输入输出**：
- **输入**：
  - 订单变更事件（`PushOrderChanged`）：包含订单ID、状态、成交数量等
- **输出**：
  - 缓存更新结果（`orderSubmissionCache` 更新）
  - 持仓计算更新（可用持仓重新计算）

**边界条件**：
- **推送连接失败**：降级到轮询模式（`trackPendingOrders`），记录警告
- **推送消息解析失败**：记录错误，继续处理其他推送消息
- **重复推送**：使用订单ID去重，避免重复处理
- **推送延迟**：设置超时机制，超时后使用轮询模式补充

**验收标准**：
- [ ] 系统启动时订阅交易推送（`TopicType.Private`）
- [ ] 订单提交后立即收到推送，更新 `orderSubmissionCache`
- [ ] 订单状态变更时立即更新可用持仓计算
- [ ] 订单拒绝时立即释放资金和持仓占用
- [ ] 推送连接失败时降级到轮询模式
- [ ] 记录详细的推送日志（使用 `utils/logger.ts`）

**技术实现**：
```typescript
// 在 server.ts 或 StrategyScheduler 中初始化
const tradeCtx = await getTradeContext();

// 设置订单变更回调
tradeCtx.setOnOrderChanged((err: Error, event: PushOrderChanged) => {
  if (err) {
    logger.error('交易推送错误:', err);
    return;
  }
  
  // 立即更新订单提交缓存
  const cacheKey = `${event.strategyId}:${event.symbol}:${event.side}`;
  orderSubmissionCache.set(cacheKey, {
    timestamp: Date.now(),
    orderId: event.orderId
  });
  
  // 订单状态变更时更新可用持仓
  if (event.status === 'FilledStatus' || event.status === 'RejectedStatus') {
    // 立即重新计算可用持仓
    updateAvailablePosition(event.symbol);
  }
  
  logger.log(`收到订单推送: ${event.orderId}, 状态=${event.status}`);
});

// 订阅交易推送
await tradeCtx.subscribe([TopicType.Private]);
```

#### 功能5：卖空检测和防护
**优先级**：P0

**功能描述**：
检测卖空持仓，阻止或自动平仓卖空持仓，确保符合交易规则。

**交互流程**：
1. 系统定期检查持仓状态（从券商API获取）
2. 系统检测到卖空持仓（持仓数量 < 0）
3. 系统记录警告日志"检测到卖空持仓：标的 {symbol}，持仓数量={quantity}"
4. 系统自动生成平仓订单（买入平仓）
5. 系统提交平仓订单，优先于其他买入订单
6. 平仓成功后，更新持仓状态

**输入输出**：
- **输入**：
  - 标的代码（symbol）
  - 持仓数量（quantity: number，负数表示卖空）
- **输出**：
  - 是否检测到卖空（hasShortPosition: boolean）
  - 平仓订单ID（closeOrderId?: string）
  - 平仓结果（closeResult?: ExecutionResult）

**边界条件**：
- **检测到卖空持仓**：自动生成平仓订单，记录警告
- **平仓订单提交失败**：记录错误，继续监控
- **持仓查询失败**：记录错误，不执行平仓
- **卖空持仓数量为0**：不执行平仓，记录信息"卖空持仓已平仓"

**验收标准**：
- [ ] 在 `AccountBalanceSyncService` 同步时检测卖空持仓
- [ ] 检测到卖空时自动生成买入平仓订单（使用 `BasicExecutionService.executeBuyIntent()`）
- [ ] 平仓订单优先于其他买入订单（在策略调度器中优先处理）
- [ ] 平仓成功后更新 `strategy_instances` 状态
- [ ] 记录详细的卖空检测和平仓日志（使用 `utils/logger.ts`）

#### 功能6：持仓状态实时同步
**优先级**：P1

**功能描述**：
实时同步持仓状态，确保系统持仓状态与实际持仓一致。

**交互流程**：
1. 系统定期同步持仓状态（每5分钟或订单状态变更时）
2. 系统从券商API获取实际持仓
3. 系统从数据库获取系统持仓状态
4. 系统对比实际持仓和系统持仓状态
5. 如果发现不一致，更新系统持仓状态
6. 记录同步日志

**输入输出**：
- **输入**：
  - 标的代码（symbol，可选，不提供则同步所有标的）
- **输出**：
  - 同步结果（syncResult: SyncResult）
  - 不一致的标的列表（inconsistentSymbols: string[]）

**边界条件**：
- **实际持仓为0，系统状态为HOLDING**：更新状态为IDLE，记录警告
- **实际持仓>0，系统状态为IDLE**：更新状态为HOLDING，记录警告
- **持仓查询失败**：记录错误，不更新状态
- **状态更新失败**：记录错误，重试同步

**验收标准**：
- [ ] 利用现有 `AccountBalanceSyncService` 定期同步（每5分钟，已在 `server.ts` 中启动）
- [ ] 在 `StrategyScheduler.trackPendingOrders()` 中触发同步
- [ ] 检测并修复持仓状态不一致（已有逻辑，需增强卖空检测）
- [ ] 记录详细的同步日志（使用 `utils/logger.ts`）
- [ ] 支持通过 API 手动触发同步（`/api/quant/account-balance/sync`）

#### 功能7：买入订单持仓验证
**优先级**：P1

**功能描述**：
买入订单提交前验证资金和持仓状态，确保买入决策的准确性。

**交互流程**：
1. 系统检测到买入信号，准备提交买入订单
2. 系统验证资金是否充足
3. 系统验证是否已有持仓（如果有持仓，不允许重复买入）
4. 系统验证是否有未成交买入订单
5. 如果验证通过，允许提交买入订单
6. 如果验证失败，拒绝提交并记录警告

**输入输出**：
- **输入**：
  - 标的代码（symbol）
  - 买入数量（quantity）
  - 买入价格（price）
  - 策略ID（strategyId）
- **输出**：
  - 验证结果（valid: boolean）
  - 拒绝原因（reason?: string）

**边界条件**：
- **资金不足**：拒绝买入，记录警告"资金不足，可用资金={availableCapital}，需要资金={requiredCapital}"
- **已有持仓**：拒绝买入，记录警告"标的 {symbol} 已有持仓，不允许重复买入"
- **有未成交买入订单**：拒绝买入，记录警告"标的 {symbol} 已有未成交买入订单"
- **验证失败**：拒绝买入，记录错误

**验收标准**：
- [ ] 买入订单提交前验证资金（使用 `CapitalManager.getAvailableCapital()`）
- [ ] 验证是否已有持仓（使用 `StrategyScheduler.checkExistingPosition()`）
- [ ] 验证是否有未成交买入订单（使用 `checkPendingOrder()`）
- [ ] 验证失败时拒绝提交并记录详细日志（使用 `utils/logger.ts`）
- [ ] 验证通过时允许提交订单

---

## 4. 非功能需求

### 4.1 性能要求
- **响应时间**：持仓验证响应时间 ≤ 500ms
- **并发处理**：支持多策略并发执行，使用分布式锁防止竞态条件
- **查询频率**：持仓状态同步频率 ≤ 5分钟/次
- **缓存TTL**：订单提交缓存TTL = 60秒

### 4.2 安全要求
- **持仓验证**：必须从 Longbridge SDK `stockPositions()` 获取实际持仓，不依赖缓存
- **卖空防护**：禁止卖空操作，检测到卖空时自动平仓（使用 `BasicExecutionService.executeBuyIntent()`）
- **订单去重**：使用内存缓存（`orderSubmissionCache`）和 API 查询双重检查
- **错误处理**：验证失败时保守处理，拒绝提交订单，记录详细错误日志

### 4.3 兼容性要求
- 支持现有交易系统架构
- 兼容现有订单管理流程
- 支持多策略并发执行
- 兼容现有持仓状态管理

### 4.4 可维护性要求
- **日志记录**：记录详细的验证和去重日志，便于问题排查
- **监控告警**：检测到卖空或持仓不一致时发送告警
- **代码规范**：遵循现有代码规范和架构设计
- **文档完善**：提供详细的技术文档和使用说明

---

## 5. 技术方案

### 5.1 技术选型

**持仓验证服务**：
- 在 `BasicExecutionService.executeSellIntent()` 中添加持仓验证逻辑
- 使用 Longbridge SDK `TradeContext.stockPositions()` 获取实际持仓（支持 `channels[].positions` 和 `positions.positions` 两种结构）
- 使用 Longbridge SDK `TradeContext.todayOrders()` 查询未成交订单（利用 `StrategyScheduler.getTodayOrders()` 的缓存机制）

**订单去重机制**：
- 使用现有 `StrategyScheduler.orderSubmissionCache`（Map结构，60秒TTL，`ORDER_CACHE_TTL = 60000`）
- 增强现有 `checkPendingOrder()` 和 `checkPendingSellOrder()` 方法（使用 `todayOrders()` API）
- 增强现有 `validateStrategyExecution()` 方法（添加持仓验证和订单提交缓存检查）
- 使用数据库查询双重检查（`execution_orders`表，用于历史订单回填，但主要依赖API查询）

**持仓同步服务**：
- 使用现有 `AccountBalanceSyncService`（已在 `server.ts` 中启动，每5分钟同步一次）
- 在订单状态变更时触发同步（`StrategyScheduler.trackPendingOrders()` 方法）
- 增强同步逻辑，添加卖空检测和平仓功能

**交易推送服务**（推荐优化方案）：
- 使用 Longbridge SDK `TradeContext.subscribe([TopicType.Private])` 订阅交易推送
- 使用 `TradeContext.setOnOrderChanged()` 设置订单变更回调
- 订单状态变更时实时推送，立即更新 `orderSubmissionCache` 和可用持仓计算
- **优势**：解决竞态条件，减少延迟，避免重复提交

### 5.2 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                  订单提交流程                              │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │   订单提交前验证（新增）            │
        └───────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌───────────────┐      ┌───────────────┐
│ 持仓验证服务   │      │ 订单去重检查   │
│               │      │               │
│ - 查询实际持仓 │      │ - 检查缓存     │
│ - 计算可用持仓 │      │ - 检查数据库   │
│ - 验证卖出数量 │      │ - 分布式锁     │
└───────────────┘      └───────────────┘
        │                       │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │   提交订单（现有流程）   │
        └───────────────────────┘
```

### 5.3 接口设计

**持仓验证方法**（在 `BasicExecutionService` 中新增）：
```typescript
class BasicExecutionService {
  /**
   * 验证卖出订单持仓（新增方法）
   */
  private async validateSellPosition(
    symbol: string,
    quantity: number,
    strategyId: number
  ): Promise<{
    valid: boolean;
    availableQuantity: number;
    actualQuantity: number;
    pendingQuantity: number;
    reason?: string;
  }> {
    // 1. 从 Longbridge SDK 获取实际持仓
    const tradeCtx = await getTradeContext();
    const positions = await tradeCtx.stockPositions();
    // 处理 positions 数据结构（支持 channels[].positions 和 positions.positions）
    const actualPosition = this.findPosition(positions, symbol);
    const actualQuantity = actualPosition?.quantity || 0;
    
    // 2. 查询未成交卖出订单（使用 todayOrders API）
    const todayOrders = await tradeCtx.todayOrders();
    const pendingSellOrders = todayOrders.filter(order => 
      order.symbol === symbol && 
      this.isSellOrder(order) && 
      this.isPendingStatus(order.status)
    );
    const pendingQuantity = pendingSellOrders.reduce((sum, order) => 
      sum + (order.executedQuantity || order.quantity), 0
    );
    
    // 3. 计算可用持仓
    const availableQuantity = Math.max(0, actualQuantity - pendingQuantity);
    
    // 4. 验证卖出数量
    if (quantity > availableQuantity) {
      return {
        valid: false,
        availableQuantity,
        actualQuantity,
        pendingQuantity,
        reason: `可用持仓不足：实际持仓=${actualQuantity}，未成交订单占用=${pendingQuantity}，可用持仓=${availableQuantity}，请求卖出=${quantity}`
      };
    }
    
    return {
      valid: true,
      availableQuantity,
      actualQuantity,
      pendingQuantity
    };
  }
}
```

**订单去重方法**（增强现有 `StrategyScheduler` 方法）：
```typescript
class StrategyScheduler {
  /**
   * 增强现有 validateStrategyExecution 方法
   */
  private async validateStrategyExecution(
    strategyId: number,
    symbol: string,
    intent: { action: string; price?: number; quantity?: number; entryPrice?: number }
  ): Promise<{ valid: boolean; reason?: string }> {
    // ... 现有验证逻辑 ...
    
    // 新增：卖出订单持仓验证
    if (intent.action === 'SELL' && intent.quantity) {
      const positionValidation = await basicExecutionService.validateSellPosition(
        symbol,
        intent.quantity,
        strategyId
      );
      if (!positionValidation.valid) {
        return {
          valid: false,
          reason: positionValidation.reason
        };
      }
    }
    
    // ... 其他验证逻辑 ...
  }
  
  /**
   * 增强现有 checkPendingSellOrder 方法
   * 添加持仓数量检查
   */
  private async checkPendingSellOrder(
    strategyId: number,
    symbol: string,
    forceRefresh: boolean = false
  ): Promise<{ hasPending: boolean; availableQuantity?: number }> {
    // ... 现有检查逻辑 ...
    
    // 新增：计算可用持仓
    const positionValidation = await basicExecutionService.calculateAvailablePosition(symbol);
    return {
      hasPending: /* 现有逻辑 */,
      availableQuantity: positionValidation.availableQuantity
    };
  }
}
```

**卖空检测方法**（在 `AccountBalanceSyncService` 中新增）：
```typescript
class AccountBalanceSyncService {
  /**
   * 检测卖空持仓（新增方法）
   */
  async detectShortPositions(): Promise<Array<{ symbol: string; quantity: number }>> {
    const tradeCtx = await getTradeContext();
    const positions = await tradeCtx.stockPositions();
    const actualPositions = this.parsePositions(positions);
    
    return actualPositions
      .filter(p => p.quantity < 0)
      .map(p => ({ symbol: p.symbol, quantity: p.quantity }));
  }
  
  /**
   * 自动平仓卖空持仓（新增方法）
   */
  async closeShortPosition(
    symbol: string,
    quantity: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    // 生成买入平仓订单
    const buyQuantity = Math.abs(quantity);
    // 调用 BasicExecutionService.executeBuyIntent
    // ...
  }
}
```

### 5.4 数据模型

**使用现有数据表**：
- `execution_orders` 表：记录订单信息（已有 `signal_id` 字段）
- `strategy_instances` 表：记录策略实例状态和上下文
- `positions` 表：记录持仓信息（由 `AccountBalanceSyncService` 维护）

**不需要新建表**：
- 持仓验证日志通过现有日志系统记录（`utils/logger.ts`）
- 订单去重信息存储在内存缓存（`orderSubmissionCache`）
- 卖空检测结果记录在日志中，无需持久化

**数据查询方式**：
- 实际持仓：使用 Longbridge SDK `TradeContext.stockPositions()`
- 未成交订单：使用 Longbridge SDK `TradeContext.todayOrders()`（带缓存）
- 订单记录：查询 `execution_orders` 表（用于双重检查）

---

## 6. 风险评估

### 6.1 技术风险

**风险1：持仓查询API延迟或失败**
- **影响**：高（影响订单提交）
- **应对**：
  - 实现重试机制（最多重试3次）
  - 查询失败时保守处理，拒绝提交订单
  - 记录详细错误日志，便于排查

**风险2：竞态条件导致重复提交**
- **影响**：高（导致重复订单）
- **应对**：
  - **推荐方案**：使用 Longbridge SDK 交易推送，订单提交后立即收到推送，立即更新缓存
  - **备选方案**：增强现有 `orderSubmissionCache` 机制（60秒TTL）
  - 双重检查缓存和 `todayOrders()` API
  - 订单提交成功后立即调用 `markOrderSubmitted()` 更新缓存
  - 在 `validateStrategyExecution()` 中添加订单提交缓存检查

**风险3：未成交订单查询不准确**
- **影响**：中（影响持仓计算）
- **应对**：
  - 使用 Longbridge SDK `todayOrders()` API（利用现有缓存机制）
  - 保守处理，查询失败时假设未成交订单占用=0
  - 记录详细日志（使用 `utils/logger.ts`），便于排查

### 6.2 业务风险

**风险1：持仓验证过于严格导致订单无法提交**
- **影响**：中（影响交易策略执行）
- **应对**：
  - 提供详细的验证失败原因
  - 记录验证日志，便于分析
  - 支持手动覆盖验证（需要管理员权限）

**风险2：卖空检测不及时**
- **影响**：中（存在合规风险）
- **应对**：
  - 提高卖空检测频率（每1分钟检测一次）
  - 订单提交后立即检测
  - 检测到卖空时立即告警

### 6.3 时间风险

**风险1：开发时间不足**
- **影响**：中（影响上线时间）
- **应对**：
  - 优先实现P0功能（持仓验证、订单去重）
  - P1功能（持仓同步）可以后续迭代
  - 分阶段上线，先上线核心功能

---

## 7. 迭代计划

### 7.1 MVP范围（第一迭代）

**核心功能**：
1. ✅ 卖出订单持仓验证
2. ✅ 未成交订单持仓计算
3. ✅ 订单提交去重增强
4. ✅ **交易推送集成**（推荐，解决竞态条件）
5. ✅ 卖空检测和防护

**预期时间**：2周

**验收标准**：
- 订单拒绝率（因持仓不足）降低至0%
- 重复订单提交事件减少至0次/天

### 7.2 后续迭代

**第二迭代（P1功能）**：
- 持仓状态实时同步
- 买入订单持仓验证
- 监控告警功能

**第三迭代（优化）**：
- 性能优化（缓存优化、查询优化）
- 监控面板（可视化持仓验证和去重统计）
- 自动化测试（单元测试、集成测试）

---

## 8. 附录

### 8.1 参考资料

- [交易系统架构文档](../technical/251202-STRATEGY_LOGIC_REVIEW.md)
- [策略逻辑审查文档](../technical/251202-STRATEGY_LOGIC_REVIEW.md)
- [代码地图](../../CODE_MAP.md)
- [问题分析文档](../251203-STRATEGY_BUG_FIX_20251203.md)
- [Longbridge SDK 文档](https://longportapp.github.io/openapi/nodejs/)
- [Longbridge 交易推送文档](https://open.longbridge.com/zh-CN/docs/trade/trade-push)
- [TradeContext.subscribe API](https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html#subscribe)

### 8.2 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-12 | 初始版本 | AI Product Manager |
| v1.1 | 2025-12-12 | 根据项目实际代码完善技术方案、接口设计和数据模型，确保与现有架构一致 | AI Product Manager |
| v1.2 | 2025-12-12 | 添加 Longbridge SDK 交易推送功能作为推荐优化方案，解决竞态条件问题 | AI Product Manager |

### 8.3 问题分析

**问题根因分析**：

1. **重复卖出订单**：
   - 原因：`checkPendingSellOrder()` 使用 `todayOrders()` API 查询，但存在竞态条件
   - 竞态条件：两个策略周期同时执行，都检查到没有未成交订单，然后都提交卖出单
   - 缓存更新不及时：`orderSubmissionCache` 在订单提交后才更新，检查时看不到刚提交的订单
   - 缺少持仓数量验证：未验证卖出数量是否超过实际可用持仓

2. **持仓计算不准确**：
   - 原因：`executeSellIntent()` 中未计算可用持仓，未考虑未成交订单占用的持仓
   - 影响：卖出数量可能超过实际可用持仓，导致卖空
   - 数据源：使用 `stockPositions()` API，但未处理 `channels[].positions` 结构

3. **卖空未平仓**：
   - 原因：`AccountBalanceSyncService` 未检测卖空持仓，也未自动平仓
   - 影响：买入订单因卖空未平仓而无法执行（359单拒绝订单）

**解决方案**：
- 在 `BasicExecutionService.executeSellIntent()` 中添加持仓验证
- 增强 `validateStrategyExecution()` 方法，添加卖出订单持仓验证
- 增强 `checkPendingSellOrder()` 方法，添加可用持仓计算
- **集成 Longbridge SDK 交易推送**（`TradeContext.subscribe()` + `setOnOrderChanged()`），实时更新订单状态和缓存
- 在 `AccountBalanceSyncService` 中添加卖空检测和平仓逻辑
- 利用现有 `orderSubmissionCache` 机制，增强去重检查（结合交易推送，实现实时更新）

**交易推送的优势**：
- ✅ **解决竞态条件**：订单提交后立即收到推送，立即更新缓存，避免重复提交
- ✅ **实时更新可用持仓**：订单成交/拒绝时立即推送，立即重新计算可用持仓
- ✅ **减少延迟**：不需要等待30秒轮询，可以立即检测到订单状态变更
- ✅ **减少API调用**：不需要频繁轮询 `todayOrders()`，减少频率限制风险

