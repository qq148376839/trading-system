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

## Role Memory MCP (`rm`)
- teammate-mode 下，上下文压缩后自动调用 `get_active_team` 恢复团队身份
- 手动恢复：`/mcp__rm__who` | 切换团队：`/mcp__rm__switch team=<name>`
- 团队配置目录：`.claude/teams/*.md`

## 会话管理协议

### 会话启动协议
每次新会话开始时，按以下顺序建立上下文：
1. 读取 `PROJECT_STATUS.md` — 了解项目当前状态
2. 运行 `git log --oneline -15` — 了解最近的变更历史
3. 读取 `claude-progress.json`（如存在）— 恢复未完成的任务进度
4. 再开始处理用户的需求

### 长任务协议
当需求涉及 **3 个以上文件变更** 时，必须：
1. 先将任务拆解为子任务，写入 `claude-progress.json`（JSON 格式）
2. 逐个完成子任务，每完成一个：commit 代码 + 更新 `claude-progress.json`
3. 全部子任务完成后，清理进度文件

`claude-progress.json` 格式：
```json
{
  "task": "任务名称",
  "startedAt": "ISO 时间戳",
  "subtasks": [
    { "id": 1, "description": "子任务描述", "status": "done|in_progress|pending", "files": ["涉及文件"] }
  ],
  "currentSubtask": 1,
  "blockers": []
}
```

### 检查点协议
每次代码变更后，执行验证链：
1. `pnpm run build` — 确保编译通过
2. 运行相关测试（如有）
3. commit 代码（Conventional Commits 格式）
4. 更新 `claude-progress.json` 进度

### 上下文压缩恢复协议
当检测到上下文被压缩（丢失之前的对话内容）时：
1. **恢复团队身份**（teammate-mode）— 调用 `mcp__rm__get_active_team` 恢复角色和工作流
2. 读取 `claude-progress.json` — 恢复任务状态
3. 运行 `git log --oneline -10` — 了解最近提交
4. 基于进度文件中的 `currentSubtask` 继续工作
