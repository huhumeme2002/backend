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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'unified-aivannang-secret-2024');
    userId = decoded.userId;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  let client;
  try {
    client = await pool.connect();

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

    const u = result.rows[0];
    res.status(200).json({
      id: u.id,
      username: u.username,
      email: u.email,
      requests: Number(u.requests) || 0,
      role: u.role,
      is_active: u.is_active,
      created_at: u.created_at,
      expires_at: u.expires_at,
      transaction_count: parseInt(u.transaction_count) || 0
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  } finally {
    if (client) client.release();
  }
};


