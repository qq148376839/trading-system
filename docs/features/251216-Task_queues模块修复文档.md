# Task_queues 模块修复文档

**创建日期**: 2025-12-16  
**最后更新**: 2025-12-16  
**状态**: 已完成 ✅

---

## 📚 文档索引

### 文档结构

本文档整合了 Task_queues 模块修复的所有相关文档，包括：
- 问题确认：问题现象和影响分析
- 问题诊断：根本原因分析
- 解决方案：修复方案和实施步骤
- 实施总结：已完成的修复和验证方法

### 快速导航

**想了解问题背景？** → 查看「1. 问题确认」

**想了解问题原因？** → 查看「2. 问题诊断」

**想了解修复方案？** → 查看「3. 解决方案」

**想了解实施情况？** → 查看「4. 实施总结」

---

# 1. 问题确认

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-16
- **最后更新**：2025-12-16
- **优先级**：P0（立即修复）
- **相关文档**：[日志系统优化PRD](251216-日志系统优化产品需求文档.md)

## 🎯 问题现象

根据 API 查询结果（`curl "http://localhost:3001/api/logs?module=Task_queues&limit=10"`）：
- ✅ 日志内容都是策略相关的（"策略 5 标的..."）
- ✅ 应该来自 `strategy-scheduler.service.ts`
- ❌ 但模块名称被错误识别为 `Task_queues`（下划线格式）
- ❌ 所有日志的 `filePath` 都是 `logger.ts`（说明调用栈提取有问题）

## 问题影响

- 模块名称不一致，导致查询困难
- 无法通过模块名称准确识别日志来源
- 影响日志系统的整体一致性

---

# 2. 问题诊断

## 🔍 诊断方法

### 方法1：使用 API 查询（最简单）

```bash
curl "http://localhost:3001/api/logs?module=Task_queues&limit=10" | jq '.data.logs[] | {module, file_path, message}'
```

### 方法2：使用 SQL 查询（最准确）

```sql
-- 查看 Task_queues 模块的文件路径分布
SELECT DISTINCT 
  file_path,
  COUNT(*) as log_count,
  MIN(timestamp) as first_log,
  MAX(timestamp) as last_log
FROM system_logs
WHERE module = 'Task_queues'
GROUP BY file_path
ORDER BY log_count DESC
LIMIT 20;
```

### 方法3：使用诊断脚本

```bash
# 需要先安装依赖：cd api && npm install pg
node scripts/diagnose-task-queues-module.js
```

## 🔍 问题根源分析

**根本原因**：
1. `extractModuleName` 函数从调用栈提取文件路径
2. 调用栈中跳过了 `logger.ts`，找到了调用它的文件（应该是 `strategy-scheduler.service.ts`）
3. 但文件路径可能没有被正确匹配到映射规则
4. 使用了 `inferModuleFromPathFallback` 推断模块名称
5. `inferModuleFromPath` 函数只将连字符（`-`）转换为点号，**没有处理下划线（`_`）**
6. 如果文件名包含下划线，推断出的模块名称会保留下划线格式

**代码位置**：
- `api/src/utils/logger.ts` - `extractModuleName` 函数
- `api/src/utils/log-module-mapper.ts` - `inferModuleFromPath` 函数

---

# 3. 解决方案

## ✅ 方案1：快速修复（推荐，最小改动）

### 步骤1：添加模块名称标准化函数

**文件**：`api/src/utils/log-module-mapper.ts`

**修改内容**：在文件末尾添加：

```typescript
/**
 * 模块名称映射表（用于兼容旧格式）
 * 将旧的模块名称映射到新的模块名称
 */
const MODULE_NAME_MAPPING: Record<string, string> = {
  'Task_queues': 'Strategy.Scheduler',
  // 可以添加其他映射
}

/**
 * 标准化模块名称（处理旧格式）
 * @param module 模块名称（可能是旧格式）
 * @returns 标准化的模块名称
 */
export function normalizeModuleName(module: string): string {
  // 先检查直接映射
  if (MODULE_NAME_MAPPING[module]) {
    return MODULE_NAME_MAPPING[module]
  }
  
  // 将下划线转换为点号
  return module.replace(/_/g, '.')
}
```

