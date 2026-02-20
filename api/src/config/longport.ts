import dotenv from 'dotenv';
import path from 'path';

// 明确指定.env文件路径（相对于当前文件）
// 兼容Windows和Docker部署
const envPath = path.resolve(__dirname, '../../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('警告: 无法加载.env文件:', result.error.message);
  console.warn('尝试使用系统环境变量...');
} else {
  console.log('成功加载.env文件:', envPath);
}

// 使用require方式导入，避免TypeScript类型问题
// 添加错误处理以应对LongPort SDK兼容性问题
let longport: any = null;
let Config: any, QuoteContext: any, TradeContext: any, Decimal: any, OrderType: any, OrderSide: any, TimeInForceType: any, OutsideRTH: any, OrderStatus: any, Market: any;

try {
  longport = require('longport');
  ({ Config, QuoteContext, TradeContext, Decimal, OrderType, OrderSide, TimeInForceType, OutsideRTH, OrderStatus, Market } = longport);
  console.log('LongPort SDK 加载成功');
} catch (error: any) {
  console.warn('LongPort SDK 加载失败:', error.message);
  console.warn('系统将以降级模式运行，部分券商接口功能不可用');
  
  // 定义模拟类和对象
  Config = class MockConfig {
    static fromEnv() { return new MockConfig(); }
    constructor(options?: any) {}
  };
  
  QuoteContext = {
    new: async () => ({
      subscribe: async () => {},
      unsubscribe: async () => {},
      dispose: async () => {}
    })
  };
  
  TradeContext = {
    new: async () => ({
      subscribe: async () => {},
      unsubscribe: async () => {},
      dispose: async () => {}
    })
  };
  
  Decimal = class MockDecimal {
    constructor(value: string | number) { return value.toString(); }
    static from_str(str: string) { return new MockDecimal(str); }
  };
  
  OrderType = {};
  OrderSide = {};
  TimeInForceType = {};
  OutsideRTH = {};
  OrderStatus = {};
  Market = {};
}

type QuoteContextType = any;
type TradeContextType = any;

let quoteContext: QuoteContextType | null = null;
let tradeContext: TradeContextType | null = null;

// 添加初始化锁，防止并发初始化
let quoteContextInitializing: Promise<QuoteContextType> | null = null;
let tradeContextInitializing: Promise<TradeContextType> | null = null;

// 动态导入配置服务（避免循环依赖）
let configService: any = null;
async function getConfigService() {
  if (!configService) {
    try {
      const module = await import('../services/config.service');
      configService = module.default;
    } catch (error) {
      // 如果导入失败（例如数据库未初始化），返回null
      return null;
    }
  }
  return configService;
}

// 清除Context缓存（用于Token刷新后重新初始化）
export function clearQuoteContext() {
  quoteContext = null;
  quoteContextInitializing = null;
}

export function clearTradeContext() {
  tradeContext = null;
  tradeContextInitializing = null;
}

/**
 * 获取长桥QuoteContext实例（单例模式）
 * 严格按照长桥官方文档：https://longportapp.github.io/openapi/nodejs/classes/QuoteContext.html#quote
 * 
 * 官方示例：
 * const { Config, QuoteContext } = require("longport")
 * let config = Config.fromEnv()
 * QuoteContext.new(config)
 * 
 * 注意：Config.fromEnv() 会从系统环境变量读取，确保dotenv已加载.env文件到process.env
 */
