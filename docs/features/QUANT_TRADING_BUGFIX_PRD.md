# 量化交易系统问题修复 - 产品需求文档（PRD）

## 📋 文档信息
- **文档版本**：v1.5
- **创建时间**：2025-12-10
- **最后更新**：2025-12-10
- **文档作者**：AI Product Manager
- **审核状态**：✅ 已审核（代码已核对，订单详情手续费问题已确认无需修复）

## ⚠️ 实施前核对说明

### 现有功能 vs 新增功能

**现有功能（需要修复/优化）：**
1. ✅ 订单详情API (`GET /api/orders/:orderId`) - 已存在，**已正确实现**，手续费为空是正常行为（金额未结算）
2. ❌ 交易记录API (`GET /api/quant/trades`) - **已删除**（2025-12-11），功能已整合到订单管理
3. ✅ 资金管理API (`GET/POST/PUT/DELETE /api/quant/capital/allocations`) - 已存在，需要添加`is_system`字段支持
4. ✅ 量化首页 (`frontend/app/quant/page.tsx`) - 已存在，**已修复**（2025-12-11），改为调用后端API计算统计数据

**新增功能（需要开发）：**
1. ⚠️ Dashboard统计API (`GET /api/quant/dashboard/stats`) - **新增接口**
2. ⚠️ 订单价格审查API (`POST /api/quant/orders/review`) - **新增接口**
3. ⚠️ 保证金比例API (`GET /api/quant/margin-ratio/:symbol`) - **新增接口**（可选，用于后续功能）
4. ⚠️ 资金流水API (`GET /api/quant/cashflow`) - **新增接口**（可选，用于验证）
5. ⚠️ 订单价格审查页面 (`frontend/app/quant/orders/review/page.tsx`) - **新增页面**

### 代码核对结果

**已确认存在的代码：**
- ✅ `api/src/routes/orders.ts` - `mapOrderData`函数存在（第432行），已正确处理`charge_detail`
- ✅ `api/src/routes/orders.ts` - `formatChargeDetail`函数存在（第398行），已正确处理空数据
- ✅ `api/src/routes/orders.ts` - 订单详情API端点存在（第1643行），已正确实现
- ✅ `api/src/routes/quant.ts` - 资金管理API存在（第31-267行）
- ❌ `api/src/routes/quant.ts` - 交易记录API **已删除**（2025-12-11）
- ✅ `frontend/app/quant/page.tsx` - 量化首页存在，**已修复**（2025-12-11），改为调用后端API
- ❌ `frontend/app/quant/trades/page.tsx` - 交易记录页面 **已删除**（2025-12-11）
- ✅ `api/src/services/capital-manager.service.ts` - 资金管理服务存在（第237行`createAllocation`方法）

**需要新增的代码：**
- ⚠️ `api/src/routes/quant.ts` - Dashboard统计API（新增，约第1200行后）
- ⚠️ `api/src/routes/quant.ts` - 订单价格审查API（新增）
- ⚠️ `api/src/routes/quant.ts` - 保证金比例API（新增，可选）
- ⚠️ `api/src/routes/quant.ts` - 资金流水API（新增，可选）
- ⚠️ `frontend/app/quant/orders/review/page.tsx` - 订单价格审查页面（新增）
- ⚠️ `frontend/lib/api.ts` - API客户端方法（新增`getDashboardStats`、`reviewOrders`等）

**需要修改的代码：**
- ❌ `api/src/routes/quant.ts` - 交易记录API **已删除**（2025-12-11），不再需要修改
- ⚠️ `api/src/routes/quant.ts` - 资金管理API（第31-267行），添加`is_system`字段支持
- ⚠️ `api/src/services/capital-manager.service.ts` - `createAllocation`方法（第282行），添加`is_system`字段
- ⚠️ `frontend/app/quant/page.tsx` - 量化首页（第40-72行），改为调用后端API

**数据库变更：**
- ✅ 迁移脚本已创建：`api/migrations/010_add_is_system_to_capital_allocations.sql`
  - 使用英文注释，避免编码错误
  - 包含完整的字段添加、数据更新、索引创建和注释
- ✅ 表结构确认：`capital_allocations`表当前无`is_system`字段（通过`000_init_schema.sql`确认）

### 技术方案核对总结

**✅ 已核对确认：**
1. 订单详情API已正确实现，手续费为空是正常行为（金额未结算时SDK返回空）
2. 所有代码位置已确认存在
3. 所有新增功能已标注清楚
4. 数据库迁移脚本已创建（使用英文注释）
5. API端点路径和参数已确认

**⚠️ 重要修正：**
1. **订单详情手续费问题**：**不是bug**，是长桥SDK的正常行为。
   - **关键规则**：手续费是在所有资金结算后，才会在订单中体现
   - **已结算订单**：`charge_detail`包含完整手续费数据（如订单`1175812133628162048`，`total_amount: "9.31"`）
   - **未结算订单**：`charge_detail`字段结构保留，但`total_amount: "0.00"`，`items[].fees`为空数组（如订单`1183076078529339392`）
   - 当前代码已正确处理此情况，无需修复
2. 价格差异阈值采用动态调整方案（根据股票价格）
3. 今日盈亏计算使用主要数据源+验证数据源方案
4. 所有数据库注释使用英文，避免编码错误
5. 新增接口需要添加到现有路由文件中，不是创建新文件

## ✅ 已确认事项

### 1. 订单详情手续费数据说明
- ✅ **确认结果**：**手续费为空是正常行为，不是bug**
- ✅ **实际情况**：
  - **手续费是在所有资金结算后，才会在订单中体现**
  - 长桥SDK在订单金额未结算时，`charge_detail`字段返回空数据（`total_amount: "0.00"`, `items`数组存在但`fees`为空数组）
  - 已结算的订单会有完整的手续费数据
  - 这是长桥API的正常行为，不是系统bug
  - 当前代码已正确处理此情况：`formatChargeDetail`函数会保留空结构，不会丢失字段
- ✅ **实际案例验证**：
  - **已结算订单**（订单ID: `1175812133628162048`，期权订单）：
    ```json
    {
      "charge_detail": {
        "total_amount": "9.31",
        "currency": "USD",
        "items": [
          {
            "code": 2,
            "name": "Third-party Fees",
            "fees": [
              { "code": "CATFee", "amount": "0.04" },
              { "code": "OptionsClearingFee", "amount": "0.18" },
              { "code": "OptionsExchangeFee", "amount": "1.62" },
              { "code": "OptionsRegulatoryFee", "amount": "0.27" }
            ]
          },
          {
            "code": 1,
            "name": "Broker Fees",
            "fees": [
              { "code": "OptionsCommission", "amount": "4.50" },
              { "code": "OptionsPlatformFee", "amount": "2.70" }
            ]
          }
        ]
      }
    }
    ```
  - **未结算订单**（订单ID: `1183076078529339392`，股票订单）：
    ```json
    {
      "charge_detail": {
        "total_amount": "0.00",
        "currency": "USD",
        "items": [
          {
            "code": 1,
            "name": "Broker Fees",
            "fees": []
          },
          {
            "code": 2,
            "name": "Third-party Fees",
            "fees": []
          }
        ]
      }
    }
    ```
- ✅ **代码确认**：
  - `api/src/routes/orders.ts` - `formatChargeDetail`函数（第398行）已正确处理空数据
  - `api/src/routes/orders.ts` - `mapOrderData`函数（第523行）已正确调用`formatChargeDetail`
  - `api/src/routes/orders.ts` - 订单详情API（第1643行）已正确返回数据
- ✅ **结论**：**无需修复**，当前实现已正确。手续费数据会在订单结算后自动更新。

### 2. 价格差异阈值标准
- ✅ **确认结果**：采用**方案2 - 根据股票价格动态调整**
- ✅ **实施方案**：
  - 低价股允许更大的价格差异（因为绝对金额小）
  - 高价股使用更严格的价格差异标准
  - 动态阈值计算公式：
    ```typescript
    function getPriceThreshold(price: number): number {
      if (price < 1) return 5.0;      // 低于$1，允许5%差异
      if (price < 10) return 2.0;     // $1-$10，允许2%差异
      if (price < 50) return 1.0;     // $10-$50，允许1%差异
      return 0.5;                     // 高于$50，允许0.5%差异
    }
    ```
  - 支持配置：前端可配置基础阈值，系统根据价格动态调整
