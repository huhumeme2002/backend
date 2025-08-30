const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

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

  let client;
  try {
    client = await pool.connect();
    
    // Hash password for all test users
    const passwordHash = await bcrypt.hash('123456', 10);
    
    // Create test users
    const testUsers = [
      { username: 'user1', email: 'user1@test.com', requests: 50 },
      { username: 'user2', email: 'user2@test.com', requests: 100 },
      { username: 'user3', email: 'user3@test.com', requests: 200 },
      { username: 'vipuser', email: 'vip@test.com', requests: 500 },
      { username: 'testuser', email: 'test@test.com', requests: 10 }
    ];

    const createdUsers = [];
    
    for (const user of testUsers) {
      try {
        // Check if user exists
        const existing = await client.query(
          'SELECT id FROM users WHERE username = $1 OR email = $2',
          [user.username, user.email]
        );
        
        if (existing.rows.length === 0) {
          // Create new user
          const result = await client.query(`
            INSERT INTO users (username, email, password_hash, requests, role, is_active)
            VALUES ($1, $2, $3, $4, 'user', true)
            RETURNING id, username, email, requests
          `, [user.username, user.email, passwordHash, user.requests]);
          
          createdUsers.push(result.rows[0]);
        } else {
          // Update existing user's requests
          const result = await client.query(`
            UPDATE users 
            SET requests = $1, is_active = true
            WHERE username = $2 OR email = $3
            RETURNING id, username, email, requests
          `, [user.requests, user.username, user.email]);
          
          createdUsers.push({
            ...result.rows[0],
            status: 'updated'
          });
        }
      } catch (err) {
        console.error(`Failed to create/update user ${user.username}:`, err.message);
      }
    }

    // Get total users count
    const countResult = await client.query('SELECT COUNT(*) as total FROM users');
    
    res.status(200).json({
      message: 'Test users created/updated successfully',
      created_users: createdUsers,
      total_users_in_db: countResult.rows[0].total,
      note: 'All test users have password: 123456'
    });

  } catch (error) {
    console.error('Create test users error:', error);
    res.status(500).json({ 
      error: 'Failed to create test users',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};