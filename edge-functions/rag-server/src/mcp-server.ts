import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchVectorize } from './api/query-handler';
import type { Env, ChunkType, SearchResult } from './lib/types';

/**
 * RAG MCP Server — 3 个语义搜索工具
 * 部署为 Cloudflare Durable Object，通过 /mcp 路径暴露
 */
export class RagMCP extends McpAgent<Env> {
  server = new McpServer({
    name: 'rag',
    version: '1.0.0',
  });

  async init() {
    // ─── Tool 1: search — 全库语义搜索 ───
    this.server.tool(
      'search',
      'Semantic search across the entire codebase and documentation. Use for finding relevant code, docs, configs by meaning.',
      {
        query: z.string().describe('Search query (natural language, supports Chinese and English)'),
        scope: z.enum(['all', 'docs', 'code', 'sql', 'config', 'nav']).default('all')
          .describe('Scope: all=everything, docs=markdown, code=typescript, sql=migrations, config=config files, nav=CLAUDE.md/CHANGELOG etc'),
        top_k: z.number().min(1).max(30).default(8)
          .describe('Number of results to return (default 8)'),
      },
      async ({ query, scope, top_k }) => {
        const results = await searchVectorize(this.env, query, top_k, scope as ChunkType | 'all');
        return {
          content: [{ type: 'text', text: formatResults(results, query) }],
        };
      },
    );

    // ─── Tool 2: search_errors — 搜索错误规则和安全模式 ───
    this.server.tool(
      'search_errors',
      'Search error rules, safety patterns, and common pitfalls in the codebase. Use this to check if there are known rules or past mistakes related to what you are about to do.',
      {
        query: z.string().describe('Describe what you are about to do or the error pattern to search for'),
        top_k: z.number().min(1).max(20).default(5)
          .describe('Number of results (default 5)'),
      },
      async ({ query, top_k }) => {
        // 搜索 nav 和 docs scope 中的错误规则
        const prefixedQuery = `error rule safety pattern: ${query}`;
        const navResults = await searchVectorize(this.env, prefixedQuery, top_k, 'nav');
        const docResults = await searchVectorize(this.env, prefixedQuery, top_k, 'docs');

        // 合并去重，按 score 排序
        const seen = new Set<string>();
        const merged: SearchResult[] = [];
        for (const r of [...navResults, ...docResults]) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            merged.push(r);
          }
        }
        merged.sort((a, b) => b.score - a.score);
        const topResults = merged.slice(0, top_k);

        return {
          content: [{ type: 'text', text: formatResults(topResults, query) }],
        };
      },
    );

    // ─── Tool 3: lookup_file — 按文件路径检索 ───
    this.server.tool(
      'lookup_file',
      'Retrieve all indexed chunks for a specific file path. Use when you know the exact file you want to read.',
      {
        file_path: z.string().describe('Relative file path (e.g. "api/src/services/capital-manager.service.ts")'),
      },
      async ({ file_path }) => {
        // 从 KV 按前缀列出该文件的所有 chunks
        const listed = await this.env.CHUNKS_KV.list({ prefix: file_path + '::' });

        if (listed.keys.length === 0) {
          return {
            content: [{ type: 'text', text: `No indexed chunks found for: ${file_path}` }],
          };
        }

        // 获取所有 chunk 内容
        const chunks = await Promise.all(
          listed.keys.map(async (key) => {
            const content = await this.env.CHUNKS_KV.get(key.name);
            return { id: key.name, content: content || '[empty]' };
          }),
        );

        const text = chunks
          .map((c) => `--- ${c.id} ---\n${c.content}`)
          .join('\n\n');

        return {
          content: [{ type: 'text', text: `File: ${file_path} (${chunks.length} chunks)\n\n${text}` }],
        };
      },
    );
  }
}

/** 格式化搜索结果为可读文本 */
function formatResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No results found for: "${query}"`;
  }

  const lines = results.map((r, i) => {
    const meta = r.metadata;
    const header = [
      `[${i + 1}] ${meta.file_path}`,
      meta.symbol_name ? `symbol: ${meta.symbol_name}` : '',
      meta.section_title ? `section: ${meta.section_title}` : '',
      `score: ${r.score.toFixed(3)}`,
    ].filter(Boolean).join(' | ');

    // 截断过长内容
    const content = r.content.length > 1500
      ? r.content.slice(0, 1500) + '\n... [truncated]'
      : r.content;

    return `${header}\n${content}`;
  });

  return `Found ${results.length} results for: "${query}"\n\n${lines.join('\n\n---\n\n')}`;
}
