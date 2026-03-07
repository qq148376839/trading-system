/** Chunk 类型 */
export type ChunkType = 'docs' | 'code' | 'sql' | 'config' | 'nav';

/** 索引请求中的单个 chunk */
export interface ChunkInput {
  /** 唯一标识: file_path::chunk_index */
  id: string;
  /** 原文内容 */
  content: string;
  /** 源文件路径（相对项目根） */
  file_path: string;
  /** chunk 类型 */
  chunk_type: ChunkType;
  /** 符号名（函数名/类名/表名） */
  symbol_name?: string;
  /** 章节标题（Markdown） */
  section_title?: string;
  /** 文件最后修改时间 ISO */
  last_modified?: string;
}

/** Vectorize 存储的 metadata（不含原文，原文在 KV） */
export interface ChunkMetadata {
  /** KV key (file_path::index) — used to retrieve content from KV */
  chunk_id: string;
  file_path: string;
  chunk_type: ChunkType;
  symbol_name: string;
  section_title: string;
  last_modified: string;
}

/**
 * 将 chunk ID (file_path::index) 转换为 Vectorize 兼容的短 ID (max 64 bytes)
 * 使用 FNV-1a 哈希生成确定性的 16 字符 hex 字符串 + :chunk_index
 */
export function toVectorId(chunkId: string): string {
  // 分离 file_path 和 chunk_index
  const lastSep = chunkId.lastIndexOf('::');
  const filePath = lastSep >= 0 ? chunkId.slice(0, lastSep) : chunkId;
  const chunkIndex = lastSep >= 0 ? chunkId.slice(lastSep + 2) : '0';

  // FNV-1a 64-bit hash (split into two 32-bit halves for JS)
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < filePath.length; i++) {
    const c = filePath.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x811c9dc5);
  }

  const hash = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  // Result: 16 hex chars + ':' + index = well under 64 bytes
  return `${hash}:${chunkIndex}`;
}

/** POST /api/index 请求体 */
export interface IndexRequest {
  chunks: ChunkInput[];
}

/** POST /api/query 请求体 */
export interface QueryRequest {
  query: string;
  top_k?: number;
  scope?: ChunkType | 'all';
}

/** 搜索结果单条 */
export interface SearchResult {
  id: string;
  score: number;
  content: string;
  metadata: ChunkMetadata;
}

/** Cloudflare Worker Env 绑定 */
export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHUNKS_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  API_AUTH_TOKEN: string;
}