- ✅ **默认值**：基础阈值1%（可根据股票价格动态调整）

### 3. 今日盈亏数据来源
- ✅ **确认结果**：按照建议方案实施
- ✅ **数据来源优先级**：
  1. **主要数据源**：`auto_trades`表（已平仓交易盈亏）+ 长桥持仓API（持仓盈亏）
  2. **验证数据源**：长桥账户资金API（`accountBalance`）用于验证总资产变化
  3. **辅助验证**：长桥股票持仓API（`stockPositions`）验证持仓盈亏准确性
- ✅ **实施逻辑**：
  - 计算时使用主要数据源
  - 定期（如每小时）使用验证数据源对比，发现差异时记录警告日志
  - 前端显示时优先显示主要数据源计算结果，可提供"验证"按钮查看验证数据源结果

---

## 1. 背景与目标

### 1.1 业务背景
量化交易系统在生产环境中运行一段时间后，发现多个关键功能存在数据错误和功能缺陷，影响用户对交易数据的准确性和系统可用性的信任。这些问题主要集中在：
- 订单执行数据的完整性和准确性
- 交易统计数据的计算逻辑
- 资金管理功能的可用性

### 1.2 用户痛点
- **数据准确性担忧**：用户无法信任系统显示的盈亏和手续费数据，影响交易决策
- **功能受限**：资金管理功能中，新增账户无法删除和编辑，影响资金分配管理
- **数据缺失**：订单详情中缺少手续费等关键信息，无法进行准确的成本核算
- **策略监控困难**：无法准确判断策略是否按预期执行，特别是订单价格是否正确

### 1.3 业务目标
- **主要目标**：修复所有已知的数据错误和功能缺陷，确保系统数据准确性和功能完整性
- **成功指标**：
  - ~~订单详情数据完整率 ≥ 100%~~ ✅ **已确认无需修复**（当前实现已正确）
  - 今日盈亏计算准确率 = 100%（与长桥账户数据一致）
  - 今日交易数据准确率 = 100%（与实际成交订单一致）
  - 总盈亏和总手续费计算准确率 = 100%
  - 资金管理功能可用性 = 100%（所有账户可正常编辑和删除，除GLOBAL系统账户）

### 1.4 项目范围
- **包含范围**：
  - ~~订单详情数据完整性修复~~ ✅ **已确认无需修复**（手续费为空是正常行为）
  - 今日盈亏数据计算逻辑修复（改为后端API计算）
  - 今日交易数据统计逻辑修复（改为后端API计算）
  - 交易记录总盈亏和总手续费计算修复（添加后端统计）
  - 资金管理账户类型标识和权限控制修复（添加`is_system`字段）
  - 订单价格审查工具开发（新增功能）
- **不包含范围**：
  - 订单详情数据修复（已确认无需修复）
  - 新的功能开发（除订单价格审查工具外）
  - 性能优化（本次迭代不涉及）
  - UI/UX改进（本次迭代不涉及）

---

## 2. 用户与场景

### 2.1 目标用户
- **主要用户**：量化交易员、策略管理员
- **用户特征**：
  - 需要准确的数据进行交易决策
  - 需要管理多个资金分配账户
  - 需要监控策略执行情况

### 2.2 使用场景

**场景1：审查昨日交易策略执行情况**
- **用户**：量化交易员
- **时间**：每日开盘前
- **地点**：办公室
- **行为**：查看昨日交易日志和订单数据，检查策略是否正确执行，特别是订单价格是否正确
- **目标**：确保策略按预期执行，发现异常及时调整

**场景2：查看今日交易盈亏**
- **用户**：量化交易员
- **时间**：交易时段
- **地点**：办公室
- **行为**：在量化交易首页查看今日盈亏和交易数据
- **目标**：实时了解今日交易表现

**场景3：分析历史交易记录**
- **用户**：策略管理员
- **时间**：策略复盘时
- **地点**：办公室
- **行为**：查看交易记录页面的总盈亏和总手续费数据
- **目标**：评估策略整体表现，计算实际收益

**场景4：管理资金分配账户**
- **用户**：策略管理员
- **时间**：策略配置时
- **地点**：办公室
- **行为**：新增、编辑、删除资金分配账户
- **目标**：灵活配置资金分配策略

### 2.3 用户故事
- ~~As a 量化交易员, I want 查看准确的订单详情（包含手续费）, So that 我可以进行准确的成本核算~~ ✅ **已满足**（手续费为空是正常行为，会在结算后更新）
- As a 量化交易员, I want 查看准确的今日盈亏数据, So that 我可以实时了解交易表现
- As a 策略管理员, I want 查看准确的交易统计数据, So that 我可以评估策略效果
- As a 策略管理员, I want 管理资金分配账户（编辑和删除）, So that 我可以灵活配置资金分配
- As a 量化交易员, I want 审查订单价格是否正确, So that 我可以确保策略按预期执行

---

## 3. 功能需求

### 3.1 功能概览
| 功能 | 优先级 | 说明 | 状态 |
|------|--------|------|------|
| ~~订单详情数据完整性修复~~ | ~~P0~~ | ~~恢复所有长桥SDK返回的字段~~ | ✅ **已确认无需修复**（手续费为空是正常行为） |
| 订单价格审查工具 | P0 | 开发工具审查订单价格是否正确 | ⚠️ 待开发 |
| 今日盈亏计算修复 | P0 | 修复今日盈亏计算逻辑（改为后端API计算） | ⚠️ 待修复 |
| 今日交易数据统计修复 | P0 | 修复今日交易数量统计逻辑（改为后端API计算） | ⚠️ 待修复 |
| 总盈亏和总手续费计算修复 | P0 | 修复交易记录页面的统计数据计算 | ⚠️ 待修复 |
| 资金管理账户类型修复 | P1 | 修复账户类型标识，允许非系统账户编辑和删除 | ⚠️ 待修复 |

### 3.2 功能详细说明

#### 功能1：订单详情数据完整性说明（已正确实现）
**优先级**：~~P0~~ **已确认无需修复**

**功能描述**：
订单详情API已正确实现，手续费数据为空是长桥SDK的正常行为（金额未结算时）。

**实际情况说明**：
- **当前状态**：订单详情API已正确实现，数据封装逻辑正确
- **手续费数据规则**：**手续费是在所有资金结算后，才会在订单中体现**
  - **已结算订单**：`charge_detail`包含完整的手续费数据（`total_amount`有值，`items[].fees`有明细）
  - **未结算订单**：`charge_detail`字段结构保留，但`total_amount: "0.00"`，`items[].fees`为空数组
  - 这是长桥API的正常行为，不是系统bug
  - 手续费数据会在订单结算后自动更新
- **实际案例**：
  - ✅ **已结算订单示例**：订单ID `1175812133628162048`（期权订单），`charge_detail.total_amount: "9.31"`，包含完整手续费明细
  - ✅ **未结算订单示例**：订单ID `1183076078529339392`（股票订单），`charge_detail.total_amount: "0.00"`，`items`结构保留但`fees`为空
- **代码确认**：
  - `api/src/routes/orders.ts` - `formatChargeDetail`函数（第398行）已正确处理空数据
  - `api/src/routes/orders.ts` - `mapOrderData`函数（第523行）已正确调用`formatChargeDetail`
  - `api/src/routes/orders.ts` - 订单详情API（第1643行）已正确返回数据

**当前实现**：
```typescript
// api/src/routes/orders.ts 第398行
function formatChargeDetail(chargeDetail: any): any {
  if (!chargeDetail) {
    return {
      total_amount: '0',
      currency: '',
      items: [],
    };
  }
  
  return {
    total_amount: chargeDetail.totalAmount?.toString() || chargeDetail.total_amount?.toString() || '0',
    currency: chargeDetail.currency || '',
    items: Array.isArray(chargeDetail.items) ? chargeDetail.items.map((item: any) => ({
      code: item.code || 'UNKNOWN',
      name: item.name || '',
      fees: Array.isArray(item.fees) ? item.fees.map((fee: any) => ({
        code: fee.code || '',
        name: fee.name || '',
        amount: fee.amount?.toString() || '0',
        currency: fee.currency || '',
      })) : [],
    })) : [],
  };
}

// api/src/routes/orders.ts 第1643行
ordersRouter.get('/:orderId', async (req: Request, res: Response) => {
  const orderDetail = await tradeCtx.orderDetail(orderId);
  const mappedOrder = mapOrderData(orderDetail); // 已正确处理charge_detail
  res.json({ success: true, data: { order: mappedOrder } });
});
```

