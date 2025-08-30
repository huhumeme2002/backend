const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

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

  const token = req.headers.authorization?.replace('Bearer ', '');
  const { testType, keyValue } = req.body;
  
  let client;
  try {
    client = await pool.connect();
    const results = { timestamp: new Date().toISOString() };

    // Test 1: JWT decode
    results.jwtTest = { success: false };
    try {
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aivannang-secret-key');
        results.jwtTest = {
          success: true,
          decoded: { userId: decoded.userId, exp: decoded.exp },
          jwtSecret: process.env.JWT_SECRET ? 'From env' : 'Fallback: aivannang-secret-key'
        };
      } else {
        results.jwtTest = { success: false, error: 'No token provided' };
      }
    } catch (jwtError) {
      results.jwtTest = { success: false, error: jwtError.message };
    }

    // Test 2: User check
    results.userTest = { success: false };
    if (results.jwtTest.success) {
      try {
        const userResult = await client.query(
          'SELECT id, username, role, requests FROM users WHERE id = $1',
          [results.jwtTest.decoded.userId]
        );
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          results.userTest = {
            success: true,
            user: {
              id: user.id,
              username: user.username,
              role: user.role,
              requests: user.requests,
              isAdmin: user.role === 'admin'
            }
          };
        } else {
          results.userTest = { success: false, error: 'User not found' };
        }
      } catch (userError) {
        results.userTest = { success: false, error: userError.message };
      }
    }

    // Test 3: Keys query
    results.keysTest = { success: false };
    try {
      const keysResult = await client.query(`
        SELECT k.id, k.key_value, k.requests, k.is_used, k.created_at, k.expires_at,
               u.username as used_by_username
        FROM keys k
        LEFT JOIN users u ON k.used_by = u.id
        ORDER BY k.created_at DESC
        LIMIT 5
      `);
      results.keysTest = {
        success: true,
        keysCount: keysResult.rows.length,
        keys: keysResult.rows
      };
    } catch (keysError) {
      results.keysTest = { success: false, error: keysError.message };
    }

    // Test 4: Specific key test if provided
    if (keyValue) {
      results.specificKeyTest = { success: false };
      try {
        const keyResult = await client.query(
          'SELECT * FROM keys WHERE key_value = $1',
          [keyValue]
        );
        results.specificKeyTest = {
          success: true,
          found: keyResult.rows.length > 0,
          key: keyResult.rows[0] || null
        };
      } catch (keyError) {
        results.specificKeyTest = { success: false, error: keyError.message };
      }
    }

    // Test 5: Token table structure
    results.tableTest = { success: false };
    try {
      const tableStructure = await client.query(`
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name IN ('keys', 'uploaded_tokens', 'users')
        ORDER BY table_name, ordinal_position
      `);
      results.tableTest = {
        success: true,
        structure: tableStructure.rows
      };
    } catch (tableError) {
      results.tableTest = { success: false, error: tableError.message };
    }

    res.status(200).json(results);

  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ 
      error: 'Debug failed',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};