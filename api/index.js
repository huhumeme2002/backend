export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  res.status(200).json({
    status: 'OK',
    message: 'API is running',
    endpoints: [
      '/api/login',
      '/api/login-db',
      '/api/register',
      '/api/register-db',
      '/api/redeem-key',
      '/api/admin-keys',
      '/api/admin-upload-tokens',
      '/api/health',
      '/api/test-connect'
    ],
    timestamp: new Date().toISOString()
  });
}