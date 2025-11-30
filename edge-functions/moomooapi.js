/**
 * Moomoo API 代理服务
 * 用于解决大陆IP无法直接访问Moomoo API的问题
 * 
 * 支持的接口：
 * - /api/headfoot-search - 搜索接口
 * - /quote-api/quote-v2/get-kline - K线数据
 * - /quote-api/quote-v2/get-quote-minute - 分时数据
 * - /quote-api/quote-v2/get-stock-quote - 股票行情
 * - /quote-api/quote-v2/get-option-chain - 期权链
 * - /quote-api/quote-v2/get-option-strike-dates - 期权到期日期
 */

const MOOMOO_BASE_URL = 'https://www.moomoo.com';

// 默认的cookies和CSRF token（用于行情接口）
// 注意：这些是硬编码的默认值，如果查询参数中提供了cookies和csrf_token，会优先使用参数中的值
const DEFAULT_COOKIES = 'cipher_device_id=1763971814778021; ftreport-jssdk%40new_user=1; futu-csrf=niasJM1N1jtj3pyQh6JO4Nknn7c=; device_id=1763971814778021; csrfToken=f51O2KPxQvir0tU5zDCVQpMm; locale=zh-cn';
const DEFAULT_CSRF_TOKEN = 'f51O2KPxQvir0tU5zDCVQpMm';

// 需要quote-token的接口路径
const QUOTE_TOKEN_REQUIRED_PATHS = [
    '/quote-api/quote-v2/get-kline',
    '/quote-api/quote-v2/get-quote-minute',
    '/quote-api/quote-v2/get-stock-quote',
    '/quote-api/quote-v2/get-option-chain',
    '/quote-api/quote-v2/get-option-strike-dates',
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
        // 股票行情：stockId, marketType, marketCode, lotSize, spreadCode, underlyingStockId, instrumentType, subInstrumentType, _
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
    }
    
    return tokenParams;
}

/**
 * 处理Moomoo API代理请求
 * 
 * @param {Object} queryParams - 查询参数
 * @param {Request} request - 原始请求对象（用于获取headers）
 * @returns {Promise<Response>}
 */
export async function moomooApi(queryParams = {}, request = null) {
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

        // 设置cookies和CSRF token（优先使用参数中的值，否则使用默认值）
        const cookies = queryParams.cookies || DEFAULT_COOKIES;
        const csrfToken = queryParams.csrf_token || queryParams.csrfToken || DEFAULT_CSRF_TOKEN;
        
        headers['Cookie'] = cookies;
        headers['futu-x-csrf-token'] = csrfToken;

        // 如果需要quote-token，自动计算（在删除控制参数之前，使用原始queryParams）
        let quoteToken = queryParams.quote_token || queryParams.quoteToken;
        if (requiresQuoteToken(apiPath) && !quoteToken) {
            // 提取用于计算token的参数（使用原始queryParams，包含所有参数）
            const tokenParams = extractTokenParams(queryParams, apiPath);
            if (Object.keys(tokenParams).length > 0) {
                quoteToken = await generateQuoteToken(tokenParams);
                console.log(`[边缘函数] 自动计算quote-token: ${quoteToken} (路径: ${apiPath})`);
                console.log(`[边缘函数] Token参数详情:`, JSON.stringify(tokenParams));
            } else {
                console.warn(`[边缘函数] 无法提取token参数 (路径: ${apiPath})`);
                console.warn(`[边缘函数] 可用参数:`, Object.keys(queryParams).join(', '));
            }
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
            console.warn(`[边缘函数] Moomoo API返回业务错误:`, {
                code: responseData.code,
                message: responseData.message,
                path: apiPath,
            });
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
 */
export async function moomooApiPost(request) {
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

        // 准备headers
        const headers = {
            'authority': 'www.moomoo.com',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
            'content-type': 'application/json',
            'referer': referer || 'https://www.moomoo.com/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        };

        if (cookies) headers['Cookie'] = cookies;
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

