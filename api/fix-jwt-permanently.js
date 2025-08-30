const jwt = require('jsonwebtoken');

// UNIFIED JWT SECRET - USE THIS EVERYWHERE
const JWT_SECRET = 'unified-aivannang-secret-2024';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  
  const results = {
    timestamp: new Date().toISOString(),
    unifiedSecret: JWT_SECRET
  };

  // Test with different secrets
  const secrets = [
    'unified-aivannang-secret-2024',
    'aivannang-secret-key', 
    'default-secret-key',
    'your-secret-key'
  ];

  results.tokenTests = [];

  if (token) {
    for (const secret of secrets) {
      try {
        const decoded = jwt.verify(token, secret);
        results.tokenTests.push({
          secret: secret,
          success: true,
          decoded: {
            userId: decoded.userId,
            username: decoded.username,
            role: decoded.role
          }
        });
        results.validSecret = secret;
        results.tokenInfo = decoded;
        break; // Found the right secret
      } catch (error) {
        results.tokenTests.push({
          secret: secret,
          success: false,
          error: error.message
        });
      }
    }
  } else {
    results.error = 'No token provided';
  }

  // Generate new token with unified secret
  if (results.tokenInfo) {
    results.newToken = jwt.sign(
      { 
        userId: results.tokenInfo.userId, 
        username: results.tokenInfo.username,
        role: results.tokenInfo.role 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    results.message = 'New token generated with unified secret. Use this token for all requests.';
  }

  res.status(200).json(results);
};