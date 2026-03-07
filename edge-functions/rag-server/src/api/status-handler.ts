import type { Env } from '../lib/types';

/**
 * GET /api/status — 索引状态统计
 */
export async function handleStatus(env: Env): Promise<Response> {
  // Vectorize describe 获取索引信息
  const indexInfo = await env.VECTORIZE.describe();

  // KV 抽样获取 chunk 类型分布（list 前 1000 条）
  const kvList = await env.CHUNKS_KV.list({ limit: 1000 });
  const typeCount: Record<string, number> = {};
  for (const key of kvList.keys) {
    const meta = key.metadata as { chunk_type?: string } | null;
    const chunkType = meta?.chunk_type || 'unknown';
    typeCount[chunkType] = (typeCount[chunkType] || 0) + 1;
  }

  return Response.json({
    vectorize: {
      vectorCount: indexInfo.vectorCount,
      dimensions: indexInfo.dimensionCount,
      config: indexInfo.config,
    },
    kv: {
      sampled_keys: kvList.keys.length,
      has_more: !kvList.list_complete,
      type_distribution: typeCount,
    },
  });
}
