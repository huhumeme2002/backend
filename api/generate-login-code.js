const { Pool } = require('pg');
const { verifyAdmin } = require('./admin-middleware');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
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

    if (req.method === 'POST') {
      // Generate new login code
      const code = req.body.code || Math.random().toString(36).substring(2, 8).toUpperCase();

      // Store the login code in database (you might want to create a login_codes table)
      // For now, we'll just return the generated code
      const result = await client.query(
        'INSERT INTO admin_activities (admin_id, activity_type, description, new_value, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
        [
          req.user.id,
          'generate_login_code',
          `Admin ${req.user.username} generated login code`,
          JSON.stringify({ code })
        ]
      );

      res.status(200).json({
        message: 'Login code generated successfully',
        code: code,
        generated_at: new Date().toISOString(),
        generated_by: req.user.username
      });

    } else if (req.method === 'GET') {
      // Get current login code (this would need a proper table structure)
      // For now, return a placeholder
      res.status(200).json({
        code: null, // No persistent code stored
        date: new Date().toISOString().split('T')[0],
        message: 'No persistent login code found. Use POST to generate a new one.'
      });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Generate login code error:', error);
    res.status(500).json({
      error: 'Lỗi server',
      details: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};