**结论**：
- ✅ **无需修复**：当前实现已正确
- ✅ **数据完整性**：所有字段都已正确保留
- ✅ **手续费处理**：
  - 已结算订单：完整手续费数据正确返回
  - 未结算订单：字段结构保留，`total_amount: "0.00"`，`items`结构完整但`fees`为空数组
- ✅ **后续更新**：手续费数据会在订单结算后自动更新（无需手动操作）

**验收标准**（已满足）：
- [x] 订单详情API返回的数据结构完整
- [x] `charge_detail`字段完整保留（即使数据为空）
- [x] `charge_detail.total_amount`字段存在
- [x] `charge_detail.items`数组存在（即使为空数组）
- [x] 所有长桥SDK字段都被保留，无字段丢失

---

#### 功能2：订单价格审查工具
**优先级**：P0

**功能描述**：
开发一个日常监控工具，用于审查订单价格是否正确，对比订单日志和订单详情数据，检查是否存在价格异常，支持前端展示和JSON报告下载。

**使用场景**：
- **日常监控工具**：用于后续审计需求，定期检查订单执行情况
- **输出格式**：
  - 前端页面展示：实时查看审查结果
  - JSON报告下载：支持导出审查报告

**交互流程**：
1. 用户打开订单审查页面
2. 用户选择审查日期范围（默认昨日）
3. 系统调用后端API进行审查
4. 后端读取交易日志（`log.log`）和订单历史数据（`history.json`或从数据库获取）
5. 后端对比日志中的订单价格和订单详情中的价格
6. 后端生成审查报告
7. 前端展示审查结果，支持下载JSON报告

**输入输出**：
- **输入**：
  - 日期范围（开始日期、结束日期）
  - 可选：日志文件路径、订单历史数据源（文件或数据库）
- **输出**：审查报告，包含：
  - 正常订单列表
  - 异常订单列表（价格不匹配、价格异常等）
  - 统计信息（总订单数、异常订单数、异常率）

**审查标准**：
- **价格差异阈值**：采用**根据股票价格动态调整**方案（已确认）
  - 动态阈值计算：
    ```typescript
    /**
     * 根据股票价格计算价格差异阈值
     * @param price 股票价格
     * @param baseThreshold 基础阈值（默认1%，可配置）
     * @returns 价格差异阈值（百分比）
     */
    function calculatePriceThreshold(price: number, baseThreshold: number = 1.0): number {
      if (price < 1) return Math.max(baseThreshold, 5.0);      // 低于$1，至少5%
      if (price < 10) return Math.max(baseThreshold, 2.0);    // $1-$10，至少2%
      if (price < 50) return Math.max(baseThreshold, 1.0);     // $10-$50，至少1%
      return Math.max(baseThreshold * 0.5, 0.5);              // 高于$50，至少0.5%
    }
    ```
  - 阈值说明：
    - 低价股（<$1）：允许5%差异（因为$0.01的差异就是1%）
    - 中低价股（$1-$10）：允许2%差异
    - 中价股（$10-$50）：允许1%差异
    - 高价股（>$50）：允许0.5%差异（更严格）
  - 可配置：前端可设置基础阈值，系统根据股票价格动态调整

**审查逻辑**：
```typescript
interface OrderReviewResult {
  orderId: string;
  symbol: string;
  logPrice: number;      // 日志中的价格
  orderPrice: number;    // 订单详情中的价格
  executedPrice: number; // 成交价格
  priceDiff: number;     // 价格差异
  priceDiffPercent: number; // 价格差异百分比
  threshold: number;     // 使用的阈值
  status: 'normal' | 'warning' | 'error';
  reason: string;
}

/**
 * 根据股票价格计算价格差异阈值
 * @param price 股票价格
 * @param baseThreshold 基础阈值（默认1%，可配置）
 * @returns 价格差异阈值（百分比）
 */
function calculatePriceThreshold(price: number, baseThreshold: number = 1.0): number {
  if (price < 1) return Math.max(baseThreshold, 5.0);      // 低于$1，至少5%
  if (price < 10) return Math.max(baseThreshold, 2.0);    // $1-$10，至少2%
  if (price < 50) return Math.max(baseThreshold, 1.0);     // $10-$50，至少1%
  return Math.max(baseThreshold * 0.5, 0.5);              // 高于$50，至少0.5%
}

// 审查逻辑
function reviewOrder(
  logOrder: any, 
  orderDetail: any, 
  baseThreshold: number = 1.0
): OrderReviewResult {
  const logPrice = parseFloat(logOrder.price);
  const orderPrice = parseFloat(orderDetail.price || '0');
  const executedPrice = parseFloat(orderDetail.executed_price || '0');
  
  // 根据股票价格动态计算阈值
  const threshold = calculatePriceThreshold(orderPrice || logPrice, baseThreshold);
  
  // 计算价格差异
  const priceDiff = Math.abs(orderPrice - logPrice);
  const priceDiffPercent = logPrice > 0 ? (priceDiff / logPrice) * 100 : 0;
  
  // 判断是否异常
  let status: 'normal' | 'warning' | 'error' = 'normal';
  let reason = '';
  
  if (priceDiffPercent > threshold) {
    status = 'error';
    reason = `价格差异超过阈值: ${priceDiffPercent.toFixed(2)}% (阈值: ${threshold.toFixed(2)}%)`;
  } else if (priceDiffPercent > threshold * 0.5) {
    status = 'warning';
    reason = `价格差异较大: ${priceDiffPercent.toFixed(2)}% (阈值: ${threshold.toFixed(2)}%)`;
  }
  
  // 检查成交价格是否合理（成交价格与订单价格差异超过10%视为异常）
  if (executedPrice > 0 && orderPrice > 0) {
    const executedDiffPercent = Math.abs(executedPrice - orderPrice) / orderPrice * 100;
    if (executedDiffPercent > 10) {
      status = 'error';
      reason += `; 成交价格异常: ${executedPrice} vs 订单价格 ${orderPrice} (差异: ${executedDiffPercent.toFixed(2)}%)`;
    }
  }
  
  return {
    orderId: orderDetail.order_id,
    symbol: orderDetail.symbol,
    logPrice,
    orderPrice,
    executedPrice,
    priceDiff,
    priceDiffPercent,
    threshold,
    status,
    reason,
  };
}
```

**边界条件**：
- 日志文件不存在：返回错误，提示用户检查文件路径
- 订单历史数据不存在：标记为缺失，记录警告
- 订单在日志中但不在历史数据中：标记为缺失
- 价格差异在合理范围内：视为正常
- 订单状态为未成交：跳过审查（只审查已成交订单）
- 价格数据格式错误：记录错误日志，标记为异常

**验收标准**：
- [ ] 能够读取和解析日志文件
- [ ] 能够读取和解析订单历史数据（JSON文件或数据库）
- [ ] 能够对比订单价格（日志价格 vs 订单详情价格）
- [ ] 能够识别价格异常（价格差异超过阈值）
- [ ] 前端页面展示审查结果（表格形式）
- [ ] 支持下载JSON格式的审查报告
- [ ] 支持选择审查日期范围
- [ ] 支持配置价格差异阈值

**技术实现要点**：

