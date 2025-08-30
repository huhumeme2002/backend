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

    // Check users table structure
    const tableCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    // Get sample users (try both column names)
    let usersResult;
    try {
      usersResult = await client.query('SELECT id, username, role, requests FROM users LIMIT 3');
    } catch (e) {
      try {
        usersResult = await client.query('SELECT id, username, role, credits FROM users LIMIT 3');
      } catch (e2) {
        usersResult = await client.query('SELECT id, username, role FROM users LIMIT 3');
      }
    }

    res.status(200).json({
      message: 'Direct users test successful',
      users: usersResult.rows,
      userCount: usersResult.rows.length,
      columns: tableCheck.rows,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Direct users test error:', error);
    res.status(500).json({ 
      error: 'Direct test failed',
      details: error.message,
      code: error.code
    });
  } finally {
    if (client) client.release();
  }
};