# 长桥SDK连接失败问题修复

## 📋 问题描述

在修复TypeScript编译错误后（commit `84b8433e9af1a30bb4184e8abf71933a3c167b38`），长桥SDK无法正常连接，报错：
```
error sending request for url (https://openapi.longportapp.com/v2/socket/token)
code: 'GenericFailure'
```

回滚到 `3ca55a64acf0d5a461ee8607f7b50649395f5a1b` 版本后，连接正常。

## 🔍 问题分析

### 根本原因

1. **环境变量加载冲突**：
   - `server.ts`、`database.ts`、`longport.ts` 三个文件都在加载 `.env` 文件
   - 在修复TypeScript编译错误时，`database.ts` 的加载逻辑变得更复杂，添加了多路径查找
   - 多次调用 `dotenv.config()` 可能导致环境变量被覆盖或加载顺序问题

2. **加载顺序问题**：
   - `database.ts` 在模块加载时就会执行 `dotenv.config()`
   - 如果 `longport.ts` 在 `database.ts` 之后加载，可能会覆盖已加载的环境变量
   - 长桥SDK需要正确的 `LONGPORT_APP_KEY`、`LONGPORT_APP_SECRET`、`LONGPORT_ACCESS_TOKEN` 才能初始化

### 对比分析

**旧版本（3ca55a64）**：
```typescript
// database.ts
dotenv.config(); // 简单调用，不指定路径

// longport.ts
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath }); // 明确指定路径
```

**新版本（84b8433）**：
```typescript
// database.ts
// 添加了多路径查找逻辑，可能多次调用 dotenv.config()
const possibleEnvPaths = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
];
// ... 循环加载逻辑
```

## ✅ 修复方案

### 1. 条件加载环境变量

**`database.ts`**：
- 只在 `DATABASE_URL` 未设置时才加载 `.env` 文件
- 使用 `override: false` 确保不覆盖已存在的环境变量

```typescript
if (!process.env.DATABASE_URL) {
  // 只在需要时加载
  const result = dotenv.config({ path: envPath, override: false });
}
```

**`longport.ts`**：
- 只在 `LONGPORT_APP_KEY` 和 `LONGPORT_ACCESS_TOKEN` 都未设置时才加载
- 使用 `override: false` 确保不覆盖已存在的环境变量

```typescript
if (!process.env.LONGPORT_APP_KEY && !process.env.LONGPORT_ACCESS_TOKEN) {
  const result = dotenv.config({ path: envPath, override: false });
}
```

### 2. 保持加载顺序

- `server.ts` 首先加载 `.env`（在应用启动时）
- `database.ts` 和 `longport.ts` 只在需要时加载，且不会覆盖已存在的环境变量

## 📝 修改的文件

1. **`api/src/config/database.ts`**
   - 添加条件检查：只在 `DATABASE_URL` 未设置时加载
   - 使用 `override: false` 参数

2. **`api/src/config/longport.ts`**
   - 添加条件检查：只在长桥相关环境变量未设置时加载
   - 使用 `override: false` 参数

## 🧪 验证步骤

1. 重启API服务
2. 检查日志，确认：
   - `.env` 文件只被加载一次（或按需加载）
   - 长桥SDK能够成功初始化
   - 不再出现 `error sending request` 错误

## 📚 相关文档

- [dotenv文档](https://github.com/motdotla/dotenv#readme)
- [长桥SDK文档](https://longportapp.github.io/openapi/nodejs/)

## 🔄 版本信息

- **问题版本**: `84b8433e9af1a30bb4184e8abf71933a3c167b38`
- **正常版本**: `3ca55a64acf0d5a461ee8607f7b50649395f5a1b`
- **修复日期**: 2025-12-12

## 💡 经验总结

1. **避免多次加载环境变量**：多个模块加载 `.env` 文件时，应该使用条件检查避免重复加载
2. **使用 `override: false`**：确保不会覆盖已存在的环境变量
3. **保持加载顺序一致性**：确保环境变量在需要时已经加载完成
4. **测试环境变量加载**：在修复编译错误后，应该测试环境变量相关的功能

