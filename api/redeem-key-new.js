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

  const { keyValue } = req.body;
  if (!keyValue) {
    return res.status(400).json({ error: 'Key value is required' });
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

    // Check if key exists and not used
    const keyResult = await client.query(`
      SELECT id, key_value, requests, is_used, expires_at
      FROM keys 
      WHERE key_value = $1 AND is_used = false
    `, [keyValue]);

    if (keyResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Key không tồn tại hoặc đã được sử dụng' 
      });
    }

    const key = keyResult.rows[0];

    // Check if key expired
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return res.status(400).json({ 
        error: 'Key đã hết hạn' 
      });
    }

    // Get current user data
    const userResult = await client.query(
      'SELECT id, username, requests, expiry_time FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Start transaction
    await client.query('BEGIN');

    // Mark key as used
    await client.query(
      'UPDATE keys SET is_used = true, used_by = $1, used_at = NOW() WHERE id = $2',
      [userId, key.id]
    );

    // Add requests to user
    const newRequests = user.requests + key.requests;
    
    // Calculate new expiry time (30 days from now, or extend existing)
    let newExpiryTime;
    if (user.expiry_time && new Date(user.expiry_time) > new Date()) {
      // Extend existing expiry by 30 days
      newExpiryTime = new Date(user.expiry_time);
      newExpiryTime.setDate(newExpiryTime.getDate() + 30);
    } else {
      // Set new expiry to 30 days from now
      newExpiryTime = new Date();
      newExpiryTime.setDate(newExpiryTime.getDate() + 30);
    }

    // Update user with new requests and expiry
    await client.query(
      'UPDATE users SET requests = $1, expiry_time = $2, is_expired = false WHERE id = $3',
      [newRequests, newExpiryTime, userId]
    );

    // Log transaction
    await client.query(
      'INSERT INTO request_transactions (user_id, requests_amount, description) VALUES ($1, $2, $3)',
      [userId, key.requests, `Redeem key ${keyValue} (+${key.requests} requests)`]
    );

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Key đã được redeem thành công! +${key.requests} requests`,
      user: {
        requests: newRequests,
        expiry_time: newExpiryTime,
        is_expired: false
      }
    });

  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Redeem key error:', error);
    res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  } finally {
    if (client) client.release();
  }
};