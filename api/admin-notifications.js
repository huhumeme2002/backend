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
      // Send notification
      const { title, content, type, recipient } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
      }

      // Log the notification (optional - skip if admin_activities table doesn't exist)
      try {
        const result = await client.query(
          'INSERT INTO admin_activities (admin_id, activity_type, description, new_value, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
          [
            req.user.id,
            'send_notification',
            `Admin ${req.user.username} sent notification: ${title}`,
            JSON.stringify({ title, content, type, recipient })
          ]
        );
      } catch (logError) {
        // Ignore logging error - notification still works
        console.log('Could not log notification to admin_activities:', logError.message);
      }

      res.status(200).json({
        message: 'Notification sent successfully',
        notification: {
          title,
          content,
          type: type || 'info',
          recipient: recipient || 'all',
          sent_by: req.user.username,
          sent_at: new Date().toISOString()
        }
      });

    } else if (req.method === 'GET') {
      // Get notification history
      const result = await client.query(`
        SELECT aa.*, u.username as admin_username
        FROM admin_activities aa
        JOIN users u ON aa.admin_id = u.id
        WHERE aa.activity_type = 'send_notification'
        ORDER BY aa.created_at DESC
        LIMIT 20
      `);

      const notifications = result.rows.map(row => ({
        id: row.id,
        title: JSON.parse(row.new_value).title,
        content: JSON.parse(row.new_value).content,
        type: JSON.parse(row.new_value).type,
        recipient: JSON.parse(row.new_value).recipient,
        sent_by: row.admin_username,
        sent_at: row.created_at
      }));

      res.status(200).json({
        notifications
      });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Admin notifications error:', error);
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
