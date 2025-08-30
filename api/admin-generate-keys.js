const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const generateKey = () => {
  const timestamp = Date.now().toString();
  const randomPart = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `KEY-${timestamp.slice(-6)}-${randomPart}`;
};

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify admin access
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let client;
  try {
    client = await pool.connect();
    
    // Verify user is admin
    const userResult = await client.query(
      'SELECT id, role FROM users WHERE id = (SELECT user_id FROM user_sessions WHERE token = $1 AND expires_at > NOW())',
      [token]
    );

    if (userResult.rows.length === 0 || userResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { requests, quantity = 1, expiresInDays = null, description = '' } = req.body;

    if (!requests || requests < 1) {
      return res.status(400).json({ error: 'Invalid request amount' });
    }

    if (quantity < 1 || quantity > 100) {
      return res.status(400).json({ error: 'Quantity must be between 1 and 100' });
    }

    const generatedKeys = [];
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

    // Generate multiple keys
    for (let i = 0; i < quantity; i++) {
      const keyValue = generateKey();
      
      const insertResult = await client.query(
        `INSERT INTO keys (key_value, requests, expires_at, description, created_at) 
         VALUES ($1, $2, $3, $4, NOW()) 
         RETURNING id, key_value, requests, expires_at, created_at`,
        [keyValue, requests, expiresAt, description]
      );

      generatedKeys.push(insertResult.rows[0]);
    }

    // Log admin activity
    await client.query(
      `INSERT INTO request_transactions (user_id, requests_amount, description, created_at) 
       VALUES ($1, 0, $2, NOW())`,
      [
        userResult.rows[0].id, 
        `Admin generated ${quantity} keys with ${requests} requests each`
      ]
    );

    res.status(200).json({
      message: `Successfully generated ${quantity} key(s)`,
      keys: generatedKeys,
      total_requests: requests * quantity
    });

  } catch (error) {
    console.error('Key generation error:', error);
    
    if (error.code === '23505') { // Duplicate key
      return res.status(409).json({ error: 'Key generation conflict, please try again' });
    }
    
    res.status(500).json({ 
      error: 'Failed to generate keys',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (client) client.release();
  }
};