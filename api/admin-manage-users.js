const { Pool } = require('pg');
const { verifyAdmin } = require('./admin-middleware');
const bcrypt = require('bcryptjs');

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

    if (req.method === 'POST') {
      const { action, userId, amount, description, newPassword } = req.body;

      if (!userId) {
        return res.status(400).json({ error: 'User ID là bắt buộc' });
      }

      // Get user info first
      const userResult = await client.query(
        'SELECT id, username, requests, email FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Không tìm thấy người dùng' });
      }

      const user = userResult.rows[0];

      if (action === 'adjust_requests' || action === 'adjust_credits') {
        // Add or reduce requests (formerly credits)
        if (amount === undefined || isNaN(amount)) {
          return res.status(400).json({ error: 'Số lượng request không hợp lệ' });
        }

        const oldRequests = user.requests;
        const newRequests = Math.max(0, oldRequests + amount); // Không cho phép requests âm

        // Update user requests
        await client.query(
          'UPDATE users SET requests = $1 WHERE id = $2',
          [newRequests, userId]
        );

        // Log request transaction
        await client.query(
          'INSERT INTO request_transactions (user_id, requests_amount, description, created_at) VALUES ($1, $2, $3, NOW())',
          [userId, amount, description || `Admin ${req.user.username} điều chỉnh requests`]
        );

        // Log admin activity (if admin_activities table exists)
        try {
          await client.query(
            'INSERT INTO admin_activities (admin_id, activity_type, target_user_id, description, old_value, new_value, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
            [
              req.user.id,
              'adjust_requests',
              userId,
              `Điều chỉnh requests cho ${user.username}: ${amount > 0 ? '+' : ''}${amount}`,
              JSON.stringify({ requests: oldRequests }),
              JSON.stringify({ requests: newRequests })
            ]
          );
        } catch (adminLogError) {
          // Admin activities table might not exist, continue anyway
          console.log('Admin activity logging skipped:', adminLogError.message);
        }

        res.status(200).json({
          message: 'Điều chỉnh requests thành công',
          user: {
            id: user.id,
            username: user.username,
            oldRequests,
            newRequests,
            adjustment: amount
          }
        });

      } else if (action === 'change_password') {
        // Change user password
        if (!newPassword || newPassword.length < 6) {
          return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(newPassword, 10);

        // Update password
        await client.query(
          'UPDATE users SET password_hash = $1 WHERE id = $2',
          [passwordHash, userId]
        );

        // Log admin activity (if admin_activities table exists)
        try {
          await client.query(
            'INSERT INTO admin_activities (admin_id, activity_type, target_user_id, description, created_at) VALUES ($1, $2, $3, $4, NOW())',
            [
              req.user.id,
              'change_password',
              userId,
              `Đổi mật khẩu cho người dùng ${user.username}`
            ]
          );
        } catch (adminLogError) {
          console.log('Admin activity logging skipped:', adminLogError.message);
        }

        res.status(200).json({
          message: 'Đổi mật khẩu thành công',
          user: {
            id: user.id,
            username: user.username,
            email: user.email
          }
        });

      } else if (action === 'get_user_tokens') {
        // Get user's token usage history
        const tokensResult = await client.query(`
          SELECT 
            ut.token_value,
            ut.requests,
            ut.used_at,
            ut.expires_at,
            ut.description,
            CASE WHEN ut.expires_at IS NOT NULL AND ut.expires_at < NOW() THEN true ELSE false END as was_expired_when_used
          FROM uploaded_tokens ut
          WHERE ut.used_by = $1
          ORDER BY ut.used_at DESC
          LIMIT 50
        `, [userId]);

        const requestHistory = await client.query(`
          SELECT requests_amount as amount, description, created_at
          FROM request_transactions
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 50
        `, [userId]);

        res.status(200).json({
          user: user,
          tokenHistory: tokensResult.rows,
          creditHistory: requestHistory.rows
        });

      } else {
        res.status(400).json({ error: 'Action không hợp lệ' });
      }

    } else if (req.method === 'GET') {
      // Get user management dashboard data
      const stats = await client.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN is_active THEN 1 END) as active_users,
          SUM(requests) as total_requests,
          COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_count
        FROM users
      `);

      let recentActivities = { rows: [] };
      try {
        recentActivities = await client.query(`
          SELECT 
            aa.activity_type,
            aa.description,
            aa.created_at,
            u1.username as admin_username,
            u2.username as target_username
          FROM admin_activities aa
          JOIN users u1 ON aa.admin_id = u1.id
          LEFT JOIN users u2 ON aa.target_user_id = u2.id
          ORDER BY aa.created_at DESC
          LIMIT 20
        `);
      } catch (error) {
        // admin_activities table might not exist
        console.log('Admin activities table not available');
      }

      const topRequestUsers = await client.query(`
        SELECT username, requests, 
               (SELECT COUNT(*) FROM uploaded_tokens WHERE used_by = users.id) as tokens_used
        FROM users
        ORDER BY requests DESC
        LIMIT 10
      `);

      res.status(200).json({
        stats: stats.rows[0],
        recentActivities: recentActivities.rows,
        topRequestUsers: topRequestUsers.rows
      });

    } else {
      res.status(405).json({ error: 'Method không được hỗ trợ' });
    }

  } catch (error) {
    console.error('Admin manage users error:', error);
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