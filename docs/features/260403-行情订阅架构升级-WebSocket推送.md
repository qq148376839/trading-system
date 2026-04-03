# 260403 行情订阅架构升级 — 从 5 秒轮询到 WebSocket 推送

## 背景

原始数据路径：
```
setInterval(5000ms) → quoteCtx.quote(idleSymbols) → priceMap → fastMomentumService.feedQuotes()
```

LongPort SDK 内置 WebSocket 订阅能力（`subscribe()` + `setOnQuote()` + `subscribeCandlesticks()` + `setOnCandlestick()`），升级后数据延迟从 0~5s 降至 ~50-200ms。

## 变更文件

### 1. 新增 `api/src/services/quote-subscription.service.ts`

单例服务，管理 WebSocket 行情推送生命周期：

- `init()` — 获取 quoteCtx 并注册 `setOnQuote` / `setOnCandlestick` 回调
- `subscribeSymbols(symbols)` — 订阅报价 + 1 分钟 K 线（幂等）
- `unsubscribeSymbols(symbols)` — 取消订阅
- `addQuoteConsumer(callback)` — 注册外部消费者
- `getPrice(symbol)` / `getPriceMap()` — 读取价格缓存

**降级机制**：
- 心跳检测（30s 超时）→ 断线判定 → 进入 DEGRADED 模式
- DEGRADED 模式自动启动 5 秒轮询 fallback
- 指数退避重连（2s → 4s → 8s → ... → 60s 上限）
- 重连成功后恢复 WebSocket 并停止 fallback 轮询

**状态机**: `IDLE → ACTIVE ⇄ DEGRADED → STOPPED`

### 2. 修改 `api/src/services/fast-momentum.service.ts`

- 新增 `feedSingleQuote(symbol, price, timestamp)` — 单条实时报价喂入
- Buffer 扩容：`BUFFER_CAPACITY` 12→120，`LONG_BUFFER_CAPACITY` 60→600
- 扩容原因：WebSocket 推送频率远高于 5s 轮询，需要更大缓冲区存储同时长窗口数据

### 3. 修改 `api/src/services/strategy-scheduler.service.ts`

- 导入 `quoteSubscriptionService`
- `startStrategy()`: 期权策略启动时初始化 WebSocket 订阅服务
- `stop()`: 停止时清理订阅服务
- `runStrategyCycleInternal()` Phase A:
  - 持仓标的（nonIdleSymbols）订阅实时行情
  - IDLE 标的订阅实时行情
  - WebSocket 活跃时无需手动拉取（数据由回调实时喂入）
  - 降级时回退到原有批量轮询逻辑

## 技术设计要点

### 数据流（升级后）
```
LongPort WebSocket push
  → onQuote callback
    → priceMap 更新
    → fastMomentumService.feedSingleQuote()
    → 外部消费者回调

LongPort WebSocket push
  → onCandlestick callback (isConfirmed=true)
    → priceMap 更新
    → fastMomentumService.feedSingleQuote()
```

### 安全设计（规则 #7 合规）
- 原有 5s 轮询逻辑完整保留为 fallback
- WebSocket 不可用时自动降级到轮询
- 心跳检测确保不会静默丢失数据

### LongPort SDK API 签名
```typescript
// 报价订阅
quoteCtx.subscribe(symbols: string[], [SubType.Quote], isFirstPush: boolean): Promise<void>
quoteCtx.unsubscribe(symbols: string[], [SubType.Quote]): Promise<void>
quoteCtx.setOnQuote(callback: (err: Error | null, event: PushQuoteEvent) => void): void

// K 线订阅（逐标的）
quoteCtx.subscribeCandlesticks(symbol: string, period: Period): Promise<void>
quoteCtx.unsubscribeCandlesticks(symbol: string, period: Period): Promise<void>
quoteCtx.setOnCandlestick(callback: (err: Error | null, event: PushCandlestickEvent) => void): void
```
