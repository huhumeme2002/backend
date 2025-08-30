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
    
    // Lấy schema của users table
    const schemaResult = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    // Lấy sample user data
    const sampleResult = await client.query(`
      SELECT id, username, email, requests, role, is_active, created_at
      FROM users 
      LIMIT 3
    `);

    res.status(200).json({
      table_schema: schemaResult.rows,
      sample_users: sampleResult.rows,
      note: 'Check what default values are set for new users'
    });

  } catch (error) {
    console.error('Check schema error:', error);
    res.status(500).json({ 
      error: 'Failed to check schema',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};