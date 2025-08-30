const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

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
    client = await pool.connect();
    
    // Create test token
    const testToken = 'TEST-TOKEN-' + Date.now();
    const credits = 100;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now
    
    const result = await client.query(`
      INSERT INTO uploaded_tokens (token_value, requests, expires_at, description, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, token_value, requests, expires_at, description
    `, [testToken, credits, expiresAt, 'Sample test token']);
    
    const insertedToken = result.rows[0];
    
    res.status(201).json({
      message: 'Test token created successfully',
      token: insertedToken
    });
    
  } catch (error) {
    console.error('Create test token error:', error);
    res.status(500).json({ 
      error: 'Tạo test token thất bại',
      details: error.message 
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};