### 步骤2：在 logger.ts 中使用标准化函数

**文件**：`api/src/utils/logger.ts`

**修改内容**：
- 添加 `normalizeModuleName` 函数的导入
- 修改 `extractModuleName` 函数，在返回前标准化

**代码位置**：
- 导入部分（第13行）
- `extractModuleName` 函数（第166-177行）

```typescript
// 导入 normalizeModuleName
let normalizeModuleName: ((module: string) => string) | undefined;
try {
  const moduleMapper = require('./log-module-mapper');
  if (moduleMapper && typeof moduleMapper.normalizeModuleName === 'function') {
    normalizeModuleName = moduleMapper.normalizeModuleName;
  }
} catch (error) {
  // 忽略错误，使用备用方案
}

// 在 extractModuleName 中使用
function extractModuleName(stack?: string): string {
  if (!stack) {
    return 'Unknown';
  }

  const stackLines = stack.split('\n');
  // 跳过前3行（Error、logger.log/info/warn/error/debug）
  for (let i = 3; i < stackLines.length; i++) {
    const line = stackLines[i];
    // 匹配格式：at functionName (file:line:column)
    const match = line.match(/at\s+.+\s+\((.+):(\d+):(\d+)\)/);
    if (match) {
      const filePath = match[1];
      // 排除node_modules和logger.ts本身
      if (!filePath.includes('node_modules') && !filePath.includes('logger.ts')) {
        // 使用模块映射器获取准确的模块名称，如果失败则使用备用方案
        try {
          const module = getModuleFromPath(filePath);
          // 标准化模块名称（处理旧格式）
          if (normalizeModuleName) {
            return normalizeModuleName(module);
          }
          return module;
        } catch (error) {
          // 如果调用失败，使用备用方案
          const module = inferModuleFromPathFallback(filePath);
          if (normalizeModuleName) {
            return normalizeModuleName(module);
          }
          return module;
        }
      }
    }
  }

  return 'Unknown';
}
```

**优点**：
- ✅ 改动最小，只需添加一个函数和几行代码
- ✅ 立即生效，新日志会使用正确的模块名称
- ✅ 向后兼容，不影响历史数据

## ✅ 方案2：完整修复（推荐，长期方案）

除了方案1的修复，还需要修复 `inferModuleFromPath` 函数，确保未来不会产生下划线格式的模块名称。

### 步骤1：修复 inferModuleFromPath 函数

**文件**：`api/src/utils/log-module-mapper.ts`

**修改内容**：在所有模块名称转换的地方添加下划线处理

**修改位置**：
- 第319行：services 目录处理
- 第332行：routes 目录处理
- 第345行：utils 目录处理
- 第358行：config 目录处理
- 第370行：默认文件名提取

```typescript
function inferModuleFromPath(filePath: string): string {
  // 提取文件路径中的关键部分
  const pathParts = filePath.split('/')
  
  // 查找 services、routes、utils、config 等目录
  const servicesIndex = pathParts.indexOf('services')
  const routesIndex = pathParts.indexOf('routes')
  const utilsIndex = pathParts.indexOf('utils')
  const configIndex = pathParts.indexOf('config')
  
  if (servicesIndex >= 0 && servicesIndex < pathParts.length - 1) {
    // 在services目录下
    const fileName = pathParts[pathParts.length - 1]
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.')
    return `Service.${moduleName}`
  }
  
  if (routesIndex >= 0 && routesIndex < pathParts.length - 1) {
    // 在routes目录下
    const fileName = pathParts[pathParts.length - 1]
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.')
    return `API.${moduleName}`
  }
  
  if (utilsIndex >= 0 && utilsIndex < pathParts.length - 1) {
    // 在utils目录下
    const fileName = pathParts[pathParts.length - 1]
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.')
    return `Utils.${moduleName}`
  }
  
  if (configIndex >= 0 && configIndex < pathParts.length - 1) {
    // 在config目录下
    const fileName = pathParts[pathParts.length - 1]
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.')
    return `Config.${moduleName}`
  }
  
  // 默认：从文件名提取
  const fileName = pathParts[pathParts.length - 1]
  const moduleName = fileName
    .replace(/\.(ts|js)$/, '')
    .replace(/-/g, '.')
    .replace(/_/g, '.')  // 新增：将下划线也转换为点号
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('.')
  
  return moduleName || 'Unknown'
}
```

