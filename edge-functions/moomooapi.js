/**
 * Moomoo API 代理服务 - 动态 Cookies 版本
 * 用于解决大陆IP无法直接访问Moomoo API的问题
 * 
 * 依赖：需要绑定一个名为 MOOMOO_CACHE 的 KV Namespace
 * 
 * 支持的接口：
 * - /api/headfoot-search - 搜索接口
 * - /quote-api/quote-v2/get-kline - K线数据
 * - /quote-api/quote-v2/get-quote-minute - 分时数据
 * - /quote-api/quote-v2/get-stock-quote - 股票行情
 * - /quote-api/quote-v2/get-option-chain - 期权链
 * - /quote-api/quote-v2/get-option-strike-dates - 期权到期日期
 * - /quote-api/quote-v2/get-popular-position - 热门机构列表
 * - /quote-api/quote-v2/get-share-holding-list - 机构持仓列表
 */

const MOOMOO_BASE_URL = 'https://www.moomoo.com';

// -------------------- KV 缓存配置 --------------------
const COOKIES_KEY = 'latest_moomoo_cookies';
const COOKIES_TTL_SECONDS = 3600; // Cookies有效期设置为 1 小时

// 备用硬编码值（如果动态获取失败，使用此值作为回退）
const FALLBACK_COOKIES = 'cipher_device_id=1763971814778021; ftreport-jssdk%40new_user=1; futu-csrf=niasJM1N1jtj3pyQh6JO4Nknn7c=; device_id=1763971814778021; csrfToken=f51O2KPxQvir0tU5zDCVQpMm; locale=zh-cn';
const DEFAULT_CSRF_TOKEN = 'f51O2KPxQvir0tU5zDCVQpMm';

// 需要quote-token的接口路径
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

/**
 * 生成quote-token（使用Web Crypto API，兼容Cloudflare Workers）
 * 
 * @param {Object} params - 请求参数（所有值必须是字符串类型）
 * @returns {Promise<string>} quote-token
 */
async function generateQuoteToken(params) {
    try {
        // 重要：参数值必须是字符串类型
        const dataStr = JSON.stringify(params);
        
        if (dataStr.length <= 0) {
            return 'quote';
        }
        
        // 将字符串转换为Uint8Array
        const encoder = new TextEncoder();
        const dataBytes = encoder.encode(dataStr);
        const keyBytes = encoder.encode('quote_web');
        
        // HMAC-SHA512加密
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'HMAC', hash: 'SHA-512' },
            false,
            ['sign']
        );
        
        const hmacSignature = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
        const hmacArray = Array.from(new Uint8Array(hmacSignature));
        const hmacHex = hmacArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        // 取前10位
        const firstSlice = hmacHex.substring(0, 10);
        
        // SHA256哈希
        const sha256Bytes = encoder.encode(firstSlice);
        const sha256Hash = await crypto.subtle.digest('SHA-256', sha256Bytes);
        const sha256Array = Array.from(new Uint8Array(sha256Hash));
        const sha256Hex = sha256Array.map(b => b.toString(16).padStart(2, '0')).join('');
        
        // 取前10位作为token
        return sha256Hex.substring(0, 10);
    } catch (error) {
        console.error('生成quote-token失败:', error);
        // 如果生成失败，返回默认值
        return 'quote';
    }
}

/**
 * 检查接口是否需要quote-token
 */
function requiresQuoteToken(apiPath) {
    return QUOTE_TOKEN_REQUIRED_PATHS.some(path => apiPath.startsWith(path));
}

/**
 * 从参数中提取用于计算quote-token的参数
 * 注意：参数顺序很重要，必须与后端代码保持一致
 * 
 * 后端代码中的参数顺序（market-data.service.ts）：
 * stockId, marketType, type, marketCode, instrumentType, subInstrumentType, _
 */
