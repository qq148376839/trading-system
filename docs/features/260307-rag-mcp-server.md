# RAG MCP Server — Cloudflare Workers + Vectorize

> 创建日期: 2026-03-07
> 状态: 已部署

## 概述

基于 Cloudflare Workers 的 RAG（检索增强生成）系统，为 Claude Code 提供项目代码库和文档的语义搜索能力。

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
```

## 目录结构

```
edge-functions/rag-server/
  wrangler.jsonc                  ← Worker 配置
  package.json
  tsconfig.json
  src/
    index.ts                      ← Worker 入口：路由分发 + 鉴权
    mcp-server.ts                 ← MCP 3 个 tool（search, search_errors, lookup_file）
    api/
      index-handler.ts            ← POST /api/index 嵌入+存储
      query-handler.ts            ← POST /api/query 语义搜索
      delete-handler.ts           ← DELETE /api/index 删除
      status-handler.ts           ← GET /api/status 状态
    lib/
      embeddings.ts               ← Workers AI 嵌入封装
      types.ts                    ← 共享类型
  scripts/
    index-project.ts              ← 本地索引主脚本
    lib/
      file-scanner.ts             ← Git-aware 文件发现
      manifest.ts                 ← 增量索引追踪
      api-client.ts               ← Worker REST API 客户端
      chunkers/
        markdown-chunker.ts       ← .md 按标题分块
        typescript-chunker.ts     ← .ts 按函数边界分块
        sql-chunker.ts            ← .sql 按 CREATE TABLE 分块
```

## MCP 工具

| 工具 | 用途 |
|------|------|
| `search` | 全库语义搜索，支持 scope 过滤（all/docs/code/sql/config/nav） |
| `search_errors` | 搜索错误规则和安全模式，防重复犯错 |
| `lookup_file` | 按文件路径检索该文件的所有已索引 chunks |

## 索引操作

```bash
# 进入 rag-server 目录
cd edge-functions/rag-server

# 增量索引（只处理变更文件）
pnpm index

# 全量重建
pnpm index:full

# 索引单个文件
pnpm index:file api/src/services/capital-manager.service.ts
```

需要环境变量: `RAG_API_TOKEN`（已配置在根 `.env`）

## Cloudflare 资源

| 资源 | 名称/ID |
|------|---------|
| Worker | `rag-server` |
| 域名 | `rag.riowang.win` |
| Vectorize | `trading-system-rag` (1024维, cosine) |
| KV | `CHUNKS_KV` (eff14ce9be754c02a92f6e9612c1995e) |
| Secret | `API_AUTH_TOKEN` |

## 嵌入模型

`@cf/baai/bge-m3` — 1024 维，支持中英文混合内容，60K token 上下文窗口。

## 分块策略

- **Markdown**: 按 `##` 标题分块，超长节按 `###` 子分
- **TypeScript**: 按函数/类边界分块，携带 import 上下文
- **SQL**: 按 CREATE TABLE / ALTER TABLE 分块

## 成本

~1,700 chunks × 1024 维 ≈ 1.74M stored dimensions（免费额度 5M）— 完全免费。
