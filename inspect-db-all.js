const { Pool } = require('pg');
require('dotenv').config();

async function inspectSchema() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_67BPVAIWZEDg@ep-wispy-fog-adt9noug-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
  if (!connectionString) {
    console.error('DATABASE_URL not found');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  let client;
  try {
    client = await pool.connect();
    console.log('Connected to database');

    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    for (const row of tablesRes.rows) {
      const table = row.table_name;
      console.log(`\n== Table: ${table} ==`);
      const colsRes = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      for (const col of colsRes.rows) {
        console.log(`- ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable}) default: ${col.column_default ?? 'NULL'}`);
      }
    }
  } catch (err) {
    console.error('Schema inspection error:', err.message);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

inspectSchema();
