# 订单重复提交防护机制 - 测试执行指南

**文档版本**：v1.0  
**创建时间**：2025-12-12  
**状态**：测试执行中

---

## 📋 测试准备

### 1. 环境检查

**检查项**：
- ✅ 数据库迁移已完成（`order_prevention_metrics` 表已创建）
- ✅ API 服务已启动
- ✅ Longbridge SDK 配置正确
- ✅ 测试账户可用（模拟盘环境）

**验证命令**：
```bash
# 检查数据库表是否存在
psql -U postgres -d trading_db -c "\d order_prevention_metrics"

# 检查 API 服务是否运行
curl http://localhost:3001/api/health

# 检查监控指标 API 是否可用
curl http://localhost:3001/api/order-prevention-metrics
```

---

## 2. 测试数据准备

### 2.1 准备测试持仓

**方法1：通过 Longbridge SDK 手动设置**
- 在模拟盘环境中手动买入测试标的
- 记录标的代码和持仓数量

**方法2：使用现有持仓**
- 查看当前账户持仓：`GET /api/positions`
- 选择有持仓的标的进行测试

### 2.2 准备测试策略

**创建测试策略实例**（如果需要）：
```sql
-- 查询现有策略
SELECT id, name, status FROM strategies WHERE status = 'RUNNING';

-- 创建测试策略实例（如果不存在）
INSERT INTO strategy_instances (strategy_id, symbol, current_state, context)
VALUES (1, 'ACHR.US', 'HOLDING', '{"quantity": 100, "entryPrice": 10.0}')
ON CONFLICT DO NOTHING;
```

---

## 3. 功能测试执行

### 3.1 测试用例 TC-001：正常卖出（持仓充足）

**前置条件**：
- 账户持有 ACHR.US 100股
- 无未成交卖出订单

**测试步骤**：
1. 查看当前持仓：
   ```bash
   curl http://localhost:3001/api/positions
   ```

2. 提交卖出订单（通过策略或API）：
   ```bash
   # 如果通过API，需要先获取策略ID和信号ID
   # 这里假设通过策略自动触发
   ```

3. 查看订单状态：
   ```bash
   curl http://localhost:3001/api/orders/today
   ```

4. 查看日志：
   ```bash
   grep "持仓验证" log.log | tail -20
   ```

**预期结果**：
- ✅ 订单成功提交
- ✅ 日志显示：`持仓验证通过，可用持仓=100，请求卖出=50`
- ✅ 订单状态为 `SUBMITTED` 或 `NEW`

**验证命令**：
```bash
# 查看监控指标
curl http://localhost:3001/api/order-prevention-metrics | jq '.data.metrics.position_validation_passed'
```

---

### 3.2 测试用例 TC-002：卖出数量超过可用持仓

**前置条件**：
- 账户持有 ACHR.US 100股
- 无未成交卖出订单

**测试步骤**：
1. 手动触发卖出订单（数量=150）
   - 可以通过修改策略配置或直接调用API

2. 查看订单是否被拒绝

3. 查看错误信息

**预期结果**：
- ❌ 订单被拒绝
- ❌ 错误信息包含：`可用持仓不足`
- ✅ 监控指标记录失败次数

**验证命令**：
```bash
# 查看监控指标
curl http://localhost:3001/api/order-prevention-metrics | jq '.data.metrics.position_validation_failed'

# 查看订单拒绝原因
curl http://localhost:3001/api/orders/today | jq '.[] | select(.status == "REJECTED")'
```

---

### 3.3 测试用例 TC-003：卖出数量超过可用持仓（有未成交订单）

**前置条件**：
- 账户持有 ACHR.US 100股
- 已有未成交卖出订单：ACHR.US，数量=60

**测试步骤**：
1. 先提交一个卖出订单（数量=60），确保未成交
2. 再次提交卖出订单（数量=50）
3. 验证第二次提交是否被拒绝

**预期结果**：
- ✅ 第一次提交成功
- ❌ 第二次提交被拒绝
- ❌ 错误信息：`可用持仓不足：实际持仓=100，未成交订单占用=60，可用持仓=40`

**验证命令**：
```bash
# 查看未成交订单
curl http://localhost:3001/api/orders/today | jq '.[] | select(.status == "PENDING")'

# 查看监控指标
curl http://localhost:3001/api/order-prevention-metrics | jq '.data.metrics'
```

