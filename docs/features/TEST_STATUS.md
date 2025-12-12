# 订单重复提交防护机制 - 测试状态

**测试日期**：2025-12-12  
**测试人员**：系统测试

---

## ✅ 测试环境检查结果

### 1. API 服务状态
- ✅ **健康检查**：通过
- ✅ **数据库连接**：正常
- ✅ **监控指标 API**：可用

### 2. 监控指标状态
- ✅ **API 端点**：`/api/order-prevention-metrics` 正常响应
- ✅ **初始状态**：所有指标为 0（正常，尚未执行操作）

### 3. 持仓数据
- ✅ **持仓数据**：正常获取
- ✅ **测试标的**：ACHR.US 有 197 股持仓（可用于测试）

### 4. 已知问题
- ⚠️ **TradeContext 初始化失败**：`/api/orders/today` 无法访问
  - 原因：网络连接问题或 Longbridge API 服务暂时不可用
  - 影响：无法查询今日订单（不影响持仓验证功能）
  - 建议：检查网络连接或稍后重试

---

## 📋 可执行的测试用例

### ✅ 可以立即测试的功能

#### TC-001：正常卖出（持仓充足）
**测试标的**：ACHR.US（持仓 197 股）

**测试步骤**：
1. 通过策略触发卖出订单（数量 < 197）
2. 或通过 API 直接提交卖出订单

**验证方法**：
```bash
# 查看监控指标（持仓验证通过次数应该增加）
curl http://localhost:3001/api/order-prevention-metrics

# 查看日志
grep "持仓验证" log.log | tail -10
```

---

#### TC-002：卖出数量超过可用持仓
**测试标的**：ACHR.US（持仓 197 股）

**测试步骤**：
1. 尝试卖出数量 > 197（例如 200）
2. 验证订单是否被拒绝

**验证方法**：
```bash
# 查看监控指标（持仓验证失败次数应该增加）
curl http://localhost:3001/api/order-prevention-metrics

# 查看日志
grep "持仓验证失败" log.log | tail -10
```

---

#### TC-005：重复提交检测（缓存检查）
**测试标的**：ACHR.US

**测试步骤**：
1. 提交卖出订单
2. 立即（5秒内）再次提交相同订单
3. 验证第二次提交是否被拒绝

**验证方法**：
```bash
# 查看监控指标（重复订单阻止次数应该增加）
curl http://localhost:3001/api/order-prevention-metrics
```

---

## 🔧 Windows 友好的测试命令

### 查看监控指标（不使用 jq）

**PowerShell 方式**：
```powershell
# 获取监控指标
$response = Invoke-RestMethod -Uri "http://localhost:3001/api/order-prevention-metrics"
$response.data.metrics | ConvertTo-Json -Depth 10

# 查看持仓验证指标
$response.data.metrics.positionValidationTotal
$response.data.metrics.positionValidationPassed
$response.data.metrics.positionValidationFailed
```

**curl + 格式化**：
```bash
# 查看完整响应（格式化）
curl http://localhost:3001/api/order-prevention-metrics | python -m json.tool

# 或者保存到文件查看
curl http://localhost:3001/api/order-prevention-metrics > metrics.json
type metrics.json
```

---

## 📊 测试执行建议

### 阶段1：基础功能测试（当前可执行）

1. **持仓验证测试**
   - TC-001：正常卖出
   - TC-002：卖出数量超过可用持仓

2. **订单去重测试**
   - TC-005：重复提交检测

### 阶段2：集成测试（需要 TradeContext 可用）

1. **未成交订单测试**
   - TC-003：卖出数量超过可用持仓（有未成交订单）
   - TC-004：部分成交订单的持仓计算

2. **卖空检测测试**
   - TC-007：卖空检测
   - TC-008：多个卖空持仓平仓

3. **交易推送测试**
   - TC-009：交易推送订阅
   - TC-010：交易推送更新缓存

---

## 🐛 问题排查

### TradeContext 初始化失败

**问题**：`/api/orders/today` 返回错误

**可能原因**：
1. 网络连接问题
2. Longbridge API 服务暂时不可用
3. Token 过期或无效
4. SDK 配置问题

**排查步骤**：
1. 检查网络连接：
   ```bash
   ping openapi.longportapp.com
   ```

2. 检查 Token 状态：
   ```bash
   curl http://localhost:3001/api/token-refresh/status
   ```

3. 尝试刷新 Token：
   ```bash
   curl -X POST http://localhost:3001/api/token-refresh/refresh
   ```

4. 查看详细错误日志：
   ```bash
   grep "TradeContext" log.log | tail -20
   ```

---

## 📝 测试记录模板

### 测试执行记录

| 测试用例ID | 测试用例名称 | 执行时间 | 执行结果 | 备注 |
|-----------|-------------|---------|---------|------|
| TC-001 | 正常卖出（持仓充足） | | ✅/❌ | |
| TC-002 | 卖出数量超过可用持仓 | | ✅/❌ | |
| TC-005 | 重复提交检测（缓存检查） | | ✅/❌ | |

### 监控指标记录

**测试前指标**：
- 持仓验证总次数：0
- 持仓验证通过次数：0
- 持仓验证失败次数：0
- 阻止重复订单总数：0

**测试后指标**：
- 持仓验证总次数：___
- 持仓验证通过次数：___
- 持仓验证失败次数：___
- 阻止重复订单总数：___

---

## ✅ 下一步行动

1. **执行基础功能测试**
   - 使用 ACHR.US（197 股）进行测试
   - 验证持仓验证功能
   - 验证订单去重功能

2. **解决 TradeContext 问题**
   - 检查网络连接
   - 检查 Token 状态
   - 查看错误日志

3. **继续集成测试**
   - 待 TradeContext 可用后执行
   - 测试未成交订单检查
   - 测试卖空检测

---

**最后更新**：2025-12-12

