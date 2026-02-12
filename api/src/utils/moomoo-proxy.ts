/**
 * Moomoo API 边缘函数代理工具
 * 用于解决大陆IP无法直接访问Moomoo API的问题
 *
 * 配置优先级：DB (system_config) → 环境变量 → 硬编码默认值
 */

import axios from 'axios';
import { logger } from './logger';

// ── DB 缓存（与 futunn.ts 同模式：异步加载，同步消费） ─────
const DEFAULT_EDGE_URL = 'https://moomoo-api.riowang.win';

let _edgeFunctionUrl: string = process.env.MOOMOO_EDGE_FUNCTION_URL || DEFAULT_EDGE_URL;
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
 * 根据配置自动选择使用边缘函数或直接访问
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
    // 使用边缘函数代理
    // 注意：不传 cookies / csrf_token / quoteToken 给边缘函数
    // 边缘函数内置了游客 cookies 和 quote-token 生成逻辑
    // 超长 cookies 作为 URL query param 会导致 Cloudflare 530 (error 1016) 拒绝请求
    const proxyParams: Record<string, any> = {
      path,
      ...params,
      referer,
    };

    try {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(`[Moomoo代理] 请求参数:`, {
          path,
          params: Object.keys(proxyParams),
          hasCookies: !!proxyParams.cookies,
          hasCsrfToken: !!proxyParams.csrf_token,
        });
      }

      const response = await axios.get(`${_edgeFunctionUrl}/api/moomooapi`, {
        params: proxyParams,
        timeout,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
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
        // 其他非 JSON 字符串也不是有效响应
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
    } catch (error: unknown) {
      const err = error as any;
      if (err.response) {
        logger.error(`[Moomoo代理] 边缘函数请求失败: ${path}`);
        logger.error(`[Moomoo代理] 状态码: ${err.response.status}`);
        logger.error(`[Moomoo代理] 响应数据: ${JSON.stringify(err.response.data).substring(0, 500)}`);
      } else {
        logger.error(`[Moomoo代理] 边缘函数请求失败: ${path} - ${err.message}`);
      }
      throw error;
    }
  } else {
    // 直接访问Moomoo API
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
  return _useEdgeFunction
    ? `边缘函数 (${_edgeFunctionUrl})`
    : '直接访问 (www.moomoo.com)';
}
