# 期权策略10未生效诊断方案

## 📋 问题概述

**策略ID**: 10
**策略类型**: OPTION_INTRADAY_V1（期权日内策略）
**问题**: 策略执行390次，但没有生成任何持仓，且有46个错误

## 🔍 诊断步骤

### 步骤1：检查策略配置

```sql
-- 查看策略10的完整配置
SELECT
  id,
  name,
  type,
  status,
  symbol_pool,
  config,
  interval_seconds
FROM strategies
WHERE id = 10;
```

**检查点**：
- [ ] `type` 是否为 `OPTION_INTRADAY_V1`
- [ ] `status` 是否为 `RUNNING`
- [ ] `symbol_pool` 是否配置了正确的标的（应该是底层股票，如 `QQQ.US` 或 `.SPX.US`）
- [ ] `config` 中的过滤条件是否太严格

**预期配置示例**：
```json
{
  "assetClass": "OPTION",
  "expirationMode": "0DTE",
  "directionMode": "FOLLOW_SIGNAL",
  "positionSizing": {
    "mode": "FIXED_CONTRACTS",
    "fixedContracts": 1
  },
  "liquidityFilters": {
    "minOpenInterest": 100,
    "maxBidAskSpreadPct": 20
  },
  "greekFilters": {
    "deltaMin": 0.3,
    "deltaMax": 0.7
  },
  "tradeWindow": {
    "noNewEntryBeforeCloseMinutes": 60,
    "forceCloseBeforeCloseMinutes": 30
  },
  "entryPriceMode": "ASK"
}
```

### 步骤2：检查标的池

```sql
-- 查看策略10的标的池实例
SELECT
  symbol,
  state,
  context
FROM strategy_instances
WHERE strategy_id = 10
ORDER BY updated_at DESC
LIMIT 10;
```

**检查点**：
- [ ] 标的池是否只有1个标的？（日志显示IDLE=1）
- [ ] 标的是否为正确的底层股票（不是期权symbol）
- [ ] state是否一直是IDLE

### 步骤3：查看策略10的错误日志

```bash
# 从JSON日志中提取策略10的错误
cd D:\Python\trading-system
node -e "
const fs = require('fs');
const logs = JSON.parse(fs.readFileSync('logs-2026-01-27.json', 'utf8'));
const strategy10Errors = logs.filter(log =>
  log.level === 'error' &&
  (log.message.includes('策略 10') || log.message.includes('strategyId.*10'))
);
console.log(JSON.stringify(strategy10Errors.slice(0, 20), null, 2));
"
```

或者手动搜索：
```bash
# Windows PowerShell
Select-String -Path "logs-2026-01-27.json" -Pattern "策略 10.*error|strategyId.*10.*level.*error" -Context 2
```

**检查点**：
- [ ] 错误类型是什么？
- [ ] 是否是期权合约选择失败？
- [ ] 是否是推荐服务失败？
- [ ] 是否是富途API调用失败？

### 步骤4：检查期权合约选择服务

```sql
-- 查看策略信号日志（如果有生成信号）
SELECT
  id,
  strategy_id,
  symbol,
  direction,
  metadata,
  created_at
FROM strategy_signals
WHERE strategy_id = 10
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 10;
```

**检查点**：
- [ ] 是否有生成信号记录？
- [ ] metadata中是否包含期权信息（optionSymbol, strikePrice等）？
- [ ] 如果没有信号，说明 `generateSignal()` 返回了null

### 步骤5：手动测试期权合约选择

创建测试脚本 `test-option-contract-selection.ts`：

```typescript
import { selectOptionContract } from './api/src/services/options-contract-selector.service';

async function testOptionSelection() {
  // 使用策略10的标的进行测试
  const underlyingSymbol = 'QQQ.US'; // 替换为实际配置的标的

  console.log(`测试标的: ${underlyingSymbol}`);

  try {
    const selected = await selectOptionContract({
      underlyingSymbol,
      expirationMode: '0DTE',
      direction: 'CALL',
      candidateStrikes: 8,
      liquidityFilters: {
        minOpenInterest: 100,
        maxBidAskSpreadPct: 20
      },
      greekFilters: {
        deltaMin: 0.3,
        deltaMax: 0.7
      }
    });

    if (selected) {
      console.log('✅ 成功选择期权合约:');
      console.log(JSON.stringify(selected, null, 2));
    } else {
      console.log('❌ 未能选择合适的期权合约');
      console.log('可能原因：');
      console.log('1. 没有0DTE期权');
      console.log('2. 流动性过滤太严格');
      console.log('3. Greek过滤太严格');
      console.log('4. 富途API返回数据为空');
    }
  } catch (error) {
    console.error('❌ 期权合约选择失败:', error);
  }
}

testOptionSelection();
```

运行测试：
```bash
cd api
npx ts-node test-option-contract-selection.ts
```

### 步骤6：检查推荐服务

