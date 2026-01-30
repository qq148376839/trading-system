// 测试期权策略信号生成
const path = require('path');

// 设置环境变量
process.env.DATABASE_URL = 'postgresql://postgres:qwer1234!@localhost:5432/trading_db';

async function testOptionSignalGeneration() {
  try {
    console.log('=== Test Option Strategy Signal Generation ===\n');

    // 动态导入TypeScript模块
    const { OptionIntradayStrategy } = require('./src/services/strategies/option-intraday-strategy.ts');
    const tradingRecommendationService = require('./src/services/trading-recommendation.service.ts').default;

    const symbol = 'QQQ.US';
    const strategyId = 10;
    const config = {
      "feeModel": {
        "commissionPerContract": 0.1,
        "minCommissionPerOrder": 0.99,
        "platformFeePerContract": 0.3
      },
      "assetClass": "OPTION",
      "tradeWindow": {
        "forceCloseBeforeCloseMinutes": 30,
        "noNewEntryBeforeCloseMinutes": 60
      },
      "greekFilters": {
        "deltaMax": 0.6,
        "deltaMin": 0.25
      },
      "directionMode": "FOLLOW_SIGNAL",
      "entryPriceMode": "ASK",
      "expirationMode": "0DTE",
      "positionSizing": {
        "mode": "MAX_PREMIUM",
        "fixedContracts": 1
      },
      "liquidityFilters": {
        "minOpenInterest": 500,
        "maxBidAskSpreadAbs": 0.3,
        "maxBidAskSpreadPct": 25
      }
    };

    // 1. Test recommendation service
    console.log(`1. Testing recommendation service for ${symbol}...`);
    const rec = await tradingRecommendationService.calculateRecommendation(symbol);

    if (!rec) {
      console.log('❌ Recommendation service returned null');
      console.log('   → This is why no signal is generated!');
      return;
    }

    console.log(`✅ Recommendation: ${rec.action}`);
    if (rec.action === 'HOLD') {
      console.log('⚠️  Recommendation is HOLD');
      console.log('   → Option strategy will skip signal generation');
      console.log('   → Try changing directionMode to "CALL_ONLY" to force signal');
      return;
    }

    console.log(`   Direction: ${rec.action}`);
    console.log(`   Summary: ${rec.analysis_summary ? rec.analysis_summary.substring(0, 100) : 'N/A'}`);

    // 2. Test option strategy
    console.log(`\n2. Testing option strategy signal generation...`);
    const strategy = new OptionIntradayStrategy(strategyId, config);
    const intent = await strategy.generateSignal(symbol);

    if (!intent) {
      console.log('❌ Strategy returned null signal');
      console.log('   Possible reasons:');
      console.log('   1. No suitable option contract found (liquidity/Greek filters)');
      console.log('   2. Option chain API failed');
      console.log('   3. Premium calculation failed');
      return;
    }

    console.log('✅ Signal generated successfully!');
    console.log(`   Action: ${intent.action}`);
    console.log(`   Symbol: ${intent.symbol}`);
    console.log(`   Price: ${intent.entryPrice}`);
    console.log(`   Quantity: ${intent.quantity}`);
    console.log(`   Reason: ${intent.reason ? intent.reason.substring(0, 100) : 'N/A'}`);

    if (intent.metadata) {
      console.log('\n   Option Details:');
      console.log(`     Option Symbol: ${intent.metadata.optionSymbol || 'N/A'}`);
      console.log(`     Strike Price: ${intent.metadata.strikePrice || 'N/A'}`);
      console.log(`     Direction: ${intent.metadata.optionDirection || 'N/A'}`);
      console.log(`     Expiration: ${intent.metadata.strikeDate || 'N/A'}`);
      console.log(`     Estimated Fees: $${intent.metadata.estimatedFees || 'N/A'}`);
      console.log(`     Total Cost: $${intent.metadata.allocationAmountOverride || 'N/A'}`);
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  testOptionSignalGeneration().then(() => {
    console.log('\n=== Test completed ===');
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testOptionSignalGeneration };
