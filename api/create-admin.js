const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

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
  
  let client;
  
  try {
    const { username, email, password, admin_secret } = req.body;
    
    // Simple admin creation secret (you should change this)
    const ADMIN_CREATION_SECRET = process.env.ADMIN_SECRET || 'create-admin-2024';
    
    if (admin_secret !== ADMIN_CREATION_SECRET) {
      return res.status(401).json({ error: 'Admin secret không đúng' });
    }

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
    
    console.log('Creating admin user:', { username, email });
    
    client = await pool.connect();
    
    // Check if user exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Tên đăng nhập hoặc email đã tồn tại' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create admin user
    const result = await client.query(
      `INSERT INTO users (username, email, password_hash, requests, role, is_active, created_at) 
       VALUES ($1, $2, $3, 1000, 'admin', true, NOW()) 
       RETURNING id, username, email, requests, role, created_at`,
      [username, email, passwordHash]
    );
    
    const admin = result.rows[0];
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: admin.id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET || 'unified-aivannang-secret-2024',
      { expiresIn: '24h' }
    );
    
    // Log admin creation (skip if table doesn't exist)
    try {
      await client.query(
        'INSERT INTO request_transactions (user_id, requests_amount, description) VALUES ($1, 1000, $2)',
        [admin.id, `Admin account created for ${username}`]
      );
    } catch (err) {
      console.log('Note: request_transactions table not found, skipping transaction log');
    }
    
    console.log('Admin user created successfully:', { id: admin.id, username });
    
    res.status(201).json({
      message: 'Tạo tài khoản admin thành công!',
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        requests: admin.requests,
        role: admin.role,
        created_at: admin.created_at
      },
      token
    });
    
  } catch (error) {
    console.error('Create admin error:', error);
    
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Tên đăng nhập hoặc email đã tồn tại' });
    }
    
    res.status(500).json({ 
      error: 'Tạo tài khoản admin thất bại',
      details: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};