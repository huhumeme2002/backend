const { Pool } = require('pg');

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

  let client;
  try {
    client = await pool.connect();
    
    // Kiểm tra bảng uploaded_tokens
    const checkTableResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'uploaded_tokens'
      )
    `);

    if (!checkTableResult.rows[0].exists) {
      return res.status(200).json({
        message: 'uploaded_tokens table does not exist',
        available_tokens: 0,
        total_tokens: 0,
        note: 'Need to upload tokens via admin dashboard first'
      });
    }

    // Lấy thống kê tokens
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN is_used = false THEN 1 END) as available_tokens,
        COUNT(CASE WHEN is_used = true THEN 1 END) as used_tokens
      FROM uploaded_tokens
    `);

    // Lấy một vài tokens mẫu
    const sampleResult = await client.query(`
      SELECT token_value, is_used, created_at
      FROM uploaded_tokens 
      ORDER BY created_at DESC
      LIMIT 5
    `);

    res.status(200).json({
      table_exists: true,
      stats: statsResult.rows[0],
      sample_tokens: sampleResult.rows,
      note: 'These are tokens uploaded via admin Excel upload'
    });

  } catch (error) {
    console.error('Check uploaded tokens error:', error);
    res.status(500).json({ 
      error: 'Failed to check uploaded tokens',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};