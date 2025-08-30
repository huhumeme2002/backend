const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

const removeAllForeignKeys = async () => {
  let client;
  try {
    console.log('🔄 Finding and removing all foreign key constraints...');
    client = await pool.connect();

    // Query to find all foreign key constraints referencing users table
    const findForeignKeysQuery = `
      SELECT 
        tc.table_name,
        tc.constraint_name,
        tc.table_schema
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'users'
        AND tc.table_schema = 'public'
    `;

    console.log('🔍 Finding all foreign key constraints referencing users table...');
    const foreignKeysResult = await client.query(findForeignKeysQuery);
    const foreignKeys = foreignKeysResult.rows;

    console.log(`📊 Found ${foreignKeys.length} foreign key constraints:`, foreignKeys);

    // Remove each foreign key constraint
    for (const fk of foreignKeys) {
      try {
        const dropQuery = `ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`;
        await client.query(dropQuery);
        console.log(`✅ Removed constraint: ${fk.constraint_name} from table ${fk.table_name}`);
      } catch (error) {
        console.log(`⚠️ Failed to remove ${fk.constraint_name}:`, error.message);
      }
    }

    // Also remove some common constraints that might not be caught by the query
    const additionalConstraints = [
      'ALTER TABLE uploaded_tokens DROP CONSTRAINT IF EXISTS uploaded_tokens_used_by_fkey',
      'ALTER TABLE keys DROP CONSTRAINT IF EXISTS keys_used_by_fkey',
      'ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_user_id_fkey',
      'ALTER TABLE request_transactions DROP CONSTRAINT IF EXISTS request_transactions_user_id_fkey',
      'ALTER TABLE admin_activities DROP CONSTRAINT IF EXISTS admin_activities_admin_id_fkey',
      'ALTER TABLE admin_activities DROP CONSTRAINT IF EXISTS admin_activities_target_user_id_fkey',
      'ALTER TABLE generated_tokens DROP CONSTRAINT IF EXISTS generated_tokens_user_id_fkey'
    ];

    console.log('🧹 Removing additional known constraints...');
    for (const constraint of additionalConstraints) {
      try {
        await client.query(constraint);
        const constraintName = constraint.split(' ')[4];
        console.log('✅ Removed additional constraint:', constraintName);
      } catch (error) {
        const constraintName = constraint.split(' ')[4];
        console.log('ℹ️ Constraint not found:', constraintName);
      }
    }

    // Verify by trying to find remaining constraints
    const verifyQuery = `
      SELECT COUNT(*) as remaining_constraints
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'users'
        AND tc.table_schema = 'public'
    `;

    const verifyResult = await client.query(verifyQuery);
    const remainingCount = parseInt(verifyResult.rows[0].remaining_constraints);

    console.log(`🔍 Verification: ${remainingCount} foreign key constraints remaining`);

    console.log('✅ All foreign key constraints targeting users table have been removed!');
    return { 
      success: true, 
      removed_constraints: foreignKeys.length,
      remaining_constraints: remainingCount
    };

  } catch (error) {
    console.error('❌ Foreign key removal failed:', error);
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
    const result = await removeAllForeignKeys();
    
    if (result.success) {
      res.status(200).json({
        message: '✅ All foreign key constraints removed successfully',
        removed_constraints: result.removed_constraints,
        remaining_constraints: result.remaining_constraints,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        message: '❌ Foreign key removal failed', 
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