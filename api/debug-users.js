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
    
    // Get all users (hide sensitive data)
    const usersResult = await client.query(`
      SELECT id, username, email, requests, role, is_active, created_at
      FROM users 
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    // Get table structure
    const structureResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position
    `);
    
    res.status(200).json({
      message: 'Users debug info',
      timestamp: new Date().toISOString(),
      total_users: usersResult.rows.length,
      users: usersResult.rows.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        requests: user.requests,
        role: user.role,
        is_active: user.is_active,
        created_at: user.created_at
      })),
      table_structure: structureResult.rows
    });

  } catch (error) {
    console.error('Debug users error:', error);
    res.status(500).json({ 
      error: 'Database error',
      details: error.message,
      code: error.code
    });
  } finally {
    if (client) client.release();
  }
};
