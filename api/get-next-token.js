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

    // Atomic reservation of a token + deduction of 50 requests
    await client.query('BEGIN');

    // Lock one available token to avoid concurrent duplication
    const tokenLockResult = await client.query(
      `SELECT id, token_value, requests, expires_at, description
       FROM uploaded_tokens
       WHERE is_used = false
         AND used_by IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );

    if (tokenLockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Không có token nào có sẵn. Vui lòng liên hệ admin để upload thêm token.'
      });
    }

    const tokenRow = tokenLockResult.rows[0];

    // Ensure user has at least 50 requests
    const userRes = await client.query(
      'SELECT id, username, requests FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const currentRequests = userRes.rows[0].requests || 0;
    const cost = 50;
    if (currentRequests < cost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cần ít nhất ${cost} requests để lấy token` });
    }

    // Mark token as used by this user
    await client.query(
      `UPDATE uploaded_tokens
       SET is_used = true, used_by = $1, used_at = NOW()
       WHERE id = $2`,
      [userId, tokenRow.id]
    );

    // Deduct cost from user requests
    const userUpdateResult = await client.query(
      `UPDATE users
       SET requests = requests - $1
       WHERE id = $2
       RETURNING username, requests`,
      [cost, userId]
    );

    // Log transaction as a negative request usage
    await client.query(
      `INSERT INTO request_transactions (user_id, requests_amount, description, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, -cost, `Lấy token: ${tokenRow.token_value}${tokenRow.description ? ' - ' + tokenRow.description : ''}`]
    );

    await client.query('COMMIT');

    const updatedUser = userUpdateResult.rows[0];

    res.status(200).json({
      message: 'Lấy token thành công!',
      token_value: tokenRow.token_value,
      cost,
      new_requests: updatedUser.requests,
      description: tokenRow.description
    });

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