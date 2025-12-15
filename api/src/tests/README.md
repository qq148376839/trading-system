# 回测历史数据优化功能测试

## 测试文件说明

### 1. `backtest-optimization.test.ts`
单元测试套件，测试所有已实现的功能：
- 数据格式转换工具
- API频次限制处理
- 配额监控
- 交易日判断
- Symbol到Moomoo参数转换
- 市场环境模拟

### 2. `integration-backtest.test.ts`
集成测试，测试完整的回测流程

## 运行测试

```bash
# 安装依赖（如果还没有）
npm install

# 运行所有测试
npm test

# 运行特定测试文件
npm test -- backtest-optimization.test.ts

# 查看测试覆盖率
npm test -- --coverage
```

## 测试环境要求

1. Node.js >= 16
2. TypeScript支持
3. Jest测试框架

## 注意事项

1. **API连接测试**：部分集成测试需要实际的Longbridge API连接，在CI/CD环境中可能需要mock
2. **时间相关测试**：交易日判断测试依赖于当前日期，可能需要定期更新
3. **数据格式测试**：基于实际API返回的数据格式，如果API格式变化需要更新测试

## 测试覆盖范围

- ✅ 数据格式转换（Longbridge和Moomoo）
- ✅ API频次限制处理
- ✅ 配额监控
- ✅ 交易日判断
- ✅ Symbol转换
- ✅ 市场环境模拟
- ✅ 边界情况处理

