# 策略修订时的资金计算优化 - 产品需求文档（PRD）

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-09
- **最后更新**：2025-12-09
- **文档作者**：AI Product Manager
- **审核状态**：待审核

---

## 1. 背景与目标

### 1.1 业务背景
在策略管理系统中，用户需要修订已有策略的股票池配置。当策略已经有持仓时，修订股票池配置会导致资金计算不准确的问题。

### 1.2 用户痛点

#### 痛点1：修订策略时的资金计算不准确
**场景**：
- 策略A原来有股票池：`[TSLA.US, AMD.US, ...]`，其中TSLA.US已有持仓
- 用户使用机构选股功能修订策略，选择新的股票池：`[TSLA.US, NVDA.US, ...]`
- 问题：计算可用资金时，TSLA.US的持仓已经占用了资金，但如果新股票池中又包含TSLA.US，资金分配计算可能会重复计算或计算不准确

**影响**：
- 用户无法准确了解实际可用资金
- 资金分配计算不准确，可能导致超配或资金浪费
- 用户体验差，需要手动计算和调整

#### 痛点2：多策略股票重复时的持仓区分
**场景**：
- 策略A选择了TSLA.US，已有持仓
- 策略B也选择了TSLA.US，准备买入
- 问题：实际的账户持仓只有一份TSLA.US，但两个策略都有自己的 `strategy_instances` 记录，如何区分持仓属于哪个策略？

**影响**：
- 资金计算混乱：两个策略都认为TSLA.US占用了自己的资金
- 持仓管理困难：无法准确追踪每个策略的实际持仓
- 风险控制困难：无法准确评估每个策略的风险敞口

### 1.3 业务目标
- **主要目标**：优化策略修订时的资金计算逻辑，确保资金计算的准确性
- **次要目标**：明确多策略股票重复时的持仓管理规则
- **成功指标**：
  - 修订策略时，资金计算准确率 ≥ 95%
  - 用户对资金计算的满意度 ≥ 4.0/5.0
  - 多策略股票重复时的持仓区分清晰度 ≥ 90%

### 1.4 项目范围
- **包含范围**：
  - 修订策略时，显示已有持仓股票
  - 计算可用资金时，排除已有持仓占用的资金
  - 机构选股时，标记已有持仓的股票
  - 多策略股票重复时的持仓区分规则
- **不包含范围**：
  - 策略持仓的自动平仓功能（后续迭代）
  - 多策略持仓的合并管理功能（后续迭代）

---

## 2. 用户与场景

### 2.1 目标用户
- **主要用户**：量化交易策略管理员
- **用户特征**：需要频繁修订策略配置，对资金计算的准确性要求高

### 2.2 使用场景

**场景1：修订已有持仓的策略**
- **用户**：策略管理员
- **时间**：策略运行过程中
- **地点**：办公室
- **行为**：策略A已有TSLA.US持仓，用户使用机构选股功能修订股票池，新股票池中包含TSLA.US
- **目标**：准确了解可用资金，避免重复计算TSLA.US的资金占用

**场景2：多策略选择相同股票**
- **用户**：策略管理员
- **时间**：创建或修订策略时
- **地点**：办公室
- **行为**：策略A和策略B都选择了TSLA.US，需要区分持仓属于哪个策略
- **目标**：明确每个策略的持仓归属，准确计算资金占用

---

## 3. 功能需求

### 3.1 功能概览
| 功能 | 优先级 | 说明 |
|------|--------|------|
| 获取策略已有持仓 | P0 | 在修订策略时，获取策略的已有持仓列表 |
| 显示已有持仓股票 | P0 | 在机构选股界面中，标记已有持仓的股票 |
| 调整资金计算逻辑 | P0 | 计算可用资金时，排除已有持仓占用的资金 |
| 多策略持仓区分规则 | P1 | 明确多策略股票重复时的持仓管理规则 |

### 3.2 功能详细说明

#### 功能1：获取策略已有持仓
**优先级**：P0

**功能描述**：
在修订策略时，获取策略的已有持仓列表（状态为HOLDING的strategy_instances）。

**交互流程**：
1. 用户打开策略编辑页面
2. 系统调用API获取策略的已有持仓
3. 系统显示已有持仓列表（股票代码、持仓数量、持仓价值）

**输入输出**：
- **输入**：策略ID
- **输出**：已有持仓列表（包含symbol、quantity、entryPrice、currentPrice等）

**边界条件**：
- 策略没有持仓：返回空列表
- 策略不存在：返回错误提示
- 持仓数据异常：记录日志，返回空列表

**验收标准**：
- [ ] 可以正确获取策略的已有持仓
- [ ] 返回的持仓数据包含必要信息（symbol、quantity、entryPrice）
- [ ] 异常情况处理正确

#### 功能2：显示已有持仓股票
**优先级**：P0

**功能描述**：
在机构选股界面中，标记已有持仓的股票，并显示持仓信息。

