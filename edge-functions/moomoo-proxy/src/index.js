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

// 与后端 HARDCODED_FALLBACK (futunn.ts) 保持索引一致
const GUEST_CONFIGS = [
  {
    csrfToken: '4BBtlR29Ixmg4SWW_GR7VGgn',
    cookies: 'cipher_device_id=1763971814778021; device_id=1763971814778021; _gcl_au=1.1.1320793734.1763971839; _mg_ckp=eyJja1RrZERGIjoiIn0=; __lt__cid=ee3c0c9d-3027-4b78-9db8-39854191fde9; _yjsu_yjad=1763971839.d31da0fe-c2c0-47a1-8528-36ecc4e27e55; _tt_enable_cookie=1; _ttp=01KATEMD6NAZBT2CJCF3ZKBZ41_.tt.1; __qca=P1-722a293c-31d3-4ee4-b36f-8e57523b8053; __mguid_=0e0369e2696d07072vb5pd00mawb4ked; _ss_pp_id=4ec8255ca75ddccfc401763943040859; FUTU_TIMEZONE=Asia%2FShanghai; csrfToken=4BBtlR29Ixmg4SWW_GR7VGgn; futu-offline-csrf-v2=u%2B8Ge3D8OD23piTUo1a6YA%3D%3D; _gid=GA1.2.1064953976.1770793596; _gat_UA-137699611-5=1; locale=zh-cn; locale.sig=_8-JHymmrgcL5ROK0F6Mu8XEiGiPWj3juJFFOsvEScI; _ga=GA1.1.1804626796.1763971839; _ga_ZDJSDWKJ3P=GS2.1.s1770799277$o10$g1$t1770799294$j43$l0$h1777386248$dmlLepEf3ZX5E2Y9JI5kqCHu1JFqTD7RFCA; _uetsid=3449d590071811f1b04bf98484b84d01|1w7kwd5|2|g3h|0|2233; _ga_76MJLWJGT4=GS2.2.s1770799277$o24$g0$t1770799294$j43$l0$h0; _ga_25WYRC4KDG=GS2.1.s1770799278$o34$g1$t1770799294$j44$l0$h0$drH6SYE9TRbfkkPDk4J3t4c7GZH05RP-lfA; _uetvid=10ea6980c90d11f0b434d3853efc02b0|2xkpa0|1770799294855|2|1|bat.bing.com/p/insights/c/b; ttcsid_D0QOPQRC77U7M2KJAGJG=1770799278031::CrSNbjjPpf3uhqIScpMU.21.1770799294860.1; ttcsid_D4DUI6JC77UA35RT1N4G=1770799278032::aszRcLBfpvg8AnpP-Mob.21.1770799294860.1; ttcsid_D4E40SBC77UA35RT20JG=1770799278033::6vF0TQbwYRSSO25G1PKW.21.1770799294860.1; cto_bundle=IqitG184UCUyRiUyQkRqQzhzZkVkVmlZTFhFMjMwbURHTTVDQTVDdTNVd3RQTmdNaG45RGxzV2NGdWNuTk44WWw1OUhEU25RJTJGMlpwTHdTSEN3Skkwc3ZqVUx4akxEZ0pubVVsYVVhSTQ0UzFTRkpad01hYWVaajZxOHU1YVFsampuMFN0ME1sUzlTRHl3alhZWVc5MzgyRzJIc2ZXSGclM0QlM0Q; ftreport-jssdk%40session={%22distinctId%22:%22ftv1mMllOlsD59hMVEMUfsUIlDIhwHhGbRW+izcksZ2Pv4Ypc9TW79CWWEeyejx23hMD%22%2C%22firstId%22:%22ftv1mMllOlsD59hMVEMUfsUIlCfz/R+9vJB9fA6tf/zSKbIpc9TW79CWWEeyejx23hMD%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; _td=47c8a206-0b21-4008-a666-4c750049cbac; ttcsid=1770799278032::zaEmaYtP6i8alY9QXSj9.21.1770799294860.0::1.10082.16380::46471.10.281.616::0.0.0; _rdt_uuid=1763971823005.3f644dc2-6dd1-4465-9ddd-65d6744fc139',
  },
  {
    csrfToken: 'bMZdRQVliYtPd9zSiQ2RqB2Y',
    cookies: 'csrfToken=bMZdRQVliYtPd9zSiQ2RqB2Y; cipher_device_id=1770799451106330; ftreport-jssdk%40new_user=1; locale=en-us; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; _gid=GA1.2.1993268494.1770799457; _gat_UA-137699611-5=1; _gcl_au=1.1.629712897.1770799457; _ga=GA1.1.1864842949.1770799457; _ga_ZDJSDWKJ3P=GS2.1.s1770799455$o1$g1$t1770799456$j59$l0$h1714110453$d05Sppe4bAvfhfyuUCy8qRABqI1Q5fxI_eA; _mg_ckp=eyJja1RrZERGIjoiIn0=; _ga_76MJLWJGT4=GS2.2.s1770799457$o1$g0$t1770799457$j60$l0$h0; _uetsid=d972cf60072511f1a03c53abc8832b95|1j398lf|2|g3h|0|2233; _fbp=fb.1.1770799457150.550810131152727553; _yjsu_yjad=1770799457.1af84db8-bceb-406b-a2af-f31f326dec5d; __qca=P1-6590d6dd-50bb-4923-9b81-6621355c0457; _tt_enable_cookie=1; _ttp=01KH5XYRZ54PNMDGHQYCAWPBY0_.tt.1; _ss_pp_id=d82f370045c1ebcb1581770770657323; _uetvid=d972fc60072511f188176f4c787345d9|w47f4z|1770799457452|1|1|bat.bing.com/p/insights/c/b; __mguid_=76f35f0fecd24d05b5bcc0c02314da49; cto_bundle=BBYMNF9FVkgwSHVSWWo1clV5dzVBOGZENGFsbVR1YjVYS1gyTzhJUndTZSUyRjN4UmNrTkoxc25oN3NtMGsyRDUzSUFXNmZxZnhUejNYNFgxUVJQSE5YNE56RzMyOWRoaW1uanYlMkZCRlRRSjV5bVI4R3pKJTJGdEMlMkJqUTBLdiUyRm9QTyUyRkhGSk9EbQ; _ga_25WYRC4KDG=GS2.1.s1770799457$o1$g0$t1770799457$j60$l0$h0$dIryDvAmc0-IbtaRY5yeHB5TYWTiB_lnZnw; ftreport-jssdk%40session={%22distinctId%22:%22ftv122IGwJQj2ncY0iu64wl1S5mDdVauUc+t2yXP1Uuece5lo1G9BLBpFHKnM2dMsBOq%22%2C%22firstId%22:%22ftv122IGwJQj2ncY0iu64wl1Sx8jmkyX8iCRzOhgLOSLVillo1G9BLBpFHKnM2dMsBOq%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; ttcsid_D0QOPQRC77U7M2KJAGJG=1770799457260::M25qWY77nULOjiL8FIzd.1.1770799467278.1; ttcsid_D4DUI6JC77UA35RT1N4G=1770799457262::X3xP45nquZWi6VUgLwA_.1.1770799467280.1; ttcsid_D4E40SBC77UA35RT20JG=1770799457263::LrH0Ad1ZGt72dvb3ZlMb.1.1770799467281.1; ttcsid=1770799457260::MEcce-pBzpDzqiUoJXTa.1.1770799467281.0::1.-5770.47::44493.3.266.613::0.0.0; _rdt_uuid=1770799455824.c42f9879-690e-4d4d-82ed-734d8a442584',
  },
  {
    csrfToken: 'nHw2TYiBQA0hxqP3qt-b1j4g',
    cookies: 'csrfToken=nHw2TYiBQA0hxqP3qt-b1j4g; cipher_device_id=1770799556161980; ftreport-jssdk%40new_user=1; _gid=GA1.2.124065327.1770799561; _gat_UA-137699611-5=1; _gcl_au=1.1.386017817.1770799561; _ga=GA1.1.982274856.1770799561; _ga_ZDJSDWKJ3P=GS2.1.s1770799559$o1$g1$t1770799561$j58$l0$h1039476057$du_iBaGfiH9T6w_31F9MZC4cEjBvCbVVlWA; _mg_ckp=eyJja1RrZERGIjoiIn0=; locale=en-us; locale.sig=VqoPLcN4ieQqgpFWEtINd7kgYnHLtT740KlCcrWAFsQ; _uetsid=17d051b0072611f18e8a692266dddf53|1uhkj7o|2|g3h|0|2233; _ga_76MJLWJGT4=GS2.2.s1770799561$o1$g0$t1770799561$j60$l0$h0; __mguid_=9da8cb1784fb44848b2a5c24c72c6ff8; __qca=P1-b5699a25-0bef-47f2-bc00-c37ddb8cf9e9; _yjsu_yjad=1770799562.0723d6fe-f8fe-4306-b82a-a8bce5ee9dde; _ga_25WYRC4KDG=GS2.1.s1770799562$o1$g0$t1770799562$j60$l0$h0$dlWOhizBWvMjcWuUt72SUajEu0VporcFXhw; _tt_enable_cookie=1; _ttp=01KH5Y1ZZ8HP2TAZJGCNY3QG3Z_.tt.1; _uetvid=17d06d30072611f180ac4fe33c2252aa|qtq0e4|1770799562786|1|1|bat.bing.com/p/insights/c/b; _ss_pp_id=fa7abef2aba630c591e1770770762854; ttcsid_D0QOPQRC77U7M2KJAGJG=1770799562734::Hkr-s995M-tZW6AiA-uu.1.1770799562992.0; ttcsid_D4DUI6JC77UA35RT1N4G=1770799562735::UVPUAPoIEp3wZxky6_-c.1.1770799562992.0; ttcsid_D4E40SBC77UA35RT20JG=1770799562736::-qP7ymrY7v8rye2diNNL.1.1770799562992.0; _fbp=fb.1.1770799563002.669422765674111063; cto_bundle=1WfueV9FMUk3aGszeFFOUmtpcTZFbjIzbHNGZDlZTEVzcW1zeGV6V2NqbnNEeWhIdlJLbUpOcFVwbWMwTlV2RkRpNERyNk05Mk9PaSUyQjczNyUyRkNTVWNwV09zanZtSEVPNHpsOGZ5cE4yQjZTZEI5WlY0MnZXTk1OeGN4QXlUeGtNSjNURDQ; ftreport-jssdk%40session={%22distinctId%22:%22ftv1T7NOLzRPW4MaOdC6gFTQ11jtHDFY+wdd4QZAHOMwrdHMzEzofRpG0Hr6AILHaHpd%22%2C%22firstId%22:%22ftv1T7NOLzRPW4MaOdC6gFTQ13fNf/jcb+ymfKTMCu4xfrXMzEzofRpG0Hr6AILHaHpd%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; ttcsid=1770799562734::vP1KzZmNc4SjupuSbTak.1.1770799562991.0::1.-6747.41::4320.1.278.620::0.0.0; _rdt_uuid=1770799559945.89c7538b-6491-4b61-8537-421a3d2da898',
  },
];

