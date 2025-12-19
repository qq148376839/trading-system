# 信号日志历史数据修复方案

## 📋 问题描述

在实施信号与订单关联功能（方案B：添加 `signal_id` 字段）后，历史数据存在以下问题：

1. **历史订单没有 `signal_id`**：`execution_orders` 表中的历史订单在添加 `signal_id` 字段之前创建，因此该字段为 `NULL`
2. **历史信号状态不准确**：`strategy_signals` 表中的历史信号状态可能都是 `PENDING`，没有根据实际订单状态更新
3. **无法通过 `signal_id` 关联**：历史订单和信号之间没有明确的关联关系

## 🎯 解决方案

### 方案概述

通过**时间窗口匹配**的方式，将历史订单与信号关联起来，并更新信号状态。

### 关联规则

1. **匹配条件**：
   - `strategy_id` 相同
   - `symbol` 相同
   - `side` 匹配（订单的 `side` 对应信号的 `signal_type`：`BUY` ↔ `Buy`，`SELL` ↔ `Sell`）
   - `created_at` 时间差在 ±5 分钟内
   - 信号状态为 `PENDING`

2. **匹配优先级**（解决同一标的多个信号的问题）：
   - **优先匹配订单创建时间之前的信号**：选择订单创建时间之前最近的信号
   - **降级匹配订单创建时间之后的信号**：如果没有之前的信号，选择订单创建时间之后最近的信号
   - 这样可以确保订单匹配到触发它的信号，而不是后续生成的信号

3. **信号状态更新规则**：
   - 订单状态为 `FilledStatus` 或 `PartialFilledStatus` → 信号状态更新为 `EXECUTED`
   - 订单状态为 `CanceledStatus`、`PendingCancelStatus`、`WaitToCancel` → 信号状态更新为 `IGNORED`
   - 订单状态为 `RejectedStatus` → 信号状态更新为 `REJECTED`

## 📝 实施步骤

### 1. 数据库迁移脚本

**文件**：`api/migrations/012_backfill_signal_id_and_status.sql`

该脚本执行以下操作：

1. **回填 `signal_id`**：为历史订单匹配对应的信号，并更新 `execution_orders.signal_id`
2. **更新信号状态**：根据订单状态更新对应的信号状态

**执行方式**：
```bash
# 连接到数据库并执行迁移脚本
psql -U your_user -d your_database -f api/migrations/012_backfill_signal_id_and_status.sql
```

### 2. TypeScript 数据修复脚本

**文件**：`api/scripts/backfill-signal-associations.ts`

该脚本提供更灵活的数据修复功能，包括：

- 详细的日志输出
- 统计信息
- 支持 dry-run 模式
- 可配置的时间窗口

**使用方法**：
```bash
# Dry-run 模式（不实际修改数据）
tsx api/scripts/backfill-signal-associations.ts --dry-run

# 实际执行（默认时间窗口：±5分钟）
tsx api/scripts/backfill-signal-associations.ts

# 自定义时间窗口（±10分钟）
tsx api/scripts/backfill-signal-associations.ts --time-window-minutes=10
```

**输出示例**：
```
开始回填信号关联数据 (dry-run: false, 时间窗口: ±5分钟)
找到 150 个未关联信号的订单
匹配订单 1183076078529339392 (TSLA.US, Buy) 到信号 1234 (时间差: 2.35分钟)
...
回填完成！统计信息:
  - 匹配的订单数: 145
  - 更新的信号数: 145
  - 信号状态: EXECUTED=120, IGNORED=15, REJECTED=10
  - 未找到信号的订单数: 5
  - 未找到订单的信号数: 8
```

### 3. 代码改进

**文件**：`api/src/services/basic-execution.service.ts`

改进了 `updateSignalStatusByOrderId` 方法，使其能够处理历史订单：

1. **优先使用 `signal_id`**：如果订单有 `signal_id`，直接使用
2. **降级到时间窗口匹配**：如果订单没有 `signal_id`，使用时间窗口匹配
3. **自动回填 `signal_id`**：如果通过时间窗口匹配成功，自动回填 `signal_id` 以便后续使用

## 🔍 匹配算法详解

### 时间窗口匹配算法

```sql
-- 示例：为订单匹配信号
SELECT ss.id
FROM strategy_signals ss
WHERE ss.strategy_id = eo.strategy_id
  AND ss.symbol = eo.symbol
  AND ss.signal_type = CASE 
    WHEN eo.side = 'BUY' OR eo.side = '1' THEN 'BUY'
    WHEN eo.side = 'SELL' OR eo.side = '2' THEN 'SELL'
    ELSE NULL
  END
  AND ss.created_at >= eo.created_at - INTERVAL '5 minutes'
  AND ss.created_at <= eo.created_at + INTERVAL '5 minutes'
  AND ss.status = 'PENDING'
ORDER BY ABS(EXTRACT(EPOCH FROM (ss.created_at - eo.created_at)))
LIMIT 1
```