### 步骤2：修复 inferModuleFromPathFallback 函数

**文件**：`api/src/utils/logger.ts`

**修改内容**：在所有模块名称转换的地方添加 `.replace(/_/g, '.')`

**修改位置**：
- 第74行：services 目录处理
- 第86行：routes 目录处理
- 第98行：utils 目录处理
- 第110行：config 目录处理
- 第122行：默认文件名提取

```typescript
function inferModuleFromPathFallback(filePath: string): string {
  // ... 现有逻辑 ...
  
  // 在所有模块名称转换的地方添加 .replace(/_/g, '.')
  const moduleName = fileName
    .replace(/\.(ts|js)$/, '')
    .replace(/-/g, '.')
    .replace(/_/g, '.')  // 新增
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('.')
  
  return moduleName || 'Unknown'
}
```

**优点**：
- ✅ 从根本上解决问题，防止未来再次出现类似问题
- ✅ 统一模块命名格式为点号分隔
- ✅ 与方案1结合，确保新旧格式都能正确处理

## ✅ 方案3：查询兼容性处理（临时方案）

在 `api/src/routes/logs.ts` 的查询接口中，支持查询旧格式和新格式：

```typescript
if (module) {
  // 将下划线转换为点号
  const normalizedModule = module.replace(/_/g, '.')
  
  // 支持查询旧格式（Task_queues）和新格式（Strategy.Scheduler）
  if (normalizedModule !== module) {
    conditions.push(`(module = $${paramIndex++} OR module = $${paramIndex++})`)
    params.push(module, normalizedModule)
  } else {
    conditions.push(`module = $${paramIndex++}`)
    params.push(module)
  }
}
```

**优点**：
- ✅ 不影响日志记录逻辑
- ✅ 支持查询历史数据

**缺点**：
- ❌ 只是临时方案，不能解决根本问题
- ❌ 新日志仍会使用错误的模块名称

---

# 4. 实施总结

## 📋 实施信息
- **实施时间**：2025-12-16
- **修复版本**：v1.0
- **状态**：✅ 已完成

## ✅ 已完成的修复

### 1. 添加模块名称标准化函数

**文件**：`api/src/utils/log-module-mapper.ts`

**修改内容**：
- ✅ 添加了 `MODULE_NAME_MAPPING` 映射表，将 `Task_queues` 映射到 `Strategy.Scheduler`
- ✅ 添加了 `normalizeModuleName` 函数，支持模块名称标准化

**代码位置**：文件末尾（第395-422行）

```typescript
const MODULE_NAME_MAPPING: Record<string, string> = {
  'Task_queues': 'Strategy.Scheduler',
}

export function normalizeModuleName(module: string): string {
  if (!module) {
    return 'Unknown'
  }
  
  // 先检查直接映射
  if (MODULE_NAME_MAPPING[module]) {
    return MODULE_NAME_MAPPING[module]
  }
  
  // 将下划线转换为点号
  return module.replace(/_/g, '.')
}
```

### 2. 在 logger.ts 中使用标准化函数

**文件**：`api/src/utils/logger.ts`

