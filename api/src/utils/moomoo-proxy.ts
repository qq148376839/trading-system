/**
 * Moomoo API 边缘函数代理工具
 * 用于解决大陆IP无法直接访问Moomoo API的问题
 *
 * 配置优先级：DB (system_config) → 环境变量 → 硬编码默认值
 */

import axios from 'axios';
import { logger } from './logger';
import { getEffectiveConfigs } from '../config/futunn';

// ── DB 缓存（与 futunn.ts 同模式：异步加载，同步消费） ─────
const DEFAULT_EDGE_URL = 'https://moomoo-api.riowang.win';
const DEFAULT_VERCEL_URL = 'https://vercel-moomoo.riowang.win';

let _edgeFunctionUrl: string = process.env.MOOMOO_EDGE_FUNCTION_URL || DEFAULT_EDGE_URL;
let _vercelProxyUrl: string = process.env.MOOMOO_VERCEL_PROXY_URL || DEFAULT_VERCEL_URL;
let _useEdgeFunction: boolean = process.env.USE_MOOMOO_EDGE_FUNCTION !== 'false';
let _proxyConfigLastRefresh = 0;
const PROXY_CONFIG_TTL = 5 * 60 * 1000; // 5 min

async function refreshProxyConfig(): Promise<void> {
  try {
    const configService = (await import('../services/config.service')).default;
    const [urlVal, enabledVal] = await Promise.all([
      configService.getConfig('moomoo_edge_function_url'),
      configService.getConfig('use_moomoo_edge_function'),
    ]);

    if (urlVal && urlVal.trim() !== '') {
      _edgeFunctionUrl = urlVal.trim();
    }
    const vercelUrlVal = await configService.getConfig('moomoo_vercel_proxy_url');
    if (vercelUrlVal && vercelUrlVal.trim() !== '') {
      _vercelProxyUrl = vercelUrlVal.trim();
    }
    if (enabledVal !== null) {
      _useEdgeFunction = enabledVal !== 'false';
    }
    _proxyConfigLastRefresh = Date.now();
  } catch {
    // 保留当前值，不中断
  }
}

async function ensureProxyConfig(): Promise<void> {
  if (Date.now() - _proxyConfigLastRefresh > PROXY_CONFIG_TTL) {
    await refreshProxyConfig();
  }
}

// ── 内部：调用边缘函数（Vercel / CF 通用） ───────────────────

async function callEdgeFunction(
  baseUrl: string,
  proxyParams: Record<string, any>,
  path: string,
  timeout: number,
): Promise<unknown> {
  if (process.env.NODE_ENV === 'development') {
    logger.debug(`[Moomoo代理] 请求参数:`, {
      baseUrl,
      path,
      params: Object.keys(proxyParams),
      cookieIndex: proxyParams.cookie_index,
      hasCsrfToken: !!proxyParams.csrf_token,
      hasQuoteToken: !!proxyParams.quoteToken,
    });
  }

  const response = await axios.get(`${baseUrl}/api/moomooapi`, {
    params: proxyParams,
    timeout,
    maxRedirects: 5,
    validateStatus: (status: number) => status < 500,
  });

  if (process.env.NODE_ENV === 'development') {
    logger.debug(`[Moomoo代理] 响应结构:`, {
      hasData: !!response.data,
      dataType: typeof response.data,
      hasSuccess: response.data?.success !== undefined,
      hasCode: response.data?.code !== undefined,
      hasDataData: !!response.data?.data,
    });
  }

  // 检查 HTTP 状态码（403 = Moomoo 限频）
  if (response.status === 403) {
    throw new Error(`Moomoo API 403 限频: ${path} (cookie 可能已过期或请求过于频繁)`);
  }

  // 检查响应是否为 HTML（非 JSON）— Moomoo 403/5xx 错误页面
  const rawData = response.data;
  if (typeof rawData === 'string') {
    if (rawData.includes('<!DOCTYPE') || rawData.includes('<html') || rawData.includes('Operations too frequent')) {
      throw new Error(`Moomoo API 返回 HTML 错误页面: ${path} (可能是 403 限频或 cookie 过期)`);
    }
    throw new Error(`Moomoo API 返回非 JSON 响应: ${path} (类型: string, 长度: ${rawData.length})`);
  }

  // 检查响应格式
  if (rawData && typeof rawData === 'object') {
    if (rawData.success === true) {
      const moomooResponse = rawData.data;

      // 检查 edge function 包装的 data 是否为 HTML 字符串（Moomoo 403 穿透）
      if (typeof moomooResponse === 'string') {
        if (moomooResponse.includes('<!DOCTYPE') || moomooResponse.includes('Operations too frequent')) {
          throw new Error(`Moomoo API 403 限频（穿透 edge function）: ${path}`);
        }
        throw new Error(`Moomoo API 返回非 JSON data: ${path} (类型: string, 长度: ${moomooResponse.length})`);
      }

      if (process.env.NODE_ENV === 'development') {
        logger.debug(`[Moomoo代理] Moomoo API响应:`, {
          hasCode: moomooResponse?.code !== undefined,
          code: moomooResponse?.code,
          message: moomooResponse?.message,
        });
      }

      if (moomooResponse && typeof moomooResponse === 'object' && 'code' in moomooResponse) {
        if (moomooResponse.code !== 0) {
          const errorMsg = moomooResponse.message || `Moomoo API error: code=${moomooResponse.code}`;
          logger.error(`[Moomoo代理] Moomoo API返回错误:`, {
            code: moomooResponse.code,
            message: errorMsg,
            path,
            fullResponse: JSON.stringify(moomooResponse).substring(0, 1000),
          });
          throw new Error(errorMsg);
        }
      }

      return moomooResponse;
    } else if (rawData.success === false) {
      const errorMsg = rawData.error || rawData.message || 'Edge function request failed';
      const details = rawData.details ? `: ${rawData.details}` : '';
      throw new Error(`${errorMsg}${details}`);
    } else if (rawData.code !== undefined) {
      if (rawData.code === 0) {
        return rawData;
      } else {
        throw new Error(rawData.message || `Moomoo API error: code=${rawData.code}`);
      }
    } else {
      return rawData;
    }
  } else {
    throw new Error(`Moomoo API 响应格式异常: ${path} (类型: ${typeof rawData})`);
  }
}

