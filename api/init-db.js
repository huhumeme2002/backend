const { Pool } = require('pg');

// Create database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
  statement_timeout: 30000,
  query_timeout: 30000,
});

const initializeDatabase = async () => {
  let client;
  try {
    console.log('🔄 Connecting to database...');
    client = await pool.connect();
    console.log('✅ Connected to database');

    // Create users table
    console.log('📋 Creating users table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        credits INTEGER DEFAULT 100,
        role VARCHAR(20) DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP
      )
    `);

    // Create keys table
    console.log('🔑 Creating keys table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS keys (
        id SERIAL PRIMARY KEY,
        key_value VARCHAR(255) UNIQUE NOT NULL,
        credits INTEGER NOT NULL,
        is_used BOOLEAN DEFAULT false,
        used_by INTEGER REFERENCES users(id),
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create tokens table
    console.log('🎫 Creating tokens table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        token_value VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create credit_transactions table
    console.log('💰 Creating credit_transactions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount INTEGER NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database initialized successfully!');
    
    // Check if there are any users
    const userCount = await client.query('SELECT COUNT(*) as count FROM users');
    console.log(`👥 Current user count: ${userCount.rows[0].count}`);

    return { success: true, message: 'Database initialized successfully' };

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return { success: false, error: error.message };
  } finally {
    if (client) {
      client.release();
    }
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    const result = await initializeDatabase();
    
    if (result.success) {
      res.status(200).json({
        message: '✅ Database initialized successfully',
        details: result.message
      });
    } else {
      res.status(500).json({
        message: '❌ Database initialization failed', 
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      message: '❌ Unexpected error',
      error: error.message
    });
  }
};