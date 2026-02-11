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
    csrfToken: 'f51O2KPxQvir0tU5zDCVQpMm',
    cookies: 'cipher_device_id=1763971814778021; ftreport-jssdk%40new_user=1; futu-csrf=niasJM1N1jtj3pyQh6JO4Nknn7c=; device_id=1763971814778021; _gid=GA1.2.1022515751.1763971839; _gcl_au=1.1.1320793734.1763971839; _mg_ckp=eyJja1RrZERGIjoiIn0=; __lt__cid=ee3c0c9d-3027-4b78-9db8-39854191fde9; __lt__sid=e85328b3-228692ea; _yjsu_yjad=1763971839.d31da0fe-c2c0-47a1-8528-36ecc4e27e55; _tt_enable_cookie=1; _ttp=01KATEMD6NAZBT2CJCF3ZKBZ41_.tt.1; __qca=P1-722a293c-31d3-4ee4-b36f-8e57523b8053; __mguid_=0e0369e2696d07072vb5pd00mawb4ked; _ss_pp_id=4ec8255ca75ddccfc401763943040859; csrfToken=f51O2KPxQvir0tU5zDCVQpMm; _ga=GA1.2.1804626796.1763971839; _ga_76MJLWJGT4=GS2.2.s1763971839$o1$g0$t1763972122$j48$l0$h0; _uetsid=10ea87a0c90d11f088e4c1b06da112b9|cthdk|2|g1a|0|2154; ttcsid=1763971839192::cJGo9CHwlNwIHiUiI1Cp.1.1763972122638.0; ttcsid_D0QOPQRC77U7M2KJAGJG=1763971839191::aJRGPeYW1tu321ed9-6B.1.1763972122638.0; ttcsid_D4DUI6JC77UA35RT1N4G=1763971839218::Oel3J3n7hr2YxWAEbbXY.1.1763972122638.0; ttcsid_D4E40SBC77UA35RT20JG=1763971839219::o4dDfj0Ws72bbuJmMnSJ.1.1763972122638.0; _uetvid=10ea6980c90d11f0b434d3853efc02b0|tl6ecm|1763972122830|5|1|bat.bing.com/p/insights/c/b; ftreport-jssdk%40session={%22distinctId%22:%22ftv1mMllOlsD59hMVEMUfsUIlDmhHJ2O3RnKm224LUsPR1Upc9TW79CWWEeyejx23hMD%22%2C%22firstId%22:%22ftv1mMllOlsD59hMVEMUfsUIlCfz/R+9vJB9fA6tf/zSKbIpc9TW79CWWEeyejx23hMD%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; _ga_25WYRC4KDG=GS2.1.s1763971839$o1$g1$t1763972124$j36$l0$h0; locale=zh-cn; locale.sig=ObiqV0BmZw7fEycdGJRoK-Q0Yeuop294gBeiHL1LqgQ; _rdt_uuid=1763971823005.3f644dc2-6dd1-4465-9ddd-65d6744fc139',
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
function getEffectiveConfigs(): FutunnConfig[] {
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
