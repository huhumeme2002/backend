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
    
    // Get all users without any filter
    const allUsersResult = await client.query(`
      SELECT id, username, email, requests, role, is_active, created_at, last_login
      FROM users
      ORDER BY id DESC
    `);

    // Get active users only
    const activeUsersResult = await client.query(`
      SELECT id, username, email, requests, role, is_active, created_at, last_login
      FROM users
      WHERE is_active = true
      ORDER BY id DESC
    `);

    // Count stats
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
        COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_users,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
        COUNT(CASE WHEN role = 'user' THEN 1 END) as normal_users
      FROM users
    `);

    res.status(200).json({
      all_users: allUsersResult.rows,
      active_users: activeUsersResult.rows,
      total_count: allUsersResult.rows.length,
      active_count: activeUsersResult.rows.length,
      stats: statsResult.rows[0],
      debug_info: {
        query_used: 'SELECT * FROM users',
        database_url: process.env.DATABASE_URL ? 'Connected' : 'Not connected'
      }
    });

  } catch (error) {
    console.error('Check users error:', error);
    res.status(500).json({ 
      error: 'Failed to check users',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};