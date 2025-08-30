const { Pool } = require('pg');

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

    // Check keys table schema
    const keysSchema = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'keys' 
      ORDER BY ordinal_position
    `);

    // Check uploaded_tokens table schema  
    const tokensSchema = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'uploaded_tokens'
      ORDER BY ordinal_position
    `);

    // Check users table schema
    const usersSchema = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    // Check if tables exist
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('keys', 'uploaded_tokens', 'users', 'request_transactions')
    `);

    res.status(200).json({
      tables: tablesCheck.rows,
      schemas: {
        keys: keysSchema.rows,
        uploaded_tokens: tokensSchema.rows,
        users: usersSchema.rows
      }
    });

  } catch (error) {
    console.error('Schema check error:', error);
    res.status(500).json({ 
      error: 'Failed to check schema',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};