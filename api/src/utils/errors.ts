/**
 * 统一错误处理工具
 * 定义错误分类、错误码体系和错误类
 */

/**
 * 错误码枚举
 */
export enum ErrorCode {
  // 通用错误 (1000-1999)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  MISSING_PARAMETER = 'MISSING_PARAMETER',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  
  // 认证授权错误 (2000-2999)
  UNAUTHORIZED = 'UNAUTHORIZED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  
  // 资源错误 (3000-3999)
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  
  // API限制错误 (4000-4999)
  RATE_LIMIT = 'RATE_LIMIT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  
  // 业务逻辑错误 (5000-5999)
  CAPITAL_INSUFFICIENT = 'CAPITAL_INSUFFICIENT',
  ORDER_SUBMIT_FAILED = 'ORDER_SUBMIT_FAILED',
  SYNC_FAILED = 'SYNC_FAILED',
  STRATEGY_EXECUTION_FAILED = 'STRATEGY_EXECUTION_FAILED',
  
  // 外部服务错误 (6000-6999)
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

/**
 * 错误严重程度
 */
export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * 错误分类
 */
export enum ErrorCategory {
  CLIENT_ERROR = 'CLIENT_ERROR',      // 客户端错误（4xx）
  SERVER_ERROR = 'SERVER_ERROR',       // 服务器错误（5xx）
  EXTERNAL_ERROR = 'EXTERNAL_ERROR',   // 外部服务错误
  BUSINESS_ERROR = 'BUSINESS_ERROR',   // 业务逻辑错误
}

/**
 * 应用错误类
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly severity: ErrorSeverity;
  public readonly category: ErrorCategory;
  public readonly details?: any;
  public readonly isOperational: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    category: ErrorCategory = ErrorCategory.SERVER_ERROR,
    details?: any,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.severity = severity;
    this.category = category;
    this.details = details;
    this.isOperational = isOperational;

    // 保持正确的堆栈跟踪
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 错误码到HTTP状态码的映射
 */
const ERROR_CODE_TO_STATUS: Record<ErrorCode, number> = {
  // 通用错误
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.INVALID_REQUEST]: 400,
  [ErrorCode.MISSING_PARAMETER]: 400,
  [ErrorCode.VALIDATION_ERROR]: 400,
  
  // 认证授权错误
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_INVALID]: 401,
  [ErrorCode.PERMISSION_DENIED]: 403,
  
  // 资源错误
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_CONFLICT]: 409,
  [ErrorCode.RESOURCE_EXHAUSTED]: 429,
  
  // API限制错误
  [ErrorCode.RATE_LIMIT]: 429,
  [ErrorCode.QUOTA_EXCEEDED]: 400,
  
  // 业务逻辑错误
  [ErrorCode.CAPITAL_INSUFFICIENT]: 400,
  [ErrorCode.ORDER_SUBMIT_FAILED]: 500,
  [ErrorCode.SYNC_FAILED]: 500,
  [ErrorCode.STRATEGY_EXECUTION_FAILED]: 500,
  
  // 外部服务错误
  [ErrorCode.EXTERNAL_API_ERROR]: 502,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.NETWORK_ERROR]: 503,
};

/**
 * 错误码到严重程度的映射
 */
