# Jest 测试无响应问题排查

## 🔍 问题现象

运行 `npm test` 或 `npm test -- order-submission-decimal-simple.test.ts` 时完全没有输出，等待很久也没有反应。

## ⚠️ 这**不正常**

Jest 应该至少会输出：
- `No tests found`（如果找不到测试）
- 或者开始运行测试并显示进度
- 或者显示错误信息

完全没有输出通常意味着：
1. **Jest 进程卡住了**（可能在加载模块时死循环）
2. **PowerShell 输出被重定向或缓冲**
3. **测试文件有语法错误导致无法加载**

## 🚀 立即尝试的解决方案

### 方案 1：运行最简单的测试（推荐）

我创建了一个完全不依赖 Mock 的测试文件：

```bash
cd trading-system/api
npm test -- decimal-type-verification.test.ts
```

这个测试文件：
- ✅ 不 Mock 任何外部依赖
- ✅ 只测试代码逻辑
- ✅ 应该能立即运行

### 方案 2：使用诊断脚本

```bash
cd trading-system/api
node scripts/diagnose-jest.js
```

这会检查：
- Jest 是否安装
- 配置文件是否存在
- 测试文件是否存在
- Jest 是否能运行

### 方案 3：强制输出并清理缓存

```bash
cd trading-system/api

# 清理 Jest 缓存
npx jest --clearCache

# 强制输出，不使用缓存
npx jest src/__tests__/decimal-type-verification.test.ts --no-cache --verbose
```

### 方案 4：检查是否有进程卡住

```powershell
# 查看所有 node 进程
Get-Process node

# 如果有多个 node 进程，可能是之前的测试没有退出
# 可以结束它们：
Stop-Process -Name node -Force
```

### 方案 5：使用不同的终端

尝试使用：
- **Git Bash**（如果安装了 Git）
- **WSL**（如果安装了 Windows Subsystem for Linux）
- **CMD**（而不是 PowerShell）

## 📋 测试文件优先级

按从简单到复杂排序：

1. **`decimal-type-verification.test.ts`** ⭐ 推荐
   - 最简单，不依赖任何 Mock
   - 只测试代码逻辑
   - 应该能立即运行

2. **`order-submission-decimal-simple.test.ts`**
   - 简化版，有 Mock
   - 如果第一个能运行，再试这个

3. **`order-submission-decimal.test.ts`**
   - 完整版，最复杂
   - 如果前两个都能运行，再试这个

## 🔧 如果还是不行

### 检查 TypeScript 编译

```bash
cd trading-system/api

# 检查测试文件语法
npx tsc --noEmit src/__tests__/decimal-type-verification.test.ts
```

### 手动运行 Jest

```bash
cd trading-system/api

# 直接运行 Jest，不使用 npm
node_modules\.bin\jest src/__tests__/decimal-type-verification.test.ts --verbose
```

### 检查 Node.js 版本

```bash
node --version
```

Jest 29 需要 Node.js >= 14

### 重新安装依赖

```bash
cd trading-system/api

# 删除 node_modules 和 package-lock.json
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json

# 重新安装
npm install
```

## 📊 预期输出

如果测试正常运行，应该看到：

```
PASS  src/__tests__/decimal-type-verification.test.ts
  Decimal 类型使用验证
    订单参数构建 - 修复后的代码逻辑
      ✓ 应该使用 Decimal 类型构建 submittedQuantity
      ✓ 应该正确处理整数数量
      ✓ 应该正确处理小数价格
    订单提交流程
      ✓ 应该使用 Decimal 类型（修复后）
    修复前后对比
      ✓ 修复前：使用 number 类型（错误）
      ✓ 修复后：使用 Decimal 类型（正确）
    边界情况
      ✓ 应该正确处理数量为 1
      ✓ 应该正确处理大数量
      ✓ 应该正确处理最小价格

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
Time:        1.234 s
```

## 🆘 如果所有方法都失败

如果以上方法都不行，可以：

1. **手动验证代码修复**：
   - 检查 `basic-execution.service.ts` 第537行
   - 检查 `orders.ts` 第1492行
   - 确认都使用了 `new Decimal()`

2. **实际订单测试**：
   - 启动 API 服务
   - 提交测试订单
   - 验证订单提交成功

3. **代码审查**：
   - 代码修复已经完成
   - 测试文件已经创建
   - 可以跳过自动化测试，直接进行实际验证

## 📚 相关文件

- 诊断脚本：`scripts/diagnose-jest.js`
- 最简单测试：`src/__tests__/decimal-type-verification.test.ts`
- Jest 配置：`jest.config.js`