---

### 3.4 测试用例 TC-005：重复提交检测（缓存检查）

**前置条件**：
- 策略ID=1，标的=ACHR.US
- 无未成交订单

**测试步骤**：
1. 提交卖出订单：ACHR.US，数量=50
2. 立即（5秒内）再次提交相同订单
3. 验证第二次提交是否被拒绝

**预期结果**：
- ✅ 第一次提交成功
- ❌ 第二次提交被拒绝
- ❌ 错误信息：`在最近60秒内已提交过 SELL 订单`

**验证命令**：
```bash
# 查看监控指标
curl http://localhost:3001/api/order-prevention-metrics | jq '.data.metrics.duplicate_order_by_cache'
```

---

### 3.5 测试用例 TC-007：卖空检测

**前置条件**：
- 账户持有 ACHR.US -50股（卖空持仓）
   - 注意：需要手动创建卖空持仓（在模拟盘中）

**测试步骤**：
1. 手动触发账户余额同步：
   ```bash
   curl -X POST http://localhost:3001/api/quant/sync-balance
   ```

2. 查看是否检测到卖空持仓

3. 查看是否自动生成平仓订单

**预期结果**：
- ✅ 检测到卖空持仓
- ✅ 自动生成买入平仓订单
- ✅ 平仓订单成功提交

**验证命令**：
```bash
# 查看监控指标
curl http://localhost:3001/api/order-prevention-metrics | jq '.data.metrics.short_position_detected'

# 查看平仓订单
curl http://localhost:3001/api/orders/today | jq '.[] | select(.side == "BUY" and .symbol == "ACHR.US")'

# 查看日志
grep "卖空持仓" log.log | tail -10
```

---

### 3.6 测试用例 TC-009：交易推送订阅

**前置条件**：
- 系统已启动
- Longbridge SDK 可用

**测试步骤**：
1. 检查系统启动日志：
   ```bash
   grep "交易推送" log.log | head -5
   ```

2. 提交一个测试订单

3. 检查是否收到推送通知

**预期结果**：
- ✅ 日志显示：`[交易推送] 已订阅交易推送`
- ✅ 订单提交后收到推送通知
- ✅ 日志显示：`[交易推送] 收到订单变更`

**验证命令**：
```bash
# 查看交易推送日志
grep "交易推送" log.log | tail -20

# 查看监控指标
curl http://localhost:3001/api/order-prevention-metrics | jq '.data.metrics.trade_push_received'
```

---

## 4. 监控指标验证

### 4.1 查看当前指标

```bash
# 获取所有监控指标
curl http://localhost:3001/api/order-prevention-metrics | jq '.'

# 获取指标报告
curl http://localhost:3001/api/order-prevention-metrics | jq '.data.report'
```

### 4.2 验证指标更新

**测试步骤**：
1. 执行一个测试用例
2. 立即查看监控指标
3. 验证指标是否更新

**示例**：
```bash
# 执行持仓验证测试
# ... 执行测试 ...

# 查看指标
curl http://localhost:3001/api/order-prevention-metrics | jq '.data.metrics.position_validation_total'
```

---

## 5. 日志验证

### 5.1 关键日志查看

**持仓验证日志**：
```bash
grep "持仓验证" log.log | tail -20
```

**订单去重日志**：
```bash
grep "阻止重复订单" log.log | tail -20
```

**卖空检测日志**：
```bash
grep "卖空持仓" log.log | tail -20
```

**交易推送日志**：
```bash
grep "交易推送" log.log | tail -20
```

**监控指标日志**：
```bash
grep "监控指标" log.log | tail -20
```

---

## 6. 测试报告模板

### 6.1 测试结果记录

| 测试用例ID | 测试用例名称 | 执行结果 | 执行时间 | 备注 |
|-----------|-------------|---------|---------|------|
| TC-001 | 正常卖出（持仓充足） | ✅/❌ | YYYY-MM-DD HH:MM:SS | |
| TC-002 | 卖出数量超过可用持仓 | ✅/❌ | YYYY-MM-DD HH:MM:SS | |
| TC-003 | 卖出数量超过可用持仓（有未成交订单） | ✅/❌ | YYYY-MM-DD HH:MM:SS | |
| TC-005 | 重复提交检测（缓存检查） | ✅/❌ | YYYY-MM-DD HH:MM:SS | |
| TC-007 | 卖空检测 | ✅/❌ | YYYY-MM-DD HH:MM:SS | |
| TC-009 | 交易推送订阅 | ✅/❌ | YYYY-MM-DD HH:MM:SS | |

