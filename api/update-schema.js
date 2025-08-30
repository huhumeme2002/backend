const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

const updateSchema = async () => {
  let client;
  try {
    console.log('🔄 Updating database schema...');
    client = await pool.connect();

    // Add expiration columns to keys table
    console.log('📋 Adding expiration columns to keys table...');
    await client.query(`
      ALTER TABLE keys 
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_expired BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS description TEXT
    `);

    // Create tokens table for uploaded Excel tokens
    console.log('🎫 Creating uploaded_tokens table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS uploaded_tokens (
        id SERIAL PRIMARY KEY,
        token_value VARCHAR(500) UNIQUE NOT NULL,
        credits INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMP,
        is_used BOOLEAN DEFAULT false,
        used_by INTEGER REFERENCES users(id),
        used_at TIMESTAMP,
        upload_batch_id UUID,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create admin_activities table for logging
    console.log('📝 Creating admin_activities table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_activities (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER REFERENCES users(id),
        activity_type VARCHAR(50) NOT NULL,
        target_user_id INTEGER REFERENCES users(id),
        description TEXT,
        old_value JSON,
        new_value JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add indexes for performance
    console.log('🔗 Adding indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_uploaded_tokens_expires_at ON uploaded_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_uploaded_tokens_used ON uploaded_tokens(is_used);
      CREATE INDEX IF NOT EXISTS idx_keys_expires_at ON keys(expires_at);
      CREATE INDEX IF NOT EXISTS idx_admin_activities_admin_id ON admin_activities(admin_id);
    `);

    console.log('✅ Schema updated successfully!');
    return { success: true };

  } catch (error) {
    console.error('❌ Schema update failed:', error);
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
    const result = await updateSchema();
    
    if (result.success) {
      res.status(200).json({
        message: '✅ Database schema updated successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        message: '❌ Schema update failed', 
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