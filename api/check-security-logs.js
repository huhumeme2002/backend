const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    client = await pool.connect();
    
    // Check if security tables exist
    const tableCheck = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('security_incidents', 'ip_rate_limits')
    `);
    
    let securityIncidents = [];
    let ipRateLimits = [];
    
    if (tableCheck.rows.some(row => row.table_name === 'security_incidents')) {
      const incidentsResult = await client.query(`
        SELECT * FROM security_incidents 
        ORDER BY created_at DESC 
        LIMIT 20
      `);
      securityIncidents = incidentsResult.rows;
    }
    
    if (tableCheck.rows.some(row => row.table_name === 'ip_rate_limits')) {
      const rateLimitsResult = await client.query(`
        SELECT * FROM ip_rate_limits 
        ORDER BY last_request DESC 
        LIMIT 20
      `);
      ipRateLimits = rateLimitsResult.rows;
    }
    
    return res.status(200).json({
      success: true,
      message: 'Security logs retrieved successfully',
      data: {
        tables_exist: tableCheck.rows.map(r => r.table_name),
        security_incidents: securityIncidents,
        ip_rate_limits: ipRateLimits,
        incidents_count: securityIncidents.length,
        rate_limits_count: ipRateLimits.length,
        latest_incident: securityIncidents[0] || null,
        latest_rate_limit: ipRateLimits[0] || null
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Security logs check error:', error);
    return res.status(500).json({
      error: 'Failed to check security logs',
      details: error.message,
      code: error.code,
      stack: error.stack
    });
  } finally {
    if (client) client.release();
  }
};