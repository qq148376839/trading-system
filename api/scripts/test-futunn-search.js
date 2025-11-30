/**
 * 测试富途搜索 API
 * 验证直接请求是否成功
 */

const axios = require('axios');
const path = require('path');

// 手动实现 getFutunnHeaders（因为脚本环境不同）
function getFutunnHeaders(referer = 'https://www.moomoo.com/') {
  const MOOMOO_GUEST_CONFIG = {
    csrfToken: 'f51O2KPxQvir0tU5zDCVQpMm',
    cookies: 'cipher_device_id=1763971814778021; ftreport-jssdk%40new_user=1; futu-csrf=niasJM1N1jtj3pyQh6JO4Nknn7c=; device_id=1763971814778021; _gid=GA1.2.1022515751.1763971839; _gcl_au=1.1.1320793734.1763971839; _mg_ckp=eyJja1RrZERGIjoiIn0=; __lt__cid=ee3c0c9d-3027-4b78-9db8-39854191fde9; __lt__sid=e85328b3-228692ea; _yjsu_yjad=1763971839.d31da0fe-c2c0-47a1-8528-36ecc4e27e55; _tt_enable_cookie=1; _ttp=01KATEMD6NAZBT2CJCF3ZKBZ41_.tt.1; __qca=P1-722a293c-31d3-4ee4-b36f-8e57523b8053; __mguid_=0e0369e2696d07072vb5pd00mawb4ked; _ss_pp_id=4ec8255ca75ddccfc401763943040859; csrfToken=f51O2KPxQvir0tU5zDCVQpMm; _ga=GA1.2.1804626796.1763971839; _ga_76MJLWJGT4=GS2.2.s1763971839$o1$g0$t1763972122$j48$l0$h0; _uetsid=10ea87a0c90d11f088e4c1b06da112b9|cthdk|2|g1a|0|2154; ttcsid=1763971839192::cJGo9CHwlNwIHiUiI1Cp.1.1763972122638.0; ttcsid_D0QOPQRC77U7M2KJAGJG=1763971839191::aJRGPeYW1tu321ed9-6B.1.1763972122638.0; ttcsid_D4DUI6JC77UA35RT1N4G=1763971839218::Oel3J3n7hr2YxWAEbbXY.1.1763972122638.0; ttcsid_D4E40SBC77UA35RT20JG=1763971839219::o4dDfj0Ws72bbuJmMnSJ.1.1763972122638.0; _uetvid=10ea6980c90d11f0b434d3853efc02b0|tl6ecm|1763972122830|5|1|bat.bing.com/p/insights/c/b; ftreport-jssdk%40session={%22distinctId%22:%22ftv1mMllOlsD59hMVEMUfsUIlDmhHJ2O3RnKm224LUsPR1Upc9TW79CWWEeyejx23hMD%22%2C%22firstId%22:%22ftv1mMllOlsD59hMVEMUfsUIlCfz/R+9vJB9fA6tf/zSKbIpc9TW79CWWEeyejx23hMD%22%2C%22latestReferrer%22:%22https://www.moomoo.com/%22}; _ga_25WYRC4KDG=GS2.1.s1763971839$o1$g1$t1763972124$j36$l0$h0; locale=zh-cn; locale.sig=ObiqV0BmZw7fEycdGJRoK-Q0Yeuop294gBeiHL1LqgQ; _rdt_uuid=1763971823005.3f644dc2-6dd1-4465-9ddd-65d6744fc139',
  };
  
  return {
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
    'futu-x-csrf-token': MOOMOO_GUEST_CONFIG.csrfToken,
    'Cookie': MOOMOO_GUEST_CONFIG.cookies,
  };
}

async function testSearch() {
  const keyword = 'TSLA';
  const url = 'https://www.moomoo.com/api/headfoot-search';
  const params = {
    keyword: keyword.toLowerCase(),
    lang: 'zh-cn',
    site: 'sg',
  };
  
  // 使用硬编码配置
  const headers = getFutunnHeaders('https://www.moomoo.com/');
  
  console.log('=== 测试富途搜索 API ===\n');
  console.log('请求参数:', params);
  console.log('URL:', `${url}?${new URLSearchParams(params).toString()}`);
  console.log('\nHeaders:');
  console.log('  futu-x-csrf-token:', headers['futu-x-csrf-token']?.substring(0, 20) + '...');
  console.log('  Cookie 长度:', headers['Cookie']?.length || 0);
  console.log('  Referer:', headers['referer']);
  console.log('  User-Agent:', headers['user-agent']?.substring(0, 60) + '...');
  
  const startTime = Date.now();
  
  try {
    const response = await axios.get(url, {
      params,
      headers,
      timeout: 10000,
    });
    
    const duration = Date.now() - startTime;
    
    console.log('\n=== 响应成功 ===');
    console.log('状态码:', response.status);
    console.log('耗时:', `${duration}ms`);
    console.log('返回码:', response.data?.code);
    console.log('返回消息:', response.data?.message);
    console.log('股票数量:', response.data?.data?.stock?.length || 0);
    
    if (response.data?.data?.stock && response.data.data.stock.length > 0) {
      const tsla = response.data.data.stock.find(s => s.stockSymbol === 'TSLA');
      if (tsla) {
        console.log('\n找到 TSLA:');
        console.log('  stockId:', tsla.stockId);
        console.log('  symbol:', tsla.symbol);
        console.log('  stockSymbol:', tsla.stockSymbol);
        console.log('  marketType:', tsla.marketType);
      } else {
        console.log('\n未找到 TSLA，前5个结果:');
        response.data.data.stock.slice(0, 5).forEach(s => {
          console.log(`  ${s.stockSymbol} (${s.symbol}) - stockId: ${s.stockId}`);
        });
      }
    }
    
    console.log('\n完整响应数据（前500字符）:');
    console.log(JSON.stringify(response.data).substring(0, 500));
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.log('\n=== 请求失败 ===');
    console.log('错误代码:', error.code);
    console.log('错误消息:', error.message);
    console.log('耗时:', `${duration}ms`);
    
    if (error.response) {
      console.log('响应状态:', error.response.status);
      console.log('响应数据:', error.response.data);
    }
    
    if (error.request) {
      console.log('请求配置:', {
        url: error.config?.url,
        method: error.config?.method,
        timeout: error.config?.timeout,
      });
    }
  }
}

testSearch();

