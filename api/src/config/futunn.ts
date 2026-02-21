/**
 * 富途牛牛/Moomoo API配置
 *
 * 优先从 DB (moomoo_guest_cookies) 加载 cookies，fallback 到硬编码
 * getFutunnConfig() 保持同步（避免修改 9+ 个下游文件）
 * 域名统一使用 www.moomoo.com
 */

import { logger } from '../utils/logger';

// ── 硬编码 fallback（DB 为空时使用） ─────────────────────────
const HARDCODED_FALLBACK: FutunnConfig[] = [
  {
    csrfToken: "EZsS9gJAmvzpm_ATLiV8Yt4B",
    cookies: "csrfToken=EZsS9gJAmvzpm_ATLiV8Yt4B; cipher_device_id=1771642230219606; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; _gid=GA1.2.374105008.1771642237; _gat_UA-137699611-5=1; locale=zh-cn; _gcl_au=1.1.1236791403.1771642238; _ga=GA1.1.1203064612.1771642237; _ga_25WYRC4KDG=GS2.1.s1771642237$o1$g0$t1771642237$j60$l0$h0$dqvL4bLmT3PIdqIJpcy-c8RmKaaux6bFynw; _uetsid=1a1eaf100ed011f1b7b445b6b6b5630c|1h7qtwp|2|g3r|0|2243; ftreport-jssdk%40session={%22distinctId%22:%22ftv1pMqIijj1huOcOWe7WN4DpRi5UMea1LE3zFk6hDXOBX2/1w83vNdxWBv59FKrwfYH%22%2C%22firstId%22:%22ftv1pMqIijj1huOcOWe7WN4DpXZ9744y7gt0ErvRDWfONum/1w83vNdxWBv59FKrwfYH%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; _uetvid=1a1ead700ed011f1b5c819af57017f23|o8llri|1771642238922|1|1|bat.bing.com/p/insights/c/o; _ga_ZDJSDWKJ3P=GS2.1.s1771642237$o1$g1$t1771642238$j59$l0$h745343158$dHjDRkNZCDQT0nw8Ek29rk06_A1O8wjak6A; _ga_76MJLWJGT4=GS2.2.s1771642239$o1$g0$t1771642239$j60$l0$h0; _yjsu_yjad=1771642239.9c17f437-0419-4e64-9231-64f2db4f35e8; _ss_pp_id=5e01d3763ed9f3593611771663839516",
    label: "Guest #1",
  },
  {
    csrfToken: "INSNmygeOuzMvalUg_O9hjru",
    cookies: "csrfToken=INSNmygeOuzMvalUg_O9hjru; cipher_device_id=1771642243332090; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn; _gid=GA1.2.2018769455.1771642249; _gat_UA-137699611-5=1; _gcl_au=1.1.539257388.1771642249; _ga=GA1.1.833863506.1771642249; _ga_ZDJSDWKJ3P=GS2.1.s1771642249$o1$g1$t1771642250$j59$l0$h1300275669$dKRdGUY-F_qN5PwPTZW5HCLxW4FYu_MjxPg; _uetsid=215b84f00ed011f1942f5fb2526ed5a6|1fksndb|2|g3r|0|2243; _yjsu_yjad=1771642250.0ff38781-84d8-437a-90eb-e82e228d6b51; _ss_pp_id=02fe0990bd4324fc5411771671050659; _ga_76MJLWJGT4=GS2.2.s1771642250$o1$g0$t1771642250$j60$l0$h0; _uetvid=215b6a200ed011f18a400764a473fe2c|136u8yb|1771642251009|1|1|bat.bing.com/p/insights/c/o; _ga_25WYRC4KDG=GS2.1.s1771642249$o1$g0$t1771642251$j58$l0$h0$dn6sJV5LZ21B0dFcL9U9wDIGY0hLNrvjL6g; _mg_ckp=eyJja1RrZERGIjoiIn0=; __qca=P1-ab4e908b-dfd2-4c9c-950e-294a6ec185f9; ftreport-jssdk%40session={%22distinctId%22:%22ftv1buoN3t1ibArloycTCegqNE1qyafCyerTHnl2pDyDIueAhe49Ig7oKDRAeo36QaSs%22%2C%22firstId%22:%22ftv1buoN3t1ibArloycTCegqNNSHySLfTSxRUqgsFDdHsnmAhe49Ig7oKDRAeo36QaSs%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; dv0qai26lg6v2y6kl7yyc36brextdfc5jtrcwxvk=t64sndtc0fr; dv0qai26lg6v2y6kl7yyc36brextdqxjq4aa4ld8=wqzydrnoxa9; __mguid_=b2a44840664f47b2814a0220ac0b930b; dv0qai26lg6v2y6kl7yyc36brextdlbaxjxosbk=0sog1gifs9xg; dv0qai26lg6v2y6kl7yyc36brextdctvzyxug5jb=14oadbt16ui; dv0qai26lg6v2y6kl7yyc36brextdso7q6yarzx=z5509lkknqa; dv0qai26lg6v2y6kl7yyc36brextdllzz7fmoeul=wrxztelhi; dv0qai26lg6v2y6kl7yyc36brextdclnkq780mu5=g8ak2nyqy64; dv0qai26lg6v2y6kl7yyc36brextdm9qutqgie7q=e3wvu9odtdk",
    label: "Guest #2",
  },
  {
    csrfToken: "LHj3muTAe4CIeQlCEXgG69TR",
    cookies: "csrfToken=LHj3muTAe4CIeQlCEXgG69TR; cipher_device_id=1771642256887199; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=en-us; ftreport-jssdk%40session={%22distinctId%22:%22ftv1Rk1x8XVtqHjrhGxjXFLAPJ/ZgH6K2pIEQkYe11uYOvhQvbQqptvJ8fj4yGw5HYd3%22%2C%22firstId%22:%22ftv1Rk1x8XVtqHjrhGxjXFLAPBAZscMXqCj7CmC7TrO8fo9QvbQqptvJ8fj4yGw5HYd3%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}",
    label: "Guest #3",
  },
  {
    csrfToken: "vhDhsqsxM-0Z9WrvjCS8q5IE",
    cookies: "csrfToken=vhDhsqsxM-0Z9WrvjCS8q5IE; cipher_device_id=1771642269864855; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn; ftreport-jssdk%40session={%22distinctId%22:%22ftv1jcML/mHi+TRYV33SAS6UwfnSeMQC6I6q85NTDWbXV6rXTmICM2L3isz6U+XQ401D%22%2C%22firstId%22:%22ftv1jcML/mHi+TRYV33SAS6UwaZc/idnqSwBkUQqj0HqNsfXTmICM2L3isz6U+XQ401D%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}",
    label: "Guest #4",
  },
  {
    csrfToken: "BYzQxWF2pH9Y161n7q2lgI0X",
    cookies: "csrfToken=BYzQxWF2pH9Y161n7q2lgI0X; cipher_device_id=1771642283632851; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1+o7l2C7nHRcL9a6FVAgqAYsrwB9zhagfDXdu7DXP86wfJmQC9e4zhbwsD4/ABFJI%22%2C%22firstId%22:%22ftv1+o7l2C7nHRcL9a6FVAgqAYsrwB9zhagfDXdu7DXP86wfJmQC9e4zhbwsD4/ABFJI%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn",
    label: "Guest #5",
  },
  {
    csrfToken: "Yw0dQKjUVAhC3J5xSo8I-cYG",
    cookies: "csrfToken=Yw0dQKjUVAhC3J5xSo8I-cYG; cipher_device_id=1771642297470921; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1IZYqBSyUxXF7K/zi4IdYMiuX5vcOwCi2RmyI4D4FkewVVNsmhGhp81AL0hU8uWbh%22%2C%22firstId%22:%22ftv1IZYqBSyUxXF7K/zi4IdYMiuX5vcOwCi2RmyI4D4FkewVVNsmhGhp81AL0hU8uWbh%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn",
    label: "Guest #6",
  },
  {
    csrfToken: "aPX5OXuf41BvMiXdX3jI-caO",
    cookies: "csrfToken=aPX5OXuf41BvMiXdX3jI-caO; cipher_device_id=1771642311242352; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1dMDlDRrES+0KQ6g8lvANcI3E2LIodnRbsqM7lyvs6evn4JYWlB3bKnge+8qgwJLc%22%2C%22firstId%22:%22ftv1dMDlDRrES+0KQ6g8lvANcI3E2LIodnRbsqM7lyvs6evn4JYWlB3bKnge+8qgwJLc%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn",
    label: "Guest #7",
  },
  {
    csrfToken: "718ik-HVon4ScFbTxSY3ct_e",
    cookies: "csrfToken=718ik-HVon4ScFbTxSY3ct_e; cipher_device_id=1771642324273609; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1ULXSbOhPyvDrQ4ml0+IIHeN0W+VkazT3OoriOL7wcNZ99CEpTC7+aK6X5mBnGBRw%22%2C%22firstId%22:%22ftv1ULXSbOhPyvDrQ4ml0+IIHeN0W+VkazT3OoriOL7wcNZ99CEpTC7+aK6X5mBnGBRw%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn",
    label: "Guest #8",
  },
  {
    csrfToken: "13Scq7-QCQkDmBFpBVvXTe9P",
    cookies: "csrfToken=13Scq7-QCQkDmBFpBVvXTe9P; cipher_device_id=1771642338520041; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1ZfKYCd2csnJfZkzTTNDnPdrPwA6bK2ojV47UkRlkosqKoBp/TJ/MaAubKBZWJRW0%22%2C%22firstId%22:%22ftv1ZfKYCd2csnJfZkzTTNDnPdrPwA6bK2ojV47UkRlkosqKoBp/TJ/MaAubKBZWJRW0%22}; locale=zh-cn; locale.sig=_8-JHymmrgcL5ROK0F6Mu8XEiGiPWj3juJFFOsvEScI",
    label: "Guest #9",
  },
  {
    csrfToken: "w2rZWGu9IwuVHswF2AfVkGlV",
    cookies: "csrfToken=w2rZWGu9IwuVHswF2AfVkGlV; cipher_device_id=1771642353681570; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv17JSwqO3wx+l1NZT22Cnxgf4nsM+lKcfK569nuWLk5/kVme+hgaio9BME1uRWQv5q%22%2C%22firstId%22:%22ftv17JSwqO3wx+l1NZT22Cnxgf4nsM+lKcfK569nuWLk5/kVme+hgaio9BME1uRWQv5q%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=en-us",
    label: "Guest #10",
  },
  {
    csrfToken: "uFVy82LORRHRlTNhPC9uQcJY",
    cookies: "csrfToken=uFVy82LORRHRlTNhPC9uQcJY; cipher_device_id=1771642367386118; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1kpvuJGNq2HFJbRBVCa41CUzzp0hHvzhJqVIYbGZYSpsdSSNzlUNQUvO64+4EgQK+%22%2C%22firstId%22:%22ftv1kpvuJGNq2HFJbRBVCa41CUzzp0hHvzhJqVIYbGZYSpsdSSNzlUNQUvO64+4EgQK+%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn",
    label: "Guest #11",
  },
  {
    csrfToken: "A0yF8BmUim2-YhFEvFDn7_0s",
    cookies: "csrfToken=A0yF8BmUim2-YhFEvFDn7_0s; cipher_device_id=1771642380178281; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1K9IlPSVCXHM3mD3yiDZRco0D32NHUDTJGQUGDas+seH+wLZT6SVFBOl6UdAR73c/%22%2C%22firstId%22:%22ftv1K9IlPSVCXHM3mD3yiDZRco0D32NHUDTJGQUGDas+seH+wLZT6SVFBOl6UdAR73c/%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn",
    label: "Guest #12",
  },
  {
    csrfToken: "Xx1337OAd5fBDKMkWMo3DbOf",
    cookies: "csrfToken=Xx1337OAd5fBDKMkWMo3DbOf; cipher_device_id=1771642394756667; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; ftreport-jssdk%40session={%22distinctId%22:%22ftv1+m+VsERwI3Pb+4dVRK8N4TIVHk88yeuVZ+FQlxxkdV9cbQ1LleJ7e214NAwvsm+L%22%2C%22firstId%22:%22ftv1+m+VsERwI3Pb+4dVRK8N4W4HtF9Ywr3zxi0TJHZkPpRcbQ1LleJ7e214NAwvsm+L%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; locale=zh-cn",
    label: "Guest #13",
  },
  {
    csrfToken: "8gXbkMk4RvWh1izgFSkRKp7E",
    cookies: "csrfToken=8gXbkMk4RvWh1izgFSkRKp7E; cipher_device_id=1771642407650768; ftreport-jssdk%40new_user=1; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn; ftreport-jssdk%40session={%22distinctId%22:%22ftv1rrJ2AO9fc/Ejvag7s+DxdBjfO0B/2QWpvJhXF081r6EqWYhFs8MmdZ/jRZ4W4xRJ%22%2C%22firstId%22:%22ftv1rrJ2AO9fc/Ejvag7s+DxdFcCPsNcQgRLdB0VptWG94YqWYhFs8MmdZ/jRZ4W4xRJ%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}",
    label: "Guest #14",
  },
  {
    csrfToken: "pUhBgRwJn-CKdtU6K8u_DsMS",
    cookies: "csrfToken=pUhBgRwJn-CKdtU6K8u_DsMS; cipher_device_id=1771642421268876; ftreport-jssdk%40new_user=1; ftreport-jssdk%40session={%22distinctId%22:%22ftv1GGycq6HmJaP8j6CgE9x7BCTPB+g9TADapUfxf15K/uoMXRYgmaOReGUjXcKMTJZo%22%2C%22firstId%22:%22ftv1GGycq6HmJaP8j6CgE9x7BCTPB+g9TADapUfxf15K/uoMXRYgmaOReGUjXcKMTJZo%22}; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; locale=zh-cn",
    label: "Guest #15",
  },
];

