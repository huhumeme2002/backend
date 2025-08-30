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

  let client;
  try {
    client = await pool.connect();

    // Find the next available token
    const tokenResult = await client.query(
      `SELECT id, token_value, requests, expires_at, description
       FROM uploaded_tokens 
       WHERE is_used = false 
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC
       LIMIT 1`
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Không có token nào có sẵn. Vui lòng liên hệ admin để upload thêm token.' 
      });
    }

    const availableToken = tokenResult.rows[0];

    // Mark token as used
    await client.query('BEGIN');

    try {
      await client.query(
        `UPDATE uploaded_tokens 
         SET is_used = true, used_by = $1, used_at = NOW() 
         WHERE id = $2`,
        [userId, availableToken.id]
      );

      // Update user requests
      const userUpdateResult = await client.query(
        `UPDATE users 
         SET requests = requests + $1 
         WHERE id = $2 
         RETURNING username, requests`,
        [availableToken.requests, userId]
      );

      if (userUpdateResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const updatedUser = userUpdateResult.rows[0];

      // Record transaction
      await client.query(
        `INSERT INTO request_transactions (user_id, requests_amount, description, created_at) 
         VALUES ($1, $2, $3, NOW())`,
        [userId, availableToken.requests, `Lấy token: ${availableToken.token_value}`]
      );

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Lấy token thành công!',
        token_value: availableToken.token_value,
        requests_received: availableToken.requests,
        new_requests: updatedUser.requests,
        description: availableToken.description
      });

    } catch (transactionError) {
      await client.query('ROLLBACK');
      throw transactionError;
    }

  } catch (error) {
    console.error('Get token error:', error);
    res.status(500).json({ 
      error: 'Lỗi khi lấy token',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};