const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    client = await pool.connect();
    
    // Simple test without authentication
    const results = {
      timestamp: new Date().toISOString(),
      databaseConnection: 'success'
    };

    // Test table structures
    try {
      const keysTable = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'keys'
        ORDER BY ordinal_position
      `);
      results.keysTableStructure = keysTable.rows;
    } catch (e) {
      results.keysTableError = e.message;
    }

    try {
      const tokensTable = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'uploaded_tokens'
        ORDER BY ordinal_position
      `);
      results.tokensTableStructure = tokensTable.rows;
    } catch (e) {
      results.tokensTableError = e.message;
    }

    try {
      const usersTable = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
        ORDER BY ordinal_position
      `);
      results.usersTableStructure = usersTable.rows;
    } catch (e) {
      results.usersTableError = e.message;
    }

    // Test simple queries
    try {
      const keysCount = await client.query('SELECT COUNT(*) as count FROM keys');
      results.totalKeys = parseInt(keysCount.rows[0].count);
    } catch (e) {
      results.keysCountError = e.message;
    }

    try {
      const tokensCount = await client.query('SELECT COUNT(*) as count FROM uploaded_tokens');
      results.totalTokens = parseInt(tokensCount.rows[0].count);
    } catch (e) {
      results.tokensCountError = e.message;
    }

    try {
      const usersCount = await client.query('SELECT COUNT(*) as count FROM users');
      results.totalUsers = parseInt(usersCount.rows[0].count);
    } catch (e) {
      results.usersCountError = e.message;
    }

    // Test recent keys
    try {
      const recentKeys = await client.query(`
        SELECT key_value, requests, is_used, created_at 
        FROM keys 
        ORDER BY created_at DESC 
        LIMIT 3
      `);
      results.recentKeys = recentKeys.rows;
    } catch (e) {
      results.recentKeysError = e.message;
    }

    // Test JWT secret info
    results.jwtSecretSource = process.env.JWT_SECRET ? 'environment' : 'fallback';
    results.jwtSecretValue = process.env.JWT_SECRET || 'aivannang-secret-key';

    res.status(200).json(results);

  } catch (error) {
    console.error('Simple debug error:', error);
    res.status(500).json({ 
      error: 'Debug failed',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};