# 测试规范

## 🧪 单元测试

### 测试要求

- ✅ 核心业务逻辑必须编写单元测试
- ✅ 测试文件命名: `*.test.ts` 或 `*.spec.ts`
- ✅ 测试覆盖率目标: 核心服务 > 80%

### 测试组织

- ✅ 测试文件放在 `__tests__/` 目录或与源文件同级
- ✅ 使用 Jest 作为测试框架
- ✅ Mock 外部依赖（数据库、API）

### 测试结构

```typescript
describe('StrategyScheduler', () => {
  describe('executeStrategy', () => {
    it('should execute strategy successfully', async () => {
      // Arrange
      const strategyId = 1;
      const targets = ['AAPL.US'];
      
      // Act
      const result = await scheduler.executeStrategy(strategyId, targets);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });
});
```

## 🔍 测试场景

### 核心测试场景

1. **策略执行测试**
   - ✅ 正常执行流程
   - ✅ 错误处理
   - ✅ 资金不足情况
   - ✅ 订单提交失败

2. **资金管理测试**
   - ✅ 资金分配
   - ✅ 资金释放
   - ✅ 资金计算准确性

3. **订单处理测试**
   - ✅ 订单提交
   - ✅ 订单追踪
   - ✅ 订单状态同步

## 📋 测试检查清单

- [ ] 所有核心服务都有单元测试
- [ ] 测试覆盖主要业务逻辑路径
- [ ] 测试包含错误场景
- [ ] 测试包含边界条件
- [ ] Mock 所有外部依赖






