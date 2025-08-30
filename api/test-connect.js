const { Pool } = require('pg');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  let client;
  
  try {
    console.log('🔍 Testing database connection...');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
    
    const connectionString = process.env.DATABASE_URL;
    console.log('Connection string preview:', connectionString?.substring(0, 30) + '...');
    
    const pool = new Pool({
      connectionString: connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    });
    
    console.log('Pool created, attempting connection...');
    client = await pool.connect();
    console.log('Client connected successfully');
    
    const result = await client.query('SELECT NOW() as current_time, COUNT(*) as user_count FROM users');
    console.log('Query executed successfully:', result.rows[0]);
    
    const stats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM keys) as total_keys,
        (SELECT COUNT(*) FROM keys WHERE is_used = false) as available_keys
    `);
    
    console.log('Stats query successful:', stats.rows[0]);
    
    res.status(200).json({
      status: '✅ Database connection successful',
      timestamp: result.rows[0].current_time,
      database_stats: stats.rows[0],
      connection_info: {
        ssl: 'enabled',
        pool: 'connected'
      }
    });
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      status: '❌ Database connection failed',
      error: error.message,
      error_code: error.code,
      details: {
        DATABASE_URL_exists: !!process.env.DATABASE_URL,
        error_type: error.constructor.name
      }
    });
  } finally {
    if (client) {
      client.release();
      console.log('Database client released');
    }
  }
};