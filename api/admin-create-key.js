const { Pool } = require('pg');
const { verifyAdmin } = require('./admin-middleware');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const generateKey = () => {
  const timestamp = Date.now().toString();
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `VIP-${timestamp.slice(-6)}-${randomPart}`;
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
  await new Promise((resolve, reject) => {
    verifyAdmin(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  }).catch(() => {
    return; // Error already sent by middleware
  });

  let client;
  try {
    client = await pool.connect();

    const { requests = 100, quantity = 1, expiresInDays = null, description = '' } = req.body;

    if (requests < 1 || requests > 10000) {
      return res.status(400).json({ error: 'Requests must be between 1 and 10000' });
    }

    if (quantity < 1 || quantity > 50) {
      return res.status(400).json({ error: 'Quantity must be between 1 and 50' });
    }

    const generatedKeys = [];
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

    // Generate keys using simple INSERT
    for (let i = 0; i < quantity; i++) {
      const keyValue = generateKey();
      
      try {
        const insertResult = await client.query(
          `INSERT INTO keys (key_value, requests, expires_at, description, is_used, created_at) 
           VALUES ($1, $2, $3, $4, false, NOW()) 
           RETURNING id, key_value, requests, expires_at, created_at`,
          [keyValue, requests, expiresAt, description || `Admin created key (${requests} requests)`]
        );

        generatedKeys.push(insertResult.rows[0]);
      } catch (insertError) {
        console.error('Insert error:', insertError.message);
        // If individual insert fails, try with minimal data
        const fallbackResult = await client.query(
          `INSERT INTO keys (key_value, requests, is_used, created_at) 
           VALUES ($1, $2, false, NOW()) 
           RETURNING id, key_value, requests, created_at`,
          [keyValue, requests]
        );
        generatedKeys.push(fallbackResult.rows[0]);
      }
    }

    res.status(200).json({
      message: `Successfully generated ${quantity} key(s)`,
      keys: generatedKeys,
      total_requests: requests * quantity
    });

  } catch (error) {
    console.error('Key generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate keys',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};