const { Pool } = require('pg');

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
    
    // Drop và tạo lại bảng tokens
    await client.query(`DROP TABLE IF EXISTS tokens CASCADE`);
    
    await client.query(`
      CREATE TABLE tokens (
        id SERIAL PRIMARY KEY,
        token_value TEXT UNIQUE NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        used_by INTEGER,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tạo index để tăng performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tokens_is_used ON tokens(is_used)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at)
    `);

    // Kiểm tra số lượng tokens hiện có
    const countResult = await client.query('SELECT COUNT(*) as count FROM tokens');
    const tokenCount = parseInt(countResult.rows[0].count);

    // Tạo 50 tokens mẫu nếu chưa có
    const createdTokens = [];
    if (tokenCount < 10) {
      for (let i = 1; i <= 50; i++) {
        const tokenValue = `cursor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        try {
          const result = await client.query(`
            INSERT INTO tokens (token_value) 
            VALUES ($1) 
            ON CONFLICT (token_value) DO NOTHING
            RETURNING token_value
          `, [tokenValue]);
          
          if (result.rows.length > 0) {
            createdTokens.push(result.rows[0].token_value);
          }
        } catch (err) {
          console.error(`Failed to create token ${i}:`, err.message);
        }
      }
    }

    // Lấy thống kê tokens
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN is_used = false THEN 1 END) as available_tokens,
        COUNT(CASE WHEN is_used = true THEN 1 END) as used_tokens
      FROM tokens
    `);

    res.status(200).json({
      message: 'Tokens table initialized successfully',
      created_tokens: createdTokens.length,
      stats: statsResult.rows[0],
      sample_tokens: createdTokens.slice(0, 5)
    });

  } catch (error) {
    console.error('Init tokens table error:', error);
    res.status(500).json({ 
      error: 'Failed to initialize tokens table',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};