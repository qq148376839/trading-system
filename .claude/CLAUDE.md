# Claude Code 错误规则集

> 每条规则来自一次真实犯错，目的是避免重蹈覆辙。

---

## 规则 1：调用需要 cookies 认证的 HTTP 接口，必须使用 Bash + Node.js fetch

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

---

## 规则 2：任务完成前必须 `pnpm run build` 通过

**背景**：多次出现"改完就交"但实际编译报错的情况，用户发现时上下文已丢失，修复成本翻倍。

**正确做法**：每次代码变更后，在 commit 之前运行 `pnpm run build`（在 `api/` 目录下）。build 失败则修复后再提交。

**禁止**：
- 不要在 build 未通过的情况下告知用户"已完成"
- 不要跳过 build 步骤"节省时间"

---

## 规则 3：JSONB 数字字段必须 `Number()` + `isNaN` 守卫

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

---

## 规则 4：状态机转换必须幂等、防重复处理

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

---

## 规则 5：JSONB 更新用 `||` 合并，禁止全量覆盖

**背景**：用 `SET config = $1` 全量覆盖 JSONB 字段，导致其他服务写入的字段被丢弃（如策略参数被回测参数覆盖）。

**正确做法**：
```sql
UPDATE strategies SET config = config || $1::jsonb WHERE id = $2
```

**禁止**：
- 不要 `SET config = $1` 全量替换
- 不要在应用层 read-modify-write（有并发竞态风险）

---

## 规则 6：连续 2 次修复失败后必须停下

**背景**：Agent 陷入"改→报错→改→报错"死循环，消耗大量上下文且越改越偏。

**正确做法**：
1. 第一次修复失败 — 正常，换思路再试
2. 第二次修复失败 — **立即停下**
3. 记录 blocker 到 `claude-progress.json` 的 `blockers` 数组
4. 向用户说明问题并请求指导

**禁止**：
- 不要连续尝试 3 次以上相同类型的修复
- 不要在不理解根因的情况下反复改代码

---

## 规则 7：交易安全防护不能移除，只能替换

**背景**：重构时删除了资金检查代码，导致未验证余额就下单（P0 事故）。

**正确做法**：
- 重构安全相关代码时，先写新的防护逻辑，验证通过后再移除旧代码
- 安全防护包括：资金余额检查、仓位限制、风控阈值、订单金额校验

**禁止**：
- 不要在重构中"暂时注释"安全检查
- 不要假设"后面会加回来"

---

## 规则 8：代码变更完成后必须更新文档并提交 GitHub

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

---

## 规则 9：开发前必须保存规划文档到 docs 目录

**背景**：规划文档只存在于对话上下文中，会话结束或上下文压缩后丢失，后续无法追溯当初的设计意图和变更范围。

**正确做法**：
- 开发前将规划文档保存到 `docs/` 对应子目录（通常是 `docs/features/`）
- 命名规则：`YYMMDD-功能中文名称.md`（如 `260227-回测实盘信号对齐-真实温度与日K分时修正.md`）
- 文档内容包括：问题描述、涉及文件、修改方案、边界情况、验证方法

**禁止**：
- 不要直接开始写代码而跳过文档保存
- 不要把规划文档只留在对话中不落盘

---

## 规则 10：新增/修改表结构必须同步更新 `000_init_schema.sql`

**背景**：增量 migration（如 `014_xxx.sql`）只在已有数据库上执行，新环境部署时只跑 `000_init_schema.sql`，如果 000 没有包含新表，新环境会缺表。

**正确做法**：
- 每次新增表或修改表结构的 migration，必须同步将变更合并到 `api/migrations/000_init_schema.sql`
- 000 中的建表语句使用 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`，确保可安全重复运行
- 新增列用 `DO $$ ... IF NOT EXISTS ... ALTER TABLE ... $$` 包裹，兼容已有数据库
- 增量 migration 文件保留不删除（已有环境靠它升级）

**禁止**：
- 不要只写增量 migration 而忘记更新 000
- 不要在 000 中使用不可重复执行的语句（如裸 `ALTER TABLE ADD COLUMN`）
