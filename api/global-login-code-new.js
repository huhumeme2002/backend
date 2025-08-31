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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
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

    // Check user expiry for GET requests (getting login code)
    if (req.method === 'GET') {
      const userResult = await client.query(`
        SELECT 
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

      // Check if user has never redeemed key
      if (user.expiry_time === null) {
        return res.status(403).json({ 
          error: 'Bạn chưa redeem key nào. Hãy redeem key trước khi lấy mã login.' 
        });
      }

      // Check if expired
      if (user.is_expired) {
        return res.status(403).json({ 
          error: 'Tài khoản đã hết hạn. Liên hệ admin để gia hạn.' 
        });
      }
    }

    if (req.method === 'GET') {
      // Get today's login code
      const today = new Date().toISOString().split('T')[0];
      
      const codeResult = await client.query(
        'SELECT code FROM daily_login_codes WHERE date = $1',
        [today]
      );

      if (codeResult.rows.length === 0) {
        return res.status(404).json({ 
          error: 'Chưa có mã login cho hôm nay. Liên hệ admin.' 
        });
      }

      res.status(200).json({
        success: true,
        code: codeResult.rows[0].code,
        date: today
      });

    } else if (req.method === 'POST') {
      // Admin only - set login code
      const adminResult = await client.query(
        'SELECT role FROM users WHERE id = $1',
        [userId]
      );

      if (adminResult.rows.length === 0 || adminResult.rows[0].role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Code is required' });
      }

      const today = new Date().toISOString().split('T')[0];

      // Insert or update today's code
      await client.query(`
        INSERT INTO daily_login_codes (date, code) 
        VALUES ($1, $2)
        ON CONFLICT (date) DO UPDATE SET 
          code = EXCLUDED.code, 
          updated_at = NOW()
      `, [today, code]);

      res.status(200).json({
        success: true,
        message: 'Login code đã được cập nhật',
        code: code,
        date: today
      });
    }

  } catch (error) {
    console.error('Global login code error:', error);
    res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  } finally {
    if (client) client.release();
  }
};