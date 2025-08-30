const { Pool } = require('pg');

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    console.log('Environment variables check:');
    console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
    console.log('NEON_DATABASE_URL:', process.env.NEON_DATABASE_URL ? 'SET' : 'NOT SET');
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    
    const client = await pool.connect();
    console.log('Database client connected successfully');
    
    const result = await client.query('SELECT NOW() as current_time, COUNT(*) as user_count FROM users');
    console.log('Query result:', result.rows[0]);
    
    client.release();
    await pool.end();
    
    res.status(200).json({
      status: 'Database connection successful',
      timestamp: result.rows[0].current_time,
      userCount: result.rows[0].user_count,
      envVars: {
        DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
        NEON_DATABASE_URL: process.env.NEON_DATABASE_URL ? 'SET' : 'NOT SET'
      }
    });
  } catch (error) {
    console.error('Database test error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      error: 'Database test failed',
      details: error.message,
      envCheck: {
        DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
        NEON_DATABASE_URL: process.env.NEON_DATABASE_URL ? 'SET' : 'NOT SET'
      }
    });
  }
};