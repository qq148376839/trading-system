# 交易推送服务测试文件语法修复

## 📋 问题描述

运行 Jest 测试时出现语法错误：
```
SyntaxError: Unexpected token, expected "," (17:24)
  (tradePushService as any).isSubscribed = false;
```

**原因**：Jest/Babel 解析器在某些情况下不支持 TypeScript 的 `as any` 类型断言语法，特别是在赋值表达式中。

## 🔧 修复方案

### 方案1：使用辅助函数（已采用）

创建辅助函数来访问和设置私有属性：

```typescript
// 辅助函数：访问私有属性
function getPrivateProperty(obj: any, prop: string): any {
  return (obj as any)[prop];
}

function setPrivateProperty(obj: any, prop: string, value: any): void {
  (obj as any)[prop] = value;
}

// 使用方式
setPrivateProperty(tradePushService, 'isSubscribed', false);
setPrivateProperty(tradePushService, 'tradeContext', null);
```

**优点**：
- ✅ 语法兼容性好，避免 Babel 解析问题
- ✅ 代码更清晰，易于维护
- ✅ 可以统一管理私有属性访问

### 方案2：使用 @ts-ignore 注释（备选）

```typescript
// @ts-ignore
tradePushService.isSubscribed = false;
```

**缺点**：
- ❌ 需要为每一行添加注释
- ❌ 代码不够优雅

### 方案3：使用 Object.defineProperty（备选）

```typescript
Object.defineProperty(tradePushService, 'isSubscribed', {
  value: false,
  writable: true,
  configurable: true,
});
```

**缺点**：
- ❌ 代码冗长
- ❌ 不够直观

## ✅ 修复内容

已将所有 `(tradePushService as any).xxx` 替换为 `setPrivateProperty(tradePushService, 'xxx', value)`。

## 🧪 运行测试

### 方法1：使用 npm test（推荐）

```bash
cd api
npm test -- trade-push-unsubscribe.test.ts
```

### 方法2：使用 npx jest（从 api 目录运行）

```bash
cd api
npx jest src/tests/trade-push-unsubscribe.test.ts
```

**注意**：必须在 `api` 目录下运行，Jest 会自动查找 `jest.config.js` 配置文件。

### 方法3：从项目根目录运行（指定工作目录）

```bash
# 从项目根目录运行
cd api && npx jest src/tests/trade-push-unsubscribe.test.ts
```

或者：

```bash
# 使用 --rootDir 参数
npx jest --rootDir api src/tests/trade-push-unsubscribe.test.ts
```

### 方法4：使用 tsx 运行手动测试脚本

```bash
cd api
npm run tsx scripts/test-trade-push-unsubscribe.ts
```

## 📝 注意事项

1. **使用项目配置的 Jest**：建议使用 `npm test` 而不是 `npx jest`，确保使用项目的 `jest.config.js` 配置。

2. **TypeScript 支持**：项目使用 `ts-jest` preset，应该支持 TypeScript，但某些语法（如赋值表达式中的类型断言）可能不被 Babel 解析器支持。

3. **测试环境**：确保测试环境正确配置，包括：
   - `ts-jest` 已安装
   - `jest.config.js` 配置正确
   - TypeScript 编译选项正确

## 🔍 验证修复

运行测试后，应该看到：

```
PASS  api/src/tests/trade-push-unsubscribe.test.ts
  TradePushService unsubscribe 功能测试
    ✓ 状态检查
      ✓ 未订阅时调用 unsubscribe 应该安全返回（幂等性）
      ✓ 已订阅时调用 unsubscribe 应该成功取消订阅
    ✓ 错误处理
      ✓ unsubscribe 失败时应该设置 isSubscribed 为 false
      ✓ tradeContext 为 null 时应该安全处理
      ✓ unsubscribe 方法不存在时应该安全处理
    ✓ 回调函数清理
      ✓ 如果SDK支持 clearOnOrderChanged，应该调用清理方法
      ✓ 如果SDK不支持 clearOnOrderChanged，应该重置回调函数
    ✓ 幂等性
      ✓ 可以重复调用 unsubscribe（幂等性）

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

## 📚 相关文件

- `api/src/tests/trade-push-unsubscribe.test.ts` - 修复后的测试文件
- `api/jest.config.js` - Jest 配置文件
- `api/scripts/test-trade-push-unsubscribe.ts` - 手动测试脚本

