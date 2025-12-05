# 测试说明

## 运行测试

```bash
# 运行所有测试
npm test

# 运行特定测试文件
npm test -- dynamic-position-manager.test.ts

# 运行测试并查看覆盖率
npm test -- --coverage
```

## 测试文件命名规范

- 测试文件应该放在 `src/__tests__/` 目录下
- 测试文件命名格式：`*.test.ts` 或 `*.spec.ts`
- 例如：`dynamic-position-manager.test.ts`

## 注意事项

1. **Mock外部依赖**: 测试时需要mock数据库、API调用等外部依赖
2. **测试环境**: 确保测试环境配置正确
3. **测试数据**: 使用测试数据，不要影响生产数据

## 当前测试文件

- `dynamic-position-manager.test.ts` - 动态持仓管理服务测试

