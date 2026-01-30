const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:qwer1234!@localhost:5432/trading_db'
});

async function diagnose() {
  try {
    console.log('=== 1. Strategy 10 Instances ===');
    const instances = await pool.query(
      'SELECT symbol, current_state, context, last_updated FROM strategy_instances WHERE strategy_id = 10 ORDER BY last_updated DESC LIMIT 10'
    );
    console.log('Total instances:', instances.rowCount);
    console.log(JSON.stringify(instances.rows, null, 2));

    console.log('\n=== 2. Recent Signals (Last 2 days) ===');
    const signals = await pool.query(
      `SELECT id, symbol, signal_type, price, reason, metadata, status, created_at
       FROM strategy_signals
       WHERE strategy_id = 10 AND created_at >= NOW() - INTERVAL '2 days'
       ORDER BY created_at DESC LIMIT 20`
    );
    console.log('Total signals:', signals.rowCount);

    if (signals.rowCount > 0) {
      signals.rows.forEach((s, i) => {
        console.log(`\nSignal ${i + 1}:`);
        console.log('  Symbol:', s.symbol);
        console.log('  Type:', s.signal_type);
        console.log('  Status:', s.status);
        console.log('  Reason:', s.reason ? s.reason.substring(0, 100) : 'N/A');
        console.log('  Created:', s.created_at);
        if (s.metadata) {
          if (s.metadata.optionSymbol) {
            console.log('  Option Symbol:', s.metadata.optionSymbol);
            console.log('  Strike Price:', s.metadata.strikePrice);
            console.log('  Direction:', s.metadata.optionDirection);
          }
        }
      });
    } else {
      console.log('❌ No signals generated in last 2 days - This is the problem!');
    }

    console.log('\n=== 3. Recent Orders (Last 2 days) ===');
    const orders = await pool.query(
      `SELECT id, symbol, side, quantity, price, current_status, created_at
       FROM execution_orders
       WHERE strategy_id = 10 AND created_at >= NOW() - INTERVAL '2 days'
       ORDER BY created_at DESC LIMIT 20`
    );
    console.log('Total orders:', orders.rowCount);

    if (orders.rowCount > 0) {
      console.log(JSON.stringify(orders.rows, null, 2));
    } else {
      console.log('No orders in last 2 days');
    }

    console.log('\n=== 4. Capital Allocation ===');
    const capital = await pool.query(
      'SELECT id, name, total_capital, allocated_capital FROM capital_allocations WHERE id = 9'
    );
    if (capital.rowCount > 0) {
      console.log(JSON.stringify(capital.rows[0], null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

diagnose();
