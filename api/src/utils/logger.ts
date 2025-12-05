/**
 * 日志工具
 * 为所有日志添加时间戳
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

function formatMessage(...args: any[]): any[] {
  const timestamp = formatTimestamp();
  if (args.length === 0) {
    return [`[${timestamp}]`];
  }
  
  // 如果第一个参数是字符串，在前面添加时间戳
  if (typeof args[0] === 'string') {
    return [`[${timestamp}] ${args[0]}`, ...args.slice(1)];
  }
  
  // 否则在所有参数前添加时间戳
  return [`[${timestamp}]`, ...args];
}

export const logger = {
  log: (...args: any[]) => {
    console.log(...formatMessage(...args));
  },
  
  error: (...args: any[]) => {
    console.error(...formatMessage(...args));
  },
  
  warn: (...args: any[]) => {
    console.warn(...formatMessage(...args));
  },
  
  info: (...args: any[]) => {
    console.info(...formatMessage(...args));
  },
  
  debug: (...args: any[]) => {
    console.debug(...formatMessage(...args));
  },
};