const FALLBACK_COOKIES = GUEST_CONFIGS[0].cookies;
const DEFAULT_CSRF_TOKEN = GUEST_CONFIGS[0].csrfToken;

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
  delete requestParams.cookie_index;
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

  // ---- Cookies：cookie_index → 本地查表，完整 cookies → 直接用，否则动态获取 ----
  let cookies;
  let csrfToken;
  const cookieIndex = queryParams.cookie_index !== undefined ? parseInt(queryParams.cookie_index, 10) : -1;

  if (cookieIndex >= 0 && cookieIndex < GUEST_CONFIGS.length) {
    // 后端传来索引，使用本地对应的 cookies（避免超长 URL）
    cookies = GUEST_CONFIGS[cookieIndex].cookies;
    csrfToken = queryParams.csrf_token || queryParams.csrfToken || GUEST_CONFIGS[cookieIndex].csrfToken;
  } else if (queryParams.cookies) {
    // 兼容：直接传完整 cookies（自定义 cookies 场景）
    cookies = queryParams.cookies;
    csrfToken = queryParams.csrf_token || queryParams.csrfToken || DEFAULT_CSRF_TOKEN;
  } else {
    // 无 cookies 参数：动态获取或使用 fallback
    cookies = env && env.MOOMOO_CACHE ? await getOrUpdateCookies(env) : FALLBACK_COOKIES;
    csrfToken = queryParams.csrf_token || queryParams.csrfToken || DEFAULT_CSRF_TOKEN;
  }

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
