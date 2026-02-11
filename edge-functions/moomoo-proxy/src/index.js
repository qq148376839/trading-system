/**
 * Moomoo API 代理 — 独立 Worker
 *
 * 两种运行模式：
 *   1. 纯转发（后端提供 cookies + quoteToken）：CPU <1ms，99% 流量
 *   2. 完整计算（curl 直接调用，缺少参数）：CPU ~10ms，调试/测试用
 *
 * 从共享 Worker 拆分出来，独享 CPU 配额。
 */

const MOOMOO_BASE_URL = 'https://www.moomoo.com';

// -------------------- KV 缓存配置 --------------------
const COOKIES_KEY = 'latest_moomoo_cookies';
const COOKIES_TTL_SECONDS = 3600;

const FALLBACK_COOKIES =
  'cipher_device_id=1763971814778021; ftreport-jssdk%40new_user=1; futu-csrf=niasJM1N1jtj3pyQh6JO4Nknn7c=; device_id=1763971814778021; csrfToken=f51O2KPxQvir0tU5zDCVQpMm; locale=zh-cn';
const DEFAULT_CSRF_TOKEN = 'f51O2KPxQvir0tU5zDCVQpMm';

// 需要 quote-token 的接口路径
const QUOTE_TOKEN_REQUIRED_PATHS = [
  '/quote-api/quote-v2/get-kline',
  '/quote-api/quote-v2/get-quote-minute',
  '/quote-api/quote-v2/get-stock-quote',
  '/quote-api/quote-v2/get-option-chain',
  '/quote-api/quote-v2/get-option-strike-dates',
  '/quote-api/quote-v2/get-popular-position',
  '/quote-api/quote-v2/get-share-holding-list',
  '/quote-api/quote-v2/get-owner-position-list',
];

// -------------------- quote-token 计算（Web Crypto API） --------------------

async function generateQuoteToken(params) {
  try {
    const dataStr = JSON.stringify(params);
    if (dataStr.length <= 0) return 'quote';

    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(dataStr);
    const keyBytes = encoder.encode('quote_web');

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    );

    const hmacSig = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    const hmacHex = Array.from(new Uint8Array(hmacSig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const firstSlice = hmacHex.substring(0, 10);

    const sha256Hash = await crypto.subtle.digest('SHA-256', encoder.encode(firstSlice));
    const sha256Hex = Array.from(new Uint8Array(sha256Hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return sha256Hex.substring(0, 10);
  } catch (error) {
    console.error('generateQuoteToken failed:', error);
    return 'quote';
  }
}

function requiresQuoteToken(apiPath) {
  return QUOTE_TOKEN_REQUIRED_PATHS.some((p) => apiPath.startsWith(p));
}

function extractTokenParams(queryParams, apiPath) {
  const tokenParams = {};

  if (apiPath.includes('get-kline') || apiPath.includes('get-quote-minute')) {
    const keys = ['stockId', 'marketType', 'type', 'marketCode', 'instrumentType', 'subInstrumentType', '_'];
    for (const key of keys) {
      if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
        tokenParams[key] = String(queryParams[key]);
      }
    }
  } else if (apiPath.includes('get-stock-quote')) {
    const keys = ['stockId', 'marketType', 'marketCode', 'lotSize', 'spreadCode', 'underlyingStockId', 'instrumentType', 'subInstrumentType', '_'];
    for (const key of keys) {
      if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
        tokenParams[key] = String(queryParams[key]);
      }
    }
  } else if (apiPath.includes('get-option-chain')) {
    const keys = ['stockId', 'strikeDate', 'expiration', '_'];
    for (const key of keys) {
      if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
        tokenParams[key] = String(queryParams[key]);
      }
    }
  } else if (apiPath.includes('get-option-strike-dates')) {
    const keys = ['stockId', '_'];
    for (const key of keys) {
      if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
        tokenParams[key] = String(queryParams[key]);
      }
    }
  } else if (apiPath.includes('get-popular-position')) {
    // 空对象
  } else if (apiPath.includes('get-share-holding-list')) {
    const keys = ['ownerObjectId', 'periodId', 'page', 'pageSize', '_'];
    for (const key of keys) {
      if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
        tokenParams[key] = String(queryParams[key]);
      }
    }
  } else if (apiPath.includes('get-owner-position-list')) {
    const keys = ['page', 'pageSize', '_'];
    for (const key of keys) {
      if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
        tokenParams[key] = String(queryParams[key]);
      }
    }
    if (Object.keys(tokenParams).length === 0) {
      tokenParams['_'] = '';
    }
  }

  return tokenParams;
}

