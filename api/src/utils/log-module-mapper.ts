/**
 * 日志模块映射器
 * 将文件路径映射到功能模块，确保日志模块名称清晰准确
 */

interface ModuleMapping {
  // 文件路径模式（支持正则表达式或字符串匹配）
  pattern: string | RegExp
  // 模块名称
  module: string
  // 中文名称
  chineseName?: string
  // 描述
  description?: string
}

/**
 * 模块映射规则
 * 按优先级排序，匹配第一个符合的规则
 */
const MODULE_MAPPINGS: ModuleMapping[] = [
  // ==================== 策略相关 ====================
  {
    pattern: /strategy-scheduler\.service\.ts$/,
    module: 'Strategy.Scheduler',
    chineseName: '策略调度器',
    description: '策略调度器：定时触发策略运行，管理策略生命周期',
  },
  {
    pattern: /strategies\/strategy-base\.ts$/,
    module: 'Strategy.Base',
    chineseName: '策略基类',
    description: '策略基类：定义策略标准接口和通用功能',
  },
  {
    pattern: /strategies\/recommendation-strategy\.ts$/,
    module: 'Strategy.Recommendation',
    chineseName: '推荐策略',
    description: '推荐策略：基于交易推荐的策略实现',
  },
  {
    pattern: /strategies\/option-intraday-strategy\.ts$/,
    module: 'Strategy.Option',
    chineseName: '期权策略',
    description: '期权策略：末日期权交易策略，支持单边、跨式、价差等多种策略类型',
  },
  {
    pattern: /strategies\//,
    module: 'Strategy',
    chineseName: '策略实现',
    description: '策略实现：具体策略逻辑',
  },

  // ==================== 执行相关 ====================
  {
    pattern: /basic-execution\.service\.ts$/,
    module: 'Execution.Basic',
    chineseName: '基础执行器',
    description: '基础执行器：直接调用Longbridge SDK进行实盘交易',
  },
  {
    pattern: /dynamic-position-manager\.service\.ts$/,
    module: 'Execution.Position',
    chineseName: '动态持仓管理',
    description: '动态持仓管理：管理策略持仓和仓位调整',
  },

  // ==================== 回测相关 ====================
  {
    pattern: /backtest\.service\.ts$/,
    module: 'Backtest',
    chineseName: '回测服务',
    description: '回测服务：执行策略回测，计算回测结果',
  },

  // ==================== 资金管理相关 ====================
  {
    pattern: /capital-manager\.service\.ts$/,
    module: 'Capital.Manager',
    chineseName: '资金管理器',
    description: '资金管理器：管理资金分配和使用',
  },
  {
    pattern: /account-balance-sync\.service\.ts$/,
    module: 'Capital.Sync',
    chineseName: '账户余额同步',
    description: '账户余额同步：同步账户余额，确保数据一致性',
  },
  
  // ==================== 期权相关 ====================
  {
    pattern: /futunn-option-chain\.service\.ts$/,
    module: 'Option.Chain',
    chineseName: '期权链',
    description: '期权链：获取期权链数据',
  },
  {
    pattern: /futunn-option-quote\.service\.ts$/,
    module: 'Option.Quote',
    chineseName: '期权行情',
    description: '期权行情：获取期权实时行情',
  },
  {
    pattern: /institution-cache\.service\.ts$/,
    module: 'Option.InstitutionCache',
    chineseName: '机构缓存',
    description: '机构缓存：缓存机构持仓数据',
  },

  // ==================== 选股相关 ====================
  {
    pattern: /stock-selector\.service\.ts$/,
    module: 'StockSelector',
    chineseName: '选股器',
    description: '选股器：股票筛选和黑名单管理',
  },
  {
    pattern: /institution-stock-selector\.service\.ts$/,
    module: 'StockSelector.Institution',
    chineseName: '机构选股',
    description: '机构选股：基于机构持仓的选股策略',
  },
  {
    pattern: /trading-recommendation\.service\.ts$/,
    module: 'TradingRecommendation',
    chineseName: '交易推荐',
    description: '交易推荐：计算交易推荐信号',
  },

  // ==================== 市场数据相关 ====================
  {
    pattern: /market-data\.service\.ts$/,
    module: 'MarketData',
    chineseName: '市场数据',
    description: '市场数据：获取和管理市场行情数据',
  },
  {
    pattern: /market-data-cache\.service\.ts$/,
    module: 'MarketData.Cache',
    chineseName: '市场数据缓存',
    description: '市场数据缓存：缓存市场数据以提高性能',
  },
  {
    pattern: /intraday-data-filter\.service\.ts$/,
    module: 'MarketData.Filter',
    chineseName: '日内数据过滤',
    description: '日内数据过滤：过滤和处理日内数据',
  },

  // ==================== 订单相关 ====================
  {
    pattern: /order-prevention-metrics\.service\.ts$/,
    module: 'Order.Prevention',
    chineseName: '订单预防指标',
    description: '订单预防指标：订单价格审查和预防机制',
  },
  {
    pattern: /trade-push\.service\.ts$/,
    module: 'Order.Push',
    chineseName: '交易推送',
    description: '交易推送：实时订单状态更新推送',
  },
  {
    pattern: /api-rate-limiter\.service\.ts$/,
    module: 'Order.RateLimit',
    chineseName: 'API限流',
    description: 'API限流：API请求频率限制',
  },

  // ==================== 状态管理相关 ====================
  {
    pattern: /state-manager\.service\.ts$/,
    module: 'StateManager',
    chineseName: '状态管理器',
    description: '状态管理器：管理策略和系统状态',
  },

  // ==================== 日志系统相关 ====================
  {
    pattern: /log\.service\.ts$/,
    module: 'Log.Service',
    chineseName: '日志服务',
    description: '日志服务：日志写入和管理',
  },
  {
    pattern: /log-worker\.service\.ts$/,
    module: 'Log.Worker',
    chineseName: '日志工作线程',
    description: '日志工作线程：批量写入日志到数据库',
  },
  {
    pattern: /log-cleanup\.service\.ts$/,
    module: 'Log.Cleanup',
    chineseName: '日志清理',
    description: '日志清理：自动和手动清理日志',
  },
  {
    pattern: /log-digest\.service\.ts$/,
    module: 'Log.Digest',
    chineseName: '日志摘要',
    description: '日志摘要：高频指标定期聚合写入',
  },

  // ==================== 配置相关 ====================
  {
    pattern: /config\.service\.ts$/,
    module: 'Config',
    chineseName: '配置管理',
    description: '配置管理：系统配置读取和更新',
  },
  {
    pattern: /token-refresh\.service\.ts$/,
    module: 'Config.Token',
    chineseName: 'Token刷新',
    description: 'Token刷新：LongPort API Token自动刷新',
  },
  {
    pattern: /trading-days\.service\.ts$/,
    module: 'Config.TradingDays',
    chineseName: '交易日服务',
    description: '交易日服务：交易日计算和管理',
  },

  // ==================== 路由相关 ====================
  {
    pattern: /routes\/backtest\.ts$/,
    module: 'API.Backtest',
    chineseName: '回测API',
    description: '回测API：回测相关接口',
  },
  {
    pattern: /routes\/logs\.ts$/,
    module: 'API.Logs',
    chineseName: '日志API',
    description: '日志API：日志查询和导出接口',
  },
  {
    pattern: /routes\/orders\.ts$/,
    module: 'API.Orders',
    chineseName: '订单API',
    description: '订单API：订单提交和管理接口',
  },
  {
    pattern: /routes\/config\.ts$/,
    module: 'API.Config',
    chineseName: '配置API',
    description: '配置API：配置管理接口',
  },
  {
    pattern: /routes\/quant\//,
    module: 'API.Quant',
    chineseName: '量化API',
    description: '量化API：量化交易相关接口',
  },
  {
    pattern: /routes\//,
    module: 'API',
    chineseName: 'API路由',
    description: 'API路由：HTTP接口处理',
  },

  // ==================== 工具类相关 ====================
  {
    pattern: /utils\/logger\.ts$/,
    module: 'Utils.Logger',
    chineseName: '日志工具',
    description: '日志工具：日志记录工具函数',
  },
  {
    pattern: /utils\/trading-days\.ts$/,
    module: 'Utils.TradingDays',
    chineseName: '交易日工具',
    description: '交易日工具：交易日计算和验证',
  },
  {
    pattern: /utils\/order-validation\.ts$/,
    module: 'Utils.OrderValidation',
    chineseName: '订单验证',
    description: '订单验证：订单参数验证',
  },
  {
    pattern: /utils\//,
    module: 'Utils',
    chineseName: '工具类',
    description: '工具类：通用工具函数',
  },

  // ==================== 中间件相关 ====================
  {
    pattern: /middleware\//,
    module: 'Middleware',
    chineseName: '中间件',
    description: '中间件：请求处理中间件',
  },

  // ==================== 配置相关 ====================
  {
    pattern: /config\/longport\.ts$/,
    module: 'Config.LongPort',
    chineseName: 'LongPort配置',
    description: 'LongPort配置：LongPort API配置和初始化',
  },
  {
    pattern: /config\/database\.ts$/,
    module: 'Config.Database',
    chineseName: '数据库配置',
    description: '数据库配置：数据库连接配置',
  },
  {
    pattern: /config\//,
    module: 'Config',
    chineseName: '配置',
    description: '配置：系统配置',
  },

  // ==================== 服务器相关 ====================
  {
    pattern: /server\.ts$/,
    module: 'Server',
    chineseName: '服务器',
    description: '服务器：Express服务器启动和配置',
  },
]

