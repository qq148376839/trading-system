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

---

## 错误规则集

> 每条规则来自一次真实犯错，目的是避免重蹈覆辙。

### 规则 1：调用需要 cookies 认证的 HTTP 接口，必须使用 Bash + Node.js fetch

**背景**：WebFetch 工具不支持自定义 cookies/headers；Python urllib 会被 Cloudflare 拦截 (403)；curl 在 shell 中处理长 cookie 字符串容易因特殊字符导致参数解析失败。

**正确做法**：使用 `node -e` 执行 Node.js 内置 `fetch`，将 cookies 放在 JS 字符串变量中，同时携带完整的浏览器 headers（User-Agent、sec-ch-ua 等）。

**模板**：
```bash
node -e "
const cookies = '用户提供的完整cookie字符串';
fetch('目标URL', {
  headers: {
    'accept': 'application/json, text/plain, */*',
    'cookie': cookies,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'Referer': '来源页面URL'
  },
  method: 'GET'
}).then(r => { console.log('Status:', r.status); return r.text(); })
  .then(t => console.log(t))
  .catch(e => console.error('Error:', e));
"
```

**禁止**：
- 不要用 WebFetch 工具（无法传 cookies）
- 不要用 Python urllib/requests（Cloudflare 会 403）
- 不要用 curl 直接拼长 cookie（shell 特殊字符会导致参数解析失败）

### 规则 2：任务完成前必须 `pnpm run build` 通过

**背景**：多次出现"改完就交"但实际编译报错的情况，用户发现时上下文已丢失，修复成本翻倍。

**正确做法**：每次代码变更后，在 commit 之前运行 `pnpm run build`（在 `api/` 目录下）。build 失败则修复后再提交。

**禁止**：
- 不要在 build 未通过的情况下告知用户"已完成"
- 不要跳过 build 步骤"节省时间"

### 规则 3：JSONB 数字字段必须 `Number()` + `isNaN` 守卫

**背景**：从 PostgreSQL JSONB 读出的数字字段可能是字符串，直接参与运算会产生 `NaN`，导致交易金额计算错误（P0 资金安全事故）。

**正确做法**：
```typescript
const value = Number(jsonbField);
if (isNaN(value)) {
  throw new AppError('INVALID_DATA', `字段 xxx 不是有效数字: ${jsonbField}`);
}
```

**禁止**：
- 不要直接用 JSONB 字段做数学运算
- 不要用 `parseInt` / `parseFloat`（会静默忽略后缀垃圾字符）

### 规则 4：状态机转换必须幂等、防重复处理

**背景**：订单状态回调可能重复到达，如果不检查当前状态就直接转换，会导致重复扣款或重复开仓。

**正确做法**：
```typescript
// 先查当前状态
const current = await getOrderStatus(orderId);
// 只在预期的前置状态下才转换
if (current === 'pending' && newStatus === 'filled') {
  await updateOrderStatus(orderId, newStatus);
}
// 其他情况记录日志但不执行
```

**禁止**：
- 不要无条件更新状态
- 不要假设回调只会到达一次

### 规则 5：JSONB 更新用 `||` 合并，禁止全量覆盖

**背景**：用 `SET config = $1` 全量覆盖 JSONB 字段，导致其他服务写入的字段被丢弃（如策略参数被回测参数覆盖）。

**正确做法**：
```sql
UPDATE strategies SET config = config || $1::jsonb WHERE id = $2
```

**禁止**：
- 不要 `SET config = $1` 全量替换
- 不要在应用层 read-modify-write（有并发竞态风险）

### 规则 6：连续 2 次修复失败后必须停下

**背景**：Agent 陷入"改→报错→改→报错"死循环，消耗大量上下文且越改越偏。

**正确做法**：
1. 第一次修复失败 — 正常，换思路再试
2. 第二次修复失败 — **立即停下**
3. 记录 blocker 到 `claude-progress.json` 的 `blockers` 数组
4. 向用户说明问题并请求指导

**禁止**：
- 不要连续尝试 3 次以上相同类型的修复
- 不要在不理解根因的情况下反复改代码

### 规则 7：交易安全防护不能移除，只能替换

**背景**：重构时删除了资金检查代码，导致未验证余额就下单（P0 事故）。

**正确做法**：
- 重构安全相关代码时，先写新的防护逻辑，验证通过后再移除旧代码
- 安全防护包括：资金余额检查、仓位限制、风控阈值、订单金额校验

**禁止**：
- 不要在重构中"暂时注释"安全检查
- 不要假设"后面会加回来"

### 规则 8：代码变更完成后必须更新文档并提交 GitHub

**背景**：多次出现代码已改但文档未同步的情况，导致下次会话基于过时信息做决策。也出现过变更只 commit 到本地但未 push，导致部署环境和本地不同步。

**正确做法**：
- 功能变更 → 更新 `CHANGELOG.md` + `PROJECT_STATUS.md`
- 架构变更 → 同时更新 `CODE_MAP.md`
- 使用 `project-summarizer` agent 或手动更新
- 所有变更完成后 `git push` 到 GitHub

**禁止**：
- 不要"先提交代码，文档后面补"
- 不要只更新一个导航文件而遗漏其他
- 不要只 commit 不 push（除非用户明确要求暂不推送）

### 规则 9：开发前必须保存规划文档到 docs 目录

**背景**：规划文档只存在于对话上下文中，会话结束或上下文压缩后丢失，后续无法追溯当初的设计意图和变更范围。

**正确做法**：
- 开发前将规划文档保存到 `docs/` 对应子目录（通常是 `docs/features/`）
- 命名规则：`YYMMDD-功能中文名称.md`（如 `260227-回测实盘信号对齐-真实温度与日K分时修正.md`）
- 文档内容包括：问题描述、涉及文件、修改方案、边界情况、验证方法

**禁止**：
- 不要直接开始写代码而跳过文档保存
- 不要把规划文档只留在对话中不落盘

### 规则 10：新增/修改表结构必须同步更新 `000_init_schema.sql`

**背景**：增量 migration（如 `014_xxx.sql`）只在已有数据库上执行，新环境部署时只跑 `000_init_schema.sql`，如果 000 没有包含新表，新环境会缺表。

**正确做法**：
- 每次新增表或修改表结构的 migration，必须同步将变更合并到 `api/migrations/000_init_schema.sql`
- 000 中的建表语句使用 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`，确保可安全重复运行
- 新增列用 `DO $$ ... IF NOT EXISTS ... ALTER TABLE ... $$` 包裹，兼容已有数据库
- 增量 migration 文件保留不删除（已有环境靠它升级）

**禁止**：
- 不要只写增量 migration 而忘记更新 000
- 不要在 000 中使用不可重复执行的语句（如裸 `ALTER TABLE ADD COLUMN`）

### 规则 11：前端页面开发必须同步适配移动端

**背景**：系统需要在手机端查看交易状态和策略数据，但多次开发只考虑桌面端布局，上线后移动端排版错乱、表格溢出、操作按钮无法点击。

**正确做法**：
- 所有新增/修改的页面组件必须同时适配桌面端和移动端
- 使用响应式布局：优先 Tailwind 响应式前缀（`sm:` / `md:` / `lg:`）或 CSS media query
- 表格类组件在移动端使用卡片布局或横向滚动容器
- 交互元素（按钮、输入框）确保移动端可点击区域 ≥ 44px
- 开发完成后在浏览器 DevTools 中用 375px 宽度验证

**禁止**：
- 不要只写桌面端样式而跳过移动端适配
- 不要用固定宽度（`width: 800px`）替代响应式布局
- 不要假设"用户只会用电脑看"
