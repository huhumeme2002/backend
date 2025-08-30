const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { AdvancedRateLimiter, getClientIP } = require('./advanced-security-middleware');

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

  const clientIP = getClientIP(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';

  // IP-based rate limiting TRƯỚC JWT validation để bảo vệ khỏi API attacks
  const ipLimitCheck = await AdvancedRateLimiter.checkIPRateLimit(clientIP, 'get-token');
  
  if (!ipLimitCheck.allowed) {
    await AdvancedRateLimiter.logSuspiciousActivity(
      clientIP, 
      'get-token', 
      userAgent,
      {
        reason: ipLimitCheck.reason,
        requests_this_hour: ipLimitCheck.requests_this_hour,
        user_id: 'pre-auth-blocked'
      }
    );

    return res.status(429).json({
      error: 'Quá nhiều requests từ IP này',
      message: `Thử lại sau ${ipLimitCheck.remaining_minutes} phút`,
      reason: 'IP_RATE_LIMIT_EXCEEDED'
    });
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

    // Kiểm tra user có đủ requests không (cần ít nhất 50)
    const userResult = await client.query(
      'SELECT username, requests FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    if (user.requests < 50) {
      return res.status(400).json({ 
        error: 'Không đủ requests để lấy token (cần ít nhất 50 requests)'
      });
    }

    // Lấy token từ uploaded tokens (chưa được sử dụng)
    const tokenResult = await client.query(`
      SELECT token_value, id
      FROM uploaded_tokens 
      WHERE is_used = false 
      ORDER BY created_at ASC 
      LIMIT 1
    `);

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Không có token nào có sẵn' });
    }

    const availableToken = tokenResult.rows[0];

    // Kiểm tra token đã được sử dụng trong token_usage_log chưa (tránh trùng)
    const usageCheck = await client.query(
      'SELECT id FROM token_usage_log WHERE token_value = $1',
      [availableToken.token_value]
    );

    if (usageCheck.rows.length > 0) {
      return res.status(409).json({ 
        error: 'Token này đã được sử dụng bởi người khác',
        details: 'Mỗi token chỉ có thể sử dụng một lần'
      });
    }

    await client.query('BEGIN');

    try {
      // Đánh dấu token đã được sử dụng trong uploaded_tokens
      await client.query(`
        UPDATE uploaded_tokens 
        SET is_used = true, used_by = $1, used_at = NOW()
        WHERE id = $2
      `, [userId, availableToken.id]);

      // Ghi vào token_usage_log để đảm bảo uniqueness
      await client.query(`
        INSERT INTO token_usage_log (token_value, used_by, used_at, ip_address)
        VALUES ($1, $2, NOW(), $3)
      `, [availableToken.token_value, userId, req.headers['x-forwarded-for'] || 'unknown']);

      // Trừ 50 requests từ user
      const updatedUserResult = await client.query(`
        UPDATE users 
        SET requests = requests - 50 
        WHERE id = $1 
        RETURNING username, requests
      `, [userId]);

      const updatedUser = updatedUserResult.rows[0];

      // Ghi lại giao dịch
      await client.query(`
        INSERT INTO request_transactions (user_id, requests_amount, description, created_at) 
        VALUES ($1, $2, $3, NOW())
      `, [userId, -50, `Lấy token: ${availableToken.token_value}`]);

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Lấy token thành công!',
        token_value: availableToken.token_value,
        requests_deducted: 50,
        remaining_requests: updatedUser.requests
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