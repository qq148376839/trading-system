/**
 * TraceID上下文管理
 * 使用AsyncLocalStorage在异步上下文中传递TraceID
 * 便于追踪完整的业务流程
 */

import { AsyncLocalStorage } from 'async_hooks';

class TraceContext {
  private static asyncLocalStorage = new AsyncLocalStorage<string>();

  /**
   * 在指定TraceID的上下文中运行回调函数
   * @param traceId TraceID（如果未提供，自动生成）
   * @param callback 回调函数
   * @returns 回调函数的返回值
   */
  static run<T>(traceId: string | undefined, callback: () => T): T {
    const finalTraceId = traceId || this.generateTraceId();
    return this.asyncLocalStorage.run(finalTraceId, callback);
  }

  /**
   * 获取当前上下文的TraceID
   * @returns TraceID或undefined
   */
  static getTraceId(): string | undefined {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * 生成UUID v4格式的TraceID
   * @returns UUID v4字符串
   */
  static generateTraceId(): string {
    // UUID v4格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 在异步函数中运行回调，自动传递TraceID
   * @param callback 异步回调函数
   * @returns Promise
   */
  static async runAsync<T>(
    traceId: string | undefined,
    callback: () => Promise<T>
  ): Promise<T> {
    const finalTraceId = traceId || this.generateTraceId();
    return this.asyncLocalStorage.run(finalTraceId, callback);
  }
}

export default TraceContext;

