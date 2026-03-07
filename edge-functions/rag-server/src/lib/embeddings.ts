import type { Env } from './types';

const MODEL = '@cf/baai/bge-m3';
const MAX_BATCH_SIZE = 10;

/**
 * 批量生成嵌入向量
 * Workers AI bge-m3 每次最多 100 条
 */
export async function generateEmbeddings(
  ai: Env['AI'],
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const result = await ai.run(MODEL, { text: batch }) as { data: number[][] };
    allEmbeddings.push(...result.data);
  }

  return allEmbeddings;
}

/**
 * 生成单条嵌入向量
 */
export async function generateEmbedding(
  ai: Env['AI'],
  text: string,
): Promise<number[]> {
  const result = await ai.run(MODEL, { text: [text] }) as { data: number[][] };
  return result.data[0];
}