**交互流程**：
1. 用户在机构选股界面选择股票
2. 系统检查选中的股票是否已有持仓
3. 如果有持仓，在股票列表中标记并显示持仓信息（持仓数量、持仓价值）
4. 用户可以看到哪些股票已有持仓

**输入输出**：
- **输入**：选中的股票列表、策略已有持仓列表
- **输出**：标记后的股票列表（包含持仓标记和持仓信息）

**边界条件**：
- 没有已有持仓：不显示标记
- 股票不在已有持仓列表中：不显示标记
- 持仓数据异常：显示警告提示

**验收标准**：
- [ ] 可以正确标记已有持仓的股票
- [ ] 显示持仓信息（持仓数量、持仓价值）
- [ ] 标记样式清晰，易于识别

#### 功能3：调整资金计算逻辑
**优先级**：P0

**功能描述**：
计算可用资金时，排除已有持仓占用的资金。

**交互流程**：
1. 用户选择资金分配账户
2. 系统计算分配资金总额
3. 系统查询策略的已有持仓
4. 系统计算已有持仓占用的资金（持仓数量 × 当前价格）
5. 系统计算可用资金 = 分配资金总额 - 已有持仓占用资金 - 其他已使用资金

**输入输出**：
- **输入**：策略ID、资金分配账户ID
- **输出**：可用资金金额（已排除已有持仓占用）

**边界条件**：
- 没有已有持仓：可用资金 = 分配资金总额 - 其他已使用资金
- 已有持仓但无法获取当前价格：使用持仓时的价格计算
- 计算出的可用资金为负数：返回0，并提示用户

**验收标准**：
- [ ] 可以正确计算可用资金（排除已有持仓占用）
- [ ] 计算逻辑准确，符合业务规则
- [ ] 异常情况处理正确

#### 功能4：多策略持仓区分规则
**优先级**：P1

**功能描述**：
明确多策略股票重复时的持仓管理规则。

**规则说明**：
1. **持仓归属**：实际的账户持仓是全局的，不属于特定策略
2. **策略实例**：每个策略的每个股票都有自己的 `strategy_instances` 记录
3. **资金计算**：
   - 如果多个策略都选择了同一股票，每个策略都会计算该股票的持仓价值
   - 但实际的账户持仓只有一份，所以总资金占用不会重复计算
   - 需要在资金分配账户层面进行去重计算
4. **持仓管理**：
   - 策略A和策略B都选择了TSLA.US
   - 如果策略A先买入TSLA.US，策略B检测到已有持仓，可以选择：
     - 方案A：策略B不买入，等待策略A平仓后再买入
     - 方案B：策略B也买入，增加TSLA.US的总持仓
   - 当前系统采用方案B：每个策略独立管理自己的持仓

**交互流程**：
1. 用户创建或修订策略
2. 系统检查是否有其他策略选择了相同的股票
3. 如果有，显示提示信息：该股票已被其他策略选择
4. 用户可以选择是否继续使用该股票

**输入输出**：
- **输入**：策略ID、股票代码
- **输出**：是否有其他策略选择了该股票

**边界条件**：
- 没有其他策略选择该股票：不显示提示
- 多个策略选择了该股票：显示所有策略的名称
- 策略不存在：返回错误提示

**验收标准**：
- [ ] 可以正确检测多策略股票重复
- [ ] 显示清晰的提示信息
- [ ] 规则说明清晰，易于理解

---

## 4. 非功能需求

### 4.1 性能要求
- **响应时间**：获取策略已有持仓 ≤ 500ms
- **并发量**：支持同时修订多个策略
- **可用性**：资金计算准确率 ≥ 95%

### 4.2 安全要求
- 资金计算逻辑必须准确，不能出现资金计算错误
- 持仓数据必须真实可靠，不能出现数据不一致

### 4.3 兼容性要求
- 兼容现有的策略修订流程
- 兼容现有的资金分配逻辑

---

## 5. 技术方案

### 5.1 后端实现

#### 5.1.1 新增API：获取策略已有持仓
```typescript
GET /api/quant/strategies/:id/holdings
Response: {
  success: true,
  data: [
    {
      symbol: "TSLA.US",
      quantity: 6,
      entryPrice: 439.34,
      currentPrice: 450.00,
      holdingValue: 2700.00,
      state: "HOLDING",
      context: { ... }
    }
  ]
}
```

#### 5.1.2 修改API：计算可用资金
```typescript
// 在 getAvailableCapital 方法中，排除已有持仓占用的资金
async getAvailableCapital(strategyId: number): Promise<number> {
  // 1. 计算分配资金总额
  const allocatedAmount = ...;
  
  // 2. 计算已有持仓占用的资金
  const holdings = await this.getStrategyHoldings(strategyId);
  const holdingValue = holdings.reduce((sum, h) => {
    return sum + (h.quantity * h.currentPrice);
  }, 0);
  
  // 3. 计算可用资金
  const availableAmount = allocatedAmount - currentUsage - holdingValue;
  
  return Math.max(0, availableAmount);
}
```

