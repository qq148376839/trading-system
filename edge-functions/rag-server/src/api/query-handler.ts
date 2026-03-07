import { generateEmbedding } from '../lib/embeddings';
import type { Env, QueryRequest, SearchResult, ChunkMetadata, ChunkType } from '../lib/types';

/**
 * POST /api/query — 语义搜索
 */
export async function handleQuery(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as QueryRequest;

  if (!body.query || typeof body.query !== 'string') {
    return Response.json({ error: 'query string is required' }, { status: 400 });
  }

  const topK = Math.min(body.top_k || 10, 50);
  const scope = body.scope || 'all';

  const results = await searchVectorize(env, body.query, topK, scope);

  return Response.json({ results, count: results.length });
}

/**
 * 共享的 Vectorize 搜索逻辑，MCP tools 也使用
 */
export async function searchVectorize(
  env: Env,
  query: string,
  topK: number,
  scope: ChunkType | 'all',
): Promise<SearchResult[]> {
  // 1. 嵌入查询文本
  const queryVector = await generateEmbedding(env.AI, query);

  // 2. 构建过滤器
  const filter: VectorizeVectorMetadataFilter = {};
  if (scope !== 'all') {
    filter.chunk_type = { $eq: scope };
  }

  // 3. 搜索 Vectorize
  const vectorResults = await env.VECTORIZE.query(queryVector, {
    topK,
    returnMetadata: 'all',
    filter: Object.keys(filter).length > 0 ? filter : undefined,
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    return [];
  }

  // 4. 从 KV 批量获取原文（使用 metadata.chunk_id 作为 KV key）
  const results: SearchResult[] = await Promise.all(
    vectorResults.matches.map(async (match) => {
      const meta = (match.metadata || {}) as ChunkMetadata;
      const kvKey = meta.chunk_id || match.id;
      const content = await env.CHUNKS_KV.get(kvKey) || '[content not found]';
      return {
        id: kvKey,
        score: match.score,
        content,
        metadata: meta,
      };
    }),
  );

  return results;
}