**关键点**：
- **优先级排序**：先匹配订单创建时间之前的信号（`created_at <= order.created_at`），再匹配之后的信号
- 在同一优先级内，选择时间最接近的信号（`ABS(EXTRACT(EPOCH FROM (created_at - order.created_at)))`）
- 只匹配 `status = 'PENDING'` 的信号（避免重复更新）
- 时间窗口为 ±5 分钟（可配置）

**为什么需要优先级排序？**
- 策略每分钟运行一次，可能在同一标的上生成多个信号
- 订单通常基于第一个信号提交，后续信号应该被忽略
- 通过优先匹配订单创建时间之前的信号，可以确保匹配到触发订单的信号

### 状态映射规则

| 订单状态（`execution_orders.current_status`） | 信号状态（`strategy_signals.status`） |
|---------------------------------------------|-------------------------------------|
| `FilledStatus`, `PARTIALLY_FILLED` | `EXECUTED` |
| `CanceledStatus`, `PendingCancelStatus`, `WaitToCancel`, `CANCELLED` | `IGNORED` |
| `RejectedStatus`, `REJECTED`, `FAILED` | `REJECTED` |

## ⚠️ 注意事项

### 1. 匹配准确性

- **时间窗口**：±5 分钟是默认值，如果策略执行频率很高，可能需要缩小时间窗口
- **一对多匹配**：如果一个时间窗口内有多个信号，会优先选择订单创建时间之前的信号（最近的），如果没有则选择订单创建时间之后的信号（最近的）
- **多对一匹配**：如果多个订单匹配到同一个信号，只有第一个订单会成功关联（因为信号状态会从 `PENDING` 变为 `EXECUTED`）
- **SELL订单**：SELL订单通常由止盈/止损逻辑触发，而不是信号，所以可能找不到匹配的信号（这是正常的）

### 2. 数据一致性

- **已关联的数据**：如果订单已经有 `signal_id`，不会重新匹配
- **已更新的信号**：如果信号状态已经不是 `PENDING`，不会通过时间窗口匹配更新

### 3. 执行时机

- **建议在非交易时间执行**：避免影响正在运行的策略
- **建议先执行 dry-run**：查看匹配结果，确认无误后再实际执行
- **可以多次执行**：脚本是幂等的，可以安全地多次执行

## 📊 验证方法

### 1. 检查回填结果

```sql
-- 检查有多少订单被成功关联
SELECT COUNT(*) 
FROM execution_orders 
WHERE signal_id IS NOT NULL;

-- 检查信号状态分布
SELECT status, COUNT(*) 
FROM strategy_signals 
GROUP BY status;

-- 检查未关联的订单
SELECT COUNT(*) 
FROM execution_orders 
WHERE signal_id IS NULL 
  AND created_at < NOW() - INTERVAL '1 day'; -- 只检查历史订单
```

### 2. 验证匹配准确性

```sql
-- 检查匹配的时间差分布
SELECT 
  ABS(EXTRACT(EPOCH FROM (ss.created_at - eo.created_at))) / 60 as time_diff_minutes,
  COUNT(*) as count
FROM execution_orders eo
JOIN strategy_signals ss ON eo.signal_id = ss.id
WHERE eo.signal_id IS NOT NULL
GROUP BY time_diff_minutes
ORDER BY time_diff_minutes;
```

## 🔄 后续维护

### 自动回填机制

改进后的 `updateSignalStatusByOrderId` 方法会自动回填历史订单的 `signal_id`：

- 当订单状态更新时，如果订单没有 `signal_id`，会尝试通过时间窗口匹配
- 如果匹配成功，会自动更新 `signal_id`，避免下次重复匹配

### 定期检查

建议定期检查未关联的订单和信号：

```sql
-- 检查最近7天未关联的订单
SELECT COUNT(*) 
FROM execution_orders 
WHERE signal_id IS NULL 
  AND created_at >= NOW() - INTERVAL '7 days';

-- 检查最近7天未关联的信号
SELECT COUNT(*) 
FROM strategy_signals 
WHERE status = 'PENDING' 
  AND created_at >= NOW() - INTERVAL '7 days'
  AND id NOT IN (
    SELECT DISTINCT signal_id 
    FROM execution_orders 
    WHERE signal_id IS NOT NULL
  );
```

## 📚 相关文档

- [QUANT_ORDER_MANAGEMENT_REFACTOR_PRD.md](251211-QUANT_ORDER_MANAGEMENT_REFACTOR_PRD.md) - 订单管理重构PRD
- [QUANT_TRADING_BUGFIX_PRD.md](251210-QUANT_TRADING_BUGFIX_PRD.md) - 量化交易Bug修复PRD

## 📝 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-10 | 初始版本：历史数据修复方案 | AI Product Manager |