### 6.2 缺陷记录

| 缺陷ID | 测试用例ID | 缺陷描述 | 严重程度 | 状态 |
|--------|-----------|---------|---------|------|
| BUG-001 | TC-002 | 持仓验证错误信息不准确 | 中 | 待修复 |
| ... | ... | ... | ... | ... |

---

## 7. 快速测试脚本

### 7.1 自动化测试脚本（示例）

```bash
#!/bin/bash

# 测试脚本：订单重复提交防护机制

API_BASE="http://localhost:3001"
TEST_SYMBOL="ACHR.US"

echo "=== 订单重复提交防护机制测试 ==="
echo ""

# 1. 检查 API 服务
echo "1. 检查 API 服务..."
curl -s "$API_BASE/api/health" | jq '.'
echo ""

# 2. 查看当前持仓
echo "2. 查看当前持仓..."
curl -s "$API_BASE/api/positions" | jq ".[] | select(.symbol == \"$TEST_SYMBOL\")"
echo ""

# 3. 查看监控指标
echo "3. 查看监控指标..."
curl -s "$API_BASE/api/order-prevention-metrics" | jq '.data.metrics'
echo ""

# 4. 查看今日订单
echo "4. 查看今日订单..."
curl -s "$API_BASE/api/orders/today" | jq ".[] | select(.symbol == \"$TEST_SYMBOL\")"
echo ""

echo "=== 测试完成 ==="
```

---

## 8. 常见问题排查

### 8.1 持仓验证失败

**问题**：持仓验证总是失败

**排查步骤**：
1. 检查持仓数据是否正确：
   ```bash
   curl http://localhost:3001/api/positions
   ```

2. 检查未成交订单：
   ```bash
   curl http://localhost:3001/api/orders/today
   ```

3. 查看详细日志：
   ```bash
   grep "计算可用持仓" log.log | tail -10
   ```

### 8.2 交易推送未收到

**问题**：交易推送未收到

**排查步骤**：
1. 检查推送服务是否启动：
   ```bash
   grep "交易推送.*已订阅" log.log
   ```

2. 检查推送错误：
   ```bash
   grep "交易推送.*错误" log.log
   ```

3. 检查监控指标：
   ```bash
   curl http://localhost:3001/api/order-prevention-metrics | jq '.data.metrics.trade_push_error'
   ```

### 8.3 卖空检测未触发

**问题**：卖空持仓未检测到

**排查步骤**：
1. 检查账户余额同步是否执行：
   ```bash
   grep "账户余额同步" log.log | tail -10
   ```

2. 手动触发同步：
   ```bash
   curl -X POST http://localhost:3001/api/quant/sync-balance
   ```

3. 查看持仓数据：
   ```bash
   curl http://localhost:3001/api/positions | jq '.[] | select(.quantity < 0)'
   ```

---

## 9. 测试验收标准

### 9.1 功能验收

- ✅ 所有P0功能测试用例通过率 ≥ 100%
- ✅ 持仓验证响应时间 < 500ms
- ✅ 订单拒绝率（因持仓不足）降低至0%
- ✅ 重复订单提交事件减少至0次/天

### 9.2 性能验收

- ✅ 持仓验证响应时间 < 500ms（单次查询）
- ✅ 订单提交去重检查响应时间 < 100ms
- ✅ 并发订单提交无重复订单

### 9.3 稳定性验收

- ✅ 系统运行24小时无崩溃
- ✅ 监控指标正常更新
- ✅ 日志记录完整

---

## 10. 测试完成检查清单

- [ ] 所有功能测试用例已执行
- [ ] 所有测试用例结果已记录
- [ ] 监控指标已验证
- [ ] 日志记录已验证
- [ ] 缺陷已记录并修复
- [ ] 测试报告已生成

---

**文档版本**：v1.0  
**创建时间**：2025-12-12  
**最后更新**：2025-12-12