// ── 公共接口 ──────────────────────────────────────────────────

export interface MoomooProxyOptions {
  path: string;
  params?: Record<string, any>;
  cookies?: string;
  csrfToken?: string;
  quoteToken?: string;
  referer?: string;
  timeout?: number;
}

/**
 * Moomoo API代理函数
 * 三级 fallback：Vercel Edge → CF Worker → 直连 moomoo.com
 */
export async function moomooProxy(options: MoomooProxyOptions): Promise<any> {
  // 确保已从 DB 加载最新配置
  await ensureProxyConfig();

  const {
    path,
    params = {},
    cookies,
    csrfToken,
    quoteToken,
    referer = 'https://www.moomoo.com/',
    timeout = 15000,
  } = options;

  if (_useEdgeFunction) {
    // 构建边缘函数代理参数
    // 不传完整 cookies 字符串（~2000 bytes 会导致 Cloudflare 530 error 1016）
    // 改为传 cookie_index：边缘函数根据索引使用本地存储的对应 cookies
    // 同时传 quoteToken 和 csrf_token，节省边缘函数 CPU 计算
    const proxyParams: Record<string, any> = {
      path,
      ...params,
      referer,
    };

    // 通过 csrfToken 匹配确定 cookie_index
    if (csrfToken) {
      const configs = getEffectiveConfigs();
      const idx = configs.findIndex((c) => c.csrfToken === csrfToken);
      if (idx >= 0) {
        // 已知的硬编码 cookie → 只传索引
        proxyParams.cookie_index = idx;
      }
      // 未匹配到：不传 cookies 也不传 cookie_index，边缘函数用自己的默认 cookies
      proxyParams.csrf_token = csrfToken;
    }
    if (quoteToken) {
      proxyParams.quoteToken = quoteToken;
    }

    // 1) 先尝试 Vercel Edge Function（主代理）
    if (_vercelProxyUrl) {
      try {
        return await callEdgeFunction(_vercelProxyUrl, proxyParams, path, timeout);
      } catch (vercelError: unknown) {
        const vercelMsg = vercelError instanceof Error ? vercelError.message : String(vercelError);
        logger.warn(`[Moomoo代理] Vercel 代理失败: ${vercelMsg}，降级到 CF Worker`);
      }
    }

    // 2) 再尝试 CF Worker（备选代理）
    try {
      return await callEdgeFunction(_edgeFunctionUrl, proxyParams, path, timeout);
    } catch (cfError: unknown) {
      const cfMsg = cfError instanceof Error ? cfError.message : String(cfError);
      logger.warn(`[Moomoo代理] CF Worker 也失败: ${cfMsg}，降级到直连`);
    }
  }

  {
    // 3) 直连 moomoo.com（兜底）
    const headers: Record<string, string> = {
      'authority': 'www.moomoo.com',
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'referer': referer,
      'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    };

    if (cookies) headers['Cookie'] = cookies;
    if (csrfToken) headers['futu-x-csrf-token'] = csrfToken;
    if (quoteToken) headers['quote-token'] = quoteToken;

    try {
      const response = await axios.get(`https://www.moomoo.com${path}`, {
        params,
        headers,
        timeout,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
      });

      return response.data;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[Moomoo代理] 直接访问失败: ${path} - ${msg}`);
      throw error;
    }
  }
}

/**
 * 获取代理模式信息（用于日志）
 */
export async function getProxyMode(): Promise<string> {
  await ensureProxyConfig();
  if (!_useEdgeFunction) {
    return '直接访问 (www.moomoo.com)';
  }
  const parts: string[] = [];
  if (_vercelProxyUrl) {
    parts.push(`Vercel (${_vercelProxyUrl})`);
  }
  parts.push(`CF (${_edgeFunctionUrl})`);
  parts.push('直连 (www.moomoo.com)');
  return parts.join(' → ');
}
