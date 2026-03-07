import { toVectorId } from '../lib/types';
import type { Env } from '../lib/types';

interface DeleteRequest {
  /** 按文件路径删除该文件的所有 chunks */
  file_path?: string;
  /** 按 ID 列表删除 */
  ids?: string[];
}

/**
 * DELETE /api/index — 删除向量和 KV 数据
 */
export async function handleDelete(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as DeleteRequest;

  if (!body.file_path && !body.ids) {
    return Response.json({ error: 'file_path or ids is required' }, { status: 400 });
  }

  let idsToDelete: string[] = [];

  if (body.ids) {
    idsToDelete = body.ids;
  } else if (body.file_path) {
    // 从 KV 查找该文件的所有 chunk IDs
    // KV list 使用 prefix 匹配：ID 格式为 file_path::index
    const listed = await env.CHUNKS_KV.list({ prefix: body.file_path + '::' });
    idsToDelete = listed.keys.map((k) => k.name);
  }

  if (idsToDelete.length === 0) {
    return Response.json({ success: true, deleted: 0, message: 'No chunks found to delete' });
  }

  // 批量删除 Vectorize（每批最多 1000）— 使用 hashed vector IDs
  const vectorIds = idsToDelete.map(toVectorId);
  for (let i = 0; i < vectorIds.length; i += 1000) {
    const batch = vectorIds.slice(i, i + 1000);
    await env.VECTORIZE.deleteByIds(batch);
  }

  // 批量删除 KV
  await Promise.all(idsToDelete.map((id) => env.CHUNKS_KV.delete(id)));

  return Response.json({
    success: true,
    deleted: idsToDelete.length,
    message: `Deleted ${idsToDelete.length} chunks`,
  });
}
