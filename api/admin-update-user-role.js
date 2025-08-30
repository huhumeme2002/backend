const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify admin token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let adminUserId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'unified-aivannang-secret-2024');
    adminUserId = decoded.userId;
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { userId, newRole } = req.body;
  
  if (!userId || !newRole) {
    return res.status(400).json({ error: 'userId and newRole are required' });
  }

  if (!['admin', 'user'].includes(newRole)) {
    return res.status(400).json({ error: 'Role must be either "admin" or "user"' });
  }

  let client;
  try {
    client = await pool.connect();

    // Verify admin has admin role
    const adminResult = await client.query(
      'SELECT role FROM users WHERE id = $1',
      [adminUserId]
    );

    if (adminResult.rows.length === 0 || adminResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    // Get current user info
    const userResult = await client.query(
      'SELECT id, username, email, role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentUser = userResult.rows[0];

    // Prevent admin from changing their own role
    if (adminUserId === parseInt(userId)) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    // Update user role
    const updateResult = await client.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, email, role, requests',
      [newRole, userId]
    );

    const updatedUser = updateResult.rows[0];

    // Log the role change
    await client.query(
      `INSERT INTO request_transactions (user_id, requests_amount, description, created_at) 
       VALUES ($1, $2, $3, NOW())`,
      [adminUserId, 0, `Admin changed user ${currentUser.username} role from ${currentUser.role} to ${newRole}`]
    );

    res.status(200).json({
      message: 'User role updated successfully',
      user: updatedUser,
      previous_role: currentUser.role,
      new_role: newRole
    });

  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ 
      error: 'Failed to update user role',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};