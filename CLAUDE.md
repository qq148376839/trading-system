# 量化交易系统 — 项目上下文

## 项目概述
- 量化交易系统：Node.js + TypeScript + PostgreSQL + Next.js 14
- 交易 API：Longbridge SDK + Moomoo API
- 包管理：pnpm | 测试：Jest + ts-jest | 部署：Docker

## 目录结构
```
api/src/routes/       → API 路由层
api/src/services/     → 业务逻辑层（核心）
api/src/utils/        → 工具模块
api/src/config/       → 配置层
api/src/middleware/    → 中间件
api/migrations/       → 数据库迁移脚本
frontend/app/         → Next.js 页面
frontend/components/  → React 组件
docs/                 → 项目文档
.claude/agents/       → Claude Code agent 定义
```

## 核心服务
- `strategy-scheduler.service.ts` → 策略调度引擎
- `capital-manager.service.ts` → 资金管理
- `basic-execution.service.ts` → 订单执行
- `trading-recommendation.service.ts` → 推荐算法
- `market-data.service.ts` → 市场数据
- `log.service.ts` → 异步日志队列（级别门控 + 节流）

## 编码标准
- TypeScript 严格类型，禁用 `any`
- 命名：文件 kebab-case / 类 PascalCase / 函数变量 camelCase / 常量 UPPER_SNAKE_CASE
- 错误处理统一使用 `AppError`（定义在 `utils/error-handler.ts`）
- 日志使用 `LogService`（级别门控 + 节流 + 聚合模式）
- 数据库多步操作必须使用事务，查询必须参数化
- 分层架构：routes → services → utils → config，禁止循环依赖

## 交易系统规则（资金安全最高优先级）
- 下单前必须验证资金充足
- 订单状态必须同步到数据库
- 资金操作必须原子化（事务）
- 策略执行必须记录信号日志和执行摘要
- 敏感信息（API Key / Token）必须使用环境变量，禁止硬编码

## 文档规范
- 中文命名：`YYMMDD-功能名称.md`
- 单一文档原则：一个功能一份文档，优先更新现有文档
- 导航文件：`CHANGELOG.md` / `PROJECT_STATUS.md` / `README.md` / `CODE_MAP.md`
- 文档目录：`docs/features/` `docs/fixes/` `docs/analysis/` `docs/guides/` `docs/technical/` `docs/test/` `docs/review/` `docs/integration/` `docs/archive/`

## 核心原则
- **先确认，再执行** — 不明确的需求必须先澄清
- **最小变更** — 只做必要改动，不过度工程
- **资金安全第一** — 涉及资金/订单的变更必须格外谨慎

## 会话管理协议

- **启动**：`PROJECT_STATUS.md` → `git log --oneline -15` → `claude-progress.json`（如存在）
- **长任务**（>3 文件变更）：拆子任务写入 `claude-progress.json`，逐个完成并 commit
- **检查点**：代码变更 → `pnpm run build` → 测试 → commit
- **压缩恢复**：`mcp__rm__get_active_team` → `claude-progress.json` → `git log --oneline -10`

---

## 强制规则（违反即终止任务）

以下规则无条件生效，不论上下文是否提及：

1. **commit 前必须 build**（规则 #2）— 任何代码变更 commit 前，必须在 `api/` 和 `frontend/` 分别执行 `pnpm run build`，build 失败则修复后再提交，绝不跳过。
2. **连续 2 次修复失败必须停下**（规则 #6）— 同一问题修 2 次仍失败 → 立即停止，将 blocker 写入 `claude-progress.json`，请求用户指导。禁止第 3 次盲试。
3. **安全防护只能替换不能移除**（规则 #7）— 涉及资金检查/风控/仓位限制的代码：先建新防护 → 验证通过 → 再拆旧。禁止注释或删除安全代码。
4. **变更后更新文档 + push**（规则 #8）— 代码变更完成后必须更新 `CHANGELOG.md` + `PROJECT_STATUS.md`，然后 `git push`。
5. **会话工作文档实时持久化**（规则 #9）— 非简单问答（规划/方案/分析/重构）必须保存到 `docs/` 对应子目录，命名 `YYMMDD-功能名.md`。

---

## 关键规则速查（详情见 `docs/guides/260307-错误规则集.md`）

| # | 规则 | 要点 |
|---|------|------|
| 1 | cookies 认证用 Node.js fetch | 禁 WebFetch/Python/curl |
| 2 | **commit 前必须 `pnpm run build`** | build 不过不准提交 |
| 3 | JSONB 数字用 `Number()` + `isNaN` | 禁 parseInt/parseFloat |
| 4 | 状态机转换幂等防重复 | 先查状态再转换 |
| 5 | JSONB 更新用 `\|\|` 合并 | 禁全量覆盖 |
| 6 | **连续 2 次修复失败必须停下** | 记 blocker 请求指导 |
| 7 | **安全防护不能移除只能替换** | 先建新再拆旧 |
| 8 | 变更后更新文档 + push | CHANGELOG + PROJECT_STATUS |
| 9 | **会话工作文档实时持久化** | 非简单问答必须落盘 docs/ |
| 10 | 新表/改表同步更新 000_init_schema | 增量 migration + 000 双写 |
| 11 | 前端必须适配移动端 | Tailwind 响应式 + 375px 验证 |
| 12 | **HOLDING→IDLE 用 POSITION_EXIT_CLEANUP** | 禁 `...context` 泄露字段 |
| 13 | LongPort 文档用 `.md` 后缀 | 入口 `open.longbridge.com/llms.txt` |
| 14 | **0DTE 非首笔冷却 >= 1 分钟** | 首笔 0 / 2-4笔 1min / 5+ 3min |
| 15 | **非交易时段日志降级** | 策略日志仅开盘时运行，非交易时段只保留关键日志 |
| 16 | **部署 NAS 标准步骤** | ssh -p 32000 + **export PATH** → cd /volume1/docker/trading-system → git pull → docker compose up -d --build |
| 17 | **日期/时间用 market-time.ts** | 禁 `getDay()`/`getFullYear()` 直接用于市场时间，必须走 `utils/market-time.ts` 统一模块 |
| 18 | **correlationMap 入场/退出统一** | `recordSymbolExit` 必须用缓存的 `crossState.correlationMap`，禁无参 `getCorrelationGroup(symbol)` |

> **规则自动注入**: UserPromptSubmit hook 自动通过 RAG 检索并注入相关规则。
> 手动查阅: `docs/guides/260307-错误规则集.md` | 策略保护: `docs/guides/260307-策略核心逻辑保护清单.md`
> **新增规则**: 见错误规则集末尾"新增规则 SOP"，需同步更新 4 处（本表 + 规则集 + hook RULE_MAP + agent 定义）

## 策略核心逻辑保护（详情见 `docs/guides/260307-策略核心逻辑保护清单.md`）

修改 `strategy-scheduler.service.ts` 前必须确认不破坏：
1. **POSITION_CONTEXT_RESET** — IDLE→HOLDING 重置 10 个持仓级字段（6 处使用点）
2. **POSITION_EXIT_CLEANUP** — HOLDING→IDLE 清除 11 个字段 + trade counters（8 条退出路径）
3. **冷却期机制** — 两处冷却逻辑必须同步（非期权 / 期权）
4. **R5v2 竞价** — Phase A→D 跨标的保护，退出时清除 crossSymbolState
5. **日内熔断** — 每条退出路径必须更新 dailyRealizedPnL
