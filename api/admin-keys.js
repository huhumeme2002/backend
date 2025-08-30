const { Pool } = require('pg');
const { verifyAdmin } = require('./admin-middleware');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

// Generate random key
function generateKey() {
  return 'KEY-' + crypto.randomBytes(12).toString('hex').toUpperCase();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

    if (req.method === 'GET') {
      // Get keys with pagination and filtering
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;
      const status = req.query.status; // 'used' or 'available'

      let query = `
        SELECT k.id, k.key_value, k.requests, k.is_used, k.used_at, k.created_at, k.expires_at, k.description,
               u.username as used_by_username,
               CASE 
                 WHEN k.is_used = true THEN 'used'
                 WHEN k.expires_at IS NOT NULL AND k.expires_at <= NOW() THEN 'expired'
                 ELSE 'available'
               END as status
        FROM keys k
        LEFT JOIN users u ON k.used_by = u.id
      `;
      let countQuery = 'SELECT COUNT(*) as total FROM keys';
      let params = [];

      if (status === 'used') {
        query += ' WHERE k.is_used = true';
        countQuery += ' WHERE is_used = true';
      } else if (status === 'available') {
        query += ' WHERE k.is_used = false AND (k.expires_at IS NULL OR k.expires_at > NOW())';
        countQuery += ' WHERE is_used = false AND (expires_at IS NULL OR expires_at > NOW())';
      } else if (status === 'expired') {
        query += ' WHERE k.is_used = false AND k.expires_at IS NOT NULL AND k.expires_at <= NOW()';
        countQuery += ' WHERE is_used = false AND expires_at IS NOT NULL AND expires_at <= NOW()';
      }

      query += ' ORDER BY k.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const [keysResult, countResult] = await Promise.all([
        client.query(query, params),
        client.query(countQuery)
      ]);

      // Add is_expired flag for frontend compatibility
      const keys = keysResult.rows.map(key => ({
        ...key,
        is_expired: key.status === 'expired'
      }));
      const total = parseInt(countResult.rows[0].total);

      res.status(200).json({
        keys,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          total,
          limit
        }
      });

    } else if (req.method === 'POST') {
      // Create new keys
      const { count = 1, requests = 500, keyType = 'custom' } = req.body;

      if (count > 100) {
        return res.status(400).json({ error: 'Không thể tạo quá 100 key cùng lúc' });
      }

      if (requests < 1 || requests > 100000) {
        return res.status(400).json({ error: 'Requests phải từ 1 đến 100,000' });
      }

      const createdKeys = [];
      
      for (let i = 0; i < count; i++) {
        const keyValue = generateKey();
        
        const result = await client.query(
          'INSERT INTO keys (key_value, requests, key_type, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
          [keyValue, requests, keyType]
        );
        
        createdKeys.push(result.rows[0]);
      }

      // Log admin activity
      await client.query(
        'INSERT INTO request_transactions (user_id, requests_amount, description) VALUES ($1, 0, $2)',
        [req.user.id, `Admin ${req.user.username} created ${count} keys with ${requests} requests each`]
      );

      res.status(201).json({
        message: `Tạo thành công ${count} key(s) với ${requests} requests mỗi key`,
        keys: createdKeys
      });

    } else if (req.method === 'DELETE') {
      // Delete unused keys
      const { keyIds } = req.body;

      if (!keyIds || !Array.isArray(keyIds)) {
        return res.status(400).json({ error: 'Key IDs là bắt buộc' });
      }

      // Only delete unused keys
      const result = await client.query(
        'DELETE FROM keys WHERE id = ANY($1) AND is_used = false RETURNING id, key_value',
        [keyIds]
      );

      // Log admin activity
      await client.query(
        'INSERT INTO request_transactions (user_id, requests_amount, description, created_at) VALUES ($1, 0, $2, NOW())',
        [req.user.id, `Admin ${req.user.username} deleted ${result.rows.length} unused keys`]
      );

      res.status(200).json({
        message: `Xóa thành công ${result.rows.length} key(s)`,
        deletedKeys: result.rows
      });

    } else {
      res.status(405).json({ error: 'Method không được hỗ trợ' });
    }

  } catch (error) {
    console.error('Admin keys error:', error);
    
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Key đã tồn tại, vui lòng thử lại' });
    }

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