const { Pool } = require('pg');
const { verifyAdmin } = require('./admin-middleware');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

// Initialize global login code table if it doesn't exist
const initTable = async (client) => {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS global_login_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(255) NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true
      )
    `);
    console.log('Global login codes table initialized');
  } catch (error) {
    console.log('Table initialization skipped:', error.message);
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  let client;

  try {
    client = await pool.connect();
    await initTable(client);

    if (req.method === 'GET') {
      // Get current active global login code
      const result = await client.query(
        'SELECT code, created_at FROM global_login_codes WHERE is_active = true ORDER BY created_at DESC LIMIT 1'
      );

      if (result.rows.length > 0) {
        res.status(200).json({
          code: result.rows[0].code,
          date: result.rows[0].created_at.toISOString().split('T')[0]
        });
      } else {
        res.status(200).json({
          code: null,
          message: 'No global login code set'
        });
      }

    } else if (req.method === 'POST') {
      // Verify admin access for setting global code
      await new Promise((resolve, reject) => {
        verifyAdmin(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      }).catch(() => {
        return; // Error already sent by middleware
      });

      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ error: 'Code is required' });
      }

      // Deactivate all existing codes
      await client.query('UPDATE global_login_codes SET is_active = false WHERE is_active = true');

      // Insert new global code
      const result = await client.query(
        'INSERT INTO global_login_codes (code, created_by, created_at) VALUES ($1, $2, NOW()) RETURNING *',
        [code, req.user.id]
      );

      res.status(200).json({
        message: 'Global login code updated successfully',
        code: code,
        created_by: req.user.username,
        created_at: result.rows[0].created_at
      });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Global login code error:', error);
    res.status(500).json({
      error: 'Lỗi server',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};
