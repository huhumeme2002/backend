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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
      // Get users with pagination
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;
      const search = req.query.search || '';

      let query = `
        SELECT id, username, email, requests, role, is_active, created_at,
               (SELECT COUNT(*) FROM request_transactions WHERE user_id = users.id) as transaction_count
        FROM users
      `;
      let countQuery = 'SELECT COUNT(*) as total FROM users';
      let params = [];
      
      if (search) {
        query += ' WHERE username ILIKE $1 OR email ILIKE $1';
        countQuery += ' WHERE username ILIKE $1 OR email ILIKE $1';
        params = [`%${search}%`];
      }
      
      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const [usersResult, countResult] = await Promise.all([
        client.query(query, params),
        client.query(countQuery, search ? [`%${search}%`] : [])
      ]);

      const users = usersResult.rows;
      const total = parseInt(countResult.rows[0].total);

      res.status(200).json({
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });

    } else if (req.method === 'PUT') {
      // Update user
      const { userId, updates } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: 'User ID là bắt buộc' });
      }

      const allowedUpdates = ['role', 'is_active', 'requests'];
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (allowedUpdates.includes(key)) {
          updateFields.push(`${key} = $${paramIndex}`);
          updateValues.push(value);
          paramIndex++;
        }
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'Không có trường hợp lệ để cập nhật' });
      }

      const updateQuery = `
        UPDATE users 
        SET ${updateFields.join(', ')} 
        WHERE id = $${paramIndex}
        RETURNING id, username, email, requests, role, is_active
      `;
      updateValues.push(userId);

      const result = await client.query(updateQuery, updateValues);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Không tìm thấy người dùng' });
      }

      // Log admin activity
      await client.query(
        'INSERT INTO request_transactions (user_id, requests_amount, description) VALUES ($1, 0, $2)',
        [req.user.id, `Admin ${req.user.username} updated user ${userId}: ${JSON.stringify(updates)}`]
      );

      res.status(200).json({
        message: 'Cập nhật người dùng thành công',
        user: result.rows[0]
      });

    } else if (req.method === 'POST') {
      // Create admin user or adjust credits
      const { action, userId, amount, description } = req.body;

      if (action === 'adjust_requests' || action === 'adjust_credits') {
        if (!userId || amount === undefined) {
          return res.status(400).json({ error: 'User ID và amount là bắt buộc' });
        }

        // Update user requests
        const result = await client.query(
          'UPDATE users SET requests = requests + $1 WHERE id = $2 RETURNING username, requests',
          [amount, userId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Không tìm thấy người dùng' });
        }

        // Log transaction
        await client.query(
          'INSERT INTO request_transactions (user_id, requests_amount, description) VALUES ($1, $2, $3)',
          [userId, amount, description || `Admin ${req.user.username} adjusted requests`]
        );

        res.status(200).json({
          message: 'Điều chỉnh requests thành công',
          user: result.rows[0]
        });
      } else {
        res.status(400).json({ error: 'Action không hợp lệ' });
      }
    } else {
      res.status(405).json({ error: 'Method không được hỗ trợ' });
    }

  } catch (error) {
    console.error('Admin users error:', error);
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