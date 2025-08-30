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
  const { action, keyValue, testData } = req.body;
  
  let client;
  try {
    client = await pool.connect();
    const results = { 
      timestamp: new Date().toISOString(),
      action: action || 'full_debug'
    };

    // Step 1: JWT Authentication Test
    results.auth = { step: 1, success: false };
    let userId = null, userRole = null;
    
    if (!token) {
      results.auth.error = 'No token provided';
    } else {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aivannang-secret-key');
        userId = decoded.userId;
        
        const userResult = await client.query(
          'SELECT id, username, role FROM users WHERE id = $1',
          [userId]
        );
        
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          userRole = user.role;
          results.auth = {
            step: 1,
            success: true,
            userId: user.id,
            username: user.username,
            role: user.role,
            isAdmin: user.role === 'admin'
          };
        } else {
          results.auth.error = 'User not found in database';
        }
      } catch (jwtError) {
        results.auth.error = `JWT Error: ${jwtError.message}`;
      }
    }

    // Step 2: Test Key Creation (if admin)
    if (action === 'test_create_key' && results.auth.success && userRole === 'admin') {
      results.createKey = { step: 2, success: false };
      try {
        const keyValue = `TEST-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
        
        const insertResult = await client.query(
          `INSERT INTO keys (key_value, requests, expires_at, description, is_used, created_at) 
           VALUES ($1, $2, $3, $4, false, NOW()) 
           RETURNING id, key_value, requests, created_at`,
          [keyValue, 100, null, 'Test key creation']
        );

        results.createKey = {
          step: 2,
          success: true,
          insertedKey: insertResult.rows[0]
        };

        // Verify it was inserted
        const verifyResult = await client.query(
          'SELECT * FROM keys WHERE key_value = $1',
          [keyValue]
        );
        
        results.createKey.verification = {
          found: verifyResult.rows.length > 0,
          key: verifyResult.rows[0]
        };

      } catch (createError) {
        results.createKey.error = createError.message;
      }
    }

    // Step 3: Test Admin Keys Query  
    if (results.auth.success && userRole === 'admin') {
      results.adminKeys = { step: 3, success: false };
      try {
        const keysQuery = `
          SELECT k.id, k.key_value, k.requests, k.is_used, k.created_at, k.expires_at, k.description,
                 u.username as used_by_username,
                 CASE 
                   WHEN k.is_used = true THEN 'used'
                   WHEN k.expires_at IS NOT NULL AND k.expires_at <= NOW() THEN 'expired'
                   ELSE 'available'
                 END as status
          FROM keys k
          LEFT JOIN users u ON k.used_by = u.id
          ORDER BY k.created_at DESC
          LIMIT 10
        `;
        
        const keysResult = await client.query(keysQuery);
        
        results.adminKeys = {
          step: 3,
          success: true,
          totalKeys: keysResult.rows.length,
          keys: keysResult.rows
        };
      } catch (keysError) {
        results.adminKeys.error = keysError.message;
      }
    }

    // Step 4: Test Key Redemption
    if (keyValue && results.auth.success) {
      results.redeemKey = { step: 4, success: false };
      try {
        const keyResult = await client.query(
          `SELECT id, key_value, requests, expires_at, is_used, used_by, used_at 
           FROM keys 
           WHERE key_value = $1`,
          [keyValue]
        );

        if (keyResult.rows.length === 0) {
          results.redeemKey.error = 'Key không tồn tại';
        } else {
          const keyData = keyResult.rows[0];
          results.redeemKey = {
            step: 4,
            success: true,
            keyFound: true,
            key: keyData,
            canRedeem: !keyData.is_used && (!keyData.expires_at || new Date(keyData.expires_at) > new Date())
          };

          // Test the actual redemption if requested
          if (action === 'test_redeem' && !keyData.is_used) {
            await client.query('BEGIN');
            
            try {
              await client.query(
                `UPDATE keys 
                 SET is_used = true, used_by = $1, used_at = NOW() 
                 WHERE id = $2`,
                [userId, keyData.id]
              );

              const userUpdateResult = await client.query(
                `UPDATE users 
                 SET requests = requests + $1 
                 WHERE id = $2 
                 RETURNING username, requests`,
                [keyData.requests, userId]
              );

              await client.query(
                `INSERT INTO request_transactions (user_id, requests_amount, description, created_at) 
                 VALUES ($1, $2, $3, NOW())`,
                [userId, keyData.requests, `Test redeem key: ${keyData.key_value}`]
              );

              await client.query('COMMIT');

              results.redeemKey.redemption = {
                success: true,
                requestsAdded: keyData.requests,
                newUserRequests: userUpdateResult.rows[0].requests
              };
            } catch (redeemError) {
              await client.query('ROLLBACK');
              results.redeemKey.redemption = {
                success: false,
                error: redeemError.message
              };
            }
          }
        }
      } catch (redeemError) {
        results.redeemKey.error = redeemError.message;
      }
    }

    // Step 5: Current Database State
    results.dbState = { step: 5, success: false };
    try {
      const counts = await Promise.all([
        client.query('SELECT COUNT(*) as count FROM keys'),
        client.query('SELECT COUNT(*) as count FROM uploaded_tokens'),
        client.query('SELECT COUNT(*) as count FROM users'),
        client.query('SELECT COUNT(*) as count FROM keys WHERE is_used = false'),
      ]);

      results.dbState = {
        step: 5,
        success: true,
        totalKeys: parseInt(counts[0].rows[0].count),
        totalTokens: parseInt(counts[1].rows[0].count),
        totalUsers: parseInt(counts[2].rows[0].count),
        availableKeys: parseInt(counts[3].rows[0].count)
      };
    } catch (dbError) {
      results.dbState.error = dbError.message;
    }

    res.status(200).json(results);

  } catch (error) {
    console.error('Complete debug error:', error);
    res.status(500).json({ 
      error: 'Complete debug failed',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};