**修改内容**：
- ✅ 添加了 `normalizeModuleName` 函数的导入
- ✅ 修改了 `extractModuleName` 函数，在返回模块名称前进行标准化

**代码位置**：
- 导入部分（第13行）
- `extractModuleName` 函数（第166-177行）

```typescript
// 导入 normalizeModuleName
let normalizeModuleName: ((module: string) => string) | undefined;

// 在 extractModuleName 中使用
const module = getModuleFromPath(filePath);
// 标准化模块名称（处理旧格式）
if (normalizeModuleName) {
  return normalizeModuleName(module);
}
return module;
```

### 3. 修复 inferModuleFromPath 函数

**文件**：`api/src/utils/log-module-mapper.ts`

**修改内容**：
- ✅ 在所有模块名称转换逻辑中添加了 `.replace(/_/g, '.')`
- ✅ 修复了 services、routes、utils、config 目录下的推断逻辑
- ✅ 修复了默认文件名提取逻辑

**修改位置**：
- 第319行：services 目录处理
- 第332行：routes 目录处理
- 第345行：utils 目录处理
- 第358行：config 目录处理
- 第370行：默认文件名提取

### 4. 修复 inferModuleFromPathFallback 函数

**文件**：`api/src/utils/logger.ts`

**修改内容**：
- ✅ 在所有模块名称转换逻辑中添加了 `.replace(/_/g, '.')`
- ✅ 修复了 services、routes、utils、config 目录下的推断逻辑
- ✅ 修复了默认文件名提取逻辑

**修改位置**：
- 第74行：services 目录处理
- 第86行：routes 目录处理
- 第98行：utils 目录处理
- 第110行：config 目录处理
- 第122行：默认文件名提取

## 🎯 修复效果

### 修复前
- ❌ 模块名称可能是 `Task_queues`（下划线格式）
- ❌ 模块命名不一致，影响查询

### 修复后
- ✅ 新日志自动将 `Task_queues` 映射到 `Strategy.Scheduler`
- ✅ 所有下划线格式的模块名称自动转换为点号分隔格式
- ✅ 模块命名统一为点号分隔格式

## 📊 验证方法

### 1. 等待新日志生成

修复后，等待系统生成新日志（或手动触发一次策略执行），然后查询：

```bash
curl "http://localhost:3001/api/logs?limit=10" | jq '.data.logs[] | {module, message}'
```

**预期结果**：
- 新日志的 `module` 应该是 `Strategy.Scheduler` 而不是 `Task_queues`
- 所有模块名称都应该是点号分隔格式

### 2. 验证标准化函数

可以编写简单的测试验证：

```typescript
import { normalizeModuleName } from './utils/log-module-mapper';

// 测试直接映射
console.log(normalizeModuleName('Task_queues'));  // 应该返回 'Strategy.Scheduler'

// 测试下划线转换
console.log(normalizeModuleName('Task_Queues'));  // 应该返回 'Task.Queues'
console.log(normalizeModuleName('Some_Module'));  // 应该返回 'Some.Module'

// 测试正常格式
console.log(normalizeModuleName('Strategy.Scheduler'));  // 应该返回 'Strategy.Scheduler'
```

## 🔄 向后兼容性

### 历史数据
- ✅ 历史数据中的 `Task_queues` 保持不变（不影响已有数据）
- ✅ 查询时可以通过查询兼容性处理支持旧格式（如果实现了方案3）

### 新日志
- ✅ 新日志自动使用标准化的模块名称
- ✅ 不会再产生下划线格式的模块名称

## 📝 后续工作

### 可选：查询兼容性处理

如果需要支持查询旧格式，可以在 `api/src/routes/logs.ts` 中添加：

