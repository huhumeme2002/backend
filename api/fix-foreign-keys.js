const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

const fixForeignKeys = async () => {
  let client;
  try {
    console.log('🔄 Fixing foreign key constraints...');
    client = await pool.connect();

    // List of all foreign key constraints that might cause issues
    const constraintsToRemove = [
      'ALTER TABLE uploaded_tokens DROP CONSTRAINT IF EXISTS uploaded_tokens_used_by_fkey',
      'ALTER TABLE keys DROP CONSTRAINT IF EXISTS keys_used_by_fkey',
      'ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_user_id_fkey',
      'ALTER TABLE request_transactions DROP CONSTRAINT IF EXISTS request_transactions_user_id_fkey',
      'ALTER TABLE request_transactions DROP CONSTRAINT IF EXISTS credit_transactions_user_id_fkey',
      'ALTER TABLE admin_activities DROP CONSTRAINT IF EXISTS admin_activities_admin_id_fkey',
      'ALTER TABLE admin_activities DROP CONSTRAINT IF EXISTS admin_activities_target_user_id_fkey'
    ];

    console.log('📋 Removing foreign key constraints that cause deletion issues...');
    
    for (const constraint of constraintsToRemove) {
      try {
        await client.query(constraint);
        console.log('✅ Executed:', constraint.split(' ')[4]); // Extract constraint name
      } catch (error) {
        console.log('ℹ️ Constraint not found or already removed:', constraint.split(' ')[4]);
      }
    }

    // Ensure request_transactions table has the right column name
    try {
      await client.query('ALTER TABLE request_transactions RENAME COLUMN amount TO requests_amount');
      console.log('✅ Renamed amount to requests_amount');
    } catch (error) {
      console.log('ℹ️ Column already renamed or doesn\'t exist');
    }

    console.log('✅ Foreign key constraints fixed successfully!');
    return { success: true };

  } catch (error) {
    console.error('❌ Foreign key fix failed:', error);
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
    const result = await fixForeignKeys();
    
    if (result.success) {
      res.status(200).json({
        message: '✅ Foreign key constraints fixed successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        message: '❌ Foreign key fix failed', 
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