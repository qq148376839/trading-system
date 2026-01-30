# 策略日志聚合与降噪 - 产品需求文档 (PRD)

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-19
- **文档作者**：AI Product Manager
- **审核状态**：已确认
- **对应功能**：策略调度器日志优化

---

## 1. 背景与目标

### 1.1 业务背景
当前量化系统运行“策略5 (ARK投资)”时，系统会每分钟对 20+ 个标的进行一次扫描。目前的日志机制是对每个标的的每次检查都输出一条日志（如 `当前状态=IDLE`，`持仓监控...`），导致控制台和数据库充斥着大量重复的、无状态变更的信息。

### 1.2 用户痛点
1.  **关键信息淹没**：真正的交易信号、错误报错、状态变更（如 IDLE -> BUY）被淹没在海量“IDLE”日志中，排查问题极为困难。
2.  **存储资源浪费**：如果每条无意义日志都写入数据库，会导致 `system_logs` 表迅速膨胀，影响查询性能。
3.  **视觉干扰**：控制台（Terminal）滚动过快，无法实时监控系统健康状态。

### 1.3 业务目标
- **主要目标**：将策略执行周期的日志从“每标的一条”优化为“每周期一条汇总”，除非发生重要事件。
- **成功指标**：
    - 单次策略执行的常规日志条数从 N条（标的数量）降低为 1-2 条。
    - 关键信号（Signal Generated）和错误（Error）的日志可见性提升 100%。

### 1.4 项目范围
- **包含范围**：
    - `StrategyScheduler` 服务中的日志逻辑优化。
    - 策略执行结果的内存聚合逻辑。
    - 数据库写入逻辑的优化（仅写入汇总或重要日志）。
- **不包含范围**：
    - 对日志系统底层架构（`LogService`）的重构（复用现有架构）。

---

## 2. 用户与场景

### 2.1 目标用户
- **开发者/运维**：需要通过日志监控系统运行状态，排查 Bug。
- **量化交易员**：需要确认策略是否正常运行，是否有产生信号。

### 2.2 使用场景

**场景1：系统正常待机（最常见）**
- **现状**：每分钟刷屏 20 行 `[INFO] ... 当前状态=IDLE`。
- **期望**：每分钟输出 1 行 `[INFO] 策略5 执行完成：耗时 200ms，扫描 20 个标的，全部 IDLE/无操作`。

**场景2：触发交易信号**
- **现状**：信号日志夹杂在 19 行 IDLE 日志中间。
- **期望**：
    - 输出 1 行 `[INFO] 策略5 执行完成...`
    - 单独输出 `[INFO] 标的 TSLA.US 生成信号 BUY...`（高亮/独立记录）。

---

## 3. 功能需求

### 3.1 功能概览

| 功能模块 | 优先级 | 说明 |
| :--- | :--- | :--- |
| **日志聚合机制** | **P0** | 在内存中收集单次循环的所有执行结果，结束时统一输出。 |
| **智能降噪策略** | **P0** | 只有状态变更、信号生成或错误发生时，才记录详细日志；否则仅记录统计摘要。 |
| **结构化汇总写入** | **P1** | 将汇总信息（JSON格式）作为一条记录写入数据库，方便后续统计分析。 |

### 3.2 功能详细说明

#### 功能1：日志聚合机制 (In-Memory Aggregation)
**功能描述**：
在 `strategy-scheduler.service.ts` 的 `executeStrategy` 循环中，不再直接调用 `logger.info` 输出每个标的的状态，而是创建一个 `ExecutionSummary` 对象进行收集。

**数据结构设计**：
```typescript
interface StrategyExecutionSummary {
  strategyId: number;
  totalTargets: number;
  startTime: number;
  duration: number;
  results: {
    idle: string[];      // IDLE状态的标的代码列表
    holding: string[];   // HOLDING状态的标的代码列表
    signals: any[];      // 生成的信号详情
    errors: any[];       // 发生的错误详情
    stateChanges: any[]; // 状态发生变更的详情
  }
}
```

**交互流程**：
1.  策略周期开始，初始化 `summary` 对象。
2.  遍历标的列表：
    - 如果状态无变化且无信号 -> 将标的代码推入 `summary.results.idle` 或 `holding`。
    - 如果生成信号 -> 将信号推入 `summary.results.signals`，并**立即打印一条详细日志**。
    - 如果发生错误 -> 将错误推入 `summary.results.errors`，并**立即打印错误日志**。
3.  遍历结束，计算耗时。
4.  调用 `logger.info` 输出汇总信息。

#### 功能2：智能降噪输出
**功能描述**：
根据聚合结果决定输出内容的详细程度。

**逻辑规则**：
1.  **纯净模式（全无事）**：如果 `signals`、`errors`、`stateChanges` 均为空。
    - 输出：`[INFO] 策略 {id} 执行完成。扫描 {count} 个标的 (IDLE: {n}, HOLDING: {m})。耗时 {t}ms。`
2.  **有事发生模式**：
    - 输出：`[INFO] 策略 {id} 执行完成。扫描 {count} 个标的。⚠️ 发现 {n} 个信号，{m} 个错误。`
    - 此时，具体的信号和错误已在循环中被即时打印，汇总日志起到“总结”作用。

#### 功能3：数据库写入优化
**功能描述**：
利用现有的 `system_logs` 表的 `metadata` (JSONB) 字段。

**实现方式**：
- 对于“纯净模式”的汇总日志，`metadata` 字段存储精简的统计数据：`{ stats: { idle: 18, holding: 2 } }`。
- 这样在查看数据库时，不会被每分钟 20 条记录淹没，每分钟只有 1 条策略级记录。

---

## 4. 技术方案建议

### 4.1 代码修改点
主要修改 `api/src/services/strategy-scheduler.service.ts` 文件。

**伪代码示例**：
```typescript
// 1. 初始化统计
const summary = { idle: [], processing: [], signals: [], errors: [] };

// 2. 循环处理
for (const symbol of targets) {
    try {
        const result = await processTarget(symbol);
        
        if (result.hasSignal) {
            logger.info(`[信号] ${symbol} 生成信号...`); // 关键信息保留实时输出
            summary.signals.push(symbol);
        } else if (result.isIdle) {
            // logger.info(...)  <-- 删除这行，不再输出 IDLE 日志
            summary.idle.push(symbol);
        }
    } catch (e) {
        logger.error(`[错误] ${symbol}...`);
        summary.errors.push(symbol);
    }
}

// 3. 结束汇总
const logMsg = `策略${strategy.id}完成: 扫描${targets.length}, 信号${summary.signals.length}, 错误${summary.errors.length}, IDLE:${summary.idle.length}`;
logger.info(logMsg, { metadata: summary }); // 写入一条汇总到数据库
```

---

## 5. 风险评估

### 5.1 风险点
- **过度聚合**：如果汇总逻辑有误，可能会掩盖某些“看起来正常但实际异常”的情况（例如程序假死，但被误判为IDLE）。
    - **应对**：保留 `DEBUG` 级别的详细日志。开发调试时可开启 `LOG_LEVEL=debug` 查看每条记录。

---

## 6. 下一步行动 (Action Plan)

1.  **创建功能分支**：`feature/log-aggregation`。
2.  **重构 `strategy-scheduler.service.ts`**：
    - 引入聚合统计对象。
    - 移除循环内的低价值 `logger.info` 调用。
    - 在循环结束后添加汇总日志输出。
3.  **验证**：
    - 运行 `npm run dev`，观察控制台输出是否变得清爽。
    - 检查数据库 `system_logs` 表，确认每分钟是否只有一条策略级记录。






