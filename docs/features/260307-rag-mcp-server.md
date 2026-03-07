# RAG MCP Server — Cloudflare Workers + Vectorize

> 创建日期: 2026-03-07
> 状态: 已部署，自动同步

## 概述

基于 Cloudflare Workers 的 RAG（检索增强生成）系统，为 Claude Code 提供项目代码库和文档的语义搜索能力。push 到 main 分支时通过 GitHub Action 自动增量索引。

## 架构

```
Claude Code  ──(Streamable HTTP)──>  Cloudflare Worker (rag-server)
                                        ├── /mcp          → MCP Server (3 tools)
                                        ├── /api/index     → 接收 chunks + 嵌入 + 存储
                                        ├── /api/query     → REST 查询（测试用）
                                        ├── /api/status    → 索引状态
                                        └── /api/index DEL → 删除向量
                                              │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                         Vectorize        Workers AI         KV Store
                      (向量存储+检索)   (@cf/baai/bge-m3)   (chunk 原文)
                       1024 维, cosine    中英文多语言嵌入

git push main ──> GitHub Action (.github/workflows/rag-index.yml)
                    → 恢复 .index-manifest.json (actions/cache)
                    → pnpm index（增量索引变更文件）
                    → 缓存更新后的 manifest
```

## 目录结构

```
edge-functions/rag-server/
  wrangler.jsonc                  ← Worker 配置（Vectorize + AI + KV + DO 绑定）
  package.json                    ← 依赖: agents, @modelcontextprotocol/sdk, zod
  tsconfig.json
  worker-configuration.d.ts       ← Cloudflare 类型声明
  .npmrc                          ← 指向 npmjs 公共仓库（绕过内网 registry）
  src/
    index.ts                      ← Worker 入口：路由分发 + Bearer Token 鉴权
    mcp-server.ts                 ← MCP 3 个 tool（search, search_errors, lookup_file）
    api/
      index-handler.ts            ← POST /api/index — 嵌入+存储（含 try-catch 错误返回）
      query-handler.ts            ← POST /api/query — 语义搜索（共享逻辑供 MCP 调用）
      delete-handler.ts           ← DELETE /api/index — 按文件路径或 ID 删除
      status-handler.ts           ← GET /api/status — Vectorize + KV 状态统计
    lib/
      embeddings.ts               ← Workers AI 嵌入封装（批次 10 条，防 60K token 溢出）
      types.ts                    ← 共享类型 + toVectorId() 哈希函数
  scripts/
    index-project.ts              ← 本地索引主脚本（增量/全量/单文件）
    lib/
      file-scanner.ts             ← Git-aware 文件发现 + 敏感文件过滤
      manifest.ts                 ← .index-manifest.json 增量追踪（SHA-256 hash）
      api-client.ts               ← Worker REST API 客户端（25 chunks/批，3 次重试）
      chunkers/
        markdown-chunker.ts       ← .md 按 ## 标题分块，超长按 ### 子分
        typescript-chunker.ts     ← .ts 按函数/类边界分块，携带 import 上下文
        sql-chunker.ts            ← .sql 按 CREATE TABLE / ALTER TABLE 分块
.github/workflows/
  rag-index.yml                   ← GitHub Action: push main 时自动增量索引
```

## MCP 工具

| 工具 | 用途 | 参数 |
|------|------|------|
| `search` | 全库语义搜索 | `query`, `scope` (all/docs/code/sql/config/nav), `top_k` |
| `search_errors` | 搜索错误规则和安全模式，防重复犯错 | `query`, `top_k` |
| `lookup_file` | 按文件路径检索该文件的所有已索引 chunks | `file_path` |

Claude Code 通过 `.mcp.json` 配置自动连接 MCP Server，可根据上下文自行决定是否调用这些工具。也可以主动引导："用 RAG 搜一下..."

## 索引操作

### 自动（GitHub Action）

push 到 main 且变更了以下路径时自动触发：
- `docs/**`, `api/src/services/**`, `api/src/routes/**`, `api/src/utils/**`, `api/src/config/**`
- `api/src/middleware/**`, `api/migrations/**`
- `CLAUDE.md`, `PROJECT_STATUS.md`, `CHANGELOG.md`, `CODE_MAP.md`
- `.claude/agents/**`, `.claude/teams/**`

也可在 GitHub Actions 页面手动触发（workflow_dispatch）。

### 手动

