# 交易推送修复测试 - 快速使用指南

## 🚀 快速开始

### Windows 用户

```powershell
# 进入 api 目录
cd api

# 运行测试脚本
.\scripts\test-trade-push-fix.ps1
```

### Linux/Mac 用户

```bash
# 进入 api 目录
cd api

# 添加执行权限（首次运行）
chmod +x scripts/test-trade-push-fix.sh

# 运行测试脚本
./scripts/test-trade-push-fix.sh
```

### 直接运行 TypeScript

```bash
# 进入 api 目录
cd api

# 运行测试
npx ts-node scripts/test-trade-push-fix.ts
```

---

## 📋 测试内容

测试脚本会自动执行以下5个测试：

1. ✅ **测试1**: 交易推送服务初始化检查
2. ✅ **测试2**: 订单状态更新
3. ✅ **测试3**: 信号状态更新
4. ✅ **测试4**: 订单关联逻辑（时间窗口匹配）
5. ✅ **测试5**: 状态映射函数

---

## ✅ 预期结果

如果所有测试通过，你会看到：

```
==========================================
测试结果汇总
==========================================

总测试数: 5
通过: 5 (100.0%)
失败: 0 (0.0%)

✅ 所有测试通过！
```

---

## ❌ 如果测试失败

如果测试失败，脚本会显示详细的错误信息：

1. **查看失败测试的详细信息**
2. **检查错误消息**
3. **参考故障排查指南**（见测试计划文档）

---

## 📚 更多信息

- **详细测试计划**: `docs/tests/251217-TRADE_PUSH_FIX_TEST_PLAN.md`
- **BUG分析报告**: `docs/analysis/251217-TRADE_PUSH_BUG_ANALYSIS.md`
- **修复总结**: `docs/fixes/251217-TRADE_PUSH_BUG_FIX.md`

---

## 🔧 故障排查

### 问题：ts-node 未找到

**解决方案**：
```bash
npm install -g ts-node typescript
```

### 问题：数据库连接失败

**解决方案**：
1. 检查 `.env` 文件中的 `DATABASE_URL`
2. 确认数据库服务正在运行

### 问题：没有测试订单

**说明**：这是正常的，如果数据库中没有订单，相关测试会跳过。

---

**最后更新**: 2025-12-17

