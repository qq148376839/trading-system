import type { ChunkInput } from '../../src/lib/types';

const BATCH_SIZE = 25;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

interface IndexResponse {
  success: boolean;
  indexed: number;
  message: string;
}

interface DeleteResponse {
  success: boolean;
  deleted: number;
  message: string;
}

/**
 * Worker REST API 客户端
 */
export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  /** 批量索引 chunks（自动分批） */
  async indexChunks(chunks: ChunkInput[]): Promise<{ total: number; batches: number }> {
    let total = 0;
    let batches = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const result = await this.retry(() => this.postIndex(batch));
      total += result.indexed;
      batches++;

      if (batches % 5 === 0) {
        console.log(`  Progress: ${total}/${chunks.length} chunks indexed`);
      }
    }

    return { total, batches };
  }

  /** 删除文件的所有 chunks */
  async deleteFile(filePath: string): Promise<number> {
    const result = await this.retry(() => this.deleteIndex(filePath));
    return result.deleted;
  }

  /** 检查服务状态 */
  async status(): Promise<Record<string, unknown>> {
    const resp = await this.fetch('/api/status', { method: 'GET' });
    return resp.json();
  }

  private async postIndex(chunks: ChunkInput[]): Promise<IndexResponse> {
    const resp = await this.fetch('/api/index', {
      method: 'POST',
      body: JSON.stringify({ chunks }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Index failed (${resp.status}): ${text}`);
    }
    return resp.json() as Promise<IndexResponse>;
  }

  private async deleteIndex(filePath: string): Promise<DeleteResponse> {
    const resp = await this.fetch('/api/index', {
      method: 'DELETE',
      body: JSON.stringify({ file_path: filePath }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Delete failed (${resp.status}): ${text}`);
    }
    return resp.json() as Promise<DeleteResponse>;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    return globalThis.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...init.headers,
      },
    });
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_RETRIES) {
          console.warn(`  Retry ${attempt}/${MAX_RETRIES}: ${lastError.message}`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        }
      }
    }
    throw lastError;
  }
}