```bash
cd edge-functions/rag-server

# 增量索引（只处理变更文件，依赖 .index-manifest.json）
pnpm index

# 全量重建（清空 manifest，重新索引所有文件）
pnpm index:full

# 索引单个文件
pnpm index:file api/src/services/capital-manager.service.ts
```

环境变量: `RAG_API_TOKEN`（已配置在根 `.env` + GitHub Secrets）

## Cloudflare 资源

| 资源 | 名称/ID |
|------|---------|
| Worker | `rag-server` |
| 自定义域 | `rag.riowang.win`（Cloudflare dashboard 手动添加） |
| Vectorize | `trading-system-rag` (1024维, cosine, metadata index: file_path + chunk_type) |
| KV | `CHUNKS_KV` (eff14ce9be754c02a92f6e9612c1995e) |
| Secret | `API_AUTH_TOKEN` |
| Durable Object | `RagMCP`（MCP Agent 状态） |

## 索引范围

| 文件模式 | Chunk Type | 说明 |
|----------|-----------|------|
| `docs/**/*.md` | docs | 项目文档 |
| `api/src/services/**/*.ts` | code | 业务逻辑 |
| `api/src/routes/**/*.ts` | code | API 路由 |
| `api/src/utils/**/*.ts` | code | 工具模块 |
| `api/src/config/**/*.ts` | config | 配置 |
| `api/src/middleware/**/*.ts` | code | 中间件 |
| `api/migrations/**/*.sql` | sql | 数据库迁移 |
| `CLAUDE.md` / `PROJECT_STATUS.md` / `CHANGELOG.md` / `CODE_MAP.md` | nav | 导航文件 |
| `.claude/agents/*.md` / `.claude/teams/*.md` | docs | Agent/Team 定义 |

**排除**: node_modules、dist、.env*、含凭据文件（moomoo-proxy/src/index.js 等）

当前规模: **60 文件, 603 chunks**

## 技术细节

### 嵌入模型

`@cf/baai/bge-m3` — 1024 维，中英文多语言，60K token 上下文。每批最多 10 条文本（防超 token 限制）。

### Vector ID 哈希

Vectorize 限制 vector ID 最大 64 bytes。文件路径如 `api/migrations/archive/011_add_signal_id_to_execution_orders.sql::2` 会超限。

解决方案：`toVectorId()` 函数用 FNV-1a 双哈希将文件路径压缩为 16 字符 hex + `:` + chunk index（如 `a1b2c3d4e5f6a7b8:2`），永远不超 64 bytes。

KV 仍使用完整 `file_path::index` 作为 key（无长度限制），Vectorize metadata 中的 `chunk_id` 字段存储原始 KV key 用于反向映射。

### 分块策略

- **Markdown**: 按 `##` 分块，保留 `#` 标题前缀；超 6000 字符按 `###` 子分；最终按段落硬分割
- **TypeScript**: 正则匹配函数签名 + 大括号配对找边界；每个 chunk 携带前 10 行 import 作为类型上下文；超 6000 字符按行分割
- **SQL**: 按 CREATE TABLE / ALTER TABLE / DO $$ 块分割，关联 CREATE INDEX 归同一 chunk
- **Metadata**: 每个 chunk 携带 `file_path`, `chunk_type`, `symbol_name`, `section_title`, `last_modified`

### 鉴权

所有端点（/mcp 和 /api/*）统一使用 Bearer Token 鉴权。Token 存储在：
- Cloudflare Worker Secret: `API_AUTH_TOKEN`
- 本地: 根目录 `.env` 中 `RAG_API_TOKEN`
- CI: GitHub Secrets 中 `RAG_API_TOKEN`

## 成本

603 chunks × 1024 维 ≈ 0.62M stored dimensions（免费额度 5M）— **完全免费**。

## 验证测试结果（2026-03-07）

| 测试场景 | 最高分 | 命中内容 |
|----------|--------|----------|
| 中文"冷却时间" | 0.635 | PROJECT_STATUS 0DTE 冷却机制 |
| 代码 "capital allocation" | 0.438 | option-intraday-strategy 资金预算 |
| 错误规则 "JSONB" | 0.503 | CLAUDE.md 规则速查表 |
| SQL "execution_orders signal_id" | 0.695 | 011 migration + 005 建表语句 |
| 策略保护 "POSITION_EXIT_CLEANUP" | 0.575 | CLAUDE.md 核心逻辑保护清单 |