#### 5.1.3 新增方法：获取策略已有持仓
```typescript
async getStrategyHoldings(strategyId: number): Promise<Holding[]> {
  const result = await pool.query(
    `SELECT si.symbol, si.current_state, si.context
     FROM strategy_instances si
     WHERE si.strategy_id = $1 AND si.current_state = 'HOLDING'`,
    [strategyId]
  );
  
  // 获取当前价格并计算持仓价值
  const holdings = await Promise.all(
    result.rows.map(async (row) => {
      const context = row.context || {};
      const quantity = context.quantity || 0;
      const entryPrice = context.entryPrice || 0;
      
      // 获取当前价格
      const tradeCtx = await getTradeContext();
      const quote = await tradeCtx.quote([row.symbol]);
      const currentPrice = quote?.[0]?.lastPrice || entryPrice;
      
      return {
        symbol: row.symbol,
        quantity,
        entryPrice,
        currentPrice: parseFloat(currentPrice),
        holdingValue: quantity * parseFloat(currentPrice),
        state: row.current_state,
        context,
      };
    })
  );
  
  return holdings;
}
```

### 5.2 前端实现

#### 5.2.1 修改 EditStrategyModal 组件
```typescript
// 1. 添加状态管理已有持仓
const [existingHoldings, setExistingHoldings] = useState<Holding[]>([]);

// 2. 加载策略已有持仓
useEffect(() => {
  if (strategy.id) {
    quantApi.getStrategyHoldings(strategy.id).then((res) => {
      if (res.success) {
        setExistingHoldings(res.data || []);
      }
    });
  }
}, [strategy.id]);

// 3. 调整可用资金计算
useEffect(() => {
  if (formData.capitalAllocationId && allocations.length > 0) {
    const allocation = allocations.find(
      (a) => a.id === formData.capitalAllocationId
    );
    if (allocation) {
      // 计算分配资金
      let allocated: number;
      if (allocation.allocationType === 'PERCENTAGE') {
        allocated = totalCapital * parseFloat(allocation.allocationValue || '0');
      } else {
        allocated = parseFloat(allocation.allocationValue || '0');
      }
      
      // 计算已有持仓占用资金
      const holdingValue = existingHoldings.reduce((sum, h) => {
        return sum + (h.quantity * h.currentPrice);
      }, 0);
      
      // 计算可用资金
      const used = parseFloat(allocation.currentUsage || '0');
      const available = Math.max(0, allocated - used - holdingValue);
      
      setAvailableCapital(available);
    }
  }
}, [formData.capitalAllocationId, allocations, totalCapital, existingHoldings]);
```

#### 5.2.2 修改 InstitutionStockSelector 组件
```typescript
// 1. 添加已有持仓标记
interface InstitutionStockSelectorProps {
  // ... existing props
  existingHoldings?: Holding[]; // 新增：已有持仓列表
}

// 2. 在股票列表中标记已有持仓
{holdings.map((stock) => {
  const existingHolding = existingHoldings?.find(h => h.symbol === stock.symbol);
  const isSelected = selectedStocks.some((s) => s.symbol === stock.symbol);
  
  return (
    <tr
      key={stock.symbol}
      className={`hover:bg-gray-50 cursor-pointer ${isSelected ? 'bg-blue-50' : ''} ${existingHolding ? 'bg-yellow-50' : ''}`}
      onClick={() => handleToggleStock(stock)}
    >
      <td className="px-4 py-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => handleToggleStock(stock)}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td className="px-4 py-2 font-mono">
        {stock.symbol}
        {existingHolding && (
          <span className="ml-2 text-xs text-yellow-600" title={`已有持仓: ${existingHolding.quantity}股`}>
            ⚠️
          </span>
        )}
      </td>
      {/* ... other columns */}
    </tr>
  );
})}
```

### 5.3 数据库设计
无需修改数据库结构，使用现有的 `strategy_instances` 表。

---

## 6. 风险评估

### 6.1 技术风险
- **风险**：获取当前价格可能失败，导致资金计算不准确
- **影响**：中（影响资金计算准确性）
- **应对**：使用持仓时的价格作为备选，并记录日志

### 6.2 业务风险
- **风险**：多策略股票重复时的持仓管理规则不清晰
- **影响**：高（影响资金计算和持仓管理）
- **应对**：明确规则说明，并在UI中显示清晰的提示信息

---

## 7. 迭代计划

### 7.1 MVP范围
- 获取策略已有持仓
- 显示已有持仓股票
- 调整资金计算逻辑（排除已有持仓占用）

### 7.2 后续迭代
- **V1.1**：多策略持仓区分规则优化
- **V1.2**：策略持仓的自动平仓功能
- **V1.3**：多策略持仓的合并管理功能

---

## 8. 附录

### 8.1 参考资料
- [策略实例管理文档](../DYNAMIC_TRADING_STRATEGY_IMPLEMENTATION.md)
- [资金分配管理文档](../../api/src/services/capital-manager.service.ts)

### 8.2 变更记录
| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-09 | 初始版本 | AI Product Manager |

