# 测试设置说明

## 问题

运行测试时出现错误：
```
npm test -- dynaic-position-manage.test.ts
No tests found, exiting with code 1
```

## 原因分析

1. **文件名拼写错误**: `dynaic-position-manage.test.ts` 应该是 `dynamic-position-manager.test.ts`
2. **缺少测试依赖**: 需要安装 `ts-jest`（已在package.json中添加，需要运行npm install）
3. **测试文件位置**: 测试文件应该在 `src/__tests__/` 目录下（已创建）
4. **Jest配置**: 需要 `jest.config.js` 配置文件（已创建）

## 解决方案

### 1. 安装测试依赖

```bash
cd api

# 安装ts-jest（如果还没有安装）
npm install ts-jest --save-dev

# 如果npm install失败，可以尝试：
# 清除npm缓存
npm cache clean --force

# 重新安装
npm install ts-jest --save-dev
```

**注意**: 如果npm install失败，可能是npm配置问题。可以尝试：
- 使用 `npm install ts-jest@29.1.1 --save-dev --legacy-peer-deps`
- 或者手动编辑 `package.json` 添加 `"ts-jest": "^29.1.1"` 到 devDependencies，然后运行 `npm install`

### 2. 运行测试

**正确的命令**:
```bash
# 运行所有测试
npm test

# 运行特定测试文件（注意文件名）
npm test -- dynamic-position-manager.test.ts

# 或者使用完整路径
npm test -- src/__tests__/dynamic-position-manager.test.ts
```

### 3. 测试文件位置

测试文件应该放在：
```
api/src/__tests__/dynamic-position-manager.test.ts
```

## 测试配置

已创建 `jest.config.js` 配置文件，包含：
- TypeScript支持（ts-jest）
- 测试文件匹配规则
- 覆盖率配置

## 当前测试文件

- ✅ `src/__tests__/dynamic-position-manager.test.ts` - 动态持仓管理服务测试

## 注意事项

1. **Mock外部依赖**: 测试中需要mock数据库、API调用等外部依赖
2. **测试环境**: 确保测试环境配置正确
3. **测试数据**: 使用测试数据，不要影响生产数据

## 运行测试示例

```bash
# 1. 安装依赖（如果还没有）
npm install ts-jest --save-dev

# 2. 运行所有测试
npm test

# 3. 运行特定测试文件
npm test -- dynamic-position-manager.test.ts

# 4. 运行测试并查看覆盖率
npm test -- --coverage
```

## 测试文件结构

```
api/
├── src/
│   ├── __tests__/
│   │   ├── dynamic-position-manager.test.ts
│   │   └── README.md
│   └── services/
│       └── dynamic-position-manager.service.ts
├── jest.config.js
└── package.json
```

