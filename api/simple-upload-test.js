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
    
    // Test simple token insertion without file upload
    const testTokens = ['test-token-1', 'test-token-2', 'test-token-3'];
    const results = [];
    const errors = [];

    for (const tokenValue of testTokens) {
      try {
        const result = await client.query(`
          INSERT INTO uploaded_tokens (token_value, requests, expires_at, description, created_at)
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING id, token_value, requests
        `, [tokenValue, 50, null, 'Test token - 50 requests']);
        
        results.push(result.rows[0]);
      } catch (insertError) {
        if (insertError.code === '23505') { // Unique violation
          errors.push(`Token "${tokenValue}" đã tồn tại`);
        } else {
          errors.push(`Lỗi khi chèn token "${tokenValue}": ${insertError.message}`);
        }
      }
    }

    res.status(200).json({
      message: 'Upload test completed',
      inserted: results.length,
      errors: errors.length,
      results: results,
      errorDetails: errors,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Upload test error:', error);
    res.status(500).json({ 
      error: 'Upload test failed',
      details: error.message
    });
  } finally {
    if (client) client.release();
  }
};