1. **后端API实现**（**新增接口**）：
   - 创建新接口：`POST /api/quant/orders/review`
   - 文件位置：`api/src/routes/quant.ts`（在现有quantRouter中添加）
   - **注意**：此接口目前不存在，需要新增
   - 实现逻辑：
     ```typescript
     quantRouter.post('/orders/review', async (req, res, next) => {
       try {
         const { startDate, endDate, baseThreshold = 1.0 } = req.body; // 基础阈值，默认1%
         
         // 1. 读取日志文件，提取订单信息
         const logOrders = await parseLogFile('log.log', startDate, endDate);
         
         // 2. 获取订单历史数据（从数据库或文件）
         const orderDetails = await getOrderDetails(startDate, endDate);
         
         // 3. 对比价格，识别异常（使用动态阈值）
         const results: OrderReviewResult[] = [];
         for (const logOrder of logOrders) {
           const orderDetail = orderDetails.find(o => o.order_id === logOrder.orderId);
           if (orderDetail) {
             const result = reviewOrder(logOrder, orderDetail, baseThreshold);
             results.push(result);
           } else {
             results.push({
               orderId: logOrder.orderId,
               symbol: logOrder.symbol,
               logPrice: parseFloat(logOrder.price || '0'),
               orderPrice: 0,
               executedPrice: 0,
               priceDiff: 0,
               priceDiffPercent: 0,
               threshold: baseThreshold,
               status: 'error',
               reason: '订单数据缺失',
             });
           }
         }
         
         // 4. 生成统计信息
         const stats = {
           totalOrders: results.length,
           normalOrders: results.filter(r => r.status === 'normal').length,
           warningOrders: results.filter(r => r.status === 'warning').length,
           errorOrders: results.filter(r => r.status === 'error').length,
           errorRate: results.length > 0 
             ? (results.filter(r => r.status === 'error').length / results.length) * 100 
             : 0,
         };
         
         res.json({
           success: true,
           data: {
             results,
             stats,
             reviewDate: new Date().toISOString(),
             dateRange: { startDate, endDate },
             baseThreshold, // 基础阈值
             thresholdNote: '实际阈值根据股票价格动态调整',
           },
         });
       } catch (error) {
         next(error);
       }
     });
     ```

2. **前端页面实现**（**新增页面**）：
   - 创建新页面：`frontend/app/quant/orders/review/page.tsx`
   - **注意**：此页面目前不存在，需要新增
   - 功能：
     - 日期范围选择器
     - 价格差异阈值配置（默认1%）
     - 审查结果表格展示（正常/警告/异常）
     - 统计信息卡片展示
     - JSON报告下载按钮
   - 实现逻辑：
     ```typescript
     const handleReview = async () => {
       try {
         setLoading(true);
         const response = await quantApi.reviewOrders({
           startDate: dateRange[0],
           endDate: dateRange[1],
           baseThreshold: thresholdPercent, // 基础阈值，系统会根据股票价格动态调整
         });
         
         if (response.success) {
           setReviewResults(response.data.results);
           setStats(response.data.stats);
         }
       } catch (error) {
         // 错误处理
       } finally {
         setLoading(false);
       }
     };
     
     const handleDownloadReport = () => {
       const report = {
         reviewDate: new Date().toISOString(),
         dateRange,
         baseThreshold: thresholdPercent, // 基础阈值
         thresholdNote: '实际阈值根据股票价格动态调整',
         stats,
         results: reviewResults,
       };
       const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = `order-review-${dateRange[0]}-${dateRange[1]}.json`;
       a.click();
     };
     ```

3. **日志解析工具**：
   - 创建工具函数：`api/src/utils/log-parser.ts`
   - 功能：解析日志文件，提取订单信息
   - 实现逻辑：
     ```typescript
     interface LogOrder {
       orderId: string;
       symbol: string;
       price: number;
       quantity: number;
       side: 'BUY' | 'SELL';
       timestamp: Date;
     }
     
     export async function parseLogFile(
       filePath: string,
       startDate: Date,
       endDate: Date
     ): Promise<LogOrder[]> {
       const logContent = await fs.readFile(filePath, 'utf-8');
       const lines = logContent.split('\n');
       const orders: LogOrder[] = [];
       
       // 解析日志行，提取订单信息
       // 例如：[2025-12-10 09:38:58.245] 策略 5 标的 TWST.US 买入订单已成交，更新状态为HOLDING，订单ID: 1183076078529339392
       // 需要根据实际日志格式编写解析逻辑
       
       return orders;
     }
     ```

4. **API客户端添加**：
   - 文件位置：`frontend/lib/api.ts`
   - 在`quantApi`对象中添加：
     ```typescript
     reviewOrders: (params: {
       startDate: string;
       endDate: string;
       baseThreshold?: number; // 基础阈值（默认1%），系统会根据股票价格动态调整
     }) => {
       return api.post('/quant/orders/review', params);
     },
     ```

5. **价格差异阈值配置**：
   - **待确认**：需要用户确认合理的价格差异标准
   - 建议默认值：1%（可配置）
   - 支持根据股票价格、订单类型动态调整

---

#### 功能3：今日盈亏计算修复
**优先级**：P0

**功能描述**：
修复量化交易首页的今日盈亏计算逻辑，确保正确统计已平仓交易盈亏和持仓盈亏。

**问题分析**：
- **当前问题**：
  - 今日盈亏显示为0，功能可能未实现
  - 当前实现：`frontend/app/quant/page.tsx`第53-55行，只统计了`open_time`为今日且`pnl`存在的交易
  - 问题：只统计已平仓交易，未统计持仓盈亏；且可能因为`pnl`字段为空导致统计为0
- **数据来源确认**：
  - 前端从`auto_trades`表获取数据（通过`quantApi.getTrades`）
  - 需要确认：是否应该从长桥账户资金、股票持仓、当日订单来核查
- **对比基准**：
  - 使用长桥账户资金API验证
  - 使用长桥股票持仓API验证
  - 使用长桥当日/历史订单API验证

**交互流程**：
1. 用户打开量化交易首页
2. 系统调用后端API获取今日统计数据
3. 后端计算今日盈亏：
   - 已平仓交易盈亏：从`auto_trades`表查询今日平仓的交易
   - 持仓盈亏：从长桥持仓API获取当前持仓，计算浮动盈亏
4. 系统显示今日盈亏数据

**输入输出**：
- **输入**：
  - 今日交易记录（`auto_trades`表，`close_time`为今日）
  - 当前持仓（长桥`stockPositions` API）
  - 当前价格（长桥行情API）
- **输出**：今日盈亏金额（USD）

**计算逻辑**：
```typescript
// 今日盈亏 = 已平仓交易盈亏 + 持仓盈亏

// 1. 已平仓交易盈亏（从auto_trades表）
const closedTradesPnl = await db.query(`
  SELECT SUM(pnl) as total_pnl 
  FROM auto_trades 
  WHERE DATE(close_time) = CURRENT_DATE 
    AND status = 'FILLED'
    AND pnl IS NOT NULL
`);

// 2. 持仓盈亏（从长桥持仓API）
const positions = await tradeCtx.stockPositions();
const holdingPnl = positions.reduce((sum, pos) => {
  const currentPrice = getCurrentPrice(pos.symbol);
  const costPrice = parseFloat(pos.costPrice || '0');
  const quantity = parseInt(pos.quantity || '0');
  const pnl = (currentPrice - costPrice) * quantity;
  return sum + pnl;
}, 0);

// 3. 今日盈亏
const todayPnl = closedTradesPnl + holdingPnl;
```

**边界条件**：
- 无交易记录：显示0
- 无持仓：只计算已平仓交易盈亏
- 价格数据缺失：使用最新成交价（`last_done`）或跳过该持仓
- `pnl`字段为null：视为0，不参与计算
- 持仓成本价为0：跳过该持仓，记录警告日志

**验收标准**：
- [ ] 今日盈亏计算准确（与长桥账户数据一致）
- [ ] 包含已平仓交易盈亏（`close_time`为今日的交易）
- [ ] 包含持仓盈亏（当前持仓的浮动盈亏）
- [ ] 数据实时更新（页面刷新时重新计算）
- [ ] 与长桥账户资金API数据对比验证

**技术实现要点**：