const ERROR_CODE_TO_SEVERITY: Record<ErrorCode, ErrorSeverity> = {
  // 通用错误
  [ErrorCode.INTERNAL_ERROR]: ErrorSeverity.HIGH,
  [ErrorCode.INVALID_REQUEST]: ErrorSeverity.LOW,
  [ErrorCode.MISSING_PARAMETER]: ErrorSeverity.LOW,
  [ErrorCode.VALIDATION_ERROR]: ErrorSeverity.LOW,
  
  // 认证授权错误
  [ErrorCode.UNAUTHORIZED]: ErrorSeverity.MEDIUM,
  [ErrorCode.TOKEN_EXPIRED]: ErrorSeverity.MEDIUM,
  [ErrorCode.TOKEN_INVALID]: ErrorSeverity.MEDIUM,
  [ErrorCode.PERMISSION_DENIED]: ErrorSeverity.MEDIUM,
  
  // 资源错误
  [ErrorCode.NOT_FOUND]: ErrorSeverity.LOW,
  [ErrorCode.RESOURCE_CONFLICT]: ErrorSeverity.MEDIUM,
  [ErrorCode.RESOURCE_EXHAUSTED]: ErrorSeverity.MEDIUM,
  
  // API限制错误
  [ErrorCode.RATE_LIMIT]: ErrorSeverity.MEDIUM,
  [ErrorCode.QUOTA_EXCEEDED]: ErrorSeverity.MEDIUM,
  
  // 业务逻辑错误
  [ErrorCode.CAPITAL_INSUFFICIENT]: ErrorSeverity.MEDIUM,
  [ErrorCode.ORDER_SUBMIT_FAILED]: ErrorSeverity.HIGH,
  [ErrorCode.SYNC_FAILED]: ErrorSeverity.HIGH,
  [ErrorCode.STRATEGY_EXECUTION_FAILED]: ErrorSeverity.CRITICAL,
  
  // 外部服务错误
  [ErrorCode.EXTERNAL_API_ERROR]: ErrorSeverity.HIGH,
  [ErrorCode.DATABASE_ERROR]: ErrorSeverity.HIGH,
  [ErrorCode.NETWORK_ERROR]: ErrorSeverity.MEDIUM,
};

/**
 * 错误码到错误分类的映射
 */
const ERROR_CODE_TO_CATEGORY: Record<ErrorCode, ErrorCategory> = {
  // 通用错误
  [ErrorCode.INTERNAL_ERROR]: ErrorCategory.SERVER_ERROR,
  [ErrorCode.INVALID_REQUEST]: ErrorCategory.CLIENT_ERROR,
  [ErrorCode.MISSING_PARAMETER]: ErrorCategory.CLIENT_ERROR,
  [ErrorCode.VALIDATION_ERROR]: ErrorCategory.CLIENT_ERROR,
  
  // 认证授权错误
  [ErrorCode.UNAUTHORIZED]: ErrorCategory.CLIENT_ERROR,
  [ErrorCode.TOKEN_EXPIRED]: ErrorCategory.CLIENT_ERROR,
  [ErrorCode.TOKEN_INVALID]: ErrorCategory.CLIENT_ERROR,
  [ErrorCode.PERMISSION_DENIED]: ErrorCategory.CLIENT_ERROR,
  
  // 资源错误
  [ErrorCode.NOT_FOUND]: ErrorCategory.CLIENT_ERROR,
  [ErrorCode.RESOURCE_CONFLICT]: ErrorCategory.CLIENT_ERROR,
  [ErrorCode.RESOURCE_EXHAUSTED]: ErrorCategory.CLIENT_ERROR,
  
  // API限制错误
  [ErrorCode.RATE_LIMIT]: ErrorCategory.CLIENT_ERROR,
  [ErrorCode.QUOTA_EXCEEDED]: ErrorCategory.CLIENT_ERROR,
  
  // 业务逻辑错误
  [ErrorCode.CAPITAL_INSUFFICIENT]: ErrorCategory.BUSINESS_ERROR,
  [ErrorCode.ORDER_SUBMIT_FAILED]: ErrorCategory.BUSINESS_ERROR,
  [ErrorCode.SYNC_FAILED]: ErrorCategory.BUSINESS_ERROR,
  [ErrorCode.STRATEGY_EXECUTION_FAILED]: ErrorCategory.BUSINESS_ERROR,
  
  // 外部服务错误
  [ErrorCode.EXTERNAL_API_ERROR]: ErrorCategory.EXTERNAL_ERROR,
  [ErrorCode.DATABASE_ERROR]: ErrorCategory.EXTERNAL_ERROR,
  [ErrorCode.NETWORK_ERROR]: ErrorCategory.EXTERNAL_ERROR,
};

/**
 * 创建应用错误
 */
export function createError(
  code: ErrorCode,
  message: string,
  details?: any
): AppError {
  return new AppError(
    code,
    message,
    ERROR_CODE_TO_STATUS[code],
    ERROR_CODE_TO_SEVERITY[code],
    ERROR_CODE_TO_CATEGORY[code],
    details
  );
}

/**
 * 错误工厂函数
 */
