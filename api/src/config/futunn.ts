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
    csrfToken: '4BBtlR29Ixmg4SWW_GR7VGgn',
    cookies: 'cipher_device_id=1763971814778021; device_id=1763971814778021; _gcl_au=1.1.1320793734.1763971839; _mg_ckp=eyJja1RrZERGIjoiIn0=; __lt__cid=ee3c0c9d-3027-4b78-9db8-39854191fde9; _yjsu_yjad=1763971839.d31da0fe-c2c0-47a1-8528-36ecc4e27e55; _tt_enable_cookie=1; _ttp=01KATEMD6NAZBT2CJCF3ZKBZ41_.tt.1; __qca=P1-722a293c-31d3-4ee4-b36f-8e57523b8053; __mguid_=0e0369e2696d07072vb5pd00mawb4ked; _ss_pp_id=4ec8255ca75ddccfc401763943040859; FUTU_TIMEZONE=Asia%2FShanghai; csrfToken=4BBtlR29Ixmg4SWW_GR7VGgn; futu-offline-csrf-v2=u%2B8Ge3D8OD23piTUo1a6YA%3D%3D; _gid=GA1.2.1064953976.1770793596; _gat_UA-137699611-5=1; locale=zh-cn; locale.sig=_8-JHymmrgcL5ROK0F6Mu8XEiGiPWj3juJFFOsvEScI; _ga=GA1.1.1804626796.1763971839; _ga_ZDJSDWKJ3P=GS2.1.s1770799277$o10$g1$t1770799294$j43$l0$h1777386248$dmlLepEf3ZX5E2Y9JI5kqCHu1JFqTD7RFCA; _uetsid=3449d590071811f1b04bf98484b84d01|1w7kwd5|2|g3h|0|2233; _ga_76MJLWJGT4=GS2.2.s1770799277$o24$g0$t1770799294$j43$l0$h0; _ga_25WYRC4KDG=GS2.1.s1770799278$o34$g1$t1770799294$j44$l0$h0$drH6SYE9TRbfkkPDk4J3t4c7GZH05RP-lfA; _uetvid=10ea6980c90d11f0b434d3853efc02b0|2xkpa0|1770799294855|2|1|bat.bing.com/p/insights/c/b; ttcsid_D0QOPQRC77U7M2KJAGJG=1770799278031::CrSNbjjPpf3uhqIScpMU.21.1770799294860.1; ttcsid_D4DUI6JC77UA35RT1N4G=1770799278032::aszRcLBfpvg8AnpP-Mob.21.1770799294860.1; ttcsid_D4E40SBC77UA35RT20JG=1770799278033::6vF0TQbwYRSSO25G1PKW.21.1770799294860.1; cto_bundle=IqitG184UCUyRiUyQkRqQzhzZkVkVmlZTFhFMjMwbURHTTVDQTVDdTNVd3RQTmdNaG45RGxzV2NGdWNuTk44WWw1OUhEU25RJTJGMlpwTHdTSEN3Skkwc3ZqVUx4akxEZ0pubVVsYVVhSTQ0UzFTRkpad01hYWVaajZxOHU1YVFsampuMFN0ME1sUzlTRHl3alhZWVc5MzgyRzJIc2ZXSGclM0QlM0Q; ftreport-jssdk%40session={%22distinctId%22:%22ftv1mMllOlsD59hMVEMUfsUIlDIhwHhGbRW+izcksZ2Pv4Ypc9TW79CWWEeyejx23hMD%22%2C%22firstId%22:%22ftv1mMllOlsD59hMVEMUfsUIlCfz/R+9vJB9fA6tf/zSKbIpc9TW79CWWEeyejx23hMD%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; _td=47c8a206-0b21-4008-a666-4c750049cbac; ttcsid=1770799278032::zaEmaYtP6i8alY9QXSj9.21.1770799294860.0::1.10082.16380::46471.10.281.616::0.0.0; _rdt_uuid=1763971823005.3f644dc2-6dd1-4465-9ddd-65d6744fc139',
    label: 'Guest #1',
  },
  {
    csrfToken: 'bMZdRQVliYtPd9zSiQ2RqB2Y',
    cookies: 'csrfToken=bMZdRQVliYtPd9zSiQ2RqB2Y; cipher_device_id=1770799451106330; ftreport-jssdk%40new_user=1; locale=en-us; locale.sig=kYCWOTxYZzzw1XlXa271MN6gu-mD2VMdpd93Q4xYSSs; _gid=GA1.2.1993268494.1770799457; _gat_UA-137699611-5=1; _gcl_au=1.1.629712897.1770799457; _ga=GA1.1.1864842949.1770799457; _ga_ZDJSDWKJ3P=GS2.1.s1770799455$o1$g1$t1770799456$j59$l0$h1714110453$d05Sppe4bAvfhfyuUCy8qRABqI1Q5fxI_eA; _mg_ckp=eyJja1RrZERGIjoiIn0=; _ga_76MJLWJGT4=GS2.2.s1770799457$o1$g0$t1770799457$j60$l0$h0; _uetsid=d972cf60072511f1a03c53abc8832b95|1j398lf|2|g3h|0|2233; _fbp=fb.1.1770799457150.550810131152727553; _yjsu_yjad=1770799457.1af84db8-bceb-406b-a2af-f31f326dec5d; __qca=P1-6590d6dd-50bb-4923-9b81-6621355c0457; _tt_enable_cookie=1; _ttp=01KH5XYRZ54PNMDGHQYCAWPBY0_.tt.1; _ss_pp_id=d82f370045c1ebcb1581770770657323; _uetvid=d972fc60072511f188176f4c787345d9|w47f4z|1770799457452|1|1|bat.bing.com/p/insights/c/b; __mguid_=76f35f0fecd24d05b5bcc0c02314da49; cto_bundle=BBYMNF9FVkgwSHVSWWo1clV5dzVBOGZENGFsbVR1YjVYS1gyTzhJUndTZSUyRjN4UmNrTkoxc25oN3NtMGsyRDUzSUFXNmZxZnhUejNYNFgxUVJQSE5YNE56RzMyOWRoaW1uanYlMkZCRlRRSjV5bVI4R3pKJTJGdEMlMkJqUTBLdiUyRm9QTyUyRkhGSk9EbQ; _ga_25WYRC4KDG=GS2.1.s1770799457$o1$g0$t1770799457$j60$l0$h0$dIryDvAmc0-IbtaRY5yeHB5TYWTiB_lnZnw; ftreport-jssdk%40session={%22distinctId%22:%22ftv122IGwJQj2ncY0iu64wl1S5mDdVauUc+t2yXP1Uuece5lo1G9BLBpFHKnM2dMsBOq%22%2C%22firstId%22:%22ftv122IGwJQj2ncY0iu64wl1Sx8jmkyX8iCRzOhgLOSLVillo1G9BLBpFHKnM2dMsBOq%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; ttcsid_D0QOPQRC77U7M2KJAGJG=1770799457260::M25qWY77nULOjiL8FIzd.1.1770799467278.1; ttcsid_D4DUI6JC77UA35RT1N4G=1770799457262::X3xP45nquZWi6VUgLwA_.1.1770799467280.1; ttcsid_D4E40SBC77UA35RT20JG=1770799457263::LrH0Ad1ZGt72dvb3ZlMb.1.1770799467281.1; ttcsid=1770799457260::MEcce-pBzpDzqiUoJXTa.1.1770799467281.0::1.-5770.47::44493.3.266.613::0.0.0; _rdt_uuid=1770799455824.c42f9879-690e-4d4d-82ed-734d8a442584',
    label: 'Guest #2',
  },
  {
    csrfToken: 'nHw2TYiBQA0hxqP3qt-b1j4g',
    cookies: 'csrfToken=nHw2TYiBQA0hxqP3qt-b1j4g; cipher_device_id=1770799556161980; ftreport-jssdk%40new_user=1; _gid=GA1.2.124065327.1770799561; _gat_UA-137699611-5=1; _gcl_au=1.1.386017817.1770799561; _ga=GA1.1.982274856.1770799561; _ga_ZDJSDWKJ3P=GS2.1.s1770799559$o1$g1$t1770799561$j58$l0$h1039476057$du_iBaGfiH9T6w_31F9MZC4cEjBvCbVVlWA; _mg_ckp=eyJja1RrZERGIjoiIn0=; locale=en-us; locale.sig=VqoPLcN4ieQqgpFWEtINd7kgYnHLtT740KlCcrWAFsQ; _uetsid=17d051b0072611f18e8a692266dddf53|1uhkj7o|2|g3h|0|2233; _ga_76MJLWJGT4=GS2.2.s1770799561$o1$g0$t1770799561$j60$l0$h0; __mguid_=9da8cb1784fb44848b2a5c24c72c6ff8; __qca=P1-b5699a25-0bef-47f2-bc00-c37ddb8cf9e9; _yjsu_yjad=1770799562.0723d6fe-f8fe-4306-b82a-a8bce5ee9dde; _ga_25WYRC4KDG=GS2.1.s1770799562$o1$g0$t1770799562$j60$l0$h0$dlWOhizBWvMjcWuUt72SUajEu0VporcFXhw; _tt_enable_cookie=1; _ttp=01KH5Y1ZZ8HP2TAZJGCNY3QG3Z_.tt.1; _uetvid=17d06d30072611f180ac4fe33c2252aa|qtq0e4|1770799562786|1|1|bat.bing.com/p/insights/c/b; _ss_pp_id=fa7abef2aba630c591e1770770762854; ttcsid_D0QOPQRC77U7M2KJAGJG=1770799562734::Hkr-s995M-tZW6AiA-uu.1.1770799562992.0; ttcsid_D4DUI6JC77UA35RT1N4G=1770799562735::UVPUAPoIEp3wZxky6_-c.1.1770799562992.0; ttcsid_D4E40SBC77UA35RT20JG=1770799562736::-qP7ymrY7v8rye2diNNL.1.1770799562992.0; _fbp=fb.1.1770799563002.669422765674111063; cto_bundle=1WfueV9FMUk3aGszeFFOUmtpcTZFbjIzbHNGZDlZTEVzcW1zeGV6V2NqbnNEeWhIdlJLbUpOcFVwbWMwTlV2RkRpNERyNk05Mk9PaSUyQjczNyUyRkNTVWNwV09zanZtSEVPNHpsOGZ5cE4yQjZTZEI5WlY0MnZXTk1OeGN4QXlUeGtNSjNURDQ; ftreport-jssdk%40session={%22distinctId%22:%22ftv1T7NOLzRPW4MaOdC6gFTQ11jtHDFY+wdd4QZAHOMwrdHMzEzofRpG0Hr6AILHaHpd%22%2C%22firstId%22:%22ftv1T7NOLzRPW4MaOdC6gFTQ13fNf/jcb+ymfKTMCu4xfrXMzEzofRpG0Hr6AILHaHpd%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; ttcsid=1770799562734::vP1KzZmNc4SjupuSbTak.1.1770799562991.0::1.-6747.41::4320.1.278.620::0.0.0; _rdt_uuid=1770799559945.89c7538b-6491-4b61-8537-421a3d2da898',
    label: 'Guest #3',
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