1. **后端API实现**（**新增接口**）：
   - 创建新接口：`GET /api/quant/dashboard/stats`
   - 文件位置：`api/src/routes/quant.ts`（在现有quantRouter中添加）
   - **注意**：此接口目前不存在，需要新增
   - 实现逻辑：
     ```typescript
     quantRouter.get('/dashboard/stats', async (req, res, next) => {
       try {
         // 1. 获取今日已平仓交易盈亏（主要数据源）
         const closedTradesResult = await pool.query(`
           SELECT COALESCE(SUM(pnl), 0) as total_pnl
           FROM auto_trades
           WHERE DATE(close_time) = CURRENT_DATE
             AND status = 'FILLED'
             AND pnl IS NOT NULL
         `);
         const closedTradesPnl = parseFloat(closedTradesResult.rows[0].total_pnl || '0');
         
         // 2. 获取持仓盈亏（主要数据源）
         const { getTradeContext } = await import('../config/longport');
         const tradeCtx = await getTradeContext();
         const positions = await tradeCtx.stockPositions();
         
         let holdingPnl = 0;
         for (const pos of positions) {
           const symbol = pos.symbol;
           const costPrice = parseFloat(pos.costPrice?.toString() || '0');
           const quantity = parseInt(pos.quantity?.toString() || '0');
           
           if (costPrice > 0 && quantity > 0) {
             // 获取当前价格
             const { getQuoteContext } = await import('../config/longport');
             const quoteCtx = await getQuoteContext();
             const quote = await quoteCtx.quote([symbol]);
             const currentPrice = parseFloat(quote[0]?.lastPrice?.toString() || '0');
             
             if (currentPrice > 0) {
               holdingPnl += (currentPrice - costPrice) * quantity;
             }
           }
         }
         
         // 3. 计算今日交易数量
         const todayOrdersResult = await pool.query(`
           SELECT COUNT(*) as count
           FROM execution_orders
           WHERE DATE(created_at) = CURRENT_DATE
             AND current_status IN ('FILLED', 'PARTIALLY_FILLED')
         `);
         const todayTrades = parseInt(todayOrdersResult.rows[0].count || '0');
         
         // 4. 验证数据（辅助验证，不阻塞主流程）
         let verificationData = null;
         try {
           // 使用长桥账户资金API验证总资产变化
           const accountBalance = await tradeCtx.accountBalance();
           verificationData = {
             totalAssets: parseFloat(accountBalance.totalAssets?.toString() || '0'),
             availableCash: parseFloat(accountBalance.availableCash?.toString() || '0'),
             // 可以对比今日盈亏与账户资产变化
           };
         } catch (error) {
           logger.warn('获取账户资金验证数据失败:', error);
         }
         
         const todayPnl = closedTradesPnl + holdingPnl;
         
         res.json({
           success: true,
           data: {
             todayPnl, // 主要数据源计算结果
             todayTrades,
             closedTradesPnl,
             holdingPnl,
             verificationData, // 验证数据（可选）
           },
         });
       } catch (error) {
         next(error);
       }
     });
     ```

2. **前端调用修改**：
   - 文件位置：`frontend/app/quant/page.tsx`
   - 修改`loadData`函数：
     ```typescript
     const loadData = async () => {
       try {
         setLoading(true);
         
         const strategiesRes = await quantApi.getStrategies();
         const strategies = strategiesRes.data || [];
         const runningStrategies = strategies.filter((s: any) => s.status === 'RUNNING').length;
         
         const capitalRes = await quantApi.getCapitalUsage();
         const totalCapital = capitalRes.data?.totalCapital || 0;
         
         // 调用新的统计接口
         const statsRes = await quantApi.getDashboardStats();
         const todayPnl = statsRes.data?.todayPnl || 0;
         const todayTrades = statsRes.data?.todayTrades || 0;
         
         setOverview({
           runningStrategies,
           totalCapital,
           todayTrades,
           todayPnl,
         });
         
         // ... 其他代码
       } catch (error) {
         console.error('加载数据失败:', error);
       } finally {
         setLoading(false);
       }
     };
     ```

3. **API客户端添加**：
   - 文件位置：`frontend/lib/api.ts`
   - 在`quantApi`对象中添加：
     ```typescript
     getDashboardStats: () => {
       return api.get('/quant/dashboard/stats');
     },
     ```

4. **数据验证**：
   - 使用长桥账户资金API（`accountBalance`）验证总资产变化
   - 使用长桥股票持仓API（`stockPositions`）验证持仓盈亏
   - 使用长桥当日订单API（`todayOrders`）验证交易数量

---

#### 功能4：今日交易数据统计修复
**优先级**：P0

**功能描述**：
修复量化交易首页的今日交易数量统计逻辑，确保统计实际成交订单数量，而不是受limit限制的交易记录数量。

**问题分析**：
- **当前问题**：
  - 总交易数等于交易记录中的`limit`字段值（如100），而不是实际交易数量
  - 当前实现：`frontend/app/quant/page.tsx`第47-52行，从`quantApi.getTrades({ limit: 100 })`获取数据，然后统计`open_time`为今日的记录数量
  - 问题：统计的是返回的交易记录数量（受limit限制），而不是实际的今日交易数量
- **统计口径**：
  - 应该统计：今日已成交订单数量（包括买入和卖出）
  - 数据来源：从`execution_orders`表或长桥`todayOrders` API获取

**交互流程**：
1. 用户打开量化交易首页
2. 系统调用后端API获取今日交易统计
3. 后端从数据库或长桥API获取今日已成交订单
4. 系统统计今日交易数量（包括买入和卖出）
5. 系统显示今日交易数据

**输入输出**：
- **输入**：
  - 今日订单数据（`execution_orders`表或长桥`todayOrders` API）
- **输出**：今日交易数量（已成交订单数）

**统计逻辑**：
```typescript
// 方案1：从数据库统计（推荐，性能更好）
const todayTradesResult = await pool.query(`
  SELECT COUNT(*) as count
  FROM execution_orders
  WHERE DATE(created_at) = CURRENT_DATE
    AND current_status IN ('FILLED', 'PARTIALLY_FILLED')
`);
const todayTrades = parseInt(todayTradesResult.rows[0].count || '0');

// 方案2：从长桥API统计
const tradeCtx = await getTradeContext();
const todayOrders = await tradeCtx.todayOrders({});
const todayTrades = todayOrders.filter(order => {
  const status = order.status?.toString() || '';
  const filledStatuses = ['FilledStatus', 'PartialFilledStatus'];
  return filledStatuses.includes(status);
}).length;
```

**边界条件**：
- 无订单：显示0
- 订单状态为未成交：不统计（只统计`FILLED`和`PARTIALLY_FILLED`）
- 时区问题：使用数据库服务器时区或UTC时区判断"今日"
- 部分成交订单：统计为1笔交易（不是按成交数量统计）

**验收标准**：
- [ ] 今日交易数量统计准确（与实际成交订单一致）
- [ ] 包含买入和卖出订单
- [ ] 只统计已成交订单（`FILLED`和`PARTIALLY_FILLED`状态）
- [ ] 不受前端limit参数影响
- [ ] 时区处理正确（使用数据库时区）

**技术实现要点**：

1. **后端API实现**（已在功能3中实现）：
   - 接口：`GET /api/quant/dashboard/stats`
   - 在统计接口中添加今日交易数量计算
   - 文件位置：`api/src/routes/quant.ts`

2. **前端调用修改**：
   - 文件位置：`frontend/app/quant/page.tsx`
   - 修改`loadData`函数，使用新的统计接口
   - 移除原有的交易记录过滤逻辑

3. **数据库查询优化**：
   - 使用索引加速查询：`CREATE INDEX IF NOT EXISTS idx_execution_orders_created_status ON execution_orders(created_at, current_status);`
   - 考虑缓存今日统计数据（5分钟过期）

4. **时区处理**：
   - 数据库使用UTC时区存储时间
   - 前端根据用户时区显示"今日"
   - 后端查询时使用`CURRENT_DATE`（数据库服务器时区）或`DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE`

---

#### 功能5：总盈亏和总手续费计算修复
**优先级**：P0

**功能描述**：
修复交易记录页面的总盈亏和总手续费计算逻辑，确保正确统计所有交易（包括未平仓持仓）的盈亏和手续费。

**问题分析**：
- **当前问题**：
  - 总盈亏：可能只统计了已平仓交易，未统计持仓盈亏
  - 总手续费：数据缺失（为0），因为订单详情中`charge_detail`数据为空
- **计算要求**：
  - 总盈亏：应该全部计入，包括已平仓交易盈亏和持仓盈亏
  - 总手续费：应该统计所有交易的手续费（包括开仓和平仓）

**交互流程**：
1. 用户打开交易记录页面
2. 系统调用后端API获取交易记录和统计数据
3. 后端计算总盈亏和总手续费
4. 系统显示统计数据

**输入输出**：
- **输入**：
  - 交易记录列表（`auto_trades`表）
  - 当前持仓（长桥`stockPositions` API，用于计算持仓盈亏）
  - 订单详情（用于获取手续费）
