/**
 * LongPort API call helpers:
 * - lightweight in-process rate limiter (min interval)
 * - retry with exponential backoff for 429002 "api request is limited"
 *
 * Note: This is intentionally conservative and dependency-free.
 */
 
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
 
export function isLongportRateLimitError(error: unknown): boolean {
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as any).message || '')
      : String(error || '');
 
  // LongPort openapi rate limit signal (seen in logs)
  return (
    msg.includes('429002') ||
    msg.toLowerCase().includes('api request is limited') ||
    msg.toLowerCase().includes('please slow down request frequency')
  );
}
 
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 800;
  const maxDelayMs = options?.maxDelayMs ?? 8000;
 
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isLongportRateLimitError(error) && attempt < maxRetries) {
        const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt));
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
 
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
 
/**
 * Minimal async queue-based rate limiter.
 * Ensures calls are spaced by at least `minIntervalMs`.
 */
export class RateLimiter {
  private queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }> = [];
  private processing = false;
  private lastCallTime = 0;
 
  constructor(private readonly minIntervalMs: number) {}
 
  execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn: fn as any, resolve: resolve as any, reject });
      if (!this.processing) void this.processQueue();
    });
  }
 
  getQueueLength(): number {
    return this.queue.length;
  }
 
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
 
    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        const elapsed = now - this.lastCallTime;
        if (elapsed < this.minIntervalMs) {
          await sleep(this.minIntervalMs - elapsed);
        }
 
        const task = this.queue.shift();
        if (!task) continue;
 
        try {
          const result = await task.fn();
          this.lastCallTime = Date.now();
          task.resolve(result);
        } catch (e) {
          this.lastCallTime = Date.now();
          task.reject(e);
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
 
// A shared limiter for LongPort requests in live trading flows.
export const longportRateLimiter = new RateLimiter(150);