```typescript
import tradingRecommendationService from './api/src/services/trading-recommendation.service';

async function testRecommendation() {
  const symbol = 'QQQ.US'; // 替换为实际配置的标的

  console.log(`测试推荐服务: ${symbol}`);

  try {
    const rec = await tradingRecommendationService.calculateRecommendation(symbol);

    if (!rec) {
      console.log('❌ 推荐服务返回null');
    } else if (rec.action === 'HOLD') {
      console.log('⚠️  推荐操作为HOLD（期权策略会跳过）');
      console.log(`推荐详情: ${JSON.stringify(rec, null, 2)}`);
    } else {
      console.log(`✅ 推荐操作: ${rec.action}`);
      console.log(`推荐详情: ${JSON.stringify(rec, null, 2)}`);
    }
  } catch (error) {
    console.error('❌ 推荐服务失败:', error);
  }
}

testRecommendation();
```

### 步骤7：检查市场时间窗口

```typescript
import { getMarketCloseWindow } from './api/src/services/market-session.service';

async function testMarketWindow() {
  const symbol = 'QQQ.US';
  const market = 'US';

  try {
    const closeWindow = await getMarketCloseWindow(market);

    console.log('市场收盘时间窗口:');
    console.log(`- 市场: ${market}`);
    console.log(`- 距离收盘: ${closeWindow.minutesUntilClose} 分钟`);
    console.log(`- 禁止开仓: ${closeWindow.noNewEntry ? '是' : '否'}`);
    console.log(`- 强制平仓: ${closeWindow.forceClose ? '是' : '否'}`);

    if (closeWindow.noNewEntry) {
      console.log('⚠️  当前在"禁止开仓"窗口内（默认收盘前60分钟）');
    }
  } catch (error) {
    console.error('❌ 获取市场时间窗口失败:', error);
  }
}

testMarketWindow();
```

## 🔧 常见问题修复

### 问题1：标的池配置错误

**症状**: IDLE标的只有1个，或者标的池为空

**修复**:
```sql
-- 更新标的池配置
UPDATE strategies
SET symbol_pool = jsonb_build_object(
  'type', 'manual',
  'symbols', jsonb_build_array('QQQ.US', 'SPY.US')
)
WHERE id = 10;
```

### 问题2：过滤条件太严格

**症状**: 期权合约选择总是返回null

**修复**:
```sql
-- 放宽流动性和Greek过滤条件
UPDATE strategies
SET config = jsonb_set(
  jsonb_set(
    config,
    '{liquidityFilters,minOpenInterest}',
    '50'
  ),
  '{liquidityFilters,maxBidAskSpreadPct}',
  '30'
)
WHERE id = 10;
```

### 问题3：指数期权stockId映射缺失

**症状**: 使用指数期权（如.SPX.US）时选择失败

**修复**: 参考 `PROJECT_STATUS.md:76-79`，需要确定并固化stockId映射

```typescript
// 在 futunn-option-chain.service.ts 中添加映射
const INDEX_STOCK_ID_MAP: Record<string, string> = {
  '.SPX.US': '200003',
  '.NDX.US': '需要从富途获取',
  // ... 其他指数
};
```

### 问题4：推荐服务返回HOLD

**症状**: 底层股票推荐总是HOLD

**修复**: 检查推荐服务配置，或切换到 `directionMode: 'CALL_ONLY'` 强制买入CALL

```sql
UPDATE strategies
SET config = jsonb_set(
  config,
  '{directionMode}',
  '"CALL_ONLY"'
)
WHERE id = 10;
```

### 问题5：在禁止开仓窗口内

**症状**: 收盘前60分钟内无法开仓

**修复**: 调整禁止开仓时间窗口

```sql
UPDATE strategies
SET config = jsonb_set(
  config,
  '{tradeWindow,noNewEntryBeforeCloseMinutes}',
  '30'
)
WHERE id = 10;
```

## 📊 验证修复

### 1. 查看策略执行日志

```sql
SELECT
  id,
  strategy_id,
  symbol,
  state,
  context->>'tradedSymbol' as option_symbol,
  context->>'allocationAmount' as allocated,
  updated_at
FROM strategy_instances
WHERE strategy_id = 10
  AND updated_at >= NOW() - INTERVAL '1 hour'
ORDER BY updated_at DESC;
```

### 2. 查看信号生成

```sql
SELECT
  id,
  symbol,
  direction,
  metadata->>'optionSymbol' as option_symbol,
  metadata->>'strikePrice' as strike,
  metadata->>'estimatedFees' as fees,
  created_at
FROM strategy_signals
WHERE strategy_id = 10
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

### 3. 查看订单提交

```sql
SELECT
  id,
  symbol,
  side,
  quantity,
  submitted_price,
  status,
  submitted_at
FROM execution_orders
WHERE strategy_id = 10
  AND submitted_at >= NOW() - INTERVAL '1 hour'
ORDER BY submitted_at DESC;
```

## ✅ 成功标志

期权策略正常运行的标志：
- [ ] 策略执行时能生成信号（strategy_signals有记录）
- [ ] 信号的metadata包含期权信息（optionSymbol, strikePrice等）
- [ ] strategy_instances中的tradedSymbol是期权symbol（如`TSLA260130C460000.US`）
- [ ] execution_orders中有期权订单提交记录
- [ ] 收盘前30分钟触发强制平仓

## 📞 需要协助

如果以上步骤无法解决问题，请提供：
1. 策略10的完整配置（SQL查询结果）
2. 策略10的错误日志（步骤3的结果）
3. 期权合约选择测试结果（步骤5的输出）
4. 推荐服务测试结果（步骤6的输出）
