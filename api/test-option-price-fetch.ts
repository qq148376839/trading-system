/**
 * 期权价格获取集成测试
 * 测试真实的期权价格获取功能
 */

import { getQuoteContext } from './src/config/longport';
import optionPriceCacheService from './src/services/option-price-cache.service';

async function testOptionPriceFetch() {
  console.log('='.repeat(80));
  console.log('期权价格获取集成测试');
  console.log('='.repeat(80));
  console.log();

  try {
    // 测试的期权合约（使用日志中出现的真实合约代码）
    const optionSymbols = [
      'QQQ260128C634000', // 日志中出现的QQQ看涨期权
      'QQQ260128C635000', // 日志中出现的QQQ看涨期权
      'QQQ.US', // 测试股票价格获取
    ];

    const quoteCtx = await getQuoteContext();

    for (const symbol of optionSymbols) {
      console.log(`\n测试期权: ${symbol}`);
      console.log('-'.repeat(60));

      try {
        const quotes = await quoteCtx.quote([symbol]);

        if (quotes && quotes.length > 0) {
          const quote = quotes[0];
          console.log('原始报价数据:');
          console.log(`  symbol: ${quote.symbol}`);
          console.log(`  lastDone: ${quote.lastDone || 'N/A'}`);
          console.log(`  last_done: ${(quote as any).last_done || 'N/A'}`);
          console.log(`  bidPrice: ${quote.bidPrice || 'N/A'}`);
          console.log(`  askPrice: ${quote.askPrice || 'N/A'}`);

          // 模拟getCurrentMarketPrice逻辑
          let price = 0;
          let bid = 0;
          let ask = 0;
          let priceSource = '';

          if (quote.bidPrice) {
            bid = parseFloat((quote.bidPrice as any)?.toString() || '0');
          }
          if (quote.askPrice) {
            ask = parseFloat((quote.askPrice as any)?.toString() || '0');
          }

          // 1. 最近成交价
          if (quote.lastDone) {
            price = parseFloat(quote.lastDone.toString());
            priceSource = 'lastDone';
          } else if ((quote as any).last_done) {
            price = parseFloat((quote as any).last_done.toString());
            priceSource = 'last_done';
          }

          // 2. 中间价
          if (price <= 0 && ask > 0 && bid > 0) {
            price = (ask + bid) / 2;
            priceSource = 'mid (bid-ask)';
          }

          // 3. 卖一价
          if (price <= 0 && ask > 0) {
            price = ask;
            priceSource = 'ask';
          }

          // 4. 买一价
          if (price <= 0 && bid > 0) {
            price = bid;
            priceSource = 'bid';
          }

          console.log();
          console.log('计算结果:');
          console.log(`  ✓ 最终价格: ${price > 0 ? price.toFixed(4) : 'N/A'}`);
          console.log(`  ✓ 价格来源: ${priceSource || 'N/A'}`);
          console.log(`  ✓ Bid: ${bid > 0 ? bid.toFixed(4) : 'N/A'}`);
          console.log(`  ✓ Ask: ${ask > 0 ? ask.toFixed(4) : 'N/A'}`);

          if (price > 0) {
            // 测试缓存功能
            optionPriceCacheService.set(symbol, {
              price,
              bid: bid || price,
              ask: ask || price,
              mid: (bid > 0 && ask > 0) ? (bid + ask) / 2 : price,
              timestamp: Date.now(),
              underlyingPrice: 0,
              source: 'longport',
            });
            console.log(`  ✓ 价格已缓存`);

            // 验证缓存
            const cached = optionPriceCacheService.get(symbol);
            if (cached) {
              console.log(`  ✓ 缓存验证成功: ${cached.price.toFixed(4)}`);
            }
          } else {
            console.log('  ✗ 无法获取有效价格');
          }
        } else {
          console.log('  ✗ 未返回报价数据');
        }
      } catch (error: any) {
        console.log(`  ✗ 错误: ${error.message}`);
      }

      // 延迟避免API限流
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 测试缓存统计
    console.log();
    console.log('='.repeat(80));
    console.log('缓存统计:');
    const stats = optionPriceCacheService.getStats();
    console.log(`  总缓存条目: ${stats.totalEntries}`);
    console.log(`  有效条目: ${stats.validEntries}`);
    console.log(`  过期条目: ${stats.expiredEntries}`);
    console.log();

    console.log('='.repeat(80));
    console.log('测试完成！');
    console.log('='.repeat(80));

    process.exit(0);
  } catch (error: any) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testOptionPriceFetch();