- **输出**：总盈亏、总手续费

**计算逻辑**：
```typescript
// 1. 总盈亏 = 已平仓交易盈亏 + 持仓盈亏
const closedTradesPnl = await pool.query(`
  SELECT COALESCE(SUM(pnl), 0) as total_pnl
  FROM auto_trades
  WHERE status = 'FILLED'
    AND close_time IS NOT NULL
    AND pnl IS NOT NULL
`);

// 获取持仓盈亏
const positions = await tradeCtx.stockPositions();
const holdingPnl = positions.reduce((sum, pos) => {
  const currentPrice = getCurrentPrice(pos.symbol);
  const costPrice = parseFloat(pos.costPrice || '0');
  const quantity = parseInt(pos.quantity || '0');
  return sum + (currentPrice - costPrice) * quantity;
}, 0);

const totalPnl = closedTradesPnl + holdingPnl;

// 2. 总手续费 = SUM(所有交易的手续费)
// 方案1：从auto_trades表的fees字段统计（如果数据完整）
const feesFromTrades = await pool.query(`
  SELECT COALESCE(SUM(fees), 0) as total_fees
  FROM auto_trades
  WHERE fees IS NOT NULL
`);

// 方案2：从订单详情获取手续费（如果auto_trades表数据不完整）
// 需要遍历所有订单，调用orderDetail API获取charge_detail
const orders = await pool.query(`
  SELECT DISTINCT order_id 
  FROM execution_orders
  WHERE current_status IN ('FILLED', 'PARTIALLY_FILLED')
`);
let totalFees = 0;
for (const order of orders.rows) {
  const orderDetail = await tradeCtx.orderDetail(order.order_id);
  const chargeDetail = orderDetail.chargeDetail || orderDetail.charge_detail;
  if (chargeDetail && chargeDetail.total_amount) {
    totalFees += parseFloat(chargeDetail.total_amount.toString());
  }
}
```

**边界条件**：
- 无交易记录：显示0
- `pnl`或`fees`字段为空：视为0
- 持仓成本价为0：跳过该持仓，记录警告日志
- 订单详情获取失败：记录错误日志，该订单手续费视为0
- 数据格式错误：记录错误日志，但不影响其他数据计算

**验收标准**：
- [ ] 总盈亏计算准确（包括已平仓交易盈亏和持仓盈亏）
- [ ] 总手续费计算准确（包含所有交易的手续费）
- [ ] 数据格式处理正确（处理null、undefined等情况）
- [ ] 计算性能良好（大数据量下不卡顿，考虑批量查询优化）
- [ ] 与长桥账户资金API数据对比验证

**技术实现要点**：

1. **后端API实现**（**修改现有接口**）：
   - 修改接口：`GET /api/quant/trades`（已存在，第1193行）
   - 文件位置：`api/src/routes/quant.ts`
   - **注意**：此接口已存在，需要添加统计数据计算逻辑
   - 添加统计数据计算：
     ```typescript
     quantRouter.get('/trades', async (req, res, next) => {
       try {
         const { strategyId, symbol, limit = 100 } = req.query;
         
         // 获取交易记录（原有逻辑）
         let query = 'SELECT * FROM auto_trades WHERE 1=1';
         // ... 查询逻辑
         
         const result = await pool.query(query, params);
         
         // 计算统计数据
         // 1. 总盈亏
         const pnlQuery = 'SELECT COALESCE(SUM(pnl), 0) as total_pnl FROM auto_trades WHERE status = $1 AND close_time IS NOT NULL';
         const pnlResult = await pool.query(pnlQuery, ['FILLED']);
         const closedTradesPnl = parseFloat(pnlResult.rows[0].total_pnl || '0');
         
         // 获取持仓盈亏
         const { getTradeContext } = await import('../config/longport');
         const tradeCtx = await getTradeContext();
         const positions = await tradeCtx.stockPositions();
         
         let holdingPnl = 0;
         for (const pos of positions) {
           // ... 计算持仓盈亏逻辑
         }
         
         const totalPnl = closedTradesPnl + holdingPnl;
         
         // 2. 总手续费
         // 优先从auto_trades表获取
         const feesQuery = 'SELECT COALESCE(SUM(fees), 0) as total_fees FROM auto_trades WHERE fees IS NOT NULL';
         const feesResult = await pool.query(feesQuery);
         let totalFees = parseFloat(feesResult.rows[0].total_fees || '0');
         
         // 如果fees数据不完整，从订单详情补充
         if (totalFees === 0) {
           // 批量获取订单详情手续费
           // ... 实现逻辑
         }
         
         res.json({
           success: true,
           data: result.rows,
           stats: {
             totalPnl,
             totalFees,
             closedTradesPnl,
             holdingPnl,
           },
         });
       } catch (error) {
         next(error);
       }
     });
     ```

2. **前端调用修改**：
   - 文件位置：`frontend/app/quant/trades/page.tsx`
   - 修改`loadTrades`函数：
     ```typescript
     const loadTrades = async () => {
       try {
         setLoading(true);
         const params: any = { limit: filters.limit };
         if (filters.strategyId) params.strategyId = filters.strategyId;
         if (filters.symbol) params.symbol = filters.symbol;
         
         const response = await quantApi.getTrades(params);
         if (response.success) {
           const tradesData = response.data || [];
           const statsData = response.stats || {};
           
           setTrades(tradesData);
           
           // 使用后端返回的统计数据
           setStats({
             totalTrades: tradesData.length,
             totalPnl: statsData.totalPnl || 0,
             totalFees: statsData.totalFees || 0,
           });
         }
       } catch (err) {
         // ... 错误处理
       } finally {
         setLoading(false);
       }
     };
     ```

3. **新增辅助接口**（用于后续功能扩展）：

   **接口1：获取保证金比例**（**新增接口**）
   - API文档：https://open.longbridge.com/zh-CN/docs/trade/asset/margin_ratio
   - SDK方法：`TradeContext.marginRatio(symbol: string)`
   - 用途：后续卖空功能可用于计算卖空保证金
   - 实现位置：`api/src/routes/quant.ts`（新增）
   - **注意**：此接口目前不存在，需要新增
   ```typescript
   quantRouter.get('/margin-ratio/:symbol', async (req, res, next) => {
     try {
       const { symbol } = req.params;
       const { getTradeContext } = await import('../config/longport');
       const tradeCtx = await getTradeContext();
       const marginRatio = await tradeCtx.marginRatio(symbol);
       res.json({ success: true, data: marginRatio });
     } catch (error) {
       next(error);
     }
   });
   ```

   **接口2：获取资金流水**（**新增接口**）
   - API文档：https://open.longbridge.com/zh-CN/docs/trade/asset/cashflow
   - SDK方法：`TradeContext.cashFlow(options: CashFlowOptions)`
   - 用途：可用于验证手续费和资金变动
   - 实现位置：`api/src/routes/quant.ts`（新增）
   - **注意**：此接口目前不存在，需要新增
   ```typescript
   quantRouter.get('/cashflow', async (req, res, next) => {
     try {
       const { startTime, endTime, businessType, symbol, page = 1, size = 50 } = req.query;
       const { getTradeContext } = await import('../config/longport');
       const tradeCtx = await getTradeContext();
       
       const cashFlow = await tradeCtx.cashFlow({
         startAt: new Date(parseInt(startTime as string) * 1000),
         endAt: new Date(parseInt(endTime as string) * 1000),
         businessType: businessType ? parseInt(businessType as string) : undefined,
         symbol: symbol as string,
         page: parseInt(page as string),
         size: parseInt(size as string),
       });
       
       res.json({ success: true, data: cashFlow });
     } catch (error) {
       next(error);
     }
   });
   ```

4. **性能优化**：
   - 批量获取订单详情（避免频繁API调用）
   - 缓存手续费数据（订单详情获取后更新`auto_trades`表的`fees`字段）
   - 使用数据库聚合查询优化统计计算

---

#### 功能6：资金管理账户类型修复
**优先级**：P1

**功能描述**：
修复资金管理功能中账户类型标识问题，确保只有真正的系统账户（GLOBAL）无法删除，其他账户可以正常编辑和删除。

