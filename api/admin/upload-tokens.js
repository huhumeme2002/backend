const { Pool } = require('pg');
const { verifyAdmin } = require('../admin-middleware');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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

    if (req.method === 'GET') {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const status = req.query.status || 'all';

      let whereClause = '';
      if (status === 'used') {
        whereClause = 'WHERE used_by IS NOT NULL';
      } else if (status === 'available') {
        whereClause = 'WHERE used_by IS NULL AND (expires_at IS NULL OR expires_at > NOW())';
      } else if (status === 'expired') {
        whereClause = 'WHERE expires_at IS NOT NULL AND expires_at <= NOW()';
      }

      // Get tokens with user info
      const tokensQuery = `
        SELECT 
          ut.id,
          ut.token_value,
          ut.requests,
          ut.expires_at,
          ut.description,
          ut.created_at,
          ut.used_at,
          u.username as used_by_username,
          ut.used_by,
          CASE 
            WHEN ut.used_by IS NOT NULL THEN 'used'
            WHEN ut.expires_at IS NOT NULL AND ut.expires_at <= NOW() THEN 'expired'
            ELSE 'available'
          END as status
        FROM uploaded_tokens ut
        LEFT JOIN users u ON ut.used_by = u.id
        ${whereClause}
        ORDER BY ut.created_at DESC
        LIMIT $1 OFFSET $2
      `;

      const countQuery = `
        SELECT COUNT(*) as total
        FROM uploaded_tokens ut
        ${whereClause}
      `;

      const [tokensResult, countResult] = await Promise.all([
        client.query(tokensQuery, [limit, offset]),
        client.query(countQuery)
      ]);

      const tokens = tokensResult.rows;
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        tokens,
        pagination: {
          page,
          limit,
          total,
          totalPages
        }
      });

    } else if (req.method === 'POST') {
      // Handle file upload - this would be handled by admin-upload-tokens endpoint
      return res.status(400).json({ 
        error: 'Use admin-upload-tokens endpoint for file uploads' 
      });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Admin upload tokens error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch tokens',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};