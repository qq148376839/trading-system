/**
 * 富途牛牛/Moomoo API配置
 * 
 * 使用Moomoo游客cookies，无需环境变量配置
 * 域名统一使用 www.moomoo.com
 */

// Moomoo游客的CSRF token和cookies（硬编码）
const MOOMOO_GUEST_CONFIG = {
  csrfToken: 'f51O2KPxQvir0tU5zDCVQpMm',
  cookies: 'cipher_device_id=1763971814778021; ftreport-jssdk%40new_user=1; futu-csrf=niasJM1N1jtj3pyQh6JO4Nknn7c=; device_id=1763971814778021; _gid=GA1.2.1022515751.1763971839; _gcl_au=1.1.1320793734.1763971839; _mg_ckp=eyJja1RrZERGIjoiIn0=; __lt__cid=ee3c0c9d-3027-4b78-9db8-39854191fde9; __lt__sid=e85328b3-228692ea; _yjsu_yjad=1763971839.d31da0fe-c2c0-47a1-8528-36ecc4e27e55; _tt_enable_cookie=1; _ttp=01KATEMD6NAZBT2CJCF3ZKBZ41_.tt.1; __qca=P1-722a293c-31d3-4ee4-b36f-8e57523b8053; __mguid_=0e0369e2696d07072vb5pd00mawb4ked; _ss_pp_id=4ec8255ca75ddccfc401763943040859; csrfToken=f51O2KPxQvir0tU5zDCVQpMm; _ga=GA1.2.1804626796.1763971839; _ga_76MJLWJGT4=GS2.2.s1763971839$o1$g0$t1763972122$j48$l0$h0; _uetsid=10ea87a0c90d11f088e4c1b06da112b9|cthdk|2|g1a|0|2154; ttcsid=1763971839192::cJGo9CHwlNwIHiUiI1Cp.1.1763972122638.0; ttcsid_D0QOPQRC77U7M2KJAGJG=1763971839191::aJRGPeYW1tu321ed9-6B.1.1763972122638.0; ttcsid_D4DUI6JC77UA35RT1N4G=1763971839218::Oel3J3n7hr2YxWAEbbXY.1.1763972122638.0; ttcsid_D4E40SBC77UA35RT20JG=1763971839219::o4dDfj0Ws72bbuJmMnSJ.1.1763972122638.0; _uetvid=10ea6980c90d11f0b434d3853efc02b0|tl6ecm|1763972122830|5|1|bat.bing.com/p/insights/c/b; ftreport-jssdk%40session={%22distinctId%22:%22ftv1mMllOlsD59hMVEMUfsUIlDmhHJ2O3RnKm224LUsPR1Upc9TW79CWWEeyejx23hMD%22%2C%22firstId%22:%22ftv1mMllOlsD59hMVEMUfsUIlCfz/R+9vJB9fA6tf/zSKbIpc9TW79CWWEeyejx23hMD%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; _ga_25WYRC4KDG=GS2.1.s1763971839$o1$g1$t1763972124$j36$l0$h0; locale=zh-cn; locale.sig=ObiqV0BmZw7fEycdGJRoK-Q0Yeuop294gBeiHL1LqgQ; _rdt_uuid=1763971823005.3f644dc2-6dd1-4465-9ddd-65d6744fc139',
};

export interface FutunnConfig {
  csrfToken: string;
  cookies: string;
}

/**
 * 获取富途牛牛/Moomoo配置（使用游客配置）
 */
export function getFutunnConfig(): FutunnConfig {
  return MOOMOO_GUEST_CONFIG;
}

/**
 * 设置富途牛牛配置（用于测试或动态更新，通常不需要）
 */
export function setFutunnConfig(config: FutunnConfig) {
  // 保留接口，但实际使用硬编码的游客配置
  console.warn('setFutunnConfig: 当前使用硬编码的Moomoo游客配置，设置操作将被忽略');
}

/**
 * 初始化富途牛牛配置（已废弃，保留用于兼容性）
 */
export function initFutunnConfig(): FutunnConfig {
  console.log('✅ Moomoo游客配置已加载（无需环境变量）');
  return MOOMOO_GUEST_CONFIG;
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

// 启动时初始化配置
initFutunnConfig();
