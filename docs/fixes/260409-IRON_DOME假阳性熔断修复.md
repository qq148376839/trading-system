# IRON_DOME 假阳性熔断修复

**日期**: 2026-04-09
**严重性**: P0（资金安全相关）
**影响范围**: 策略 10，4/6-4/8 三天 5 次假阳性熔断

---

## 问题描述

IRON_DOME reconciliation 逻辑在 broker API 调用失败时（GenericFailure/timeout），`getCachedPositions()` 返回空数组 `[]`。`reconciliationCheck()` 将空数组误判为"broker 无持仓"，触发 BROKER_TERMINATED 全策略熔断。

### 影响

| 时间 | 标的 | 事件 |
|------|------|------|
| 04-06 15:34 | TSLA.US (TSLANPNUS) | 假阳性熔断 |
| 04-07 | TSLA.US | 假阳性熔断 |
| 04-08 13:52 | TSLA.US | 假阳性熔断 |
| 04-08 14:04 | NVDA (NVDANCNUS) | 假阳性熔断 |
| 04-08 15:01 | QQQ260408C604000 | 假阳性熔断 |

每次假阳性都会：释放资金分配、标记 BROKER_TERMINATED、激活全策略 circuitBreaker。

### 日志特征

```
[ERROR] 计算可用持仓失败 (TSLANPNUS): GenericFailure
[WARN]  [IRON_DOME:RECONCILIATION] 策略 10 标的 TSLA.US: DB状态=HOLDING 但 broker 持仓为零!
[WARN]  [IRON_DOME:CIRCUIT_BREAKER] 策略 10: 账实不符触发全策略熔断!
```

---

## 根因分析

### 控制流

```
T0: Broker API 调用失败 (GenericFailure / timeout / rate limit)
T1: getCachedPositions() 进入 catch 块
    ├─ 有过期缓存 → 返回缓存（安全）
    └─ 无缓存 → return [] ← BUG：无法区分"API确认无仓位"和"API挂了"
T2: reconciliationCheck() 收到空数组
    ├─ 遍历 holdingRows（DB 中 HOLDING 状态的实例）
    ├─ 在空数组中找不到对应持仓 → brokerQty = 0
    └─ brokerQty <= 0 → 触发 BROKER_TERMINATED 熔断
```

### 代码位置

- **BUG**: `strategy-scheduler.service.ts` 行 3197，`getCachedPositions()` catch 块 `return []`
- **触发点**: `strategy-scheduler.service.ts` 行 5626，`reconciliationCheck()` 的 `if (brokerQty <= 0)`

### 已有警示

`basic-execution.service.ts:calculateAvailablePosition()` 行 426-427 注释：
> "如果静默返回 0，定期核对会误判为券商无持仓而转 IDLE（P0 事故）"

该函数选择 throw error 而非返回 0。`getCachedPositions()` 未遵循同一模式。

---

## 修复方案

### 改动 1: `getCachedPositions()` — throw 替代 return []（行 3197）

```typescript
// 修复前（BUG）:
return [];

// 修复后:
// 无缓存时必须 throw —— 返回 [] 会导致 IRON_DOME 误判为"broker 无持仓"触发假熔断（P0）
throw sdkError;
```

### 改动 2: `reconciliationCheck()` — catch 块增加日志（行 5606-5608）

```typescript
// 修复前:
} catch {
  return; // API 失败不阻塞

// 修复后:
} catch (posErr: any) {
  logger.info(`[IRON_DOME:RECONCILIATION] 持仓API不可用（${posErr?.message}），跳过本轮核对`);
  return;
```

### 其他调用点影响

`getCachedPositions()` 共 7 个调用点，除 reconciliationCheck 外的 6 个均有外层 try/catch，throw 后安全降级（跳过检查/回退其他数据源），无破坏性行为。

---

## 验证

- API 成功返回空数组（真正无持仓）→ 正常返回 `[]` → reconciliation 正常触发 BROKER_TERMINATED
- API 失败 + 有过期缓存 → 返回缓存数据 → reconciliation 用缓存核对
- API 失败 + 无缓存 → throw → reconciliationCheck catch → 打日志 → 跳过本轮

修复后日志中应出现 `[IRON_DOME:RECONCILIATION] 持仓API不可用` 替代之前的假阳性熔断告警。
