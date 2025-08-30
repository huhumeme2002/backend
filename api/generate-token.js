const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
      'SELECT id, username, requests, is_active FROM users WHERE id = $1',
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

// Generate random token
function generateToken() {
  return 'TOK-' + crypto.randomBytes(16).toString('hex').toUpperCase();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
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
    if (req.method === 'POST') {
      // Generate new token
      const REQUESTS_PER_TOKEN = 50; // 1 token = 50 requests
      
      if (req.user.requests < REQUESTS_PER_TOKEN) {
        return res.status(400).json({ 
          error: `Không đủ requests. Bạn cần ${REQUESTS_PER_TOKEN} requests để tạo token.`,
          currentRequests: req.user.requests,
          requiredRequests: REQUESTS_PER_TOKEN
        });
      }

      client = await pool.connect();
      
      // Start transaction
      await client.query('BEGIN');

      // Generate unique token
      let tokenValue = generateToken();
      let attempts = 0;
      
      // Ensure token is unique
      while (attempts < 10) {
        const existingToken = await client.query(
          'SELECT id FROM generated_tokens WHERE token_value = $1',
          [tokenValue]
        );
        
        if (existingToken.rows.length === 0) {
          break;
        }
        
        tokenValue = generateToken();
        attempts++;
      }

      if (attempts >= 10) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: 'Không thể tạo token unique' });
      }

      // Deduct requests from user
      const newRequestCount = req.user.requests - REQUESTS_PER_TOKEN;
      await client.query(
        'UPDATE users SET requests = $1 WHERE id = $2',
        [newRequestCount, req.user.id]
      );

      // Create generated token record
      const result = await client.query(`
        INSERT INTO generated_tokens (user_id, token_value, requests_cost, created_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING id, token_value, requests_cost, created_at
      `, [req.user.id, tokenValue, REQUESTS_PER_TOKEN]);

      // Log transaction
      await client.query(
        'INSERT INTO request_transactions (user_id, requests_amount, description, created_at) VALUES ($1, $2, $3, NOW())',
        [req.user.id, -REQUESTS_PER_TOKEN, `Tạo token: ${tokenValue}`]
      );

      // Commit transaction
      await client.query('COMMIT');

      const generatedToken = result.rows[0];

      console.log('Token generated successfully:', { 
        user: req.user.username, 
        token: tokenValue, 
        requestsCost: REQUESTS_PER_TOKEN 
      });

      res.status(201).json({
        message: 'Tạo token thành công!',
        token: generatedToken.token_value,
        requests_cost: REQUESTS_PER_TOKEN,
        remaining_requests: newRequestCount,
        created_at: generatedToken.created_at,
        note: `Token này có giá trị ${REQUESTS_PER_TOKEN} requests`
      });

    } else if (req.method === 'GET') {
      // Get user's generated tokens history
      client = await pool.connect();
      
      const tokensResult = await client.query(`
        SELECT token_value, requests_cost, is_active, created_at, last_used_at, usage_count
        FROM generated_tokens 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT 20
      `, [req.user.id]);

      res.status(200).json({
        tokens: tokensResult.rows,
        current_requests: req.user.requests,
        requests_per_token: 50
      });

    } else {
      res.status(405).json({ error: 'Method không được hỗ trợ' });
    }

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    
    console.error('Generate token error:', error);
    res.status(500).json({ 
      error: 'Tạo token thất bại',
      details: error.message 
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};