// -------------------- 动态 Cookies --------------------

async function getLatestVisitorCookies() {
  try {
    const response = await fetch(MOOMOO_BASE_URL + '/', {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error('[Cookies] non-200:', response.status);
      return null;
    }

    const setCookieHeader = response.headers.get('Set-Cookie');
    if (setCookieHeader) {
      return setCookieHeader;
    }
    console.warn('[Cookies] No Set-Cookie header in response');
    return null;
  } catch (error) {
    console.error('[Cookies] fetch failed:', error);
    return null;
  }
}

async function getOrUpdateCookies(env) {
  const cached = await env.MOOMOO_CACHE.get(COOKIES_KEY);
  if (cached) return cached;

  console.log('[Cookies] Cache miss, refreshing...');
  const newCookies = await getLatestVisitorCookies();
  if (newCookies) {
    await env.MOOMOO_CACHE.put(COOKIES_KEY, newCookies, { expirationTtl: COOKIES_TTL_SECONDS });
    return newCookies;
  }
  console.warn('[Cookies] Fallback to hardcoded cookies');
  return FALLBACK_COOKIES;
}

// -------------------- CORS --------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, futu-x-csrf-token, quote-token',
};

// -------------------- 请求处理 --------------------

async function handleGet(queryParams, request, env) {
  const apiPath = queryParams.path || queryParams.api_path;
  if (!apiPath) {
    return Response.json(
      {
        error: 'Missing required parameter: path or api_path',
        usage: {
          kline:
            '/api/moomooapi?path=/quote-api/quote-v2/get-kline&stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001',
        },
      },
      { status: 400 },
    );
  }

  const targetUrl = `${MOOMOO_BASE_URL}${apiPath}`;

  // 准备请求参数（排除控制参数）
  const requestParams = { ...queryParams };
  delete requestParams.path;
  delete requestParams.api_path;
  delete requestParams.cookies;
  delete requestParams.csrf_token;
  delete requestParams.csrfToken;
  delete requestParams.quote_token;
  delete requestParams.quoteToken;
  delete requestParams.referer;

  if (apiPath.includes('get-owner-position-list') && Object.keys(requestParams).length === 0) {
    requestParams['_'] = '';
  }

  // 自动补 _ 时间戳（kline/quote 等接口需要）
  if (!requestParams['_'] && requiresQuoteToken(apiPath)) {
    requestParams['_'] = String(Date.now());
  }

  const queryString = Object.entries(requestParams)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  const fullUrl = queryString ? `${targetUrl}?${queryString}` : targetUrl;

  // ---- Cookies：后端提供则跳过 homepage fetch ----
  let cookies;
  if (queryParams.cookies) {
    cookies = queryParams.cookies;
  } else {
    cookies = env && env.MOOMOO_CACHE ? await getOrUpdateCookies(env) : FALLBACK_COOKIES;
  }

  const csrfToken = queryParams.csrf_token || queryParams.csrfToken || DEFAULT_CSRF_TOKEN;

  // ---- quoteToken：后端提供则跳过计算 ----
  let quoteToken = queryParams.quoteToken || queryParams.quote_token;
  if (!quoteToken && requiresQuoteToken(apiPath)) {
    // 从 requestParams 提取（已补 _ 时间戳），确保 token 与实际请求参数一致
    const tokenParams = extractTokenParams(requestParams, apiPath);
    quoteToken = await generateQuoteToken(tokenParams);
    console.log(`[Worker] Computed quoteToken: ${quoteToken} for ${apiPath} params=${JSON.stringify(tokenParams)}`);
  }

  // 构建 headers
  const headers = {
    authority: 'www.moomoo.com',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    priority: 'u=1, i',
    referer: queryParams.referer || 'https://www.moomoo.com/',
    'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    Cookie: cookies,
    'futu-x-csrf-token': csrfToken,
  };

  if (quoteToken) {
    headers['quote-token'] = quoteToken;
  }

  // 转发 Authorization（如果有）
  if (request && request.headers) {
    const auth = request.headers.get('Authorization');
    if (auth) headers['Authorization'] = auth;
  }

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Worker] Moomoo ${response.status} for ${apiPath}`);
      return Response.json(
        {
          success: false,
          error: `Moomoo API returned ${response.status} ${response.statusText}`,
          status: response.status,
          details: errorText.substring(0, 500),
        },
        { status: response.status, headers: CORS_HEADERS },
      );
    }

    const contentType = response.headers.get('content-type');
    let responseData;
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    // 记录业务错误
    if (
      responseData &&
      typeof responseData === 'object' &&
      responseData.code !== undefined &&
      responseData.code !== 0
    ) {
      console.error(`[Worker] Business error code=${responseData.code}: ${responseData.message || ''} path=${apiPath}`);
    }

    return Response.json(
      { success: true, status: response.status, data: responseData },
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return Response.json(
        { error: 'Request timeout', message: 'Moomoo API timed out after 25s', type: 'timeout' },
        { status: 504, headers: CORS_HEADERS },
      );
    }
    if (error.message && error.message.includes('fetch')) {
      return Response.json(
        { error: 'Network error', message: 'Failed to connect to Moomoo API', details: error.message },
        { status: 502, headers: CORS_HEADERS },
      );
    }
    return Response.json(
      { error: 'Internal server error', message: error.message || 'Unknown error', type: error.name || 'Error' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

async function handlePost(request, env) {
  try {
    const body = await request.json();
    const {
      path,
      api_path,
      cookies,
      csrf_token,
      csrfToken,
      quote_token,
      quoteToken,
      referer,
      ...otherParams
    } = body;

    const apiPath = path || api_path;
    if (!apiPath) {
      return Response.json({ error: 'Missing required parameter: path' }, { status: 400, headers: CORS_HEADERS });
    }

    const targetUrl = `${MOOMOO_BASE_URL}${apiPath}`;

    let finalCookies;
    if (cookies) {
      finalCookies = cookies;
    } else {
      finalCookies = env && env.MOOMOO_CACHE ? await getOrUpdateCookies(env) : FALLBACK_COOKIES;
    }

    const headers = {
      authority: 'www.moomoo.com',
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
      'content-type': 'application/json',
      referer: referer || 'https://www.moomoo.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Cookie: finalCookies,
    };

    if (csrf_token || csrfToken) headers['futu-x-csrf-token'] = csrf_token || csrfToken;
    if (quote_token || quoteToken) headers['quote-token'] = quote_token || quoteToken;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(otherParams),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json(
        { error: `Moomoo API returned ${response.status}`, details: errorText.substring(0, 500) },
        { status: response.status, headers: CORS_HEADERS },
      );
    }

    const responseData = await response.json();
    return Response.json({ success: true, data: responseData }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json(
      { error: 'Internal server error', message: error.message },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

// -------------------- Worker 入口 --------------------

export default {
  async fetch(request, env, ctx) {
    // OPTIONS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
      });
    }

    const url = new URL(request.url);
    const queryParams = Object.fromEntries(url.searchParams);

    if (url.pathname.startsWith('/api/moomooapi')) {
      if (request.method === 'GET') {
        return handleGet(queryParams, request, env);
      }
      if (request.method === 'POST') {
        return handlePost(request, env);
      }
    }

    return new Response('Moomoo API Proxy Worker is running. Use /api/moomooapi route.', {
      status: 200,
      headers: CORS_HEADERS,
    });
  },
};
