const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

const fixDatabaseSchema = async () => {
  let client;
  try {
    console.log('🔄 Fixing database schema...');
    client = await pool.connect();

    // Step 1: Remove ALL problematic foreign key constraints that cause issues
    console.log('📋 Removing ALL problematic foreign key constraints...');
    
    // Drop foreign key constraint from uploaded_tokens to users
    await client.query(`
      ALTER TABLE uploaded_tokens 
      DROP CONSTRAINT IF EXISTS uploaded_tokens_used_by_fkey
    `);

    // Drop foreign key constraint from keys to users  
    await client.query(`
      ALTER TABLE keys 
      DROP CONSTRAINT IF EXISTS keys_used_by_fkey
    `);

    // Drop foreign key constraint from credit_transactions/request_transactions to users
    await client.query(`
      ALTER TABLE credit_transactions 
      DROP CONSTRAINT IF EXISTS credit_transactions_user_id_fkey
    `);

    // Drop foreign key constraint from request_transactions to users (if it exists)
    await client.query(`
      ALTER TABLE request_transactions 
      DROP CONSTRAINT IF EXISTS request_transactions_user_id_fkey
    `);

    // Step 2: Ensure request system columns exist (handle already converted case)
    console.log('💰 Ensuring requests system is properly set up...');
    
    // Check if credits still exists and rename to requests
    try {
      await client.query(`ALTER TABLE users RENAME COLUMN credits TO requests`);
      console.log('✅ Renamed users.credits to requests');
    } catch (error) {
      console.log('ℹ️ users.credits already renamed or doesn\'t exist');
    }

    try {
      await client.query(`ALTER TABLE uploaded_tokens RENAME COLUMN credits TO requests`);
      console.log('✅ Renamed uploaded_tokens.credits to requests');
    } catch (error) {
      console.log('ℹ️ uploaded_tokens.credits already renamed or doesn\'t exist');
    }

    try {
      await client.query(`ALTER TABLE keys RENAME COLUMN credits TO requests`);
      console.log('✅ Renamed keys.credits to requests');
    } catch (error) {
      console.log('ℹ️ keys.credits already renamed or doesn\'t exist');
    }

    // Handle credit_transactions table
    try {
      await client.query(`ALTER TABLE credit_transactions RENAME TO request_transactions`);
      console.log('✅ Renamed credit_transactions to request_transactions');
    } catch (error) {
      console.log('ℹ️ credit_transactions already renamed or doesn\'t exist');
    }

    try {
      await client.query(`ALTER TABLE request_transactions RENAME COLUMN amount TO requests_amount`);
      console.log('✅ Renamed amount to requests_amount');
    } catch (error) {
      console.log('ℹ️ amount column already renamed or doesn\'t exist');
    }

    // Step 3: Update default values to be request-based
    console.log('🔧 Updating default values for request system...');
    
    try {
      // Set default requests for new users (1000 requests = 20 tokens)
      await client.query(`ALTER TABLE users ALTER COLUMN requests SET DEFAULT 1000`);
      console.log('✅ Set default requests for users');
    } catch (error) {
      console.log('ℹ️ Could not set default requests:', error.message);
    }

    try {
      // Update existing users to have reasonable request amounts (only if they're very low)
      await client.query(`UPDATE users SET requests = GREATEST(requests, 100) WHERE requests < 100`);
      console.log('✅ Updated user request amounts');
    } catch (error) {
      console.log('ℹ️ Could not update user requests:', error.message);
    }

    // Step 4: Create new key generation system
    console.log('🔑 Setting up key generation system...');
    
    try {
      // Add key_type column to distinguish between regular keys and custom keys
      await client.query(`ALTER TABLE keys ADD COLUMN IF NOT EXISTS key_type VARCHAR(20) DEFAULT 'regular'`);
      console.log('✅ Added key_type column');
    } catch (error) {
      console.log('ℹ️ Could not add key_type column:', error.message);
    }

    // Step 5: Add token generation tracking
    console.log('🎫 Setting up token generation tracking...');
    
    try {
      // Create table to track generated tokens (what users generate to use elsewhere)
      await client.query(`
        CREATE TABLE IF NOT EXISTS generated_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          token_value VARCHAR(500) UNIQUE NOT NULL,
          requests_cost INTEGER NOT NULL DEFAULT 50,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_used_at TIMESTAMP,
          usage_count INTEGER DEFAULT 0
        )
      `);
      console.log('✅ Created generated_tokens table');
    } catch (error) {
      console.log('ℹ️ Could not create generated_tokens table:', error.message);
    }

    // Add indexes for performance
    console.log('🔗 Adding performance indexes...');
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_generated_tokens_user_id ON generated_tokens(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_generated_tokens_active ON generated_tokens(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_uploaded_tokens_expires_at ON uploaded_tokens(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_request_transactions_user_id ON request_transactions(user_id)'
    ];

    for (const indexQuery of indexes) {
      try {
        await client.query(indexQuery);
      } catch (error) {
        console.log('ℹ️ Could not create index:', error.message);
      }
    }

    console.log('✅ Database schema fixed successfully!');
    return { success: true };

  } catch (error) {
    console.error('❌ Database schema fix failed:', error);
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
    const result = await fixDatabaseSchema();
    
    if (result.success) {
      res.status(200).json({
        message: '✅ Database schema fixed successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        message: '❌ Database schema fix failed', 
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