export async function getQuoteContext(): Promise<QuoteContextType> {
  // 如果已经初始化，直接返回
  if (quoteContext) {
    return quoteContext;
  }
  
  // 如果正在初始化，等待初始化完成
  if (quoteContextInitializing) {
    return quoteContextInitializing;
  }
  
  // 开始初始化，创建Promise
  quoteContextInitializing = (async () => {
    // 优先从数据库读取配置，如果数据库中没有则使用环境变量
    const service = await getConfigService();
    let appKey: string | null = null;
    let appSecret: string | null = null;
    let accessToken: string | null = null;
    let enableOvernight: string | null = null;

    // 记录从数据库读取的值（用于判断配置来源）
    let dbAppKey: string | null = null;
    let dbAppSecret: string | null = null;
    let dbAccessToken: string | null = null;

    if (service) {
      try {
        dbAppKey = await service.getConfig('longport_app_key');
        dbAppSecret = await service.getConfig('longport_app_secret');
        dbAccessToken = await service.getConfig('longport_access_token');
        enableOvernight = await service.getConfig('longport_enable_overnight');

        appKey = dbAppKey;
        appSecret = dbAppSecret;
        accessToken = dbAccessToken;
      } catch (error: any) {
        console.warn('从数据库读取配置失败，使用环境变量:', error.message);
      }
    }

    // 只有当数据库返回 null/undefined 时才使用环境变量（不使用 || 运算符，避免空字符串被覆盖）
    if (appKey == null) appKey = process.env.LONGPORT_APP_KEY || null;
    if (appSecret == null) appSecret = process.env.LONGPORT_APP_SECRET || null;
    if (accessToken == null) accessToken = process.env.LONGPORT_ACCESS_TOKEN || null;
    if (enableOvernight == null) enableOvernight = process.env.LONGPORT_ENABLE_OVERNIGHT || 'false';

    // 记录配置来源
    const appKeySource = dbAppKey != null ? '数据库' : '环境变量';
    const appSecretSource = dbAppSecret != null ? '数据库' : '环境变量';
    const accessTokenSource = dbAccessToken != null ? '数据库' : '环境变量';

    if (!appKey || !appSecret || !accessToken) {
      quoteContextInitializing = null;
      const envPathForError = path.resolve(__dirname, '../../.env');
      throw new Error(
        'LongPort credentials not configured. Please set LONGPORT_APP_KEY, LONGPORT_APP_SECRET, and LONGPORT_ACCESS_TOKEN in database or .env file.\n' +
        `当前.env文件路径: ${envPathForError}\n` +
        `LONGPORT_APP_KEY: ${appKey ? '已设置' : '未设置'} (来源: ${appKeySource})\n` +
        `LONGPORT_APP_SECRET: ${appSecret ? '已设置' : '未设置'} (来源: ${appSecretSource})\n` +
        `LONGPORT_ACCESS_TOKEN: ${accessToken ? '已设置' : '未设置'} (来源: ${accessTokenSource})`
      );
    }

    // 审计修复: H-3 — 凭证日志脱敏
    console.log(`使用长桥API配置:`);
    console.log(`  APP_KEY: configured: true, source: ${appKeySource}, length: ${appKey.length}`);
    console.log(`  APP_SECRET: configured: true, source: ${appSecretSource}, length: ${appSecret.length}`);
    console.log(`  ACCESS_TOKEN: configured: true, source: ${accessTokenSource}, length: ${accessToken.length}`);
    
    // 打印富途配置（从数据库或硬编码）
    let futunnCsrfToken: string | null = null;
    let futunnCookies: string | null = null;
    if (service) {
      try {
        futunnCsrfToken = await service.getConfig('futunn_csrf_token');
        futunnCookies = await service.getConfig('futunn_cookies');
      } catch (error: any) {
        // 忽略错误，使用硬编码配置
      }
    }
    
    // 如果数据库中没有配置，使用硬编码的游客配置
    let futunnConfig: { csrfToken: string; cookies: string };
    if (futunnCsrfToken && futunnCookies) {
      futunnConfig = { csrfToken: futunnCsrfToken, cookies: futunnCookies };
    } else {
      // 动态导入避免循环依赖
      const futunnModule = await import('./futunn');
      futunnConfig = futunnModule.getFutunnConfig();
    }
    
    const futunnSource = futunnCsrfToken && futunnCookies ? '数据库' : '硬编码（游客配置）';
    console.log(`使用富途牛牛API配置（来源: ${futunnSource}）:`);
    console.log(`  CSRF_TOKEN: configured: true (长度: ${futunnConfig.csrfToken.length})`);
    console.log(`  COOKIES: configured: true (长度: ${futunnConfig.cookies.length})`);

    // 使用手动创建Config的方式，因为需要enablePrintQuotePackages字段
    // 根据测试结果，Config.fromEnv()可能在某些版本有兼容性问题
    const config = new Config({
      appKey: appKey.trim(),
      appSecret: appSecret.trim(),
      accessToken: accessToken.trim(),
      enablePrintQuotePackages: false, // 新版本SDK要求的字段
      // 可选：开启美股夜盘
      enableOvernight: enableOvernight === 'true',
    });

    // 使用官方SDK创建QuoteContext
    try {
      quoteContext = await QuoteContext.new(config);
      quoteContextInitializing = null;
      return quoteContext;
    } catch (error: any) {
      quoteContextInitializing = null;
      // 处理401004错误（token invalid）
      if (error.message && error.message.includes('401004')) {
        throw new Error(
          '长桥API认证失败（401004: token invalid）。\n' +
          '可能的原因：\n' +
          '1. Access Token已过期或无效\n' +
          '2. Access Token与当前App Key不匹配\n' +
          '3. Access Token没有行情权限\n\n' +
          '解决方案：\n' +
          '1. 访问 https://open.longportapp.com/ 登录开发者中心\n' +
          '2. 确认当前使用的App Key是否正确\n' +
          '3. 重新生成Access Token并更新.env文件中的LONGPORT_ACCESS_TOKEN\n' +
          '4. 确保账户已开通行情权限\n\n' +
          `当前配置的App Key: configured: true, length: ${appKey.length}\n` +
          `当前Token长度: ${accessToken.length}字符`
        );
      }
      throw error;
    }
  })();

  return quoteContextInitializing;
}

