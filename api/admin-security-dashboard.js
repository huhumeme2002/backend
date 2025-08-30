const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
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

  let client;
  try {
    client = await pool.connect();

    // Verify admin role
    const adminResult = await client.query(
      'SELECT role FROM users WHERE id = $1',
      [adminUserId]
    );

    if (adminResult.rows.length === 0 || adminResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }

    // Get security incidents (last 24 hours)
    const incidentsResult = await client.query(`
      SELECT ip_address, endpoint, incident_type, details, created_at, user_agent
      FROM security_incidents 
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    // Get IP rate limit stats
    const ipStatsResult = await client.query(`
      SELECT 
        ip_address,
        endpoint,
        request_count,
        is_suspicious,
        blocked_until,
        first_request,
        last_request
      FROM ip_rate_limits 
      WHERE is_suspicious = TRUE OR blocked_until > NOW()
      ORDER BY last_request DESC
      LIMIT 50
    `);

    // Get failed key attempts stats
    const failedAttemptsResult = await client.query(`
      SELECT 
        ka.user_id,
        u.username,
        ka.failed_count,
        ka.blocked_until,
        ka.ip_address,
        ka.last_attempt
      FROM key_attempts ka
      LEFT JOIN users u ON ka.user_id = u.id
      WHERE ka.failed_count > 0
      ORDER BY ka.last_attempt DESC
      LIMIT 50
    `);

    // Get summary statistics
    const statsResult = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM security_incidents WHERE created_at > NOW() - INTERVAL '24 hours') as incidents_24h,
        (SELECT COUNT(*) FROM ip_rate_limits WHERE is_suspicious = TRUE) as suspicious_ips,
        (SELECT COUNT(*) FROM ip_rate_limits WHERE blocked_until > NOW()) as blocked_ips,
        (SELECT COUNT(*) FROM key_attempts WHERE failed_count >= 3) as blocked_users,
        (SELECT COUNT(DISTINCT ip_address) FROM security_incidents WHERE created_at > NOW() - INTERVAL '1 hour') as unique_attack_ips_1h
    `);

    res.status(200).json({
      summary: statsResult.rows[0],
      recent_incidents: incidentsResult.rows,
      suspicious_ips: ipStatsResult.rows,
      failed_key_attempts: failedAttemptsResult.rows,
      generated_at: new Date().toISOString(),
      note: 'Security dashboard data for last 24 hours'
    });

  } catch (error) {
    console.error('Admin security dashboard error:', error);
    res.status(500).json({ 
      error: 'Failed to load security dashboard',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};