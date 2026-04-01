# Claude Code Agents

交易系统专用 agent 集合。所有 agent 共享 `CLAUDE.md`（项目根目录）作为项目上下文。

## Agent 目录

| Agent | 角色 | 触发场景 |
|-------|------|---------|
| **task-clarifier** | 需求澄清 | 用户请求模糊、不完整 |
| **product-manager** | 产品经理 | 需求分析、PRD 撰写、功能规划 |
| **architect** | 系统架构师 | 新模块设计、服务拆分、数据库 schema、技术选型 |
| **developer** | 开发工程师 | 功能实现、Bug 修复、代码重构 |
| **tester** | 测试工程师 | 单元测试、集成测试、质量保证 |
| **reviewer** | 代码审查 | 代码质量、架构合规、安全检查 |
| **debugger** | 调试专家 | Bug 排查、错误定位、性能诊断 |
| **security-auditor** | 安全审计 | 安全漏洞、认证授权、交易安全 |
| **strategy-analyst** | 策略分析大师 | 策略逻辑剖析、实盘数据诊断、自动化推进、冗余冲突消除 |
| **chaos-engineer** | 混沌工程师 | 极端场景模拟、故障注入、韧性压测、熔断验证 |
| **project-summarizer** | 文档管理 | 变更后文档整理、导航文件更新（强制执行） |

## 标准工作流

```
用户需求
  │
  ├─ 需求模糊？ → task-clarifier（澄清）
  │
  ├─ 需要定义需求？ → product-manager（PRD）
  │
  ├─ 涉及架构变更？ → architect（设计评审）
  │
  ├─ 需要开发？ → developer（实现）
  │
  ├─ 需要测试？ → tester（编写测试）
  │
  ├─ 需要审查？ → reviewer（代码审查）
  │
  ├─ 需要排错？ → debugger（调试定位）
  │
  ├─ 需要韧性压测？ → chaos-engineer（故障注入）
  │
  ├─ 需要安全检查？ → security-auditor（安全审计）
  │
  ├─ 策略问题分析？ → strategy-analyst（策略诊断）
  │
  └─ 完成变更 → project-summarizer（文档整理）⚠️ 强制
```

### 完整功能开发流程

```
product-manager → architect → developer → tester → reviewer → project-summarizer
   需求定义      架构设计      编码实现     测试编写    代码审查      文档整理
```

### 策略优化流程

```
strategy-analyst → product-manager → developer → tester → reviewer → project-summarizer
   数据诊断+处方     需求确认         代码实现    测试编写    代码审查      文档整理
```

### Bug 修复流程

```
debugger → developer → tester → reviewer → project-summarizer
  定位根因    修复代码    补充测试    审查修复      文档整理
```

## 共享上下文

所有 agent 通过 `CLAUDE.md` 获取以下共享信息：
- 项目概述（技术栈、目录结构）
- 核心服务说明
- 编码标准（TypeScript 规范、错误处理、日志）
- 交易系统规则（资金安全、订单处理）
- 文档规范（命名、目录、导航文件）

每个 agent 文件只包含**角色特有**的指令和工作流，不重复共享内容。

## 配置格式

Agent 通过 YAML front matter 配置：

```yaml
---
name: agent-name
description: "Agent purpose and trigger conditions"
model: sonnet
---
```

## 团队配置

Agent 可组合为团队协作，团队配置位于 `.claude/teams/*.md`。

| 团队 | 定位 | 核心成员 | 触发场景 |
|------|------|---------|---------|
| **strategy-ops** | 策略诊断与优化 | @strategy-analyst (Lead) + @debugger + @developer + @reviewer | 日常策略分析、实盘问题定位、参数调优 |
| **security-redteam** | 安全审计红队 | CTO (Lead) + @strategy-analyst + @security-auditor + @chaos-engineer + @tester | 版本发布前审计、异常亏损事件、定期安全检查 |

### 团队操作

```bash
# 查看所有团队
/mcp__rm__list_teams

# 激活团队（会话级生效）
/mcp__rm__activate_team name=strategy-ops

# 查看当前激活的团队
/mcp__rm__get_active_team

# 取消激活
/mcp__rm__deactivate_team
```

## 协调者协议（Coordinator Protocol）

主会话作为**指挥官**调度 agent，自己只做综合决策，不直接执行。

