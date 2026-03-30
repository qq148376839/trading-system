---
name: strategy-check
description: 拉取交易系统API数据，基于第一性原理分析策略运行状态
user_invocable: true
---

## 缓存机制

缓存目录: `/tmp/strategy-check-cache/`
缓存元数据: `/tmp/strategy-check-cache/meta.json`

### 缓存规则

| 数据 | 文件 | 新鲜度(分钟) | 说明 |
|---|---|---|---|
| 策略配置 | strategies.json | 60 | 配置极少变动 |
| 策略实例状态 | instances.json | 3 | PnL/熔断实时变化 |
| 信号日志 | signals.json | 3 | 交易时段频繁产生 |
| 今日订单 | orders.json | 3 | 交易时段频繁变化 |
| 系统日志 | logs.json | 3 | 持续产生 |

### 执行流程

1. 写一个 JS 脚本到 `/tmp/strategy-check.js`
2. 脚本启动时读取 `/tmp/strategy-check-cache/meta.json`（不存在则视为空缓存）
3. 对每个端点：
   - **缓存命中**（文件存在 && 年龄 < 新鲜度）→ 跳过拉取，输出 `✓ {name}: 使用缓存 ({age}分钟前)`
   - **缓存未命中** → 拉取新数据，写入缓存文件，更新 meta.json 的时间戳
4. **信号去重合并**：新拉取的信号与缓存按 `id` 去重合并，保留更完整的历史（最多保留 500 条）
5. 所有数据就绪后输出到 stdout 供分析

### 强制刷新

如果 `$ARGUMENTS` 包含 `--force` 或 `force`，跳过所有缓存，全量重新拉取。

**必须使用 Node.js http 模块**（规则 #1），cookies 放 JS 字符串变量。如果请求返回 401/403，提示用户更新 cookie。

## 接口列表

### 1. 信号日志（300条）
```
GET http://192.168.31.18:3001/api/quant/signals?limit=300
```

### 2. 今日订单
```
GET http://192.168.31.18:3001/api/orders/today
```

### 3. 系统日志（最近8小时）
```
GET http://192.168.31.18:3001/api/logs?limit=200&offset=0&start_time={8小时前ISO}&end_time={当前ISO}
```

### 4. 策略列表
```
GET http://192.168.31.18:3001/api/quant/strategies
```

### 5. RUNNING 策略的实例状态（per strategy_id）
```
GET http://192.168.31.18:3001/api/quant/strategies/{id}/instances
```
只拉取 `status === 'RUNNING'` 的策略的实例。此接口返回各标的的 `dailyRealizedPnL`、`circuitBreakerActive` 等关键运行状态。

## 分析框架：第一性原理

拉取到数据后，**必须从底层原理出发**分析，禁止堆砌指标。每个分析维度都要回答 "为什么" 而不只是 "是什么"。

### 层级 1：这个策略有没有正期望值？

> **第一性原理**：一个策略长期盈利的充要条件是 `E[PnL] = winRate × avgWin - (1-winRate) × avgLoss > 0`。

必须计算：
- **期望值 E[PnL]**：按标的、按 regime、按时段分别计算，找出 E[PnL] 为正的子集
- **盈亏比 R = avgWin / avgLoss**：R > 1 是基本要求。如果 R < 1，即使胜率 > 50% 也可能亏损
- **Kelly fraction**：f* = (p × R - (1-p)) / R，判断当前仓位是 over-bet 还是 under-bet
- **边际 EV 分布**：将信号按 `finalScore` 分段（如 8-10, 10-12, 12-15, 15+），分别计算 EV，找出 **正 EV 的分数阈值**

### 层级 2：退出逻辑是在保护利润还是在扼杀赢家？

> **第一性原理**：最优退出策略应该让赢家尽可能跑、输家尽早切断。止损保护资本，止盈/锁利保护利润。

必须计算：
- **阶梯锁利的利润捕获率** = 实际卖出价 / 峰值价。接近 1 说明锁住了利润，远低于 1 说明回吐严重
- **止损触发分析**：止损是被真实趋势反转触发，还是被噪声/短期波动误触发？用止损后标的价格走势验证（如果止损后价格继续亏损方向 = 正确止损；如果反弹 = 可能被洗出）
- **持仓时长 vs PnL 的关系**：赢家平均持仓多久？输家呢？如果赢家持仓时间极短（锁利过早），说明退出逻辑在扼杀赢家
- **各退出路径的 EV 贡献**：STOP_LOSS / TRAILING_STOP / TAKE_PROFIT 各自对总 EV 的贡献

### 层级 3：信号质量是否在筛选真机会？

> **第一性原理**：好信号 = 高确信度 + 高赔率。低分信号如果频繁入场，会拉低总体 EV。

必须计算：
- **score 区间的胜率和 EV**：score 8-9 / 9-10 / 10-12 / 12+ 各自的胜率和平均 PnL
- **regime 条件下的表现差异**：MOMENTUM / MEAN_REVERSION / UNCERTAIN 各 regime 的 EV
- **滑点成本**：信号价 vs 实际成交价的差异（从信号 metadata.ask/bid 和订单 executed_price 交叉比对）
- **费用拖累**：fees / grossPnL 的比例，判断费用是否在侵蚀正 EV

### 层级 4：风险控制是否在正确运作？

> **第一性原理**：风控的目的是让策略在极端情况下存活，而不是在正常情况下干扰交易。

必须检查：
- **熔断阈值合理性**：当前 dailyRealizedPnL vs 熔断阈值，是否存在虚增（IRON_DOME 竞态问题）
- **数据库一致性**：instances 的 dailyRealizedPnL 之和 vs 信号 PnL 之和是否匹配
- **冷却期效果**：冷却期后的第一笔交易 EV 是否优于冷却前的最后一笔？
- **相关性保护**：同一 correlation group 内是否有过度集中的入场？

### 层级 5：智能反向（smartReverse）评估

> **第一性原理**：反向交易只在市场 regime 判断准确时有价值。如果 regime 检测本身不可靠，反向只会加倍亏损。

必须计算：
- **regime 检测准确率**：`shouldReverse=true` 的信号，如果真的反向了，胜率和 EV 如何？
- **配置参数与实际分布的匹配度**：`marketScoreExtreme=35` 是否对应了信号分布的真实极端值？
- **positionMultiplier 的风险敞口**：`reversed=1` 意味着反向仓位不缩减，是否过于激进？
- **启用 vs 不启用的模拟对比**：用历史信号模拟反向交易的总 PnL

给出具体参数建议时必须附带数据支撑，参考结构：
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
