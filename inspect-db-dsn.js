const { Pool } = require('pg');

async function run() {
  const dsn = process.env.DSN;
  if (!dsn) {
    console.error('Missing DSN env var. Example (PowerShell):');
    console.error(`$env:DSN = 'postgresql://user:pass@host/db?sslmode=require'`);
    console.error('then: node inspect-db-dsn.js');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn, ssl: { rejectUnauthorized: false } });
  let client;
  try {
    client = await pool.connect();
    console.log('Connected to DSN');

    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('\nTables found:', tablesRes.rows.map(r => r.table_name).join(', '));

    for (const { table_name } of tablesRes.rows) {
      console.log(`\n== Table: ${table_name} ==`);
      const colsRes = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table_name]);
      for (const col of colsRes.rows) {
        console.log(`- ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable}) default: ${col.column_default ?? 'NULL'}`);
      }

      // Sample 5 rows if small/known tables
      if (['users','keys','tokens','credit_transactions','key_redemptions','request_transactions'].includes(table_name)) {
        try {
          const sampleRes = await client.query(`SELECT * FROM ${table_name} LIMIT 5`);
          console.log(`Sample rows (${sampleRes.rowCount}):`);
          for (const row of sampleRes.rows) {
            console.log(row);
          }
        } catch (e) {
          console.log(`(Could not fetch sample rows from ${table_name}: ${e.message})`);
        }
      }
    }

    // Quick compatibility summary
    const usersCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `);
    const userColSet = new Set(usersCols.rows.map(r => r.column_name));
    console.log('\nUsers columns contain requests?', userColSet.has('requests'));
    console.log('Users columns contain credits?', userColSet.has('credits'));

    const keysCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'keys'
    `);
    const keyColSet = new Set(keysCols.rows.map(r => r.column_name));
    console.log('Keys columns:', Array.from(keyColSet).join(', '));
  } catch (err) {
    console.error('Inspection error:', err.message);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

run();
