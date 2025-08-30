const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

module.exports = async function handler(req, res) {
  // Comprehensive CORS headers for Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent, DNT, Cache-Control, X-Mx-ReqToken, Keep-Alive, X-Requested-With, If-Modified-Since, X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).json({
      message: 'CORS preflight successful',
      methods: 'GET, POST, PUT, DELETE, OPTIONS',
      headers: 'Content-Type, Authorization, X-Requested-With'
    });
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify JWT token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'unified-aivannang-secret-2024');
    userId = decoded.userId;
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  let client;
  try {
    client = await pool.connect();

    // Get fresh user data from database
    const result = await client.query(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.requests,
        u.role,
        u.is_active,
        u.created_at,
        u.expires_at,
        COUNT(rt.id) as transaction_count
      FROM users u
      LEFT JOIN request_transactions rt ON u.id = rt.user_id
      WHERE u.id = $1
      GROUP BY u.id, u.username, u.email, u.requests, u.role, u.is_active, u.created_at, u.expires_at
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        requests: user.requests,
        role: user.role,
        is_active: user.is_active,
        created_at: user.created_at,
        expires_at: user.expires_at,
        transaction_count: parseInt(user.transaction_count) || 0
      }
    });

  } catch (error) {
    console.error('User profile error:', error);
    // Ensure CORS headers are set even on error
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.status(500).json({
      error: 'Lỗi server',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};