// ── DB 缓存 ──────────────────────────────────────────────────
let _dbConfigs: FutunnConfig[] | null = null;
let _dbConfigsRefreshTimer: ReturnType<typeof setInterval> | null = null;
const DB_CONFIGS_TTL = 5 * 60 * 1000; // 5 分钟

let _configIndex = 0;

export interface FutunnConfig {
  csrfToken: string;
  cookies: string;
  label?: string;
}

/**
 * 从 DB 异步加载 moomoo_guest_cookies 并填充缓存
 */
async function refreshDBConfigs(): Promise<void> {
  try {
    const configService = (await import('../services/config.service')).default;
    const raw = await configService.getConfig('moomoo_guest_cookies');
    if (!raw || raw.trim() === '' || raw.trim() === '[]') {
      _dbConfigs = null;
      return;
    }

    const parsed: Array<{ csrfToken?: string; cookies?: string; label?: string }> = JSON.parse(raw);
    const valid = parsed.filter(
      (item) => item.csrfToken && item.csrfToken.trim() !== '' && item.cookies && item.cookies.trim() !== ''
    );

    _dbConfigs = valid.length > 0
      ? valid.map((item) => ({
          csrfToken: item.csrfToken!,
          cookies: item.cookies!,
          label: item.label,
        }))
      : null;

    const source = _dbConfigs ? `DB(${_dbConfigs.length}组)` : 'fallback';
    logger.info(`[Moomoo配置] 刷新完成 → ${source}`, { dbWrite: false });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[Moomoo配置] 从DB加载失败，保留当前缓存: ${msg}`);
  }
}

/**
 * 获取有效的配置列表（DB 优先，fallback 到硬编码）
 */
export function getEffectiveConfigs(): FutunnConfig[] {
  return (_dbConfigs && _dbConfigs.length > 0) ? _dbConfigs : HARDCODED_FALLBACK;
}

/**
 * 获取富途牛牛/Moomoo配置（round-robin 轮询多个 guest cookie）
 * 同步接口，不改下游调用签名
 */
export function getFutunnConfig(): FutunnConfig {
  const configs = getEffectiveConfigs();
  const config = configs[_configIndex % configs.length];
  _configIndex++;
  return config;
}

/**
 * 设置富途牛牛配置（用于测试或动态更新，通常不需要）
 */
export function setFutunnConfig(_config: FutunnConfig) {
  logger.warn('setFutunnConfig: 当前使用DB+硬编码的Moomoo游客配置，设置操作将被忽略');
}

/**
 * 初始化富途牛牛配置
 * 启动时触发一次 DB 加载，并设置定时刷新
 */
export function initFutunnConfig(): FutunnConfig {
  const configs = getEffectiveConfigs();
  logger.info(`Moomoo游客配置已加载（${configs.length}个cookie，round-robin轮询）`, { dbWrite: false });

  // 异步加载 DB 配置（fire-and-forget）
  refreshDBConfigs().catch(() => {});

  // 定时刷新
  if (!_dbConfigsRefreshTimer) {
    _dbConfigsRefreshTimer = setInterval(() => {
      refreshDBConfigs().catch(() => {});
    }, DB_CONFIGS_TTL);
  }

  return configs[0];
}

/**
 * 获取富途牛牛/Moomoo API的基础headers
 */
export function getFutunnHeaders(referer: string = 'https://www.moomoo.com/'): Record<string, string> {
  const config = getFutunnConfig();

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

  // 添加CSRF token和cookies
  headers['futu-x-csrf-token'] = config.csrfToken;
  headers['Cookie'] = config.cookies;

  return headers;
}

/**
 * 获取搜索接口专用的headers（可以单独配置cookies）
 * 优先使用数据库中的 futunn_search_cookies 配置，如果没有则使用默认配置
 */
export async function getFutunnSearchHeaders(referer: string = 'https://www.moomoo.com/'): Promise<Record<string, string>> {
  const baseHeaders: Record<string, string> = {
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

  // 尝试从数据库获取搜索专用的cookies
  let searchCookies: string | null = null;
  let configSource = '硬编码（游客配置）';

  try {
    const configService = (await import('../services/config.service')).default;
    const dbSearchCookies = await configService.getConfig('futunn_search_cookies');

    if (dbSearchCookies && dbSearchCookies.trim() !== '') {
      searchCookies = dbSearchCookies;
      configSource = '数据库（搜索专用）';
      logger.debug(`[富途搜索配置] 使用数据库中的搜索专用cookies（长度: ${searchCookies.length}）`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[富途搜索配置] 无法从数据库获取搜索专用cookies: ${msg}`);
  }

  // 如果数据库中没有搜索专用cookies，尝试使用主cookies配置
  if (!searchCookies) {
    try {
      const configService = (await import('../services/config.service')).default;
      const dbCookies = await configService.getConfig('futunn_cookies');

      if (dbCookies && dbCookies.trim() !== '') {
        searchCookies = dbCookies;
        configSource = '数据库（主配置）';
        logger.debug(`[富途搜索配置] 使用数据库中的主cookies配置（长度: ${searchCookies.length}）`);
      }
    } catch {
      // 忽略错误，继续使用硬编码配置
    }
  }

  // 如果还是没有，使用硬编码的默认配置
  if (!searchCookies) {
    const config = getFutunnConfig();
    searchCookies = config.cookies;
    configSource = '硬编码（游客配置）';
  }

  // 尝试从cookies中提取CSRF token（如果存在）
  let csrfToken: string | null = null;
  const csrfMatch = searchCookies.match(/csrfToken=([^;]+)/);
  if (csrfMatch) {
    csrfToken = csrfMatch[1];
  }

  // 如果cookies中没有CSRF token，尝试从数据库获取主配置的CSRF token
  if (!csrfToken) {
    try {
      const configService = (await import('../services/config.service')).default;
      const dbCsrfToken = await configService.getConfig('futunn_csrf_token');
      if (dbCsrfToken && dbCsrfToken.trim() !== '') {
        csrfToken = dbCsrfToken;
      }
    } catch {
      // 忽略错误
    }
  }

  // 如果还是没有，使用硬编码的CSRF token
  if (!csrfToken) {
    const config = getFutunnConfig();
    csrfToken = config.csrfToken;
  }

  // 添加Cookie和CSRF token
  baseHeaders['Cookie'] = searchCookies;
  baseHeaders['futu-x-csrf-token'] = csrfToken;

  logger.debug(`[富途搜索配置] 配置来源: ${configSource}`);
  logger.debug(`[富途搜索配置] CSRF Token: ${csrfToken.substring(0, 12)}...`);

  return baseHeaders;
}

// 启动时初始化配置
initFutunnConfig();
