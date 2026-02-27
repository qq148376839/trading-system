/**
 * Moomoo API Proxy — Vercel Edge Function
 *
 * 从 Cloudflare Worker (moomoo-proxy/src/index.js) 移植，去掉 KV 缓存和动态 cookie 获取。
 * 部署在美东/美西 PoP，避免亚洲节点被 Moomoo 地区封锁。
 */

export const config = { runtime: 'edge' };

const MOOMOO_BASE_URL = 'https://www.moomoo.com';

// 与后端 HARDCODED_FALLBACK (futunn.ts) 及 CF Worker 保持索引一致
const GUEST_CONFIGS = [
  {
    csrfToken: 'EZsS9gJAmvzpm_ATLiV8Yt4B',
    cookies: 'csrfToken=EZsS9gJAmvzpm_ATLiV8Yt4B; cipher_device_id=1771642230219606; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; _gid=GA1.2.374105008.1771642237; _gat_UA-137699611-5=1; locale=zh-cn; _gcl_au=1.1.1236791403.1771642238; _ga=GA1.1.1203064612.1771642237; _ga_25WYRC4KDG=GS2.1.s1771642237$o1$g0$t1771642237$j60$l0$h0$dqvL4bLmT3PIdqIJpcy-c8RmKaaux6bFynw; _uetsid=1a1eaf100ed011f1b7b445b6b6b5630c|1h7qtwp|2|g3r|0|2243; ftreport-jssdk%40session={%22distinctId%22:%22ftv1pMqIijj1huOcOWe7WN4DpRi5UMea1LE3zFk6hDXOBX2/1w83vNdxWBv59FKrwfYH%22%2C%22firstId%22:%22ftv1pMqIijj1huOcOWe7WN4DpXZ9744y7gt0ErvRDWfONum/1w83vNdxWBv59FKrwfYH%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; _uetvid=1a1ead700ed011f1b5c819af57017f23|o8llri|1771642238922|1|1|bat.bing.com/p/insights/c/o; _ga_ZDJSDWKJ3P=GS2.1.s1771642237$o1$g1$t1771642238$j59$l0$h745343158$dHjDRkNZCDQT0nw8Ek29rk06_A1O8wjak6A; _ga_76MJLWJGT4=GS2.2.s1771642239$o1$g0$t1771642239$j60$l0$h0; _yjsu_yjad=1771642239.9c17f437-0419-4e64-9231-64f2db4f35e8; _ss_pp_id=5e01d3763ed9f3593611771663839516',
  },
  {
    csrfToken: 'INSNmygeOuzMvalUg_O9hjru',
    cookies: 'csrfToken=INSNmygeOuzMvalUg_O9hjru; cipher_device_id=1771642243332090; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn; _gid=GA1.2.2018769455.1771642249; _gat_UA-137699611-5=1; _gcl_au=1.1.539257388.1771642249; _ga=GA1.1.833863506.1771642249; _ga_ZDJSDWKJ3P=GS2.1.s1771642249$o1$g1$t1771642250$j59$l0$h1300275669$dKRdGUY-F_qN5PwPTZW5HCLxW4FYu_MjxPg; _uetsid=215b84f00ed011f1942f5fb2526ed5a6|1fksndb|2|g3r|0|2243; _yjsu_yjad=1771642250.0ff38781-84d8-437a-90eb-e82e228d6b51; _ss_pp_id=02fe0990bd4324fc5411771671050659; _ga_76MJLWJGT4=GS2.2.s1771642250$o1$g0$t1771642250$j60$l0$h0; _uetvid=215b6a200ed011f18a400764a473fe2c|136u8yb|1771642251009|1|1|bat.bing.com/p/insights/c/o; _ga_25WYRC4KDG=GS2.1.s1771642249$o1$g0$t1771642251$j58$l0$h0$dn6sJV5LZ21B0dFcL9U9wDIGY0hLNrvjL6g; _mg_ckp=eyJja1RrZERGIjoiIn0=; __qca=P1-ab4e908b-dfd2-4c9c-950e-294a6ec185f9; ftreport-jssdk%40session={%22distinctId%22:%22ftv1buoN3t1ibArloycTCegqNE1qyafCyerTHnl2pDyDIueAhe49Ig7oKDRAeo36QaSs%22%2C%22firstId%22:%22ftv1buoN3t1ibArloycTCegqNNSHySLfTSxRUqgsFDdHsnmAhe49Ig7oKDRAeo36QaSs%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; dv0qai26lg6v2y6kl7yyc36brextdfc5jtrcwxvk=t64sndtc0fr; dv0qai26lg6v2y6kl7yyc36brextdqxjq4aa4ld8=wqzydrnoxa9; __mguid_=b2a44840664f47b2814a0220ac0b930b; dv0qai26lg6v2y6kl7yyc36brextdlbaxjxosbk=0sog1gifs9xg; dv0qai26lg6v2y6kl7yyc36brextdctvzyxug5jb=14oadbt16ui; dv0qai26lg6v2y6kl7yyc36brextdso7q6yarzx=z5509lkknqa; dv0qai26lg6v2y6kl7yyc36brextdllzz7fmoeul=wrxztelhi; dv0qai26lg6v2y6kl7yyc36brextdclnkq780mu5=g8ak2nyqy64; dv0qai26lg6v2y6kl7yyc36brextdm9qutqgie7q=e3wvu9odtdk',
  },
  {
    csrfToken: 'LHj3muTAe4CIeQlCEXgG69TR',
    cookies: 'csrfToken=LHj3muTAe4CIeQlCEXgG69TR; cipher_device_id=1771642256887199; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=en-us; ftreport-jssdk%40session={%22distinctId%22:%22ftv1Rk1x8XVtqHjrhGxjXFLAPJ/ZgH6K2pIEQkYe11uYOvhQvbQqptvJ8fj4yGw5HYd3%22%2C%22firstId%22:%22ftv1Rk1x8XVtqHjrhGxjXFLAPBAZscMXqCj7CmC7TrO8fo9QvbQqptvJ8fj4yGw5HYd3%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}',
  },
  {
    csrfToken: 'vhDhsqsxM-0Z9WrvjCS8q5IE',
    cookies: 'csrfToken=vhDhsqsxM-0Z9WrvjCS8q5IE; cipher_device_id=1771642269864855; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn; ftreport-jssdk%40session={%22distinctId%22:%22ftv1jcML/mHi+TRYV33SAS6UwfnSeMQC6I6q85NTDWbXV6rXTmICM2L3isz6U+XQ401D%22%2C%22firstId%22:%22ftv1jcML/mHi+TRYV33SAS6UwaZc/idnqSwBkUQqj0HqNsfXTmICM2L3isz6U+XQ401D%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}',
  },
  {
    csrfToken: 'BYzQxWF2pH9Y161n7q2lgI0X',
    cookies: 'csrfToken=BYzQxWF2pH9Y161n7q2lgI0X; cipher_device_id=1771642283632851; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1+o7l2C7nHRcL9a6FVAgqAYsrwB9zhagfDXdu7DXP86wfJmQC9e4zhbwsD4/ABFJI%22%2C%22firstId%22:%22ftv1+o7l2C7nHRcL9a6FVAgqAYsrwB9zhagfDXdu7DXP86wfJmQC9e4zhbwsD4/ABFJI%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn',
  },
  {
    csrfToken: 'Yw0dQKjUVAhC3J5xSo8I-cYG',
    cookies: 'csrfToken=Yw0dQKjUVAhC3J5xSo8I-cYG; cipher_device_id=1771642297470921; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1IZYqBSyUxXF7K/zi4IdYMiuX5vcOwCi2RmyI4D4FkewVVNsmhGhp81AL0hU8uWbh%22%2C%22firstId%22:%22ftv1IZYqBSyUxXF7K/zi4IdYMiuX5vcOwCi2RmyI4D4FkewVVNsmhGhp81AL0hU8uWbh%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn',
  },
  {
    csrfToken: 'aPX5OXuf41BvMiXdX3jI-caO',
    cookies: 'csrfToken=aPX5OXuf41BvMiXdX3jI-caO; cipher_device_id=1771642311242352; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1dMDlDRrES+0KQ6g8lvANcI3E2LIodnRbsqM7lyvs6evn4JYWlB3bKnge+8qgwJLc%22%2C%22firstId%22:%22ftv1dMDlDRrES+0KQ6g8lvANcI3E2LIodnRbsqM7lyvs6evn4JYWlB3bKnge+8qgwJLc%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn',
  },
  {
    csrfToken: '718ik-HVon4ScFbTxSY3ct_e',
    cookies: 'csrfToken=718ik-HVon4ScFbTxSY3ct_e; cipher_device_id=1771642324273609; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1ULXSbOhPyvDrQ4ml0+IIHeN0W+VkazT3OoriOL7wcNZ99CEpTC7+aK6X5mBnGBRw%22%2C%22firstId%22:%22ftv1ULXSbOhPyvDrQ4ml0+IIHeN0W+VkazT3OoriOL7wcNZ99CEpTC7+aK6X5mBnGBRw%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn',
  },
  {
    csrfToken: '13Scq7-QCQkDmBFpBVvXTe9P',
    cookies: 'csrfToken=13Scq7-QCQkDmBFpBVvXTe9P; cipher_device_id=1771642338520041; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1ZfKYCd2csnJfZkzTTNDnPdrPwA6bK2ojV47UkRlkosqKoBp/TJ/MaAubKBZWJRW0%22%2C%22firstId%22:%22ftv1ZfKYCd2csnJfZkzTTNDnPdrPwA6bK2ojV47UkRlkosqKoBp/TJ/MaAubKBZWJRW0%22}; locale=zh-cn; locale.sig=_8-JHymmrgcL5ROK0F6Mu8XEiGiPWj3juJFFOsvEScI',
  },
  {
    csrfToken: 'w2rZWGu9IwuVHswF2AfVkGlV',
    cookies: 'csrfToken=w2rZWGu9IwuVHswF2AfVkGlV; cipher_device_id=1771642353681570; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv17JSwqO3wx+l1NZT22Cnxgf4nsM+lKcfK569nuWLk5/kVme+hgaio9BME1uRWQv5q%22%2C%22firstId%22:%22ftv17JSwqO3wx+l1NZT22Cnxgf4nsM+lKcfK569nuWLk5/kVme+hgaio9BME1uRWQv5q%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=en-us',
  },
  {
    csrfToken: 'uFVy82LORRHRlTNhPC9uQcJY',
    cookies: 'csrfToken=uFVy82LORRHRlTNhPC9uQcJY; cipher_device_id=1771642367386118; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1kpvuJGNq2HFJbRBVCa41CUzzp0hHvzhJqVIYbGZYSpsdSSNzlUNQUvO64+4EgQK+%22%2C%22firstId%22:%22ftv1kpvuJGNq2HFJbRBVCa41CUzzp0hHvzhJqVIYbGZYSpsdSSNzlUNQUvO64+4EgQK+%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn',
  },
  {
    csrfToken: 'A0yF8BmUim2-YhFEvFDn7_0s',
    cookies: 'csrfToken=A0yF8BmUim2-YhFEvFDn7_0s; cipher_device_id=1771642380178281; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1K9IlPSVCXHM3mD3yiDZRco0D32NHUDTJGQUGDas+seH+wLZT6SVFBOl6UdAR73c/%22%2C%22firstId%22:%22ftv1K9IlPSVCXHM3mD3yiDZRco0D32NHUDTJGQUGDas+seH+wLZT6SVFBOl6UdAR73c/%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn',
  },
  {
    csrfToken: 'Xx1337OAd5fBDKMkWMo3DbOf',
    cookies: 'csrfToken=Xx1337OAd5fBDKMkWMo3DbOf; cipher_device_id=1771642394756667; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; ftreport-jssdk%40session={%22distinctId%22:%22ftv1+m+VsERwI3Pb+4dVRK8N4TIVHk88yeuVZ+FQlxxkdV9cbQ1LleJ7e214NAwvsm+L%22%2C%22firstId%22:%22ftv1+m+VsERwI3Pb+4dVRK8N4W4HtF9Ywr3zxi0TJHZkPpRcbQ1LleJ7e214NAwvsm+L%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; locale=zh-cn',
  },
  {
    csrfToken: '8gXbkMk4RvWh1izgFSkRKp7E',
    cookies: 'csrfToken=8gXbkMk4RvWh1izgFSkRKp7E; cipher_device_id=1771642407650768; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn; ftreport-jssdk%40session={%22distinctId%22:%22ftv1rrJ2AO9fc/Ejvag7s+DxdBjfO0B/2QWpvJhXF081r6EqWYhFs8MmdZ/jRZ4W4xRJ%22%2C%22firstId%22:%22ftv1rrJ2AO9fc/Ejvag7s+DxdFcCPsNcQgRLdB0VptWG94YqWYhFs8MmdZ/jRZ4W4xRJ%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}',
  },
  {
    csrfToken: 'pUhBgRwJn-CKdtU6K8u_DsMS',
    cookies: 'csrfToken=pUhBgRwJn-CKdtU6K8u_DsMS; cipher_device_id=1771642421268876; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1GGycq6HmJaP8j6CgE9x7BCTPB+g9TADapUfxf15K/uoMXRYgmaOReGUjXcKMTJZo%22%2C%22firstId%22:%22ftv1GGycq6HmJaP8j6CgE9x7BCTPB+g9TADapUfxf15K/uoMXRYgmaOReGUjXcKMTJZo%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn',
  },
];

