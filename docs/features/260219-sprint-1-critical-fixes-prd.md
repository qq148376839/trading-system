# Sprint 1: 关键风险修复 — 产品需求文档 (PRD)

**版本**: 1.0
**日期**: 2026-02-19
**PM**: Lead (Claude)
**关联审计报告**: `docs/review/260219-full-system-audit-report.md`

---

## 冲刺目标

消除审计报告中所有 **CRITICAL** 级别的资金安全和凭证泄露风险，以及直接影响交易执行正确性的 **HIGH** 级别缺陷。

---

## 里程碑规划

### Milestone 1: 安全加固 (Security Hardening)
**Owner**: @fullstack-dev
**关联风险**: C-1, C-2, C-3, H-1, H-2, H-3, H-4, H-5, M-1

| Task | 描述 | AC |
|------|------|----|
| T-1.1 | API Auth Middleware + CORS 收紧 | 所有 `/api/*` 端点需 Bearer Token / API Key；CORS 限定为前端域名 |
| T-1.2 | 凭证清理 (`env.backup` + 硬编码 cookie) | `git ls-files \| grep env` 返回空；`futunn.ts` 硬编码 fallback 迁移到 DB-only |
| T-1.3 | Edge Function 安全加固 | `path` 参数白名单校验；CORS 限定来源；credentials 移入 Worker secrets |
| T-1.4 | 凭证日志脱敏 | `longport.ts` 初始化日志仅输出 `configured: true/false` + 来源 + 长度，不输出值 |
| T-1.5 | 订单幂等机制 | `submitOrder()` 增加 idempotencyKey；DB UNIQUE 约束防重复；API 层要求 header |
| T-1.6 | 启用 rateLimiter | `server.ts` import 并 apply rateLimiter 到 `/api/*` |

### Milestone 2: 资金安全与事务完整性 (Capital Safety)
**Owner**: @fullstack-dev
**关联风险**: C-4, C-8, C-9, H-5, H-12, H-13, H-14, H-17, H-18

| Task | 描述 | AC |
|------|------|----|
| T-2.1 | 资金分配事务化 | `requestAllocation` / `releaseAllocation` 包裹在 `BEGIN...COMMIT`，并发测试不超额 |
| T-2.2 | 订单提交+DB 补偿机制 | DB 写入失败时启动异步补偿任务（重试3次 + 告警）；不再静默吞错 |
| T-2.3 | 期权卖出 fallback 价修正 | 从 `0.1x` 改为 `max(0.80x, 0.01)`（最多 20% 滑点） |
| T-2.4 | 统一 normalizeStatus | 提取到 `utils/order-status.ts`，覆盖数字枚举 0-17 + 字符串形式 + ExpiredStatus |
| T-2.5 | Partial Fill 正确处理 | `PartialFilledStatus` + Cancel 返回 `success: true` + 实际成交量；不再视为失败 |
| T-2.6 | DB pool 容错 | `pool.on('error')` 改为 log + 移除坏连接；移除 `process.exit(-1)` |
| T-2.7 | 增加 statement_timeout | pool config 增加 `statement_timeout: 30000` + `idle_in_transaction_session_timeout: 60000` |

### Milestone 3: 期权业务逻辑修复 (Options Logic)
**Owner**: @fullstack-dev + @uiux-polisher
**关联风险**: C-5, C-6, C-7, H-6, H-7, H-8, H-9, H-10, H-11, H-15, H-16

| Task | 描述 | AC |
|------|------|----|
| T-3.1 | Greeks 零值拦截 | delta=0 且 theta=0 时标记合约为 `greeksUnavailable`，拒绝自动交易 |
| T-3.2 | 0DTE 强平独立看门狗 | 新增 `0dte-watchdog.service.ts`，独立于策略调度器，定时扫描到期持仓并直接执行平仓 |
| T-3.3 | Symbol 格式统一层 | 新增 `utils/option-symbol-normalizer.ts`，所有入口/出口统一为 LongPort 格式 |
| T-3.4 | DST 时区修复 | 所有 ET 时间计算统一使用 `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' })` |
| T-3.5 | IV 归一化 | 移除 `< 5` 启发式；LongPort 结果统一 `* 100`；Futunn 结果直接使用百分比 |
| T-3.6 | Fallback 合约 Greeks 标记 | Moomoo fallback 合约返回时标记 `greeksSource: 'unavailable'`，下游据此放宽/收紧风控 |
| T-3.7 | Futunn 日K fallback 禁止用于盘中监控 | 当 source 为 `futunn-quote-fallback` 且处于盘中时段，拒绝用于 PnL/止损计算 |

### Milestone 4: 基础设施加固 (Infra Hardening)
**Owner**: @qa-automator
**关联风险**: C-10, H-19, H-20, H-23, H-24, H-25, M-12, M-13, M-21

| Task | 描述 | AC |
|------|------|----|
| T-4.1 | Dockerfile SDK 版本参数化 | 使用 `ARG LONGPORT_VERSION` 替代硬编码版本号 |
| T-4.2 | DB schema 修复 | symbol 列扩到 `VARCHAR(50)`；增加 `auto_trades` 复合索引；增加 `strategy_signals` 复合索引 |
| T-4.3 | system_logs 自动清理 | 启用 `log_auto_cleanup_enabled=true`，默认保留 90 天 |
| T-4.4 | Docker Compose 加固 | PG 增加 `restart: unless-stopped`；增加资源限制；移除默认密码 |
| T-4.5 | API rate limiter 队列上限 | `maxQueueSize: 1000`，超限直接拒绝并告警 |

---

## 优先级排序

| 优先级 | Task | 理由 |
|--------|------|------|
| P0 | T-1.1 (Auth) | 零认证 = 任何人可下单，最高风险 |
| P0 | T-2.1 (事务) | 资金超额分配可直接造成损失 |
| P0 | T-2.3 (Fallback 价) | 每笔 fallback 卖单可损失 90% |
| P1 | T-1.2 (凭证清理) | 已泄露凭证需轮换 |
| P1 | T-3.1 (Greeks 拦截) | 错误合约选择导致策略失效 |
| P1 | T-3.2 (0DTE 看门狗) | 到期未平仓 = 不可控风险 |
| P1 | T-2.4 (统一 Status) | 状态丢失导致幽灵持仓 |
| P2 | T-1.3 ~ T-1.6 | 安全纵深 |
| P2 | T-2.2, T-2.5 ~ T-2.7 | 事务补偿与容错 |
| P2 | T-3.3 ~ T-3.7 | 期权逻辑防御 |
| P3 | T-4.1 ~ T-4.5 | 基础设施 |
