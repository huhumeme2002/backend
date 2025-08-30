const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

// Middleware to verify user token
const verifyUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Không có token xác thực' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'unified-aivannang-secret-2024');
    
    const client = await pool.connect();
    const result = await client.query(
      'SELECT id, username, credits, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    client.release();

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Người dùng không tồn tại' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token không hợp lệ' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token đã hết hạn' });
    }
    return res.status(500).json({ error: 'Lỗi xác thực' });
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST method' });
  }

  // Verify user access
  await new Promise((resolve, reject) => {
    verifyUser(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  }).catch(() => {
    return; // Error already sent by middleware
  });

  let client;
  
  try {
    const { token } = req.body;
    
    if (!token || token.trim().length === 0) {
      return res.status(400).json({ error: 'Token không được để trống' });
    }

    const tokenValue = token.trim();
    console.log('Token redemption attempt:', { user: req.user.username, token: tokenValue });
    
    client = await pool.connect();
    
    // Start transaction
    await client.query('BEGIN');

    // Check if token exists and is available
    const tokenResult = await client.query(`
      SELECT id, token_value, requests, expires_at, is_used, description,
             CASE WHEN expires_at IS NOT NULL AND expires_at < NOW() THEN true ELSE false END as is_expired
      FROM uploaded_tokens 
      WHERE token_value = $1
    `, [tokenValue]);

    if (tokenResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Token không tồn tại' });
    }

    const tokenData = tokenResult.rows[0];

    if (tokenData.is_used) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Token đã được sử dụng' });
    }

    if (tokenData.is_expired) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Token đã hết hạn',
        expiredAt: tokenData.expires_at
      });
    }

    // Mark token as used
    await client.query(`
      UPDATE uploaded_tokens 
      SET is_used = true, used_by = $1, used_at = NOW() 
      WHERE id = $2
    `, [req.user.id, tokenData.id]);

    // Add requests to user
    const newRequests = req.user.requests + tokenData.requests;
    await client.query(
      'UPDATE users SET requests = $1 WHERE id = $2',
      [newRequests, req.user.id]
    );

    // Log request transaction
    await client.query(
      'INSERT INTO request_transactions (user_id, requests_amount, description, created_at) VALUES ($1, $2, $3, NOW())',
      [
        req.user.id, 
        tokenData.requests, 
        `Đổi token: ${tokenValue}${tokenData.description ? ' - ' + tokenData.description : ''}`
      ]
    );

    // Commit transaction
    await client.query('COMMIT');

    console.log('Token redeemed successfully:', { 
      user: req.user.username, 
      token: tokenValue, 
      credits: tokenData.credits 
    });

    res.status(200).json({
      message: 'Đổi token thành công!',
      requests_received: tokenData.requests,
      old_requests: req.user.requests,
      new_requests: newRequests,
      token_description: tokenData.description,
      redeemed_at: new Date().toISOString()
    });

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    
    console.error('Token redemption error:', error);
    
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Token đã được sử dụng' });
    }

    res.status(500).json({ 
      error: 'Đổi token thất bại',
      details: error.message 
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};