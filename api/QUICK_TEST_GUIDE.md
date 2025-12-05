# 快速测试指南

## 🚀 快速开始

### 1. 安装依赖

```bash
cd api
npm install
```

这会自动安装 `ts-jest`（已在 package.json 中配置）。

### 2. 运行测试

```bash
# 运行所有测试
npm test

# 运行特定测试文件（注意文件名拼写）
npm test -- dynamic-position-manager.test.ts

# 运行测试并显示详细输出
npm test -- --verbose
```

## ✅ 已创建的文件

1. ✅ `jest.config.js` - Jest配置文件
2. ✅ `src/__tests__/dynamic-position-manager.test.ts` - 测试文件
3. ✅ `src/__tests__/README.md` - 测试说明

## 📝 测试文件位置

```
api/
├── src/
│   ├── __tests__/
│   │   ├── dynamic-position-manager.test.ts  ✅
│   │   └── README.md
│   └── services/
│       └── dynamic-position-manager.service.ts
├── jest.config.js  ✅
└── package.json  ✅ (已添加ts-jest)
```

## 🔍 常见问题

### Q: 运行测试时提示 "No tests found"

**A**: 检查以下几点：
1. 文件名是否正确：`dynamic-position-manager.test.ts`（不是 `dynaic-position-manage.test.ts`）
2. 文件是否在 `src/__tests__/` 目录下
3. 是否已运行 `npm install` 安装依赖

### Q: 提示找不到 ts-jest

**A**: 运行以下命令：
```bash
npm install ts-jest --save-dev
```

### Q: 测试失败，提示模块找不到

**A**: 测试文件已经包含了必要的 mock，如果还有问题，检查：
1. 确保所有依赖都已安装
2. 检查 `jest.config.js` 配置是否正确

## 📊 测试覆盖

当前测试文件包含以下测试用例：

1. ✅ `getPositionContext` - 构建持仓上下文
2. ✅ `calculateMarketDeterioration` - 计算市场环境恶化程度
3. ✅ `adjustByMarketEnvironment` - 市场环境调整
4. ✅ `adjustByHoldingTime` - 持仓时间调整
5. ✅ `adjustStopLossTakeProfit` - 综合调整

## 🎯 下一步

1. 运行测试验证功能
2. 根据实际运行情况调整测试用例
3. 添加更多测试用例覆盖边界情况

