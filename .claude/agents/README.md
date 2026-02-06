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
  ├─ 需要安全检查？ → security-auditor（安全审计）
  │
  └─ 完成变更 → project-summarizer（文档整理）⚠️ 强制
```

### 完整功能开发流程

```
product-manager → architect → developer → tester → reviewer → project-summarizer
   需求定义      架构设计      编码实现     测试编写    代码审查      文档整理
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

## 核心原则

1. **先确认，再执行** — 不明确的需求必须先澄清
2. **最小变更** — 只做必要的改动
3. **资金安全第一** — 涉及资金/订单的变更格外谨慎
4. **文档同步** — 代码变更后必须更新文档（project-summarizer）
