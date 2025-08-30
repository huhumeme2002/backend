const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    client = await pool.connect();
    
    // Thay đổi default value của requests từ 1000 thành 0
    await client.query(`
      ALTER TABLE users 
      ALTER COLUMN requests SET DEFAULT 0
    `);
    
    // Cập nhật tất cả users hiện tại về 0 requests (trừ admin)
    const updateResult = await client.query(`
      UPDATE users 
      SET requests = 0 
      WHERE role != 'admin'
      RETURNING id, username, requests, role
    `);

    // Kiểm tra lại schema
    const schemaResult = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'requests'
    `);

    res.status(200).json({
      message: 'Successfully updated users default requests to 0',
      updated_users: updateResult.rows,
      new_schema: schemaResult.rows[0],
      note: 'New users will now have 0 requests by default'
    });

  } catch (error) {
    console.error('Fix users default error:', error);
    res.status(500).json({ 
      error: 'Failed to fix users default',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};