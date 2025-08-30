module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    // Test if we can load the pg module
    console.log('Loading pg module...');
    const { Pool } = require('pg');
    console.log('pg module loaded successfully');
    
    // Test basic connection string parsing
    const connectionString = process.env.DATABASE_URL;
    console.log('Connection string length:', connectionString ? connectionString.length : 'undefined');
    
    // Create pool without connecting
    const pool = new Pool({
      connectionString: connectionString,
      ssl: { rejectUnauthorized: false },
    });
    console.log('Pool created successfully');
    
    res.status(200).json({
      status: 'Modules loaded successfully',
      pgModule: 'OK',
      connectionStringLength: connectionString ? connectionString.length : 0,
      poolCreated: 'OK'
    });
  } catch (error) {
    console.error('Module test error:', error);
    
    res.status(500).json({
      error: 'Module test failed',
      details: error.message,
      stack: error.stack
    });
  }
};