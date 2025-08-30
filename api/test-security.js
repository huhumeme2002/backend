const { AdvancedRateLimiter, getClientIP } = require('./advanced-security-middleware');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const clientIP = getClientIP(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';

  try {
    console.log(`Testing security from IP: ${clientIP}`);
    
    // Test IP-based rate limiting
    const ipLimitCheck = await AdvancedRateLimiter.checkIPRateLimit(clientIP, 'test-security');
    
    if (!ipLimitCheck.allowed) {
      await AdvancedRateLimiter.logSuspiciousActivity(
        clientIP, 
        'test-security', 
        userAgent,
        {
          reason: ipLimitCheck.reason,
          requests_this_hour: ipLimitCheck.requests_this_hour,
          test: 'security-test'
        }
      );

      return res.status(429).json({
        error: 'Quá nhiều requests từ IP này',
        message: `IP bị khóa. Thử lại sau ${ipLimitCheck.remaining_minutes} phút`,
        reason: 'IP_RATE_LIMIT_EXCEEDED',
        blocked_until: ipLimitCheck.blocked_until,
        remaining_minutes: ipLimitCheck.remaining_minutes,
        ip: clientIP,
        requests_this_hour: ipLimitCheck.requests_this_hour
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Request allowed',
      ip: clientIP,
      requests_this_hour: ipLimitCheck.requests_this_hour,
      remaining: ipLimitCheck.remaining,
      userAgent: userAgent
    });

  } catch (error) {
    console.error('Security test error:', error);
    return res.status(500).json({
      error: 'Security middleware error',
      details: error.message,
      stack: error.stack
    });
  }
};