/**
 * 根据文件路径获取模块名称
 * @param filePath 文件路径
 * @returns 模块名称
 */
export function getModuleFromPath(filePath: string): string {
  if (!filePath) {
    return 'Unknown'
  }

  // 标准化路径（Windows路径转换为Unix风格）
  const normalizedPath = filePath.replace(/\\/g, '/')

  // 查找匹配的映射规则
  for (const mapping of MODULE_MAPPINGS) {
    if (typeof mapping.pattern === 'string') {
      if (normalizedPath.includes(mapping.pattern)) {
        return mapping.module
      }
    } else if (mapping.pattern instanceof RegExp) {
      if (mapping.pattern.test(normalizedPath)) {
        return mapping.module
      }
    }
  }

  // 如果没有匹配的规则，尝试从路径推断
  return inferModuleFromPath(normalizedPath)
}

/**
 * 从路径推断模块名称（备用方案）
 * @param filePath 文件路径
 * @returns 模块名称
 */
function inferModuleFromPath(filePath: string): string {
  // 提取文件路径中的关键部分
  const pathParts = filePath.split('/')
  
  // 查找 services、routes、utils、config 等目录
  const servicesIndex = pathParts.indexOf('services')
  const routesIndex = pathParts.indexOf('routes')
  const utilsIndex = pathParts.indexOf('utils')
  const configIndex = pathParts.indexOf('config')
  
  if (servicesIndex >= 0 && servicesIndex < pathParts.length - 1) {
    // 在services目录下
    const fileName = pathParts[pathParts.length - 1]
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.')
    return `Service.${moduleName}`
  }
  
  if (routesIndex >= 0 && routesIndex < pathParts.length - 1) {
    // 在routes目录下
    const fileName = pathParts[pathParts.length - 1]
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.')
    return `API.${moduleName}`
  }
  
  if (utilsIndex >= 0 && utilsIndex < pathParts.length - 1) {
    // 在utils目录下
    const fileName = pathParts[pathParts.length - 1]
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.')
    return `Utils.${moduleName}`
  }
  
  if (configIndex >= 0 && configIndex < pathParts.length - 1) {
    // 在config目录下
    const fileName = pathParts[pathParts.length - 1]
    const moduleName = fileName
      .replace(/\.(ts|js)$/, '')
      .replace(/-/g, '.')
      .replace(/_/g, '.')  // 新增：将下划线也转换为点号
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.')
    return `Config.${moduleName}`
  }
  
  // 默认：从文件名提取
  const fileName = pathParts[pathParts.length - 1]
  const moduleName = fileName
    .replace(/\.(ts|js)$/, '')
    .replace(/-/g, '.')
    .replace(/_/g, '.')  // 新增：将下划线也转换为点号
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('.')
  
  return moduleName || 'Unknown'
}

