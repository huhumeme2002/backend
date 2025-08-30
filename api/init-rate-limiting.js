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
    
    // Tạo bảng theo dõi failed attempts
    await client.query(`
      CREATE TABLE IF NOT EXISTS key_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        ip_address VARCHAR(45),
        failed_count INTEGER DEFAULT 0,
        last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        blocked_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tạo index để tăng performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_key_attempts_user_id ON key_attempts(user_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_key_attempts_ip ON key_attempts(ip_address)
    `);

    // Tạo bảng theo dõi token usage để đảm bảo unique
    await client.query(`
      CREATE TABLE IF NOT EXISTS token_usage_log (
        id SERIAL PRIMARY KEY,
        token_value TEXT NOT NULL,
        used_by INTEGER REFERENCES users(id),
        used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_token ON token_usage_log(token_value)
    `);

    res.status(200).json({
      message: 'Rate limiting tables created successfully',
      tables_created: ['key_attempts', 'token_usage_log'],
      note: 'System ready for rate limiting and token uniqueness'
    });

  } catch (error) {
    console.error('Init rate limiting error:', error);
    res.status(500).json({ 
      error: 'Failed to initialize rate limiting',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};