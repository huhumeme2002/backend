const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  let client;
  
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get database client
    client = await pool.connect();
    
    // Find user
    const result = await client.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login and get fresh data
    const updateResult = await client.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, username, email, requests, role, expiry_time, is_expired',
      [user.id]
    );
    
    const freshUser = updateResult.rows[0];
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: freshUser.id, username: freshUser.username, role: freshUser.role },
      process.env.JWT_SECRET || 'unified-aivannang-secret-2024',
      { expiresIn: '24h' }
    );
    
    console.log('User logged in successfully:', { id: freshUser.id, username: freshUser.username, requests: freshUser.requests });
    
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: freshUser.id,
        username: freshUser.username,
        email: freshUser.email,
        requests: freshUser.requests,
        role: freshUser.role,
        expiry_time: freshUser.expiry_time,
        is_expired: freshUser.is_expired
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Login failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}