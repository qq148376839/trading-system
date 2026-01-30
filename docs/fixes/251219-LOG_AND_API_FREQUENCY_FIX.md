# 日志写入和API频率限制修复方案

## 📋 文档信息
- **文档版本**：v1.0
- **创建时间**：2025-12-19
- **问题类型**：Bug修复
- **优先级**：P0

---

## 1. 问题描述

### 1.1 问题1：今日订单API调用频率过高
**现象**：
- 日志中频繁出现 `code=429002: api request is limited, please slow down request frequency`
- 多个服务同时调用 `todayOrders()` API，导致频率限制

**根本原因**：
- `basic-execution.service.ts` 中直接调用 `tradeCtx.todayOrders()`，没有使用缓存
- `strategy-scheduler.service.ts` 中有缓存机制，但其他服务没有共享缓存
- 多个服务同时调用，缓存失效时会导致重复请求

### 1.2 问题2：策略汇总日志未写入数据库
**现象**：
- 控制台可以看到日志输出：`策略 5 执行完成: 耗时 9883ms...`
- 但数据库中查询不到对应的日志记录

**可能原因**：
- 日志服务的metadata处理可能有问题
- 日志级别过滤可能有问题
- 日志写入队列可能有问题

---

## 2. 修复方案

### 2.1 修复方案1：统一今日订单缓存服务

**方案**：创建一个统一的今日订单缓存服务，所有服务都使用这个服务获取订单数据。

**实施步骤**：
1. 创建 `today-orders-cache.service.ts` 服务
2. 将所有直接调用 `tradeCtx.todayOrders()` 的地方改为使用缓存服务
3. 确保缓存TTL足够长（60秒），避免频繁刷新

**代码修改**：
- `api/src/services/today-orders-cache.service.ts` - 新建缓存服务
- `api/src/services/basic-execution.service.ts` - 使用缓存服务
- `api/src/services/strategy-scheduler.service.ts` - 使用缓存服务（已实现，需要优化）

### 2.2 修复方案2：检查日志写入逻辑

**方案**：检查日志服务的metadata处理，确保策略汇总日志能正确写入数据库。

**实施步骤**：
1. 检查 `logger.info` 的调用方式是否正确
2. 检查 `formatLogData` 函数是否正确处理metadata
3. 检查日志服务的队列处理逻辑
4. 添加日志写入验证

---

## 3. 实施计划

### 3.1 第一步：创建今日订单缓存服务

创建 `api/src/services/today-orders-cache.service.ts`：

```typescript
/**
 * 今日订单缓存服务
 * 统一管理今日订单的缓存，避免多个服务重复调用API
 */

import { getTradeContext } from '../config/longport';
import { mapOrderData } from '../routes/orders';
import { logger } from '../utils/logger';

class TodayOrdersCacheService {
  private cache: { orders: any[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 60 * 1000; // 60秒缓存
  private refreshPromise: Promise<any[]> | null = null; // 防止并发刷新

  /**
   * 获取今日订单（带缓存）
   */
  async getTodayOrders(forceRefresh: boolean = false): Promise<any[]> {
    const now = Date.now();
    
    // 如果缓存有效且不强制刷新，直接返回缓存
    if (!forceRefresh && this.cache && (now - this.cache.timestamp) < this.CACHE_TTL) {
      return this.cache.orders;
    }

    // 如果正在刷新，等待刷新完成
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // 开始刷新
    this.refreshPromise = this.refreshCache();
    
    try {
      const orders = await this.refreshPromise;
      return orders;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * 刷新缓存
   */
  private async refreshCache(): Promise<any[]> {
    try {
      const tradeCtx = await getTradeContext();
      const rawOrders = await tradeCtx.todayOrders({});
      
      const mappedOrders = Array.isArray(rawOrders) 
        ? rawOrders.map((order: any) => mapOrderData(order))
        : [];
      
      // 更新缓存
      this.cache = {
        orders: mappedOrders,
        timestamp: Date.now(),
      };
      
      return this.cache.orders;
    } catch (error: any) {
      // 如果刷新失败，尝试使用过期缓存
      if (this.cache) {
        logger.warn(`获取今日订单失败，使用过期缓存: ${error.message}`);
        return this.cache.orders;
      }
      logger.error('获取今日订单失败且无缓存:', error);
      return [];
    }
  }

  /**
   * 清除缓存（用于测试或手动刷新）
   */
  clearCache(): void {
    this.cache = null;
  }
}

export default new TodayOrdersCacheService();
```

### 3.2 第二步：修改basic-execution.service.ts

将所有直接调用 `tradeCtx.todayOrders()` 的地方改为使用缓存服务：

```typescript
import todayOrdersCache from './today-orders-cache.service';

// 替换所有 tradeCtx.todayOrders() 调用为：
const todayOrders = await todayOrdersCache.getTodayOrders();
```

### 3.3 第三步：优化strategy-scheduler.service.ts

移除内部的缓存实现，使用统一的缓存服务：

```typescript
import todayOrdersCache from './today-orders-cache.service';

// 移除内部的 todayOrdersCache 和 getTodayOrders 方法
// 所有调用改为：
const todayOrders = await todayOrdersCache.getTodayOrders();
```

### 3.4 第四步：检查日志写入逻辑

检查 `logger.info` 的调用方式，确保metadata正确传递：

```typescript
// 当前调用方式：
logger.info(message, { metadata: {...} });

// formatLogData 会将第二个参数作为 extraData
// 所以数据库中会有 extraData.metadata，这是正确的
```

添加日志写入验证：

```typescript
// 在 logExecutionSummary 方法中添加验证
logger.info(
  `策略 ${summary.strategyId} 执行完成...`,
  { metadata: {...} }
);

// 验证：检查日志是否写入队列
// 可以通过 logService.getQueue().length 检查
```

---

## 4. 验证方法

### 4.1 验证API频率限制修复
1. 启动策略，观察日志
2. 应该不再出现 `code=429002` 错误
3. 检查日志中的 `获取今日订单失败` 消息应该大幅减少

### 4.2 验证日志写入修复
1. 运行策略一个周期
2. 查询数据库：
   ```sql
   SELECT * FROM system_logs 
   WHERE module = 'Strategy.Scheduler' 
   AND message LIKE '%执行完成%'
   ORDER BY timestamp DESC 
   LIMIT 10;
   ```
3. 应该能看到策略汇总日志
4. 检查 `extra_data` 字段，应该包含完整的metadata

---

## 5. 相关文件

- `api/src/services/today-orders-cache.service.ts` - 新建缓存服务
- `api/src/services/basic-execution.service.ts` - 修改使用缓存服务
- `api/src/services/strategy-scheduler.service.ts` - 优化使用缓存服务
- `api/src/utils/logger.ts` - 检查日志写入逻辑

---

## 6. 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|------|------|----------|--------|
| v1.0 | 2025-12-19 | 初始修复方案 | AI Engineer |