**问题分析**：
- 当前问题：新增账户都默认是系统账户，导致无法删除和编辑
- 根本原因：数据库表`capital_allocations`中没有`is_system`字段，删除逻辑只检查账户名称是否为"GLOBAL"
- 问题：新增账户时没有明确标识账户类型

**交互流程**：
1. 用户打开资金管理页面
2. 系统显示账户列表，标识系统账户
3. 用户新增账户：默认不是系统账户
4. 用户编辑账户：非系统账户可以编辑
5. 用户删除账户：非系统账户可以删除（需检查是否被策略使用）

**输入输出**：
- **输入**：账户信息（名称、类型、值等）
- **输出**：账户列表、操作结果

**数据库变更**：
- 方案A：添加`is_system`字段（推荐）
  ```sql
  ALTER TABLE capital_allocations ADD COLUMN is_system BOOLEAN DEFAULT FALSE;
  UPDATE capital_allocations SET is_system = TRUE WHERE name = 'GLOBAL';
  ```
- 方案B：保持现有逻辑，只检查名称是否为"GLOBAL"（简单但不灵活）

**边界条件**：
- GLOBAL账户：无法删除和编辑名称
- 被策略使用的账户：删除时提示错误
- 有子账户的账户：删除时提示错误
- 账户名称重复：创建和编辑时提示错误

**验收标准**：
- [ ] 新增账户默认不是系统账户
- [ ] 只有GLOBAL账户无法删除
- [ ] 非系统账户可以编辑
- [ ] 非系统账户可以删除（满足删除条件时）
- [ ] 系统账户标识清晰（UI显示"系统账户"标签）

**技术实现要点**：
- 数据库迁移：添加`is_system`字段
- 修复`api/src/routes/quant.ts`中的删除和编辑逻辑
- 修复`frontend/app/quant/capital/page.tsx`中的UI显示和操作逻辑
- 更新`capitalManager.createAllocation`方法，确保新增账户`is_system = false`

---

## 4. 非功能需求

### 4.1 性能要求
- **响应时间**：订单详情查询 < 500ms
- **数据计算**：统计数据计算 < 1s（1000条记录）
- **页面加载**：量化首页加载 < 2s

### 4.2 数据准确性要求
- **数据一致性**：前端显示数据与后端数据一致
- **数据完整性**：订单详情包含所有必要字段
- **计算准确性**：盈亏和手续费计算准确率 = 100%

### 4.3 兼容性要求
- **向后兼容**：修复不影响现有功能
- **数据迁移**：数据库变更需要迁移脚本
- **API兼容**：API返回格式保持兼容（可扩展字段）

---

## 5. 技术方案

### 5.1 订单详情数据完整性修复

**问题定位**：
1. 检查`api/src/routes/orders.ts`中的`mapOrderData`函数
2. 检查订单详情API的返回逻辑
3. 验证长桥SDK返回的数据结构

**修复方案**：
1. 确保`formatChargeDetail`函数正确处理所有字段
2. 验证订单详情API返回时保留所有字段
3. 添加单元测试验证数据完整性

**代码位置**：
- `api/src/routes/orders.ts` - `mapOrderData`函数
- `api/src/routes/orders.ts` - `formatChargeDetail`函数
- `api/src/routes/orders.ts` - 订单详情API端点

---

### 5.2 订单价格审查工具

**实现方案**：
1. 创建审查脚本：`api/scripts/review-orders.ts`
2. 解析日志文件，提取订单信息
3. 解析订单历史JSON，提取订单详情
4. 对比价格，识别异常
5. 生成审查报告

**技术选型**：
- TypeScript + Node.js
- 文件解析：使用fs模块
- JSON解析：使用JSON.parse
- 报告生成：Markdown格式

---

### 5.3 今日盈亏和交易数据修复

**实现方案**：
1. 后端API：创建`/api/quant/dashboard/stats`接口
2. 计算逻辑：
   - 今日盈亏 = 已平仓交易盈亏 + 持仓盈亏
   - 今日交易数量 = 今日成交订单数量
3. 前端调用：修复`frontend/app/quant/page.tsx`

**代码位置**：
- 后端：`api/src/routes/quant.ts` - 新增dashboard stats接口
- 前端：`frontend/app/quant/page.tsx` - 修复数据加载逻辑

---

### 5.4 总盈亏和总手续费修复

**实现方案**：
1. 后端API：在`/api/quant/trades`接口中添加统计数据
2. 计算逻辑：
   - 总盈亏 = SUM(已平仓交易的pnl)
   - 总手续费 = SUM(所有交易的fees)
3. 前端调用：修复`frontend/app/quant/trades/page.tsx`

**代码位置**：
- 后端：`api/src/routes/quant.ts` - 修复trades接口
- 前端：`frontend/app/quant/trades/page.tsx` - 修复统计数据计算

---

### 5.5 资金管理账户类型修复

**实现方案**：
1. 数据库迁移：添加`is_system`字段
2. 后端API：修复创建、编辑、删除逻辑
3. 前端UI：修复显示和操作逻辑

**数据库现状确认**：
- 当前表结构：`capital_allocations`表**没有**`is_system`字段
- 删除逻辑：目前只检查账户名称是否为"GLOBAL"
- 需要添加：`is_system`字段（方案A）

**数据库迁移脚本**：
- ✅ **已创建**：`api/migrations/010_add_is_system_to_capital_allocations.sql`
- 脚本内容：
```sql
-- Migration: 010_add_is_system_to_capital_allocations.sql
-- Add is_system column to capital_allocations table
-- Feature: Fix capital management account type identification (Feature 6)

-- Add is_system column
ALTER TABLE capital_allocations ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE;

-- Set GLOBAL account as system account
UPDATE capital_allocations SET is_system = TRUE WHERE name = 'GLOBAL';

-- Create index for query optimization
CREATE INDEX IF NOT EXISTS idx_capital_allocations_is_system ON capital_allocations(is_system);

-- Add column comment (using English to avoid encoding issues)
COMMENT ON COLUMN capital_allocations.is_system IS 'Whether this is a system account. System accounts cannot be deleted or have their names edited';
```
- **执行方式**：
  ```bash
  psql -d trading_db -f api/migrations/010_add_is_system_to_capital_allocations.sql
  ```

**代码位置**（**修改现有代码**）：
- ✅ 数据库迁移：`api/migrations/010_add_is_system_to_capital_allocations.sql`（已创建）
- ✅ 后端路由：`api/src/routes/quant.ts` - 修复账户CRUD逻辑（已存在）
  - ✅ GET `/api/quant/capital/allocations`（第31行）- 需要返回`is_system`字段
  - ✅ POST `/api/quant/capital/allocations`（第61行）- 创建时设置`is_system = false`
  - ✅ PUT `/api/quant/capital/allocations/:id`（第90行）- 编辑时检查`is_system`，系统账户不允许编辑名称
  - ✅ DELETE `/api/quant/capital/allocations/:id`（第212行）- 删除时检查`is_system`，系统账户不允许删除
- ✅ 后端服务：`api/src/services/capital-manager.service.ts` - 修复创建逻辑（已存在，第240行）
  - `createAllocation`方法（第240行）：需要修改INSERT语句，添加`is_system = FALSE`
  - **当前代码**（第283-286行）：
    ```typescript
    INSERT INTO capital_allocations (name, parent_id, allocation_type, allocation_value)
    VALUES ($1, $2, $3, $4)
    ```
  - **需要修改为**：
    ```typescript
    INSERT INTO capital_allocations (name, parent_id, allocation_type, allocation_value, is_system)
    VALUES ($1, $2, $3, $4, FALSE)
    RETURNING id, name, parent_id, allocation_type, allocation_value, current_usage, is_system
    ```
  - 返回对象需要添加`isSystem`字段（第290行）
- ✅ 前端页面：`frontend/app/quant/capital/page.tsx` - 修复UI和操作逻辑（已存在）
  - 显示系统账户标签
  - 禁用系统账户的删除和编辑按钮（或显示提示）

**实现细节**：