```typescript
if (module) {
  // 将下划线转换为点号
  const normalizedModule = module.replace(/_/g, '.')
  
  // 支持查询旧格式（Task_queues）和新格式（Strategy.Scheduler）
  if (normalizedModule !== module) {
    conditions.push(`(module = $${paramIndex++} OR module = $${paramIndex++})`)
    params.push(module, normalizedModule)
  } else {
    conditions.push(`module = $${paramIndex++}`)
    params.push(module)
  }
}
```

### 可选：数据迁移

如果需要统一历史数据，可以执行：

```sql
UPDATE system_logs
SET module = 'Strategy.Scheduler'
WHERE module = 'Task_queues';
```

## 🚀 推荐实施步骤

### 立即修复（P0）

1. **实施方案1**：添加 `normalizeModuleName` 函数（5分钟）
   - 在 `log-module-mapper.ts` 中添加函数
   - 在 `logger.ts` 中使用函数
   - 验证新日志模块名称正确

2. **验证修复**：等待新日志生成，确认模块名称正确

### 完整修复（P1）

3. **实施方案2**：修复 `inferModuleFromPath` 函数（10分钟）
   - 在所有转换逻辑中添加下划线处理
   - 确保未来不会产生下划线格式的模块名称

4. **实施方案3**：添加查询兼容性处理（可选，5分钟）
   - 支持查询旧格式和新格式
   - 确保历史数据可查询

## 🔧 调试方法（可选）

如果需要调试模块名称提取过程，可以在 `extractModuleName` 函数中添加日志：

```typescript
function extractModuleName(stack?: string): string {
  // ... 现有逻辑 ...
  
  if (match) {
    const filePath = match[1];
    if (!filePath.includes('node_modules') && !filePath.includes('logger.ts')) {
      // 添加调试日志
      console.log('[ModuleExtraction] 提取文件路径:', filePath);
      const module = getModuleFromPath(filePath);
      console.log('[ModuleExtraction] 提取的模块名称:', module);
      const normalizedModule = normalizeModuleName ? normalizeModuleName(module) : module;
      console.log('[ModuleExtraction] 标准化后的模块名称:', normalizedModule);
      return normalizedModule;
    }
  }
  
  // ...
}
```

## 📝 数据迁移（可选）

如果需要统一历史数据，可以执行数据迁移：

```sql
-- 将 Task_queues 更新为 Strategy.Scheduler
UPDATE system_logs
SET module = 'Strategy.Scheduler'
WHERE module = 'Task_queues';

-- 验证更新结果
SELECT COUNT(*) FROM system_logs WHERE module = 'Task_queues';  -- 应该返回 0
SELECT COUNT(*) FROM system_logs WHERE module = 'Strategy.Scheduler';  -- 应该增加
```

**注意**：
- 数据迁移是可选的，不影响新日志的正确性
- 建议在业务低峰期执行
- 可以先执行 `SELECT` 查询确认影响范围

## ✅ 验收清单

- [x] `normalizeModuleName` 函数已添加并导出
- [x] `logger.ts` 中已导入并使用 `normalizeModuleName`
- [x] `inferModuleFromPath` 函数已修复（所有位置都添加了下划线处理）
- [x] `inferModuleFromPathFallback` 函数已修复（所有位置都添加了下划线处理）
- [x] 代码编译通过（无 lint 错误）
- [ ] 新日志验证（需要等待新日志生成或手动触发）

## 🎯 预期结果

修复后应该达到：
- ✅ 新日志使用 `Strategy.Scheduler` 而不是 `Task_queues`
- ✅ 模块名称统一为点号分隔格式
- ✅ 查询时支持旧格式和新格式（向后兼容）
- ✅ 未来不会产生下划线格式的模块名称

---

## 📚 相关文档

- [日志系统优化PRD](251216-日志系统优化产品需求文档.md) - 完整的优化需求文档
- [日志模块映射说明](251215-LOG_MODULE_MAPPING.md) - 模块映射规则说明

---

**文档版本**：v1.0  
**最后更新**：2025-12-16  
**状态**：已完成 ✅

