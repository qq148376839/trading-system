/**
 * 测试搜索接口的独立cookies配置
 * 
 * 使用方法：
 * node scripts/test-search-cookies.js [keyword]
 * 
 * 示例：
 * node scripts/test-search-cookies.js TSLA
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');
// 使用tsx直接运行TypeScript代码
const path = require('path');
const { register } = require('tsx');

// 注册TypeScript支持
register({
  tsconfig: path.join(__dirname, '../tsconfig.json'),
});

const { getFutunnSearchHeaders } = require('../src/config/futunn');

async function testSearch(keyword = 'TSLA') {
  console.log(`\n========== 测试搜索接口（使用独立cookies配置） ==========`);
  console.log(`关键词: ${keyword}\n`);

  try {
    const url = 'https://www.moomoo.com/api/headfoot-search';
    const params = {
      keyword: keyword.toLowerCase(),
      lang: 'zh-cn',
      site: 'sg',
    };

    // 使用搜索接口专用的headers函数
    console.log('[1] 获取搜索接口专用headers...');
    const headers = await getFutunnSearchHeaders('https://www.moomoo.com/');
    
    console.log('[2] Headers信息:');
    console.log(`  Cookie长度: ${headers['Cookie']?.length || 0}`);
    console.log(`  Cookie预览: ${headers['Cookie']?.substring(0, 100)}...`);
    console.log(`  是否包含futu-x-csrf-token: ${headers['futu-x-csrf-token'] ? '是' : '否'}`);
    console.log(`  Referer: ${headers['referer']}`);
    console.log(`  User-Agent: ${headers['user-agent']?.substring(0, 50)}...`);

    // 构建完整URL
    const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
    console.log(`\n[3] 请求URL: ${fullUrl}`);

    console.log('\n[4] 发送请求...');
    const startTime = Date.now();
    
    const response = await axios.get(url, {
      params,
      headers,
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });

    const duration = Date.now() - startTime;

    console.log(`\n[5] 响应信息:`);
    console.log(`  状态码: ${response.status}`);
    console.log(`  响应时间: ${duration}ms`);
    console.log(`  数据代码: ${response.data?.code}`);
    console.log(`  数据消息: ${response.data?.message || 'N/A'}`);

    if (response.data?.code === 0 && response.data?.data?.stock) {
      const stockList = response.data.data.stock;
      console.log(`  找到股票数量: ${stockList.length}`);
      
      if (stockList.length > 0) {
        console.log(`\n[6] 前5个结果:`);
        stockList.slice(0, 5).forEach((stock, index) => {
          console.log(`  ${index + 1}. ${stock.stockSymbol || stock.symbol} (stockId: ${stock.stockId}, marketType: ${stock.marketType})`);
        });

        // 查找目标股票
        const targetStock = stockList.find(
          stock => stock.symbol === keyword.toUpperCase() + '.US' || 
                   stock.stockSymbol === keyword.toUpperCase()
        );

        if (targetStock) {
          console.log(`\n✅ 成功找到目标股票: ${keyword}`);
          console.log(`  stockId: ${targetStock.stockId}`);
          console.log(`  marketType: ${targetStock.marketType}`);
        } else {
          console.log(`\n⚠️  未找到目标股票: ${keyword}`);
        }
      }
    } else {
      console.log(`\n⚠️  响应数据格式异常:`);
      console.log(`  数据结构:`, JSON.stringify(response.data).substring(0, 200));
    }

    console.log(`\n✅ 测试完成！`);
    return true;
  } catch (error) {
    console.error(`\n❌ 测试失败:`);
    console.error(`  错误代码: ${error.code || 'N/A'}`);
    console.error(`  错误消息: ${error.message}`);
    
    if (error.response) {
      console.error(`  响应状态: ${error.response.status}`);
      console.error(`  响应数据:`, JSON.stringify(error.response.data).substring(0, 200));
    }
    
    if (error.request) {
      console.error(`  请求配置:`, {
        url: error.config?.url,
        method: error.config?.method,
        timeout: error.config?.timeout,
      });
    }

    return false;
  }
}

// 运行测试
const keyword = process.argv[2] || 'TSLA';
testSearch(keyword)
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('未预期的错误:', error);
    process.exit(1);
  });

