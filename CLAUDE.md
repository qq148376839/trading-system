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

### 规则 12：所有 HOLDING→IDLE 退出路径必须统一清除持仓级字段

**背景**：`strategy-scheduler.service.ts` 有 **7+ 条** HOLDING→IDLE 退出路径（正常卖出、TSLPPCT成交、券商无持仓、期权过期、Iron Dome、超时等）。其中多条路径使用 `...context` 扩展 context，导致 `peakPnLPercent`、`peakPrice`、`emergencyStopLoss` 等持仓级字段泄露到 IDLE context，被下一笔交易继承。2月27日 TSLA 后3笔交易因继承了第1笔的 `peakPnLPercent=16.7%` 而被移动止损秒杀（P0 事故）。

**正确做法**：
```typescript
// 所有 HOLDING→IDLE 转换必须使用 POSITION_EXIT_CLEANUP 常量
await strategyInstance.updateState(symbol, 'IDLE', {
  ...POSITION_EXIT_CLEANUP,   // ← 必须在第一位，清除所有持仓级字段
  lastExitTime: new Date().toISOString(),
  dailyTradeCount: prevTradeCount + 1,
  consecutiveLosses: newConsecLosses,
  dailyRealizedPnL: newDailyPnL,
  exitReason: '...',
});
```

**检查清单**（新增/修改退出路径时逐条核对）：
1. ✅ 使用 `...POSITION_EXIT_CLEANUP` 替代 `...context`
2. ✅ 设置 `lastExitTime`（冷却期依赖此字段）
3. ✅ 递增 `dailyTradeCount`（冷却时间与交易次数挂钩）
4. ✅ 更新 `consecutiveLosses`（连亏冷却依赖此字段）
5. ✅ 更新 `dailyRealizedPnL`（日内熔断依赖此字段）
6. ✅ 清除 `crossSymbolState.activeEntries`（R5v2 跨标的保护）

**禁止**：
- 不要在 HOLDING→IDLE 转换中使用 `...context`（会泄露持仓级字段）
- 不要遗漏任何一个退出路径的 trade counter 递增
- 不要假设"这条路径不常走"而省略清理逻辑

### 规则 13：0DTE 冷却时间必须 ≥ 1 分钟（首笔除外）

**背景**：0DTE 冷却规则中，当 `consecutiveLosses=0 && dailyTradeCount<=1` 时冷却为 0 分钟，允许退出后秒级重入。当叠加 peakPnLPercent 泄露 bug 时，形成"秒入→秒杀→秒入"的致命循环。即使 peakPnLPercent 已修复，0 秒冷却仍然是不安全的（期权价格波动大，需要至少 1 分钟让市场稳定）。

**正确做法**：
```typescript
// 0DTE 无连亏时的冷却规则
if (dailyTradeCount === 0) cooldownMinutes = 0;     // 当日首笔：无冷却
else if (dailyTradeCount <= 3) cooldownMinutes = 1;  // 第2-4笔：至少1分钟
else cooldownMinutes = 3;                             // 第5笔起：3分钟
```

**禁止**：
- 不要将非首笔交易的冷却设为 0
- 不要仅依赖 `consecutiveLosses` 来决定冷却（盈利退出后 consecLosses=0 但仍需冷却）

---

## 策略核心逻辑保护清单

> 修改 `strategy-scheduler.service.ts` 时必须确认不会破坏以下核心机制。

### 1. POSITION_CONTEXT_RESET — 跨交易隔离屏障

**作用**：在每次 IDLE→HOLDING 转换时重置 10 个持仓级字段，防止上一笔交易的 peak/stop/protection 数据污染新交易。

**关键使用点**（6处，缺一不可）：
- Line ~1062: 买入成交后
- Line ~2241: 执行买入后
- Line ~2719: Phase D 执行后
- Line ~3055: 恢复持仓路径
- Line ~4612: HOLDING context 初始化
- Line ~4675: 同步更新

**危险操作**：任何重构如果移除或跳过了某个使用点，都会导致跨交易字段泄露。

### 2. POSITION_EXIT_CLEANUP — 退出清理屏障

**作用**：在每次 HOLDING→IDLE 转换时清除 11 个持仓级字段 + 更新 trade counters。

**必须覆盖的退出路径**（7条）：
1. 正常卖出成交回调（line ~1257）
2. TSLPPCT 保护单状态检查成交（line ~3671）
3. TSLPPCT 软件退出时发现成交（line ~4059）
4. 期权过期+无价格+券商无持仓（line ~3391）
5. 期权过期+券商无持仓（line ~3883）
6. 券商无持仓 — 退出时检查（line ~4007）
7. 券商无持仓 — 定期核对（line ~4167）
8. Iron Dome BROKER_TERMINATED（line ~5070）

**危险操作**：新增退出路径时如果忘记使用 POSITION_EXIT_CLEANUP，会导致字段泄露。

### 3. 冷却期机制 — 防止快速重入

**作用**：退出后基于 `dailyTradeCount` 和 `consecutiveLosses` 计算冷却时间，阻止同标的快速重入。

**代码位置**：两处（非期权 line ~1931，期权 line ~2395），逻辑必须同步。

**依赖链**：`lastExitTime` → 冷却判断 → `dailyTradeCount` / `consecutiveLosses` → 冷却时长。任何一环缺失都会导致冷却失效。

### 4. R5v2 竞价机制 — 跨标的保护

**作用**：Phase A→B→C→D 四阶段竞价，确保同组/跨组只选最强信号执行，防止集中暴露。

**关键状态**：`crossSymbolState` (activeEntries + lastFloorExitByGroup)，退出时必须 `delete(symbol)`。

**危险操作**：修改 Phase C/D 逻辑时如果破坏了组内/跨组淘汰规则，会导致同时持有多个同组标的。

### 5. 日内熔断 — 亏损安全阀

**作用**：策略级日内聚合 PnL 超过阈值时触发全标的熔断，当日不再交易。

**依赖链**：每条退出路径正确更新 `dailyRealizedPnL` → 卖出回调聚合查询 → 阈值判断 → `circuitBreakerActive=true`。

**危险操作**：如果某条退出路径不更新 `dailyRealizedPnL`，熔断阈值计算会低估实际亏损。
