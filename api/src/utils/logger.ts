/**
 * 日志工具
 * 为所有日志添加时间戳，并集成新的日志服务（非阻塞、结构化、持久化）
 * 
 * 向后兼容：保持原有的API接口，自动提取模块信息
 */

import logService from '../services/log.service';

// 导入 getModuleFromPath 函数
// 添加运行时安全检查，确保即使模块加载失败也能正常工作
let getModuleFromPathOriginal: ((filePath: string) => string) | undefined;
let normalizeModuleName: ((module: string) => string) | undefined;
try {
  const moduleMapper = require('./log-module-mapper');
  if (moduleMapper && typeof moduleMapper.getModuleFromPath === 'function') {
    getModuleFromPathOriginal = moduleMapper.getModuleFromPath;
  }
  if (moduleMapper && typeof moduleMapper.normalizeModuleName === 'function') {
    normalizeModuleName = moduleMapper.normalizeModuleName;
  }
} catch (error) {
  // 如果导入失败，getModuleFromPathOriginal 将保持 undefined，使用备用方案
  console.warn('[Logger] 无法加载 log-module-mapper，将使用备用模块名称提取方案');
}

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

/**
 * 从路径推断模块名称（备用方案）
 */
function inferModuleFromPathFallback(filePath: string): string {
  // 标准化路径（Windows路径转换为Unix风格）
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  
  // 查找 services、routes、utils、config 等目录
  const servicesIndex = pathParts.indexOf('services');
  const routesIndex = pathParts.indexOf('routes');
  const utilsIndex = pathParts.indexOf('utils');
  const configIndex = pathParts.indexOf('config');
  
  if (servicesIndex >= 0 && servicesIndex < pathParts.length - 1) {
    const fileName = pathParts[pathParts.length - 1];
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.');
    return `Service.${moduleName}`;
  }
  
  if (routesIndex >= 0 && routesIndex < pathParts.length - 1) {
    const fileName = pathParts[pathParts.length - 1];
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.');
    return `API.${moduleName}`;
  }
  
  if (utilsIndex >= 0 && utilsIndex < pathParts.length - 1) {
    const fileName = pathParts[pathParts.length - 1];
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.');
    return `Utils.${moduleName}`;
  }
  
  if (configIndex >= 0 && configIndex < pathParts.length - 1) {
    const fileName = pathParts[pathParts.length - 1];
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.');
    return `Config.${moduleName}`;
  }
  
  // 默认：从文件名提取
  const fileName = pathParts[pathParts.length - 1];
  const moduleName = fileName
    .replace(/\.(ts|js)$/, '')
    .replace(/-/g, '.')
    .replace(/_/g, '.')  // 新增：将下划线也转换为点号
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('.');
  
  return moduleName || 'Unknown';
}

/**
 * 安全调用 getModuleFromPath，如果失败则使用备用方案
 */
function getModuleFromPath(filePath: string): string {
  try {
    if (typeof getModuleFromPathOriginal === 'function') {
      return getModuleFromPathOriginal(filePath);
    }
  } catch (error) {
    // 如果调用失败，使用备用方案
  }
  // 如果函数不可用或调用失败，使用备用方案
  return inferModuleFromPathFallback(filePath);
}

/**
 * 从调用栈提取模块名称
 * 使用模块映射器确保模块名称清晰准确
 */
function extractModuleName(stack?: string): string {
  if (!stack) {
    return 'Unknown';
  }

  const stackLines = stack.split('\n');
  // 跳过前3行（Error、logger.log/info/warn/error/debug）
  for (let i = 3; i < stackLines.length; i++) {
    const line = stackLines[i];
    // 匹配格式：at functionName (file:line:column)
    const match = line.match(/at\s+.+\s+\((.+):(\d+):(\d+)\)/);
    if (match) {
      const filePath = match[1];
      // 排除node_modules和logger.ts本身
      if (!filePath.includes('node_modules') && !filePath.includes('logger.ts')) {
        // 使用模块映射器获取准确的模块名称，如果失败则使用备用方案
        try {
          const module = getModuleFromPath(filePath);
          // 标准化模块名称（处理旧格式）
          if (normalizeModuleName) {
            return normalizeModuleName(module);
          }
          return module;
        } catch (error) {
          // 如果调用失败，使用备用方案
          const module = inferModuleFromPathFallback(filePath);
          if (normalizeModuleName) {
            return normalizeModuleName(module);
          }
          return module;
        }
      }
    }
  }

  return 'Unknown';
}

/**
 * 格式化日志消息和额外数据
 */
function formatLogData(...args: any[]): { message: string; extraData?: Record<string, any> } {
  if (args.length === 0) {
    return { message: '' };
  }

  const message = typeof args[0] === 'string' ? args[0] : String(args[0]);
  const extraData: Record<string, any> = {};

  // 收集额外的参数作为结构化数据
  if (args.length > 1) {
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        Object.assign(extraData, arg);
      } else {
        extraData[`arg${i}`] = arg;
      }
    }
  }

  return {
    message,
    extraData: Object.keys(extraData).length > 0 ? extraData : undefined,
  };
}

export const logger = {
  /**
   * 记录日志（INFO级别）
   * 保持向后兼容：自动提取模块信息，同时写入数据库
   */
  log: (...args: any[]) => {
    const formatted = formatMessage(...args);
    console.log(...formatted);

    // 提取模块名称
    const stack = new Error().stack;
    const module = extractModuleName(stack);
    const { message, extraData } = formatLogData(...args);

    // 写入数据库（非阻塞）
    logService.info(module, message, extraData);
  },

  /**
   * 记录错误日志（ERROR级别）
   */
  error: (...args: any[]) => {
    const formatted = formatMessage(...args);
    console.error(...formatted);

    const stack = new Error().stack;
    const module = extractModuleName(stack);
    const { message, extraData } = formatLogData(...args);

    logService.error(module, message, extraData);
  },

  /**
   * 记录警告日志（WARNING级别）
   */
  warn: (...args: any[]) => {
    const formatted = formatMessage(...args);
    console.warn(...formatted);

    const stack = new Error().stack;
    const module = extractModuleName(stack);
    const { message, extraData } = formatLogData(...args);

    logService.warn(module, message, extraData);
  },

  /**
   * 记录信息日志（INFO级别）
   */
  info: (...args: any[]) => {
    const formatted = formatMessage(...args);
    console.info(...formatted);

    const stack = new Error().stack;
    const module = extractModuleName(stack);
    const { message, extraData } = formatLogData(...args);

    logService.info(module, message, extraData);
  },

  /**
   * 记录调试日志（DEBUG级别）
   */
  debug: (...args: any[]) => {
    const formatted = formatMessage(...args);
    console.debug(...formatted);

    const stack = new Error().stack;
    const module = extractModuleName(stack);
    const { message, extraData } = formatLogData(...args);

    logService.debug(module, message, extraData);
  },
};