function extractTokenParams(queryParams, apiPath) {
    const tokenParams = {};
    
    // 根据不同的接口提取不同的参数（保持与后端代码一致的顺序）
    if (apiPath.includes('get-kline') || apiPath.includes('get-quote-minute')) {
        // K线和分时数据：stockId, marketType, type, marketCode, instrumentType, subInstrumentType, _
        // 注意：顺序必须与后端代码一致
        const keys = ['stockId', 'marketType', 'type', 'marketCode', 'instrumentType', 'subInstrumentType', '_'];
        for (const key of keys) {
            if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
                tokenParams[key] = String(queryParams[key]);
            }
        }
    } else if (apiPath.includes('get-stock-quote')) {
        // 股票/期权行情：stockId, marketType, marketCode, [lotSize], spreadCode, underlyingStockId, instrumentType, subInstrumentType, _
        // 注意：
        // - lotSize 是可选参数（股票有，期权可能没有）
        // - 只添加实际存在的参数，自动处理可选参数
        // - 期权示例：stockId=501941252&marketType=2&marketCode=41&spreadCode=81&underlyingStockId=201335&instrumentType=8&subInstrumentType=8002
        const keys = ['stockId', 'marketType', 'marketCode', 'lotSize', 'spreadCode', 'underlyingStockId', 'instrumentType', 'subInstrumentType', '_'];
        for (const key of keys) {
            if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
                tokenParams[key] = String(queryParams[key]);
            }
        }
    } else if (apiPath.includes('get-option-chain')) {
        // 期权链：stockId, strikeDate, expiration, _
        const keys = ['stockId', 'strikeDate', 'expiration', '_'];
        for (const key of keys) {
            if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
                tokenParams[key] = String(queryParams[key]);
            }
        }
    } else if (apiPath.includes('get-option-strike-dates')) {
        // 期权到期日期：stockId, _
        const keys = ['stockId', '_'];
        for (const key of keys) {
            if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
                tokenParams[key] = String(queryParams[key]);
            }
        }
    } else if (apiPath.includes('get-popular-position')) {
        // 热门机构列表：根据浏览器请求，这个API不需要任何查询参数
        // 但需要quote-token，使用空对象来计算token
        // 注意：不设置任何参数，返回空对象 {}
    } else if (apiPath.includes('get-share-holding-list')) {
        // 机构持仓列表：ownerObjectId, periodId, page, pageSize, _
        const keys = ['ownerObjectId', 'periodId', 'page', 'pageSize', '_'];
        for (const key of keys) {
            if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
                tokenParams[key] = String(queryParams[key]);
            }
        }
    } else if (apiPath.includes('get-owner-position-list')) {
        // 机构列表：page, pageSize, _
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

// -------------------- 核心函数：动态获取 Cookies --------------------

/**
 * 访问 Moomoo 主页并提取最新的 Set-Cookie 头部
 * @returns {Promise<string|null>} 原始 Set-Cookie 字符串，或 null
 */
async function getLatestVisitorCookies() {
    const targetUrl = MOOMOO_BASE_URL + '/'; // 访问主页
    
    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                // 模拟一个真实的浏览器请求
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            },
            signal: AbortSignal.timeout(10000), // 10秒超时
        });
        
        if (!response.ok) {
            console.error('[Cookies更新] 目标网站返回非 200 状态:', response.status);
            return null;
        }
        
        // 提取 Set-Cookie 头部（可能包含多个 Cookies，用逗号分隔）
        const setCookieHeader = response.headers.get('Set-Cookie');
        
        if (setCookieHeader) {
            console.log(`[Cookies更新] 成功获取最新 Cookies。长度: ${setCookieHeader.length}`);
            // 清理 Cookies 字符串，移除 Path, Expires 等属性，只保留 key=value 对
            const cleanedCookies = setCookieHeader.split(', ').map(cookiePart => {
                return cookiePart.split(';')[0]; // 取第一个分号前的部分（即 key=value）
            }).join('; ');
            
            // 注意：这里返回原始的 Set-Cookie 字符串，可能包含多个 Cookies
            // 您也可以选择返回清理后的 key=value 格式，以确保请求头简洁
            // 我们返回原始头部，让 KV 存储包含所有 Set-Cookie 信息
            return setCookieHeader;
        } else {
            console.warn('[Cookies更新] 响应中未找到 Set-Cookie 头部');
            return null;
        }
    } catch (error) {
        console.error('[Cookies更新] 获取 Cookies 失败:', error);
        return null;
    }
}

