import { generateEmbeddings } from '../lib/embeddings';
import { toVectorId } from '../lib/types';
import type { Env, IndexRequest, ChunkMetadata } from '../lib/types';

const UPSERT_BATCH_SIZE = 100;

/**
 * POST /api/index — 接收 chunks，生成嵌入，存入 Vectorize + KV
 */
export async function handleIndex(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as IndexRequest;

    if (!body.chunks || !Array.isArray(body.chunks) || body.chunks.length === 0) {
      return Response.json({ error: 'chunks array is required and must be non-empty' }, { status: 400 });
    }

    const chunks = body.chunks;
    const texts = chunks.map((c) => c.content);

    // 1. 批量生成嵌入
    let embeddings: number[][];
    try {
      embeddings = await generateEmbeddings(env.AI, texts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({
        error: `Embedding generation failed: ${msg}`,
        chunk_count: chunks.length,
        total_chars: texts.reduce((s, t) => s + t.length, 0),
      }, { status: 500 });
    }

    // 2. 批量存入 KV（原文）
    const kvPromises = chunks.map((chunk) =>
      env.CHUNKS_KV.put(chunk.id, chunk.content, {
        metadata: { file_path: chunk.file_path, chunk_type: chunk.chunk_type },
      }),
    );
    await Promise.all(kvPromises);

    // 3. 批量 upsert Vectorize
    let upserted = 0;
    for (let i = 0; i < chunks.length; i += UPSERT_BATCH_SIZE) {
      const batchChunks = chunks.slice(i, i + UPSERT_BATCH_SIZE);
      const batchEmbeddings = embeddings.slice(i, i + UPSERT_BATCH_SIZE);

      const vectors = batchChunks.map((chunk, j) => ({
        id: toVectorId(chunk.id),
        values: batchEmbeddings[j],
        metadata: {
          chunk_id: chunk.id,
          file_path: chunk.file_path,
          chunk_type: chunk.chunk_type,
          symbol_name: chunk.symbol_name || '',
          section_title: chunk.section_title || '',
          last_modified: chunk.last_modified || '',
        } satisfies ChunkMetadata,
      }));

      await env.VECTORIZE.upsert(vectors);
      upserted += vectors.length;
    }

    return Response.json({
      success: true,
      indexed: upserted,
      message: `Indexed ${upserted} chunks`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Index handler error: ${msg}` }, { status: 500 });
  }
}
