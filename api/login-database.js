const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Create database pool with better configuration for Vercel
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000, // 30 seconds
  idleTimeoutMillis: 30000,
  max: 1, // Single connection for serverless
  statement_timeout: 30000,
  query_timeout: 30000,
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
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
    
    console.log('Login attempt:', { username });
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Tên đăng nhập và mật khẩu là bắt buộc' });
    }
    
    console.log('🔄 Connecting to database...');
    client = await pool.connect();
    console.log('✅ Database connected successfully');
    
    // Find user by username
    console.log('🔍 Finding user...');
    const result = await client.query(
      'SELECT id, username, email, password_hash, requests, role, is_active FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ User not found:', username);
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    
    const user = result.rows[0];
    
    if (!user.is_active) {
      console.log('❌ User is inactive:', username);
      return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa' });
    }
    
    // Check password
    console.log('🔐 Checking password...');
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      console.log('❌ Invalid password for user:', username);
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    
    console.log('✅ Login successful for user:', username);
    
    // Update last login (skip if column doesn't exist)
    try {
      await client.query(
        'UPDATE users SET last_login_at = NOW() WHERE id = $1',
        [user.id]
      );
    } catch (err) {
      console.log('Note: last_login_at column not found, skipping update');
    }
    
    // Generate JWT token
    console.log('🔑 Generating JWT token...');
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'unified-aivannang-secret-2024',
      { expiresIn: '24h' }
    );
    
    console.log('🎉 Login completed successfully');
    
    res.status(200).json({
      message: 'Đăng nhập thành công!',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        requests: user.requests,
        role: user.role
      },
      token
    });
    
  } catch (error) {
    console.error('❌ Login error:', error.message);
    console.error('Error code:', error.code);
    console.error('Error details:', error.detail);
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return res.status(500).json({ 
        error: 'Không thể kết nối đến cơ sở dữ liệu',
        details: 'Database connection failed'
      });
    }
    
    if (error.code === 'ETIMEDOUT') {
      return res.status(500).json({ 
        error: 'Kết nối đến cơ sở dữ liệu bị timeout',
        details: 'Database connection timeout'
      });
    }
    
    res.status(500).json({ 
      error: 'Đăng nhập thất bại',
      details: error.message,
      code: error.code
    });
  } finally {
    if (client) {
      client.release();
      console.log('🔌 Database client released');
    }
  }
};