/**
 * 从 KV 获取 Cookies，如果过期则自动更新
 * @param {object} env - Cloudflare Worker 环境变量 (包含 MOOMOO_CACHE)
 * @returns {Promise<string>} 有效的 Cookies 字符串
 */
async function getOrUpdateCookies(env) {
    // 1. 尝试从 KV 读取缓存的 Cookies。KV 会根据 TTL 自动处理过期
    const cachedCookies = await env.MOOMOO_CACHE.get(COOKIES_KEY);
    if (cachedCookies) {
        // 缓存命中，直接返回
        return cachedCookies;
    }
    
    // 2. 缓存过期或不存在，获取新的 Cookies
    console.log('[Cookies更新] 缓存过期，正在获取新的 Cookies...');
    const newCookies = await getLatestVisitorCookies();
    if (newCookies) {
        // 3. 将新获取的 Cookies 写入 KV，并设置过期时间（TTL）
        // 注意：这里使用 PUT 写入操作
        await env.MOOMOO_CACHE.put(COOKIES_KEY, newCookies, {
            expirationTtl: COOKIES_TTL_SECONDS
        });
        console.log('[Cookies更新] 新 Cookies 已存入 KV。');
        return newCookies;
    }
    
    // 4. 如果动态获取失败，回退到硬编码默认值
    console.warn('[Cookies更新] 动态获取失败，使用 FALLBACK_COOKIES。');
    return FALLBACK_COOKIES;
}

/**
 * 处理Moomoo API代理请求
 * 
 * @param {Object} queryParams - 查询参数
 * @param {Request} request - 原始请求对象（用于获取headers）
 * @param {object} env - Cloudflare Worker 环境变量
 * @returns {Promise<Response>}
 */