const FALLBACK_COOKIES = GUEST_CONFIGS[0].cookies;
const DEFAULT_CSRF_TOKEN = GUEST_CONFIGS[0].csrfToken;

// -------------------- 请求去重 --------------------
const INFLIGHT_REQUESTS = new Map();
const DEDUP_TTL_MS = 2500;

function computeDedupKey(apiPath, params) {
  const sorted = Object.entries(params)
    .filter(([k]) => k !== '_')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${apiPath}|${sorted}`;
}

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
  '/quote-api/quote-v2/get-option-rank',
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
  } else if (apiPath.includes('get-option-rank')) {
    const keys = ['rankType', 'subRankType', 'iterator', 'count', 'marketType'];
    for (const key of keys) {
      if (queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== '') {
        tokenParams[key] = String(queryParams[key]);
      }
    }
  }

  return tokenParams;
}

// -------------------- CORS --------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, futu-x-csrf-token, quote-token',
};

// -------------------- 请求处理 --------------------

async function handleGet(queryParams, request) {
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

  // ---- 请求去重：相同语义请求在 DEDUP_TTL_MS 内合并 ----
  const dedupKey = computeDedupKey(apiPath, requestParams);
  const existing = INFLIGHT_REQUESTS.get(dedupKey);
  if (existing && Date.now() - existing.ts < DEDUP_TTL_MS) {
    console.log(`[Vercel] Dedup hit: ${dedupKey}`);
    return existing.promise.then((r) => r.clone());
  }

  const executeRequest = async () => {
  // 自动补 _ 时间戳（kline/quote 等接口需要，option-rank 和 popular-position 除外）
  const SKIP_TIMESTAMP_PATHS = ['get-option-rank', 'get-popular-position'];
  if (!requestParams['_'] && requiresQuoteToken(apiPath) && !SKIP_TIMESTAMP_PATHS.some(p => apiPath.includes(p))) {
    requestParams['_'] = String(Date.now());
  }

  const queryString = Object.entries(requestParams)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  const fullUrl = queryString ? `${targetUrl}?${queryString}` : targetUrl;

  // ---- Cookies：cookie_index → 本地查表，完整 cookies → 直接用，否则 fallback ----
  let cookies;
  let csrfToken;
  const cookieIndex = queryParams.cookie_index !== undefined ? parseInt(queryParams.cookie_index, 10) : -1;

  if (cookieIndex >= 0 && cookieIndex < GUEST_CONFIGS.length) {
    cookies = GUEST_CONFIGS[cookieIndex].cookies;
    csrfToken = queryParams.csrf_token || queryParams.csrfToken || GUEST_CONFIGS[cookieIndex].csrfToken;
  } else if (queryParams.cookies) {
    cookies = queryParams.cookies;
    csrfToken = queryParams.csrf_token || queryParams.csrfToken || DEFAULT_CSRF_TOKEN;
  } else {
    // 无 KV，直接使用 fallback cookies
    cookies = FALLBACK_COOKIES;
    csrfToken = queryParams.csrf_token || queryParams.csrfToken || DEFAULT_CSRF_TOKEN;
  }

  // ---- quoteToken：后端提供则跳过计算 ----
  let quoteToken = queryParams.quoteToken || queryParams.quote_token;
  if (!quoteToken && requiresQuoteToken(apiPath)) {
    const tokenParams = extractTokenParams(requestParams, apiPath);
    quoteToken = await generateQuoteToken(tokenParams);
    console.log(`[Vercel] Computed quoteToken: ${quoteToken} for ${apiPath} params=${JSON.stringify(tokenParams)}`);
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
    // 带重试的 fetch：当 Moomoo 返回 HTTP 200 + HTML 限流页面时，换 cookie 重试
    const MAX_RETRIES = 2;
    let responseData;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // 重试时切换到下一个 cookie（轮询 GUEST_CONFIGS）
      if (attempt > 0) {
        const nextIdx = (cookieIndex >= 0 ? cookieIndex + attempt : attempt) % GUEST_CONFIGS.length;
        headers['Cookie'] = GUEST_CONFIGS[nextIdx].cookies;
        headers['futu-x-csrf-token'] = GUEST_CONFIGS[nextIdx].csrfToken;
        console.log(`[Vercel] Retry ${attempt}/${MAX_RETRIES} with cookie #${nextIdx} for ${apiPath}`);
        // 短暂等待避免连续触发限流
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(25000),
      });

      lastStatus = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        // HTTP 403：尝试重试
        if (response.status === 403 && attempt < MAX_RETRIES) {
          console.warn(`[Vercel] Moomoo 403 for ${apiPath}, will retry (${attempt + 1}/${MAX_RETRIES})`);
          continue;
        }
        console.error(`[Vercel] Moomoo ${response.status} for ${apiPath}`);
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
      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      // 检测 HTTP 200 但内容是 HTML 限流页（Moomoo 的 soft-403）
      if (
        typeof responseData === 'string' &&
        (responseData.includes('<!DOCTYPE') || responseData.includes('Operations too frequent'))
      ) {
        if (attempt < MAX_RETRIES) {
          console.warn(`[Vercel] Moomoo HTML 403 (soft) for ${apiPath}, will retry (${attempt + 1}/${MAX_RETRIES})`);
          continue;
        }
        // 所有重试都失败，返回明确的错误
        return Response.json(
          {
            success: false,
            error: 'Moomoo API rate limited (HTML 403)',
            status: 403,
            details: responseData.substring(0, 200),
          },
          { status: 403, headers: CORS_HEADERS },
        );
      }

      // 成功获取 JSON 数据，跳出重试循环
      break;
    }

    // 记录业务错误
    if (
      responseData &&
      typeof responseData === 'object' &&
      responseData.code !== undefined &&
      responseData.code !== 0
    ) {
      console.error(`[Vercel] Business error code=${responseData.code}: ${responseData.message || ''} path=${apiPath}`);
    }

    return Response.json(
      { success: true, status: lastStatus, data: responseData },
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
  }; // end executeRequest

  const promise = executeRequest();
  INFLIGHT_REQUESTS.set(dedupKey, { promise, ts: Date.now() });
  promise.finally(() => {
    setTimeout(() => INFLIGHT_REQUESTS.delete(dedupKey), DEDUP_TTL_MS);
  });

  return promise;
}

async function handlePost(request) {
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

    // 无 KV，直接使用提供的 cookies 或 fallback
    const finalCookies = cookies || FALLBACK_COOKIES;

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

// -------------------- Vercel Edge Function 入口 --------------------

export default async function handler(request) {
  // OPTIONS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
    });
  }

  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams);

  if (request.method === 'GET') {
    return handleGet(queryParams, request);
  }
  if (request.method === 'POST') {
    return handlePost(request);
  }

  return Response.json(
    { error: `Method ${request.method} not allowed` },
    { status: 405, headers: CORS_HEADERS },
  );
}