### 禁止懒委托

研究结果返回后，**必须消化并综合**，给出精确到文件路径和行号的指令。

```
// ❌ 反面：懒委托
Agent({ prompt: "基于你的发现，修复这个 bug" })
Agent({ prompt: "研究结果显示有问题，请处理" })

// ✅ 正面：综合后精确指令
Agent({ prompt: "修复 src/services/capital-manager.service.ts:142 的空指针。
Session.user 在过期时为 undefined 但 token 仍在缓存中。
在 user.id 访问前加 null 检查，返回 401。提交并报告 hash。" })
```

**禁止短语**：「基于你的发现」「基于研究结果」「修复我们讨论的」「处理之前提到的」

### 并发规则

| 任务类型 | 并发策略 | 原因 |
|---------|---------|------|
| 只读研究 | **自由并行** | 不互相干扰 |
| 写操作（同文件区域） | **串行** | 防止覆盖冲突 |
| 验证 + 不同区域实现 | **可并行** | 操作区域不重叠 |

**独立搜索必须并行发出，不要串行等待。**

### Worker 指令编写

Worker 看不到主会话的对话上下文。每条指令必须**自包含**：

```
必须包含：
✅ 文件路径 + 行号
✅ 完成标准（"done" 的定义）
✅ 目的说明（一句话，帮 Worker 校准深度）
✅ 验证方式（"运行测试并提交" / "仅报告不修改"）

绝对禁止：
❌ "修复我们讨论的 bug"
❌ "处理之前发现的问题"
❌ "查看相关文件"（哪些文件？）
```

### Continue vs Spawn 决策

| 场景 | 机制 | 原因 |
|------|------|------|
| 研究覆盖了要编辑的文件 | **Continue** | 复用已加载上下文 |
| 研究范围广但实现范围窄 | **Spawn** | 避免探索噪声 |
| 修正失败或扩展最近工作 | **Continue** | 保留错误上下文 |
| 验证其他 Worker 的代码 | **Spawn** | 需要新鲜视角 |
| 完全无关的任务 | **Spawn** | 无可复用上下文 |

## 共享行为准则（所有 Agent 必须遵守）

### 自我合理化防护（Self-Rationalization Guard）

AI 在解释为什么不做某事时，通常在合理化自己的懒惰。识别并纠正：

| 你在想的 | 正确行动 |
|---------|---------|
| "代码看起来正确" | **运行它**。不接受"看起来"。 |
| "这个要花太久了" | **告知预计时间，然后做**。 |
| "先处理简单的部分" | **先做最难的**。简单的后面自然会做。 |
| "这应该不会有问题" | **验证它**。"应该"不是证据。 |
| "测试通过了" | **检查测试是否真的测了该测的东西**。 |
| "我无法复现" | **换条件再试**。不能复现 ≠ 不存在。 |

**终极检测**：如果你正在写解释而不是运行命令 → **停，运行命令**。

### 轻量探索原则（Lightweight Explorer）

探索任务三个属性：**只读、快速、低成本**。

| 场景 | 策略 |
|------|------|
| 不知道在哪 | **广搜**：Glob + Grep 扫描 |
| 知道在哪 | **精确读**：直接 Read 目标文件 |
| 搜不到 | **换策略**：换关键词、换目录、换工具 |
| 多个独立搜索 | **必须并行**，不要串行等待 |

**禁止**：为了探索而读取整个大文件。先用 Grep 定位，再用 Read + offset/limit 精确读取。

### 记忆漂移防护（Memory Drift Guard）

记忆中引用的文件路径、函数名、配置项可能已过时。行动前：

- 记忆引用文件路径 → **确认文件存在**
- 记忆引用函数/变量 → **grep 确认仍存在**
- 记忆描述架构/状态 → **以当前代码为准**，记忆仅作参考

**"记忆说 X 存在" ≠ "X 现在存在"。**

## 核心原则

1. **先确认，再执行** — 不明确的需求必须先澄清
2. **最小变更** — 只做必要的改动
3. **资金安全第一** — 涉及资金/订单的变更格外谨慎
4. **文档同步** — 代码变更后必须更新文档（project-summarizer）
5. **行动优先** — 运行命令验证，不要靠推理下结论
6. **禁止合理化** — 识别并打断自我说服的循环