/**
 * 获取长桥TradeContext实例（单例模式）
 * 用于交易相关操作（下单、撤单、查询订单等）
 */
export async function getTradeContext(): Promise<TradeContextType> {
  // 如果已经初始化，直接返回
  if (tradeContext) {
    return tradeContext;
  }
  
  // 如果正在初始化，等待初始化完成
  if (tradeContextInitializing) {
    return tradeContextInitializing;
  }
  
  // 开始初始化，创建Promise
  tradeContextInitializing = (async () => {
    // 优先从数据库读取配置，如果数据库中没有则使用环境变量
    const service = await getConfigService();
    let appKey: string | null = null;
    let appSecret: string | null = null;
    let accessToken: string | null = null;
    let enableOvernight: string | null = null;

    // 记录从数据库读取的值（用于判断配置来源）
    let dbAppKey: string | null = null;
    let dbAppSecret: string | null = null;
    let dbAccessToken: string | null = null;

    if (service) {
      try {
        dbAppKey = await service.getConfig('longport_app_key');
        dbAppSecret = await service.getConfig('longport_app_secret');
        dbAccessToken = await service.getConfig('longport_access_token');
        enableOvernight = await service.getConfig('longport_enable_overnight');

        appKey = dbAppKey;
        appSecret = dbAppSecret;
        accessToken = dbAccessToken;
      } catch (error: any) {
        console.warn('从数据库读取配置失败，使用环境变量:', error.message);
      }
    }

    // 只有当数据库返回 null/undefined 时才使用环境变量（不使用 || 运算符，避免空字符串被覆盖）
    if (appKey == null) appKey = process.env.LONGPORT_APP_KEY || null;
    if (appSecret == null) appSecret = process.env.LONGPORT_APP_SECRET || null;
    if (accessToken == null) accessToken = process.env.LONGPORT_ACCESS_TOKEN || null;
    if (enableOvernight == null) enableOvernight = process.env.LONGPORT_ENABLE_OVERNIGHT || 'false';

    // 记录配置来源
    const appKeySource = dbAppKey != null ? '数据库' : '环境变量';
    const appSecretSource = dbAppSecret != null ? '数据库' : '环境变量';
    const accessTokenSource = dbAccessToken != null ? '数据库' : '环境变量';

    if (!appKey || !appSecret || !accessToken) {
      tradeContextInitializing = null;
      throw new Error(
        'LongPort credentials not configured. Please set LONGPORT_APP_KEY, LONGPORT_APP_SECRET, and LONGPORT_ACCESS_TOKEN in database or .env file.\n' +
        `LONGPORT_APP_KEY: ${appKey ? '已设置' : '未设置'} (来源: ${appKeySource})\n` +
        `LONGPORT_APP_SECRET: ${appSecret ? '已设置' : '未设置'} (来源: ${appSecretSource})\n` +
        `LONGPORT_ACCESS_TOKEN: ${accessToken ? '已设置' : '未设置'} (来源: ${accessTokenSource})`
      );
    }

    // 检查网络代理配置
    const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
    const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (httpProxy || httpsProxy) {
      console.log('检测到网络代理配置:');
      if (httpProxy) console.log(`  HTTP_PROXY: ${httpProxy}`);
      if (httpsProxy) console.log(`  HTTPS_PROXY: ${httpsProxy}`);
    } else {
      console.log('未检测到网络代理配置（HTTP_PROXY/HTTPS_PROXY）');
    }

    const config = new Config({
      appKey: appKey.trim(),
      appSecret: appSecret.trim(),
      accessToken: accessToken.trim(),
      enablePrintQuotePackages: false,
      enableOvernight: enableOvernight === 'true',
    });

    try {
      console.log('Initializing TradeContext...');
      console.log(`  APP_KEY: configured: true, source: ${appKeySource}, length: ${appKey.length}`);
      console.log(`  APP_SECRET: configured: true, source: ${appSecretSource}, length: ${appSecret.length}`);
      console.log(`  ACCESS_TOKEN: configured: true, source: ${accessTokenSource}, length: ${accessToken.length}`);
      
      // 添加重试机制，最多重试3次
      let lastError: any = null;
      const maxRetries = 3;
      const retryDelay = 2000; // 2秒延迟
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            console.log(`TradeContext初始化重试 (${attempt}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
          
          tradeContext = await TradeContext.new(config);
          console.log('TradeContext initialized successfully');
          tradeContextInitializing = null;
          return tradeContext;
        } catch (error: any) {
          lastError = error;
          // 如果是网络错误，继续重试
          if (error?.message?.includes('error sending request') || 
              error?.message?.includes('socket') ||
              error?.code === 'GenericFailure') {
            if (attempt < maxRetries) {
              console.warn(`TradeContext初始化失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`);
              continue;
            }
          } else {
            // 如果是其他错误（如权限错误），不重试
            throw error;
          }
        }
      }
      
      // 所有重试都失败，抛出最后一个错误
      throw lastError;
    } catch (error: any) {
      tradeContextInitializing = null;
      console.error('Failed to initialize TradeContext:');
      console.error('  Error type:', error?.constructor?.name);
      console.error('  Error message:', error?.message);
      console.error('  Error stack:', error?.stack);
      console.error('  Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      
      // 检查常见的错误原因
      let errorMessage = 'Failed to initialize TradeContext.\n\n';
      
      if (error?.message) {
        errorMessage += `错误信息: ${error.message}\n\n`;
        
        // 检查是否是权限问题
        if (error.message.includes('401') || error.message.includes('403') || error.message.includes('permission')) {
          errorMessage += '可能的原因：\n';
          errorMessage += '1. Access Token没有交易权限\n';
          errorMessage += '2. Access Token已过期或无效\n';
          errorMessage += '3. Access Token与当前App Key不匹配\n\n';
          errorMessage += '解决方案：\n';
          errorMessage += '1. 访问 https://open.longportapp.com/ 登录开发者中心\n';
          errorMessage += '2. 确认当前使用的App Key是否正确\n';
          errorMessage += '3. 重新生成Access Token（确保有交易权限）\n';
          errorMessage += '4. 更新.env文件中的LONGPORT_ACCESS_TOKEN\n';
          errorMessage += '5. 确保账户已开通交易权限（不仅仅是行情权限）\n';
        } else if (error.message.includes('401004')) {
          errorMessage += '错误码401004: Token无效\n';
          errorMessage += '请重新生成Access Token并更新.env文件\n';
        } else if (error.message.includes('401003')) {
          errorMessage += '错误码401003: App Key或App Secret无效\n';
          errorMessage += '请检查.env文件中的LONGPORT_APP_KEY和LONGPORT_APP_SECRET\n';
        } else if (error.message.includes('error sending request') || 
                   error.message.includes('socket') ||
                   error.code === 'GenericFailure') {
          errorMessage += '可能的原因：\n';
          errorMessage += '1. 网络连接问题（请检查网络代理设置）\n';
          errorMessage += '2. 防火墙阻止了WebSocket连接\n';
          errorMessage += '3. 长桥API服务暂时不可用\n';
          errorMessage += '4. SDK版本问题（当前版本: 1.1.7）\n';
          errorMessage += '5. 配置参数错误\n\n';
          errorMessage += '解决方案：\n';
          errorMessage += '1. 检查网络代理设置（HTTP_PROXY/HTTPS_PROXY环境变量）\n';
          errorMessage += '2. 检查防火墙是否允许WebSocket连接\n';
          errorMessage += '3. 尝试ping openapi.longportapp.com 确认网络连通性\n';
          errorMessage += '4. 如果使用代理，确保代理支持WebSocket协议\n';
        } else {
          errorMessage += '可能的原因：\n';
          errorMessage += '1. 网络连接问题\n';
          errorMessage += '2. 长桥API服务暂时不可用\n';
          errorMessage += '3. SDK版本问题\n';
          errorMessage += '4. 配置参数错误\n';
        }
      } else {
        errorMessage += '未知错误，请检查日志获取详细信息\n';
      }
      
      errorMessage += `\n当前配置的App Key: configured: true, length: ${appKey.length}`;
      errorMessage += `\n当前Token长度: ${accessToken.length}字符`;
      
      throw new Error(errorMessage);
    }
  })();

  return tradeContextInitializing;
}

// 导出类型和常量供其他模块使用
// 参考：https://longportapp.github.io/openapi/nodejs/classes/TradeContext.html
export { Decimal, OrderType, OrderSide, OrderStatus, Market, TimeInForceType, OutsideRTH };
