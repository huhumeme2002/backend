const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const { key } = req.body;
  if (!key || key.trim().length < 5) {
    return res.status(400).json({ error: 'Key không hợp lệ' });
  }

  let client;
  try {
    client = await pool.connect();

    const keyResult = await client.query(
      `SELECT id, key_value, requests, expires_at, is_used, used_by, used_at 
       FROM keys 
       WHERE key_value = $1`,
      [key.trim()]
    );

    if (keyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Key không tồn tại' });
    }

    const keyData = keyResult.rows[0];

    if (keyData.is_used) {
      return res.status(400).json({ error: 'Key đã được sử dụng' });
    }

    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Key đã hết hạn' });
    }

    await client.query('BEGIN');

    try {
      await client.query(
        `UPDATE keys 
         SET is_used = true, used_by = $1, used_at = NOW() 
         WHERE id = $2`,
        [userId, keyData.id]
      );

      const userUpdateResult = await client.query(
        `UPDATE users 
         SET requests = requests + $1 
         WHERE id = $2 
         RETURNING username, requests`,
        [keyData.requests, userId]
      );

      if (userUpdateResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const updatedUser = userUpdateResult.rows[0];

      await client.query(
        `INSERT INTO request_transactions (user_id, requests_amount, description, created_at) 
         VALUES ($1, $2, $3, NOW())`,
        [userId, keyData.requests, `Đổi key: ${keyData.key_value}`]
      );

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Đổi key thành công!',
        requests_added: keyData.requests,
        current_requests: updatedUser.requests,
        key_value: keyData.key_value
      });

    } catch (transactionError) {
      await client.query('ROLLBACK');
      throw transactionError;
    }

  } catch (error) {
    console.error('Redeem key error:', error);
    res.status(500).json({ 
      error: 'Lỗi khi đổi key',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};