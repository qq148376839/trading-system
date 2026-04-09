---
name: strategy-check
description: 拉取交易系统API数据，基于第一性原理分析策略运行状态
user_invocable: true
---

## 数据获取

### 聚合端点

所有分析数据通过单一端点获取，服务端已完成 DB 查询 + Longport SDK 调用 + 指标预计算：

```
GET http://192.168.31.18:3001/api/quant/strategy-check-digest?startDate={}&endDate={}&strategyId={}
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `startDate` | ISO date | 7天前 | 分析窗口起始 |
| `endDate` | ISO date | 今天 | 分析窗口结束 |
| `strategyId` | number | 全部RUNNING | 指定策略 |

### 执行流程

1. 解析 `$ARGUMENTS`，提取日期范围和策略 ID
   - `/strategy-check` → 默认最近 7 天
   - `/strategy-check 2026-04-01 2026-04-09` → 指定日期范围
   - `/strategy-check --days 3` → 最近 3 天
   - `/strategy-check --strategy 10` → 指定策略 10
2. 写一个 JS 脚本到 `/tmp/strategy-check.js`，fetch 上述端点
3. 读取返回的 JSON，直接进入分析（数据已预计算，无需手动聚合）

**必须使用 Node.js http 模块**（规则 #1），cookies 放 JS 字符串变量。

### 返回数据结构

端点返回已预计算的指标，结构如下：

```jsonc
{
  "data": {
    "generatedAt": "ISO",
    "window": { "startDate", "endDate" },

    // 策略配置 + 实例状态
    "strategies": [{ id, name, status, type, configSummary: { entryThreshold, maxPositions, stopLossPercent, takeProfitPercent, trailingStopPercent, smartReverse, circuitBreaker, cooldownMinutes } }],
    "instances": {
      "bySymbol": { [symbol]: { state, dailyRealizedPnL, circuitBreakerActive, cooldownUntil, entryPrice, quantity, unrealizedPnl } },
      "totalDailyPnL", "activePositions", "circuitBreakerTriggered"
    },

    // 层级1: 期望值（已计算）
    "evAnalysis": {
      "overall": { totalTrades, wins, losses, winRate, avgWin, avgLoss, payoffRatio, expectedValue, kellyFraction },
      "bySymbol": { [symbol]: { 同上 } },
      "byRegime": { [regime]: { 同上 } },
      "byScoreBucket": { "8-10": {}, "10-12": {}, "12-15": {}, "15+": {} }
    },

    // 层级2: 退出效率（已计算）
    "exitAnalysis": {
      "byExitType": { [type]: { count, avgPnl, totalPnl, winRate } },
      "avgWinHoldingMinutes", "avgLossHoldingMinutes"
    },

    // 层级3: 信号质量（已计算）
    "signalQuality": {
      "feeDrag": { totalFees, totalGrossPnl, feeRatio },
      "slippage": { avgSlippagePct, bySymbol }
    },

    // 层级4: 风险检查（已计算）
    "riskCheck": {
      "pnlConsistency": { instancesPnlSum, tradesPnlSum, discrepancy }
    },

    // 层级5: SmartReverse（已计算）
    "smartReverse": { totalReversed, reversedWinRate, reversedAvgPnl, nonReversedWinRate, nonReversedAvgPnl },

    // 订单数据（Longport SDK 实时拉取）
    "orders": {
      "today": { total, filled, pending, cancelled, details: [...] },
      "history": { total, filled, details: [...] }
    },

    // 系统日志（清洗去重后）
    "logs": {
      "summary": { total, errorCount, warningCount, infoCount, debugCount },
      "errorGroups": [{ module, pattern, count, firstSeen, lastSeen, sampleExtraData }],
      "warningGroups": [{ module, pattern, count, firstSeen, lastSeen }],
      "keyEvents": [{ timestamp, level, module, message, extraData }]
    },

    // 最近信号（紧凑格式）
    "recentSignals": [{ id, symbol, type, score, price, status, regime, time }]
  }
}
```

## 分析框架：第一性原理

数据已预计算，**直接用返回的指标进行深层分析**。禁止堆砌指标，每个维度回答 "为什么" 不只是 "是什么"。

### 层级 1：这个策略有没有正期望值？

> **第一性原理**：`E[PnL] = winRate × avgWin - (1-winRate) × avgLoss > 0`

直接使用 `evAnalysis` 中的预计算数据：
- **期望值 E[PnL]**：`evAnalysis.overall.expectedValue` + 各子集（bySymbol/byRegime/byScoreBucket）
- **盈亏比 R**：`evAnalysis.overall.payoffRatio`，R < 1 即使胜率 > 50% 也可能亏损
- **Kelly fraction**：`evAnalysis.overall.kellyFraction`，判断 over-bet 还是 under-bet
- **边际 EV 分布**：`evAnalysis.byScoreBucket`，找出正 EV 的分数阈值

### 层级 2：退出逻辑是在保护利润还是在扼杀赢家？

> **第一性原理**：最优退出策略让赢家跑、输家切断。

直接使用 `exitAnalysis` 数据：
- **各退出路径 EV 贡献**：`exitAnalysis.byExitType` 的 avgPnl / totalPnl / winRate
- **持仓时长**：`avgWinHoldingMinutes` vs `avgLossHoldingMinutes`，赢家持仓极短 = 锁利过早
- **关键事件中的止损/锁利记录**：`logs.keyEvents` 中的 stop_loss / trailing_stop 事件

### 层级 3：信号质量是否在筛选真机会？

> **第一性原理**：好信号 = 高确信度 + 高赔率。

- **score 区间 EV**：`evAnalysis.byScoreBucket` 各桶的胜率和 EV
- **regime 表现差异**：`evAnalysis.byRegime`
- **滑点成本**：`signalQuality.slippage`
- **费用拖累**：`signalQuality.feeDrag.feeRatio`

### 层级 4：风险控制是否在正确运作？

> **第一性原理**：风控让策略在极端情况存活，不在正常情况干扰交易。

- **熔断状态**：`instances.circuitBreakerTriggered` + 各 symbol 的 circuitBreakerActive
- **PnL 一致性**：`riskCheck.pnlConsistency.discrepancy` > 0 说明数据不一致
- **关键事件**：`logs.keyEvents` 中的 circuit_breaker / cooldown 事件
- **今日订单异常**：`orders.today` 中的 rejected / cancelled 数量

### 层级 5：智能反向（smartReverse）评估

> **第一性原理**：反向交易只在 regime 判断准确时有价值。

- **反向 vs 非反向对比**：`smartReverse` 中的 winRate / avgPnl 对比
- **配置参数**：`strategies[].configSummary.smartReverse` 的阈值设置
- **建议格式**：
```
smartReverse: {
  enabled: true/false,
  thresholds: { marketScoreExtreme, intradayScoreExtremeNeg, intradayScoreExtremePos, divergenceMin, maxIntradayScoreForEntry },
  positionMultiplier: { reversed, uncertain },
  peakReversal: { enabled, intradayThreshold, minRemainingMinutes, positionMultiplier, stopLossPercent, takeProfitPercent }
}
```

## 输出格式

### 结构要求
1. **诊断结论**（一句话）：这个策略当前是正 EV 还是负 EV？核心瓶颈是什么？
2. **期望值分解表**：按标的 × regime × 时段的 EV 矩阵
3. **退出效率分析**：各退出路径的利润捕获率 + EV 贡献
4. **参数调优建议**：`当前值 → 建议值（数据支撑）` 表格，只给有数据支撑的建议
5. **风险异常**：熔断/PnL 不一致/数据异常，附带根因分析
6. **smartReverse 决策**：启用/禁用建议 + 推荐参数（附模拟 EV）

### 格式规范
- 简洁的表格 + 风险评级（高/中/低）
- **每条建议必须附带数据计算过程**，不接受 "建议调低" 这种没有量化的建议
- 如果数据不足以得出结论，明确说 "数据不足，需要 X 才能判断"
- 严重问题高亮标注

$ARGUMENTS
