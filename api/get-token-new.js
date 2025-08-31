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
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Get token
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

    // Check user requests and expiry
    const userResult = await client.query(`
      SELECT 
        id, username, requests, 
        expiry_time,
        CASE 
          WHEN expiry_time IS NULL THEN true
          WHEN expiry_time > NOW() THEN false 
          ELSE true 
        END as is_expired
      FROM users 
      WHERE id = $1 AND is_active = true
    `, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    const user = userResult.rows[0];

    // Check if user has never redeemed key (expiry_time is NULL)
    if (user.expiry_time === null) {
      return res.status(403).json({ 
        error: 'Bạn chưa redeem key nào. Hãy redeem key trước khi lấy token.' 
      });
    }

    // Check if expired
    if (user.is_expired) {
      return res.status(403).json({ 
        error: 'Tài khoản đã hết hạn. Liên hệ admin để gia hạn.' 
      });
    }

    // Check if enough requests
    if (user.requests < 50) {
      return res.status(400).json({ 
        error: 'Không đủ requests để lấy token. Cần ít nhất 50 requests.' 
      });
    }

    // Get available token from uploaded_tokens
    const tokenResult = await client.query(`
      SELECT token_value, id 
      FROM uploaded_tokens 
      WHERE is_used = false 
      ORDER BY created_at ASC 
      LIMIT 1
    `);

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Không có token nào khả dụng. Liên hệ admin.' 
      });
    }

    const availableToken = tokenResult.rows[0];

    // Start transaction
    await client.query('BEGIN');

    // Mark token as used
    await client.query(
      'UPDATE uploaded_tokens SET is_used = true, used_by = $1, used_at = NOW() WHERE id = $2',
      [userId, availableToken.id]
    );

    // Deduct 50 requests from user
    await client.query(
      'UPDATE users SET requests = requests - 50 WHERE id = $1',
      [userId]
    );

    // Log transaction
    await client.query(
      'INSERT INTO request_transactions (user_id, requests_amount, description) VALUES ($1, $2, $3)',
      [userId, -50, 'Lấy token (-50 requests)']
    );

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      token: availableToken.token_value,
      message: 'Token đã được lấy thành công!',
      remaining_requests: user.requests - 50
    });

  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Get token error:', error);
    res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  } finally {
    if (client) client.release();
  }
};