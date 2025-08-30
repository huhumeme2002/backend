const { Pool } = require('pg');
const { verifyAdmin } = require('../admin-middleware');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify admin access
  await new Promise((resolve, reject) => {
    verifyAdmin(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  }).catch(() => {
    return; // Error already sent by middleware
  });

  let client;
  try {
    client = await pool.connect();

    const analytics = {};

    // Basic stats
    try {
      const statsResult = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE is_active = true) as active_users,
          (SELECT COUNT(*) FROM users WHERE role = 'admin') as admin_users,
          (SELECT COUNT(*) FROM uploaded_tokens) as total_tokens,
          (SELECT COUNT(*) FROM uploaded_tokens WHERE used_by IS NULL) as available_tokens,
          (SELECT COUNT(*) FROM uploaded_tokens WHERE used_by IS NOT NULL) as used_tokens,
          (SELECT COALESCE(SUM(requests), 0) FROM users) as total_requests,
          (SELECT COUNT(*) FROM request_transactions) as total_transactions
      `);
      analytics.overview = statsResult.rows[0];
    } catch (error) {
      analytics.overview = {
        total_users: 0,
        active_users: 0,
        admin_users: 0,
        total_tokens: 0,
        available_tokens: 0,
        used_tokens: 0,
        total_requests: 0,
        total_transactions: 0
      };
    }

    // User registration trends (last 30 days)
    try {
      const registrationTrends = await client.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as new_users
        FROM users 
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `);
      analytics.registration_trends = registrationTrends.rows;
    } catch (error) {
      analytics.registration_trends = [];
    }

    // Top users by requests
    try {
      const topUsers = await client.query(`
        SELECT username, requests, role, created_at
        FROM users
        ORDER BY requests DESC
        LIMIT 10
      `);
      analytics.top_users = topUsers.rows;
    } catch (error) {
      analytics.top_users = [];
    }

    // Recent activity
    try {
      const recentActivity = await client.query(`
        SELECT 
          u.username,
          rt.requests_amount as amount,
          rt.description,
          rt.created_at
        FROM request_transactions rt
        JOIN users u ON rt.user_id = u.id
        ORDER BY rt.created_at DESC
        LIMIT 20
      `);
      analytics.recent_activity = recentActivity.rows;
    } catch (error) {
      analytics.recent_activity = [];
    }

    // Token usage statistics
    try {
      const tokenStats = await client.query(`
        SELECT 
          ut.requests,
          COUNT(*) as token_count,
          COUNT(CASE WHEN ut.used_by IS NOT NULL THEN 1 END) as used_count
        FROM uploaded_tokens ut
        GROUP BY ut.requests
        ORDER BY ut.requests
      `);
      analytics.key_statistics = tokenStats.rows;
    } catch (error) {
      analytics.key_statistics = [];
    }

    // Daily statistics for the last 7 days
    try {
      const dailyStats = await client.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as registrations
        FROM users 
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);
      analytics.daily_stats = dailyStats.rows;
    } catch (error) {
      analytics.daily_stats = [];
    }

    // User roles distribution
    try {
      const roleDistribution = await client.query(`
        SELECT 
          role,
          COUNT(*) as count,
          COUNT(CASE WHEN is_active THEN 1 END) as active_count
        FROM users
        GROUP BY role
      `);
      analytics.role_distribution = roleDistribution.rows;
    } catch (error) {
      analytics.role_distribution = [];
    }

    res.status(200).json({
      message: 'Analytics data retrieved successfully',
      data: analytics,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch analytics',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};