1. **后端API修改**：
   ```typescript
   // GET /api/quant/capital/allocations
   quantRouter.get('/capital/allocations', async (req, res, next) => {
     const result = await pool.query('SELECT * FROM capital_allocations ORDER BY created_at DESC');
     res.json({
       success: true,
       data: result.rows.map((row) => ({
         id: row.id,
         name: row.name,
         parentId: row.parent_id,
         allocationType: row.allocation_type,
         allocationValue: parseFloat(row.allocation_value),
         currentUsage: parseFloat(row.current_usage || '0'),
         isSystem: row.is_system || false, // 新增字段
         createdAt: row.created_at,
         updatedAt: row.updated_at,
       })),
     });
   });
   
   // POST /api/quant/capital/allocations
   // 注意：实际创建逻辑在capital-manager.service.ts中
   // 需要修改capitalManager.createAllocation方法（第283行）
   // 修改INSERT语句添加is_system字段：
   // INSERT INTO capital_allocations (name, parent_id, allocation_type, allocation_value, is_system)
   // VALUES ($1, $2, $3, $4, FALSE)
   
   // PUT /api/quant/capital/allocations/:id（第90行）
   // 需要修改：第96行查询添加is_system字段
   // 需要添加：检查系统账户逻辑（在检查策略使用之前）
   // const checkResult = await pool.query('SELECT id, is_system FROM capital_allocations WHERE id = $1', [id]);
   // const isSystem = checkResult.rows[0].is_system || false;
   // if (isSystem && name !== undefined && name !== checkResult.rows[0].name) {
   //   return next(ErrorFactory.resourceConflict('系统账户不允许修改名称'));
   // }
   // 返回数据需要添加isSystem字段（第197行）
   
   // DELETE /api/quant/capital/allocations/:id（第212行）
   // 需要修改：第217行查询添加is_system字段
   // const checkResult = await pool.query('SELECT id, name, is_system FROM capital_allocations WHERE id = $1', [id]);
   // 需要修改：第251-254行，使用is_system字段替代名称检查
   // const isSystem = checkResult.rows[0].is_system || false;
   // if (isSystem) {
   //   return next(ErrorFactory.resourceConflict('系统账户无法删除'));
   // }
   // 删除原有的名称检查逻辑（第251-254行）
   ```

2. **前端UI修改**：
   ```typescript
   // frontend/app/quant/capital/page.tsx
   const columns = [
     // ... 其他列
     {
       title: '类型',
       dataIndex: 'isSystem',
       render: (isSystem: boolean) => (
         isSystem ? <Tag color="red">系统账户</Tag> : <Tag>普通账户</Tag>
       ),
     },
     {
       title: '操作',
       render: (_, record: CapitalAllocation) => (
         <Space>
           <Button
             disabled={record.isSystem}
             onClick={() => handleEdit(record)}
           >
             编辑
           </Button>
           <Button
             danger
             disabled={record.isSystem}
             onClick={() => handleDelete(record)}
           >
             删除
           </Button>
         </Space>
       ),
     },
   ];
   ```

---

## 6. 风险评估

### 6.1 技术风险
- **风险**：数据库迁移可能影响现有数据
- **影响**：中（数据丢失风险）
- **应对**：
  - 备份数据库
  - 使用事务确保数据一致性
  - 测试环境验证迁移脚本

### 6.2 数据风险
- **风险**：修复后数据与历史数据不一致
- **影响**：中（用户困惑）
- **应对**：
  - 记录数据变更日志
  - 提供数据修复说明
  - 考虑数据修复脚本

### 6.3 业务风险
- **风险**：修复过程中系统不可用
- **影响**：低（可以分批修复）
- **应对**：
  - 分批发布修复
  - 提供回滚方案
  - 在非交易时段发布

---

## 7. 迭代计划

### 7.1 MVP范围（第一优先级）
1. ~~**订单详情数据完整性修复**~~ ✅ **已确认无需修复**
2. **订单价格审查工具**（P0）
3. **今日盈亏计算修复**（P0）
4. **今日交易数据统计修复**（P0）
5. **总盈亏和总手续费计算修复**（P0）

### 7.2 后续迭代
- **V1.1**：资金管理账户类型修复（P1）
- **V1.2**：数据准确性监控和告警
- **V1.3**：数据修复工具和脚本

---

## 8. 验收测试用例

### 8.1 订单详情数据完整性测试（已确认通过）
- [x] 测试用例1：查询已成交订单详情，验证`charge_detail`字段存在 ✅
- [x] 测试用例2：验证`charge_detail.total_amount`字段存在（即使为空） ✅
- [x] 测试用例3：验证`charge_detail.items`数组存在（即使为空数组） ✅
- [x] 测试用例4：验证所有长桥SDK字段都被保留 ✅
- **说明**：手续费为空是正常行为（金额未结算），会在结算后自动更新

### 8.2 今日盈亏计算测试
- [ ] 测试用例1：无交易时，今日盈亏显示0
- [ ] 测试用例2：有已平仓交易时，今日盈亏 = 已平仓交易盈亏
- [ ] 测试用例3：有持仓时，今日盈亏 = 已平仓交易盈亏 + 持仓盈亏
- [ ] 测试用例4：与长桥账户数据对比，验证准确性

### 8.3 今日交易数据测试
- [ ] 测试用例1：无订单时，今日交易数量显示0
- [ ] 测试用例2：有订单时，今日交易数量 = 今日成交订单数量
- [ ] 测试用例3：时区处理正确（使用正确的时区判断"今日"）

### 8.4 总盈亏和总手续费测试
- [ ] 测试用例1：无交易记录时，总盈亏和总手续费显示0
- [ ] 测试用例2：有交易记录时，总盈亏 = SUM(已平仓交易的pnl)
- [ ] 测试用例3：总手续费 = SUM(所有交易的fees)
- [ ] 测试用例4：数据格式处理正确（null、undefined等情况）

### 8.5 资金管理账户测试
- [ ] 测试用例1：新增账户时，`is_system = false`
- [ ] 测试用例2：GLOBAL账户无法删除
- [ ] 测试用例3：非系统账户可以编辑
- [ ] 测试用例4：非系统账户可以删除（满足删除条件时）
- [ ] 测试用例5：被策略使用的账户无法删除

---

## 9. 附录

### 9.1 参考资料
- [长桥API文档 - 订单详情](https://open.longbridge.com/zh-CN/docs/trade/order/order_detail)
- [项目代码库 - trading-system](./)
- [订单详情数据结构 - content.md](../content.md)
- [交易日志 - log.log](../log.log)
- [订单历史 - history.json](../history.json)

### 9.2 相关文件
- `api/src/routes/orders.ts` - 订单相关API
- `api/src/routes/quant.ts` - 量化交易API
- `frontend/app/quant/page.tsx` - 量化交易首页
- `frontend/app/quant/trades/page.tsx` - 交易记录页面
- `frontend/app/quant/capital/page.tsx` - 资金管理页面
- `api/src/services/capital-manager.service.ts` - 资金管理服务

### 9.3 变更记录
| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-10 | 初始版本 | AI Product Manager |
| v1.1 | 2025-12-10 | 完善技术实现细节，添加详细代码示例和实现步骤 | AI Product Manager |
| v1.2 | 2025-12-10 | 确认待确认事项，更新价格差异阈值方案为动态调整，完善验证逻辑 | AI Product Manager |
| v1.3 | 2025-12-10 | 技术方案核对完成，标注现有功能vs新增功能，创建数据库迁移脚本 | AI Product Manager |
| v1.4 | 2025-12-10 | 修正订单详情手续费问题说明：已确认无需修复（手续费为空是正常行为，金额未结算时SDK返回空） | AI Product Manager |
| v1.5 | 2025-12-10 | 添加实际API响应案例验证：已结算订单有完整手续费数据，未结算订单手续费为空但字段结构保留。明确规则：手续费是在所有资金结算后才会在订单中体现 | AI Product Manager |

---

## 10. 问题优先级总结

### P0 - 必须立即修复（影响数据准确性）
1. ~~✅ 订单详情数据完整性修复~~ ✅ **已确认无需修复**（手续费为空是正常行为）
2. ⚠️ 订单价格审查工具
3. ⚠️ 今日盈亏计算修复
4. ⚠️ 今日交易数据统计修复
5. ⚠️ 总盈亏和总手续费计算修复

### P1 - 重要但可稍后修复（影响功能可用性）
6. ⚠️ 资金管理账户类型修复

---

**文档状态**：✅ 已完成  
**下一步行动**：开发团队评审，确定实施计划