/**
 * 获取所有模块映射规则（用于调试和文档）
 */
export function getAllModuleMappings(): ModuleMapping[] {
  return MODULE_MAPPINGS
}

/**
 * 根据模块名称获取描述
 * @param module 模块名称
 * @returns 模块描述
 */
export function getModuleDescription(module: string): string | undefined {
  const mapping = MODULE_MAPPINGS.find(m => m.module === module)
  return mapping?.description
}

/**
 * 根据模块名称获取中文名称
 * @param module 模块名称
 * @returns 模块中文名称，如果没有则返回模块名称本身
 */
export function getModuleChineseName(module: string): string {
  const mapping = MODULE_MAPPINGS.find(m => m.module === module)
  return mapping?.chineseName || module
}

/**
 * 模块名称映射表（用于兼容旧格式）
 * 将旧的模块名称映射到新的模块名称
 */
const MODULE_NAME_MAPPING: Record<string, string> = {
  'Task_queues': 'Strategy.Scheduler',
  'Task.Queues': 'Strategy.Scheduler',  // 下划线转换后的格式也需要映射
  // 可以添加其他映射
}

/**
 * 标准化模块名称（处理旧格式）
 * 将下划线格式的模块名称转换为点号分隔格式，并处理已知的映射
 * @param module 模块名称（可能是旧格式）
 * @returns 标准化的模块名称
 */
export function normalizeModuleName(module: string): string {
  if (!module) {
    return 'Unknown'
  }
  
  // 先检查直接映射（原始格式）
  if (MODULE_NAME_MAPPING[module]) {
    return MODULE_NAME_MAPPING[module]
  }
  
  // 将下划线转换为点号
  const normalized = module.replace(/_/g, '.')
  
  // 检查转换后的格式是否需要映射
  if (MODULE_NAME_MAPPING[normalized]) {
    return MODULE_NAME_MAPPING[normalized]
  }
  
  return normalized
}

