# OptionsQuant 系统架构全量审计报告

**审计日期**: 2026-02-19
**审计团队**: Lead + @security-auditor + @quant-risk-expert + @reliability-engineer
**审计范围**: `/trading-system/` 全项目（api / frontend / edge-functions / Docker / DB schema）

---

## 总览: 风险清单统计

| 级别 | 数量 | 涉及方向 |
|------|------|----------|
| **CRITICAL** | 10 | 资金损失 / 凭证泄露 / 事务缺失 |
| **HIGH** | 26 | 系统故障 / 逻辑缺陷 / 性能瓶颈 |
| **MEDIUM** | 21 | 代码规范 / 防御纵深不足 |

---

## PART 1: CRITICAL 级别 (可能导致资金损失 / 凭证泄露)

### C-1. [Security] ALL API 端点零认证
- **文件**: `api/src/server.ts:48-81`
- 20+ 路由（含 `/api/orders/submit`, `/api/orders/:orderId` DELETE, `/api/token-refresh`）无任何 Auth middleware。配合 `cors()` 通配符，任何网络可达方可直接下单/撤单/改单。

### C-2. [Security] `.env.backup` 已被 git track
- **文件**: `api/.env.backup`
- `git ls-files` 确认已入库。历史提交中可能包含 DB 密码、Longbridge AppSecret、AccessToken。需要立即轮换所有凭证。

### C-3. [Security] CSRF Token + 完整 Cookie 硬编码在 4 个源码文件
- **文件**: `api/src/config/futunn.ts:12-28`, `edge-functions/moomoo-proxy/src/index.js:18-31`, `edge-functions/moomooapi.js:25-38`, `edge-functions/vercel-moomoo-proxy/api/moomooapi.js:13-26`
- 3 组完整的浏览器 session cookie（含 `cipher_device_id`, `csrfToken`, tracking cookies）直接写入源码并提交 git。

### C-4. [Quant] 期权卖出 Fallback 限价单设为市价的 10%（90% 滑点）
- **文件**: `api/src/services/basic-execution.service.ts:772-773`
- 当市价单因流动性不足被拒后，卖出 fallback 价 = `formattedPrice * 0.1`。一个 $5 的期权可能以 $0.50 成交。

### C-5. [Quant] Greeks 为零的合约通过所有筛选
- **文件**: `api/src/services/options-contract-selector.service.ts:341`
- 当 LongPort `calcIndexes` 无数据时 delta/theta 置 0，但过滤条件在双零时跳过检查，导致未知 Greeks 的合约被选中交易。

### C-6. [Quant] 0DTE 强平仅产生信号，无执行保障
- **文件**: `api/src/services/option-dynamic-exit.service.ts:385`
- `checkExitCondition` 返回 `TIME_STOP` 信号但不直接执行。如果策略调度器延迟/崩溃，0DTE 到期后可能变为 ITM 自动行权或 OTM 归零。

### C-7. [Quant] LongPort/Futunn 使用不同的 Symbol 和 Strike 格式
- **文件**: `api/src/services/options-contract-selector.service.ts`
- LongPort 返回标准 symbol，Moomoo fallback 经 `normalizeMoomooOptionCodeToSymbol()` 转换。如果 LongPort 开仓、Futunn 监控退出，symbol 不匹配可能导致找不到持仓或查错合约。

### C-8. [Reliability] 资金分配操作无数据库事务
- **文件**: `api/src/services/capital-manager.service.ts:354-508`
- `requestAllocation` 的 SELECT 检查与 UPDATE 使用之间无事务，并发策略可同时通过余额检查导致超额分配。

### C-9. [Reliability] 订单提交与数据库记录非原子化
- **文件**: `api/src/services/basic-execution.service.ts:825-831`
- SDK 下单成功后 DB 写入失败被吞掉（`catch` 只 log），导致券商有真实订单但系统无记录（幽灵订单）。

### C-10. [Reliability] Longbridge 原生绑定版本硬编码在 Dockerfile
- **文件**: `Dockerfile:78-82, 125-129`
- `longport-linux-x64-gnu-3.0.21.tgz` URL 和 pnpm 内部路径写死，`package.json` 升级后 native binding 不同步会静默失败。

---

## PART 2: HIGH 级别 (系统故障 / 重要逻辑缺陷)

