// Simple serverless function for health check
export default function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'API is working!',
    endpoints: {
      health: '/api/health',
      register: '/api/register',
      login: '/api/login'
    }
  });
}