export async function moomooApi(queryParams = {}, request = null, env = null) {
    try {
        // 从查询参数中获取目标API路径
        const apiPath = queryParams.path || queryParams.api_path;
        
        if (!apiPath) {
            return Response.json(
                { 
                    error: 'Missing required parameter: path or api_path',
                    usage: {
                        'search': '/api/moomooapi?path=/api/headfoot-search&keyword=tsla&lang=zh-cn&site=sg',
                        'kline': '/api/moomooapi?path=/quote-api/quote-v2/get-kline&stockId=200003&marketType=2&type=2&marketCode=24&instrumentType=6&subInstrumentType=6001',
                        'quote': '/api/moomooapi?path=/quote-api/quote-v2/get-stock-quote&stockId=201335&marketType=2&marketCode=11',
                    }
                },
                { status: 400 }
            );
        }

        // 构建目标URL
        const targetUrl = `${MOOMOO_BASE_URL}${apiPath}`;

        // 准备请求参数（排除path、api_path、cookies、csrf_token等控制参数）
        const requestParams = { ...queryParams };
        delete requestParams.path;
        delete requestParams.api_path;
        delete requestParams.cookies;
        delete requestParams.csrf_token;
        delete requestParams.csrfToken;
        delete requestParams.quote_token;
        delete requestParams.quoteToken;
        delete requestParams.referer;
        
        // 对于某些API，如果没有参数，需要添加 _ 参数以避免参数验证错误
        // 注意：get-popular-position 不需要添加 _ 参数（官网请求没有参数）
        // 只有 get-owner-position-list 需要添加 _ 参数
        if (apiPath.includes('get-owner-position-list') && Object.keys(requestParams).length === 0) {
            requestParams['_'] = '';
        }

        // 构建查询字符串（确保数字参数正确转换）
        const queryString = Object.entries(requestParams)
            .filter(([key, value]) => value !== null && value !== undefined && value !== '')
            .map(([key, value]) => {
                // 确保值是字符串类型
                const stringValue = String(value);
                return `${encodeURIComponent(key)}=${encodeURIComponent(stringValue)}`;
            })
            .join('&');

        const fullUrl = queryString ? `${targetUrl}?${queryString}` : targetUrl;
        
        // !!! 核心修改：动态获取 Cookies !!!
        const dynamicCookies = env && env.MOOMOO_CACHE ? await getOrUpdateCookies(env) : FALLBACK_COOKIES;
        
        // 设置cookies和CSRF token（优先使用参数中的值，否则使用动态获取/默认值）
        const cookies = queryParams.cookies || dynamicCookies;
        const csrfToken = queryParams.csrf_token || queryParams.csrfToken || DEFAULT_CSRF_TOKEN;

        // 如果需要quote-token，自动计算（在删除控制参数之前，使用原始queryParams）
        let quoteToken = queryParams.quote_token || queryParams.quoteToken;
        
        // 调试日志
        console.log(`[边缘函数] 请求Moomoo API:`, {
            path: apiPath,
            url: fullUrl.substring(0, 200),
            paramsCount: Object.keys(requestParams).length,
            hasQuoteToken: !!quoteToken,
        });

        // 准备请求headers
        const headers = {
            'authority': 'www.moomoo.com',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'priority': 'u=1, i',
            'referer': queryParams.referer || 'https://www.moomoo.com/',
            'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        };
        
        headers['Cookie'] = cookies;
        headers['futu-x-csrf-token'] = csrfToken;
        
        // 如果需要quote-token，自动计算
        if (requiresQuoteToken(apiPath) && !quoteToken) {
            // 提取用于计算token的参数（使用原始queryParams，包含所有参数）
            const tokenParams = extractTokenParams(queryParams, apiPath);
            
            // 对于所有需要quote-token的API，即使没有参数也要计算token
            // 空对象也会生成有效的token
            quoteToken = await generateQuoteToken(tokenParams);
            console.log(`[边缘函数] 自动计算quote-token: ${quoteToken} (路径: ${apiPath})`);
            console.log(`[边缘函数] Token参数详情:`, JSON.stringify(tokenParams));
        }
        
        if (quoteToken) {
            headers['quote-token'] = quoteToken;
        } else if (requiresQuoteToken(apiPath)) {
            console.warn(`[边缘函数] 警告: 需要quote-token但未提供或计算失败 (路径: ${apiPath})`);
        }

        // 如果原始请求包含Authorization header，也转发（用于某些需要认证的场景）
        if (request && request.headers) {
            const authHeader = request.headers.get('Authorization');
            if (authHeader) {
                headers['Authorization'] = authHeader;
            }
        }

        // 发送请求到Moomoo API
        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: headers,
            // 设置超时（Cloudflare Workers默认超时是30秒）
            signal: AbortSignal.timeout(25000), // 25秒超时
        });

        // 检查响应状态
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[边缘函数] Moomoo API返回错误:`, {
                status: response.status,
                statusText: response.statusText,
                path: apiPath,
                url: fullUrl,
                errorText: errorText.substring(0, 500),
            });
            return Response.json(
                {
                    success: false,
                    error: `Moomoo API returned ${response.status} ${response.statusText}`,
                    status: response.status,
                    statusText: response.statusText,
                    details: errorText.substring(0, 500),
                },
                { status: response.status }
            );
        }

        // 解析响应数据
        const contentType = response.headers.get('content-type');
        let responseData;

        if (contentType && contentType.includes('application/json')) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        // 检查响应数据是否包含错误
        if (responseData && typeof responseData === 'object' && responseData.code !== undefined && responseData.code !== 0) {
            console.error(`[边缘函数] Moomoo API返回业务错误:`, {
                code: responseData.code,
                message: responseData.message,
                path: apiPath,
                url: fullUrl.substring(0, 300),
                params: Object.keys(requestParams),
                hasCookies: !!cookies,
                hasCsrfToken: !!csrfToken,
            });
            // 如果是参数错误，输出更详细的信息
            if (responseData.message && (responseData.message.includes('Params') || responseData.message.includes('参数'))) {
                console.error(`[边缘函数] 参数错误详情:`, {
                    path: apiPath,
                    requestParams: requestParams,
                    queryString: queryString,
                    fullUrl: fullUrl.substring(0, 500),
                });
            }
        }

        // 返回响应（保持原始状态码和headers）
        return Response.json(
            {
                success: true,
                status: response.status,
                data: responseData,
                headers: {
                    'content-type': contentType || 'application/json',
                },
            },
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                },
            }
        );

    } catch (error) {
        // 处理错误
        console.error('Moomoo API proxy error:', error);

        // 如果是超时错误
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return Response.json(
                {
                    error: 'Request timeout',
                    message: 'The request to Moomoo API timed out after 25 seconds',
                    type: 'timeout',
                },
                { status: 504 }
            );
        }

        // 如果是网络错误
        if (error.message && error.message.includes('fetch')) {
            return Response.json(
                {
                    error: 'Network error',
                    message: 'Failed to connect to Moomoo API',
                    details: error.message,
                },
                { status: 502 }
            );
        }

        // 其他错误
        return Response.json(
            {
                error: 'Internal server error',
                message: error.message || 'Unknown error occurred',
                type: error.name || 'Error',
            },
            { status: 500 }
        );
    }
}

/**
 * POST请求处理（用于需要POST方法的接口）
 * @param {Request} request - 原始请求对象
 * @param {object} env - Cloudflare Worker 环境变量
 */
export async function moomooApiPost(request, env = null) {
    try {
        const requestBody = await request.json();
        
        // 从请求体中获取参数
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
        } = requestBody;

        const apiPath = path || api_path;
        
        if (!apiPath) {
            return Response.json(
                { error: 'Missing required parameter: path or api_path' },
                { status: 400 }
            );
        }

        const targetUrl = `${MOOMOO_BASE_URL}${apiPath}`;

        // !!! 核心修改：动态获取 Cookies !!!
        const dynamicCookies = env && env.MOOMOO_CACHE ? await getOrUpdateCookies(env) : FALLBACK_COOKIES;

        // 准备headers
        const headers = {
            'authority': 'www.moomoo.com',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
            'content-type': 'application/json',
            'referer': referer || 'https://www.moomoo.com/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        };

        // 设置 cookies 和 CSRF token（优先使用参数中的值，否则使用动态获取/默认值）
        const finalCookies = cookies || dynamicCookies;
        if (finalCookies) headers['Cookie'] = finalCookies;
        if (csrf_token || csrfToken) headers['futu-x-csrf-token'] = csrf_token || csrfToken;
        if (quote_token || quoteToken) headers['quote-token'] = quote_token || quoteToken;

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(otherParams),
            signal: AbortSignal.timeout(25000),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return Response.json(
                {
                    error: `Moomoo API returned ${response.status}`,
                    details: errorText.substring(0, 500),
                },
                { status: response.status }
            );
        }

        const responseData = await response.json();

        return Response.json(
            {
                success: true,
                data: responseData,
            },
            {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );

    } catch (error) {
        return Response.json(
            {
                error: 'Internal server error',
                message: error.message,
            },
            { status: 500 }
        );
    }
}

// -------------------- Worker 入口 --------------------

/**
 * Worker 入口点，处理所有请求并调用相应的函数
 */
export default {
    async fetch(request, env, ctx) {
        // 允许 OPTIONS 预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, futu-x-csrf-token, quote-token',
                    'Access-Control-Max-Age': '86400', // 缓存预检结果 24 小时
                },
            });
        }
        
        const url = new URL(request.url);
        const queryParams = Object.fromEntries(url.searchParams);
        
        // 我们将所有逻辑放在 /api/moomooapi 路径下
        if (url.pathname.startsWith('/api/moomooapi')) {
            if (request.method === 'GET') {
                // GET 请求：传递 queryParams, request, env
                return moomooApi(queryParams, request, env);
            } else if (request.method === 'POST') {
                // POST 请求：传递 request, env
                return moomooApiPost(request, env);
            }
        }
        
        return new Response('Moomoo API Proxy Service is running. Use /api/moomooapi route.', { status: 200 });
    }
}
