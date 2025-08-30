const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    client = await pool.connect();

    // Test basic query without any complex logic
    const result = await client.query('SELECT * FROM keys ORDER BY created_at DESC LIMIT 5');
    
    // Also check database connection and table existence
    const tableCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'keys'
      ORDER BY ordinal_position
    `);

    res.status(200).json({
      message: 'Direct keys test successful',
      keys: result.rows,
      keyCount: result.rows.length,
      columns: tableCheck.rows,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Direct keys test error:', error);
    res.status(500).json({ 
      error: 'Direct test failed',
      details: error.message,
      code: error.code
    });
  } finally {
    if (client) client.release();
  }
};