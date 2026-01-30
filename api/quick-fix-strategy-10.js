/**
 * Quick fix for Strategy 10 - Initialize strategy instances
 *
 * The root cause: strategy_instances records are never created because
 * generateSignal() returns null (likely due to HOLD recommendation or
 * option contract selection failure).
 *
 * This script initializes the instances manually to allow the strategy to run.
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:qwer1234!@localhost:5432/trading_db'
});

async function quickFix() {
  try {
    console.log('=== Quick Fix for Strategy 10 ===\n');

    // 1. Check current strategy instances
    console.log('1. Checking current strategy instances...');
    const instances = await pool.query(
      'SELECT * FROM strategy_instances WHERE strategy_id = 10'
    );
    console.log(`   Found ${instances.rowCount} instances`);

    // 2. Get strategy configuration
    const strategy = await pool.query(
      'SELECT id, name, type, symbol_pool_config, config FROM strategies WHERE id = 10'
    );

    if (strategy.rowCount === 0) {
      console.log('❌ Strategy 10 not found!');
      return;
    }

    const strategyData = strategy.rows[0];
    console.log(`\n2. Strategy Configuration:`);
    console.log(`   Name: ${strategyData.name}`);
    console.log(`   Type: ${strategyData.type}`);
    console.log(`   Symbol Pool:`, JSON.stringify(strategyData.symbol_pool_config, null, 2));

    const symbols = strategyData.symbol_pool_config?.symbols || [];
    console.log(`   Symbols: ${symbols.join(', ')}`);

    if (symbols.length === 0) {
      console.log('❌ No symbols in pool!');
      return;
    }

    // 3. Initialize instances for all symbols in the pool
    console.log(`\n3. Initializing instances for ${symbols.length} symbol(s)...`);

    for (const symbol of symbols) {
      // Check if instance already exists
      const existing = await pool.query(
        'SELECT * FROM strategy_instances WHERE strategy_id = $1 AND symbol = $2',
        [10, symbol]
      );

      if (existing.rowCount > 0) {
        console.log(`   ✓ ${symbol}: Already exists (state: ${existing.rows[0].current_state})`);
      } else {
        // Insert new instance with IDLE state
        await pool.query(
          `INSERT INTO strategy_instances (strategy_id, symbol, current_state, context, last_updated)
           VALUES ($1, $2, $3, $4, NOW())`,
          [10, symbol, 'IDLE', null]
        );
        console.log(`   ✓ ${symbol}: Created with IDLE state`);
      }
    }

    // 4. Verify instances were created
    console.log(`\n4. Verifying instances...`);
    const finalInstances = await pool.query(
      'SELECT symbol, current_state, last_updated FROM strategy_instances WHERE strategy_id = 10'
    );

    console.log(`   Total instances: ${finalInstances.rowCount}`);
    finalInstances.rows.forEach(row => {
      console.log(`     - ${row.symbol}: ${row.current_state} (updated: ${row.last_updated})`);
    });

    // 5. Provide next steps
    console.log(`\n5. Next Steps:`);
    console.log(`   ✅ Instances have been initialized`);
    console.log(`   ✅ Strategy 10 should now process these symbols`);
    console.log(`\n   Monitor the strategy:`);
    console.log(`   - Check logs for signal generation`);
    console.log(`   - Run: SELECT * FROM strategy_signals WHERE strategy_id = 10 ORDER BY created_at DESC LIMIT 10`);
    console.log(`   - Run: SELECT * FROM execution_orders WHERE strategy_id = 10 ORDER BY created_at DESC LIMIT 10`);

    console.log(`\n6. If signals are still not generated, check:`);
    console.log(`   a) Recommendation service: Does QQQ.US return BUY/SELL or HOLD?`);
    console.log(`   b) Option contract selection: Are there any 0DTE options available?`);
    console.log(`   c) Liquidity filters: Are they too strict? (minOpenInterest: 500)`);
    console.log(`   d) Market window: Are we in the "no new entry" window? (60 mins before close)`);

    console.log(`\n7. Temporary workaround if needed:`);
    console.log(`   Change directionMode to 'CALL_ONLY' to bypass recommendation:`);
    console.log(`   UPDATE strategies SET config = jsonb_set(config, '{directionMode}', '"CALL_ONLY"') WHERE id = 10;`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

quickFix();
