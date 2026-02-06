/**
 * 基础设施层轻量 Logger
 * 仅做格式化控制台输出，不依赖 log.service / config.service
 * 适用于: config.service.ts, log.service.ts, log-worker.service.ts, database.ts
 *
 * 避免循环依赖：log.service.ts -> config.service.ts -> logger.ts -> log.service.ts
 */

function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

export const infraLogger = {
  info: (msg: string, ...args: any[]) =>
    console.log(`[${formatTimestamp()}] [INFRA] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) =>
    console.warn(`[${formatTimestamp()}] [INFRA] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) =>
    console.error(`[${formatTimestamp()}] [INFRA] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) =>
    console.debug(`[${formatTimestamp()}] [INFRA] ${msg}`, ...args),
};
