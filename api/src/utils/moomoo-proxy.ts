/**
 * Moomoo API 边缘函数代理工具
 * 用于解决大陆IP无法直接访问Moomoo API的问题
 */

import axios from 'axios';

const EDGE_FUNCTION_URL = process.env.MOOMOO_EDGE_FUNCTION_URL || 'https://cfapi.riowang.win';
const USE_EDGE_FUNCTION = process.env.USE_MOOMOO_EDGE_FUNCTION !== 'false'; // 默认启用

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
  const {
    path,
    params = {},
    cookies,
    csrfToken,
    quoteToken,
    referer = 'https://www.moomoo.com/',
    timeout = 15000,
  } = options;

  if (USE_EDGE_FUNCTION) {
    // 使用边缘函数代理
    // 边缘函数会自动计算quote-token，所以不需要传递quoteToken参数
    // 边缘函数也有默认的cookies和CSRF token，但优先使用传递的值
    const proxyParams: Record<string, any> = {
      path,
      ...params,
      referer,
    };

    // 添加认证信息（如果提供，优先使用；否则边缘函数会使用默认值）
    if (cookies) {
      proxyParams.cookies = cookies;
    }
    if (csrfToken) {
      proxyParams.csrf_token = csrfToken;
    }
    // 注意：quoteToken由边缘函数自动计算，不需要传递

    try {
      const response = await axios.get(`${EDGE_FUNCTION_URL}/api/moomooapi`, {
        params: proxyParams,
        timeout,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
      });

      // 检查响应格式
      if (response.data && typeof response.data === 'object') {
        // 如果响应包含success字段
        if (response.data.success === true) {
          return response.data.data;
        } else if (response.data.success === false) {
          // 边缘函数返回的错误
          const errorMsg = response.data.error || response.data.message || 'Edge function request failed';
          const details = response.data.details ? `: ${response.data.details}` : '';
          throw new Error(`${errorMsg}${details}`);
        } else if (response.data.code !== undefined) {
          // 直接返回Moomoo API的响应（可能是错误）
          if (response.data.code === 0) {
            return response.data;
          } else {
            throw new Error(response.data.message || `Moomoo API error: code=${response.data.code}`);
          }
        } else {
          // 没有success字段，可能是直接返回的数据
          return response.data;
        }
      } else {
        // 非对象响应，直接返回
        return response.data;
      }
    } catch (error: any) {
      console.error('[Moomoo代理] 边缘函数请求失败:', {
        path,
        params: proxyParams,
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
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
    } catch (error: any) {
      console.error('[Moomoo代理] 直接访问失败:', {
        path,
        error: error.message,
        response: error.response?.data,
      });
      throw error;
    }
  }
}

/**
 * 获取代理模式信息（用于日志）
 */
export function getProxyMode(): string {
  return USE_EDGE_FUNCTION 
    ? `边缘函数 (${EDGE_FUNCTION_URL})` 
    : '直接访问 (www.moomoo.com)';
}