export const ErrorFactory = {
  // 通用错误
  internalError: (message: string = '服务器内部错误', details?: any) =>
    createError(ErrorCode.INTERNAL_ERROR, message, details),
  
  invalidRequest: (message: string = '无效的请求', details?: any) =>
    createError(ErrorCode.INVALID_REQUEST, message, details),
  
  missingParameter: (paramName: string) =>
    createError(ErrorCode.MISSING_PARAMETER, `缺少必需参数: ${paramName}`, { parameter: paramName }),
  
  validationError: (message: string, details?: any) =>
    createError(ErrorCode.VALIDATION_ERROR, message, details),
  
  // 认证授权错误
  unauthorized: (message: string = '未授权访问') =>
    createError(ErrorCode.UNAUTHORIZED, message),
  
  tokenExpired: (message: string = '访问令牌已过期') =>
    createError(ErrorCode.TOKEN_EXPIRED, message),
  
  tokenInvalid: (message: string = '访问令牌无效') =>
    createError(ErrorCode.TOKEN_INVALID, message),
  
  permissionDenied: (message: string = '权限不足') =>
    createError(ErrorCode.PERMISSION_DENIED, message),
  
  // 资源错误
  notFound: (resource: string = '资源') =>
    createError(ErrorCode.NOT_FOUND, `${resource}不存在`, { resource }),
  
  resourceConflict: (message: string, details?: any) =>
    createError(ErrorCode.RESOURCE_CONFLICT, message, details),
  
  // API限制错误
  rateLimit: (message: string = '请求频率过高，请稍后重试') =>
    createError(ErrorCode.RATE_LIMIT, message),
  
  quotaExceeded: (message: string = '请求的标的数量超限') =>
    createError(ErrorCode.QUOTA_EXCEEDED, message),
  
  // 业务逻辑错误
  capitalInsufficient: (message: string = '资金不足') =>
    createError(ErrorCode.CAPITAL_INSUFFICIENT, message),
  
  orderSubmitFailed: (message: string = '提交订单失败', details?: any) =>
    createError(ErrorCode.ORDER_SUBMIT_FAILED, message, details),
  
  syncFailed: (message: string = '同步失败', details?: any) =>
    createError(ErrorCode.SYNC_FAILED, message, details),
  
  strategyExecutionFailed: (message: string = '策略执行失败', details?: any) =>
    createError(ErrorCode.STRATEGY_EXECUTION_FAILED, message, details),
  
  // 外部服务错误
  externalApiError: (service: string, message: string, details?: any) =>
    createError(ErrorCode.EXTERNAL_API_ERROR, `${service}: ${message}`, { service, ...details }),
  
  databaseError: (message: string = '数据库操作失败', details?: any) =>
    createError(ErrorCode.DATABASE_ERROR, message, details),
  
  networkError: (message: string = '网络连接失败', details?: any) =>
    createError(ErrorCode.NETWORK_ERROR, message, details),
};

/**
 * 判断错误是否为应用错误
 */
export function isAppError(error: any): error is AppError {
  return error instanceof AppError;
}

/**
 * 将未知错误转换为应用错误
 */
export function normalizeError(error: any): AppError {
  if (isAppError(error)) {
    return error;
  }

  // 处理常见的错误类型
  if (error.code === '301600') {
    return ErrorFactory.invalidRequest('无效的请求参数');
  }

  if (error.code === '301606' || error.code === '429002') {
    return ErrorFactory.rateLimit('请求频率过高，请稍后重试');
  }

  if (error.code === '301607') {
    return ErrorFactory.quotaExceeded('请求的标的数量超限，请减少单次请求标的数量');
  }

  if (error.message && (error.message.includes('401003') || error.message.includes('token expired'))) {
    return ErrorFactory.tokenExpired('访问令牌已过期，请更新.env文件中的LONGPORT_ACCESS_TOKEN');
  }

  if (error.message && error.message.includes('401004')) {
    return ErrorFactory.tokenInvalid('访问令牌无效（401004）。可能原因：Token与App Key不匹配、Token已过期、或没有行情权限');
  }

  if (error.message && (error.message.includes('permission') || error.message.includes('权限'))) {
    return ErrorFactory.permissionDenied('当前账户没有该市场的行情权限');
  }

  // 默认返回内部错误
  return ErrorFactory.internalError(error.message || '未知错误', {
    originalError: error,
  });
}

