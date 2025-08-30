const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

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

  // Verify JWT token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let adminId, adminRole;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'unified-aivannang-secret-2024');
    adminId = decoded.userId;
    adminRole = decoded.role;
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Check if user is admin
  if (adminRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  let client;
  try {
    client = await pool.connect();

    // Basic overview stats
    const overviewResult = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '30 days') as active_users,
        (SELECT COUNT(*) FROM uploaded_tokens WHERE used_by IS NOT NULL) as used_keys,
        (SELECT COUNT(*) FROM uploaded_tokens) as total_tokens
    `);

    const overview = overviewResult.rows[0] || {
      total_users: 0,
      active_users: 0,
      used_keys: 0,
      total_tokens: 0
    };

    // Daily stats for last 7 days
    const dailyStatsResult = await client.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as registrations
      FROM users 
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 7
    `);

    // Top users
    const topUsersResult = await client.query(`
      SELECT username, requests
      FROM users
      ORDER BY requests DESC
      LIMIT 10
    `);

    // Recent activity
    const recentActivityResult = await client.query(`
      SELECT 
        u.username,
        rt.requests_amount as amount,
        rt.description,
        rt.created_at
      FROM request_transactions rt
      JOIN users u ON rt.user_id = u.id
      ORDER BY rt.created_at DESC
      LIMIT 10
    `);

    // Key statistics
    const keyStatsResult = await client.query(`
      SELECT 
        requests,
        COUNT(*) as key_count,
        COUNT(CASE WHEN used_by IS NOT NULL THEN 1 END) as used_count
      FROM uploaded_tokens
      GROUP BY requests
      ORDER BY requests
      LIMIT 10
    `);

    const analytics = {
      overview: overview,
      daily_stats: dailyStatsResult.rows,
      top_users: topUsersResult.rows,
      recent_activity: recentActivityResult.rows,
      key_statistics: keyStatsResult.rows
    };

    res.json({
      success: true,
      data: analytics,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({ 
      error: 'Lỗi máy chủ',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};