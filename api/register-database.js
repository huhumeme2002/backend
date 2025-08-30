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
    const { username, email, password } = req.body;
    
    console.log('Registration attempt:', { username, email });
    
    // Validation
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Tên đăng nhập phải có ít nhất 3 ký tự' });
    }
    
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Email không hợp lệ' });
    }
    
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
    }
    
    console.log('🔄 Connecting to database...');
    client = await pool.connect();
    console.log('✅ Database connected successfully');
    
    // Check if user exists
    console.log('🔍 Checking for existing user...');
    const existingUser = await client.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    
    if (existingUser.rows.length > 0) {
      console.log('❌ User already exists:', username);
      return res.status(400).json({ error: 'Tên đăng nhập hoặc email đã tồn tại' });
    }
    
    // Hash password
    console.log('🔐 Hashing password...');
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    console.log('👤 Creating user...');
    const result = await client.query(
      `INSERT INTO users (username, email, password_hash, requests, role, is_active, created_at) 
       VALUES ($1, $2, $3, 1000, 'user', true, NOW()) 
       RETURNING id, username, email, requests, role, created_at`,
      [username, email, passwordHash]
    );
    
    const user = result.rows[0];
    console.log('✅ User created successfully:', { id: user.id, username });
    
    // Generate JWT token
    console.log('🔑 Generating JWT token...');
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'unified-aivannang-secret-2024',
      { expiresIn: '24h' }
    );
    
    console.log('🎉 Registration completed successfully');
    
    res.status(201).json({
      message: 'Đăng ký thành công!',
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
    console.error('❌ Registration error:', error.message);
    console.error('Error code:', error.code);
    console.error('Error details:', error.detail);
    
    // Handle specific database errors
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Tên đăng nhập hoặc email đã tồn tại' });
    }
    
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
      error: 'Đăng ký thất bại',
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