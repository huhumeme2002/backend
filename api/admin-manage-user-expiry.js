const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

// Admin middleware
async function requireAdmin(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return { error: 'No token provided', status: 401 };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'unified-aivannang-secret-2024');
    
    const client = await pool.connect();
    const result = await client.query(
      'SELECT role FROM users WHERE id = $1',
      [decoded.userId]
    );
    client.release();

    if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
      return { error: 'Admin access required', status: 403 };
    }

    return { userId: decoded.userId };
  } catch (error) {
    return { error: 'Invalid token', status: 401 };
  }
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Check admin permission
  const authResult = await requireAdmin(req, res);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  const { targetUserId, requests, expiryDays, action } = req.body;

  if (!targetUserId || !action) {
    return res.status(400).json({ 
      error: 'targetUserId and action are required' 
    });
  }

  let client;
  try {
    client = await pool.connect();

    // Get target user
    const userResult = await client.query(
      'SELECT id, username, requests, expiry_time FROM users WHERE id = $1',
      [targetUserId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    await client.query('BEGIN');

    if (action === 'adjust_requests') {
      if (typeof requests !== 'number') {
        throw new Error('Requests must be a number');
      }

      const newRequests = Math.max(0, user.requests + requests);
      
      await client.query(
        'UPDATE users SET requests = $1 WHERE id = $2',
        [newRequests, targetUserId]
      );

      // Log transaction
      await client.query(
        'INSERT INTO request_transactions (user_id, requests_amount, description) VALUES ($1, $2, $3)',
        [targetUserId, requests, `Admin adjustment: ${requests > 0 ? '+' : ''}${requests} requests`]
      );

      // Log admin activity
      await client.query(
        'INSERT INTO admin_activities (admin_id, activity_type, target_user_id, description, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [authResult.userId, 'adjust_requests', targetUserId, 'Admin adjusted user requests', 
         JSON.stringify({requests: user.requests}), JSON.stringify({requests: newRequests})]
      );

    } else if (action === 'set_expiry') {
      if (!expiryDays || typeof expiryDays !== 'number') {
        throw new Error('expiryDays must be a positive number');
      }

      const newExpiryTime = new Date();
      newExpiryTime.setDate(newExpiryTime.getDate() + expiryDays);

      await client.query(
        'UPDATE users SET expiry_time = $1, is_expired = false WHERE id = $2',
        [newExpiryTime, targetUserId]
      );

      // Log admin activity
      await client.query(
        'INSERT INTO admin_activities (admin_id, activity_type, target_user_id, description, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
        [authResult.userId, 'set_expiry', targetUserId, `Admin set user expiry to +${expiryDays} days`, 
         JSON.stringify({expiry_time: user.expiry_time}), JSON.stringify({expiry_time: newExpiryTime})]
      );

    } else {
      throw new Error('Invalid action. Use "adjust_requests" or "set_expiry"');
    }

    await client.query('COMMIT');

    // Get updated user data
    const updatedResult = await client.query(
      'SELECT id, username, requests, expiry_time, is_expired FROM users WHERE id = $1',
      [targetUserId]
    );

    res.status(200).json({
      success: true,
      message: `User ${action === 'adjust_requests' ? 'requests' : 'expiry'} updated successfully`,
      user: updatedResult.rows[0]
    });

  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Admin manage user error:', error);
    res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  } finally {
    if (client) client.release();
  }
};