| # | 方向 | 问题 | 文件:行号 |
|---|------|------|-----------|
| H-1 | Security | 通配符 CORS `*` 覆盖所有端点含交易 | `server.ts:48`, `index.js:192` |
| H-2 | Security | Edge Function `path` 参数无白名单（SSRF） | `moomoo-proxy/src/index.js:201-215` |
| H-3 | Security | 敏感凭证明文打印到 console | `longport.ts:174-232` |
| H-4 | Security | `rateLimiter` 定义了但从未 apply | `server.ts` 未 import rateLimiter |
| H-5 | Security | 订单无幂等键/去重机制 | `order-submission.service.ts:79-165` |
| H-6 | Quant | 买入价偏差 5% 对 0DTE 太宽松 | `basic-execution.service.ts:63` |
| H-7 | Quant | 卖出价偏差 20% 极度宽松 | `basic-execution.service.ts:184` |
| H-8 | Quant | DST 硬编码 EST(UTC-5)，夏令时偏移 1 小时 | `option-dynamic-exit.service.ts:568`, `option-recommendation.service.ts:469` |
| H-9 | Quant | 追踪止损无绝对金额下限 | `option-dynamic-exit.service.ts:477-494` |
| H-10 | Quant | IV 格式启发式在 IV>400% 时出错 | `longport-option-quote.service.ts:147-150` |
| H-11 | Quant | Fallback 合约 Greeks/IV 全部为零 | `options-contract-selector.service.ts:636-661` |
| H-12 | Quant | 两个 `normalizeStatus` 函数覆盖范围不同 | `orders.ts:58-139` vs `basic-execution.service.ts:1065-1078` |
| H-13 | Quant | Partial Fill + Cancel 被视为完全失败 | `basic-execution.service.ts:890-903` |
| H-14 | Quant | `waitForOrderFill` 超时返回假 `NewStatus` | `basic-execution.service.ts:1015-1021` |
| H-15 | Quant | Futunn fallback 使用日K（非实时）监控持仓 | `longport-option-quote.service.ts:252` |
| H-16 | Quant | Ultimate fallback 返回 bid=0 ask=0 隐藏流动性 | `longport-option-quote.service.ts:460-474` |
| H-17 | Reliability | DB pool error 直接 `process.exit(-1)` | `database.ts:29-35` |
| H-18 | Reliability | 无 `statement_timeout` 配置 | `database.ts:8-13` |
| H-19 | Reliability | Moomoo proxy 无熔断器 | `moomoo-proxy.ts:230-268` |
| H-20 | Reliability | API rate limiter 队列无上限 | `api-rate-limiter.service.ts:25-26` |
| H-21 | Reliability | 日志队列满时丢弃最旧条目（FIFO） | `log.service.ts:312-315` |
| H-22 | Reliability | VWAP 缓存无大小限制 | `market-data.service.ts:1092-1098` |
| H-23 | Reliability | `auto_trades` 缺少 open position 复合索引 | `000_init_schema.sql:329-348` |
| H-24 | Reliability | `system_logs` 表无分区/无自动清理 | `000_init_schema.sql:512-523` |
| H-25 | Reliability | Builder 用 `--no-frozen-lockfile` | `Dockerfile:72` |
| H-26 | Reliability | 备份 Dockerfile 引用不存在的基础镜像 | `api/Dockerfile.backup:3` |

---

## PART 3: MEDIUM 级别 (防御纵深 / 代码规范)

| # | 问题摘要 | 文件 |
|---|----------|------|
| M-1 | `.gitignore` 未覆盖 `.env.backup` / 子目录 `.env` | `.gitignore:11-14` |
| M-2 | 开发模式下 Error 响应泄露 stack trace | `errorHandler.ts:64-68` |
| M-3 | Edge Function 日志打印 quoteToken 值 | `index.js:270`, `moomooapi.js:392` |
| M-4 | HMAC key `quote_web` 硬编码在 5+ 文件 | `index.js:57` 等 |
| M-5 | 提交时无 bid-ask spread 重校验 | `basic-execution.service.ts` |
| M-6 | 市价不可用时跳过所有价格验证 | `basic-execution.service.ts:53-57` |
| M-7 | Gap risk 无显式处理 | `option-dynamic-exit.service.ts` |
| M-8 | Non-0DTE 冷却期内止损放宽到 1.5x | `option-dynamic-exit.service.ts:527` |
| M-9 | 缓存 TTL 10s 对 0DTE 仍有时效风险 | `option-price-cache.service.ts:32-33` |
| M-10 | DB 写入失败不回滚订单（幽灵持仓） | `basic-execution.service.ts:828` |
| M-11 | 跨源价格一致性无校验 | `options-contract-selector.service.ts` |
| M-12 | Docker Compose 无资源限制 | `docker-compose.yml:34-79` |
| M-13 | PostgreSQL 无 restart 策略 | `docker-compose.yml:8-31` |
| M-14 | 默认 DB 凭证 `trading_user/trading_password` | `docker-compose.yml:13-15` |
| M-15 | `SKIP_LONGPORT_INIT=true` 生产硬编码 | `docker-compose.yml:57` |
| M-16 | Balance sync 与 allocation 竞态 | `account-balance-sync.service.ts:639-663` |
| M-17 | 市场数据失败返回空数组而非抛出 | `market-data.service.ts:267-277` |
| M-18 | 陈旧缓存无最大时限 | `market-data-cache.service.ts:270-274` |
| M-19 | Logger 每次调用生成 stack trace | `logger.ts:179-215` |
| M-20 | `strategy_signals` 缺少时间窗口匹配复合索引 | `000_init_schema.sql:312-327` |
| M-21 | symbol 列 `VARCHAR(20)` 不够放期权代码 | `000_init_schema.sql` 多处 |

---

## 各模块正面发现 (Positive Findings)

1. **SQL 注入防护**: 所有 SQL 查询均使用参数化（`$1`, `$2`），未发现字符串拼接。
2. **订单验证**: `order-validation.ts` 包含 symbol regex、order type 白名单、数值范围校验。
3. **优雅关闭**: `server.ts` 实现了完整的 SIGTERM/SIGINT 处理链（停止调度器 -> 取消推送 -> 关闭 DB）。
4. **单例初始化锁**: `longport.ts` 使用 Promise 锁防止并发初始化。
5. **日志节流**: LogService 实现了消息模板归一化 + 节流 + 摘要聚合。
6. **多源 fallback**: 期权报价有 6 级 fallback chain（LongPort -> 缓存 -> Futunn）。
