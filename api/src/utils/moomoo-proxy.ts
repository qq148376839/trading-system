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
      // 调试日志：打印请求参数
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Moomoo代理] 请求参数:`, {
          path,
          params: Object.keys(proxyParams),
          hasCookies: !!proxyParams.cookies,
          hasCsrfToken: !!proxyParams.csrf_token,
        });
      }

      const response = await axios.get(`${EDGE_FUNCTION_URL}/api/moomooapi`, {
        params: proxyParams,
        timeout,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
      });

      // 调试日志：打印响应结构
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Moomoo代理] 响应结构:`, {
          hasData: !!response.data,
          dataType: typeof response.data,
          hasSuccess: response.data?.success !== undefined,
          hasCode: response.data?.code !== undefined,
          hasDataData: !!response.data?.data,
        });
      }

      // 检查响应格式
      if (response.data && typeof response.data === 'object') {
        // 如果响应包含success字段（边缘函数格式）
        if (response.data.success === true) {
          // 边缘函数成功，返回Moomoo API的原始响应（在data字段中）
          const moomooResponse = response.data.data;
          
          // 调试日志
          if (process.env.NODE_ENV === 'development') {
            console.log(`[Moomoo代理] Moomoo API响应:`, {
              hasCode: moomooResponse?.code !== undefined,
              code: moomooResponse?.code,
              message: moomooResponse?.message,
            });
          }
          
          // 如果Moomoo API响应包含code字段，检查是否成功
          if (moomooResponse && typeof moomooResponse === 'object' && 'code' in moomooResponse) {
            if (moomooResponse.code !== 0) {
              const errorMsg = moomooResponse.message || `Moomoo API error: code=${moomooResponse.code}`;
              console.error(`[Moomoo代理] Moomoo API返回错误:`, {
                code: moomooResponse.code,
                message: errorMsg,
                path,
                fullResponse: JSON.stringify(moomooResponse).substring(0, 1000),
              });
              throw new Error(errorMsg);
            }
          }
          
          return moomooResponse;
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
      // 详细错误日志
      if (error.response) {
        console.error(`[Moomoo代理] 边缘函数请求失败: ${path}`);
        console.error(`[Moomoo代理] 状态码: ${error.response.status}`);
        console.error(`[Moomoo代理] 响应数据: ${JSON.stringify(error.response.data).substring(0, 500)}`);
      } else {
        console.error(`[Moomoo代理] 边缘函数请求失败: ${path} - ${error.message}`);
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
    } catch (error: any) {
      // 简化错误日志
      console.error(`[Moomoo代理] 直接访问失败: ${path} - ${error.message}`);
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

