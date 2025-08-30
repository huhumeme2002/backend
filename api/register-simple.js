const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const storage = require('./storage');

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
  
  try {
    const { username, email, password } = req.body;
    
    console.log('Registration attempt:', { username, email });
    console.log('Current users count:', storage.getUserCount());
    
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
    
    // Check if user exists
    const existingByUsername = storage.findUserByUsername(username);
    const existingByEmail = storage.findUserByEmail(email);
    
    if (existingByUsername || existingByEmail) {
      console.log('User already exists:', username);
      return res.status(400).json({ error: 'Tên đăng nhập hoặc email đã tồn tại' });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    const userId = Date.now().toString();
    const user = {
      id: userId,
      username,
      email,
      password_hash: passwordHash,
      credits: 100, // Starting bonus
      role: 'user',
      is_active: true,
      created_at: new Date().toISOString()
    };
    
    // Save to persistent storage
    storage.addUser(userId, user);
    
    console.log('User created successfully:', { id: userId, username });
    console.log('Total users now:', storage.getUserCount());
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'unified-aivannang-secret-2024',
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      message: 'Đăng ký thành công!',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        credits: user.credits,
        role: user.role
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Đăng ký thất bại',
      details: error.message
    });
  }
};