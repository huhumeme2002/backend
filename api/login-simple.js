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
    const { username, password } = req.body;
    
    console.log('Login attempt:', { username });
    console.log('Total users in storage:', storage.getUserCount());
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Tên đăng nhập và mật khẩu là bắt buộc' });
    }
    
    // Find user by username
    const foundUser = storage.findUserByUsername(username);
    
    if (!foundUser) {
      console.log('User not found:', username);
      // List all users for debugging
      const allUsers = storage.getAllUsers();
      console.log('Available users:');
      for (let [key, user] of allUsers) {
        console.log(`  - ${user.username} (id: ${user.id})`);
      }
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, foundUser.password_hash);
    if (!isPasswordValid) {
      console.log('Invalid password for user:', username);
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    
    console.log('Login successful for user:', username);
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: foundUser.id, username: foundUser.username, role: foundUser.role },
      process.env.JWT_SECRET || 'unified-aivannang-secret-2024',
      { expiresIn: '24h' }
    );
    
    res.status(200).json({
      message: 'Đăng nhập thành công!',
      user: {
        id: foundUser.id,
        username: foundUser.username,
        email: foundUser.email,
        credits: foundUser.credits,
        role: foundUser.role
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Đăng nhập thất bại',
      details: error.message
    });
  }
};