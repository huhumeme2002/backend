const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let client;
  try {
    client = await pool.connect();
    
    // Try to decode JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'unified-aivannang-secret-2024');
    
    // Check user in database
    const userResult = await client.query(
      'SELECT id, username, role, is_active, requests FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    res.status(200).json({
      message: 'Authentication successful',
      decoded: {
        userId: decoded.userId,
        exp: decoded.exp,
        iat: decoded.iat
      },
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        is_active: user.is_active,
        requests: user.requests
      },
      jwtSecret: process.env.JWT_SECRET ? 'Set from env' : 'Using fallback: aivannang-secret-key'
    });

  } catch (error) {
    console.error('Auth test error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        details: error.message,
        jwtSecret: process.env.JWT_SECRET ? 'Set from env' : 'Using fallback: aivannang-secret-key'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        details: error.message
      });
    }
    
    return res.status(500).json({ 
      error: 'Auth test failed',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};