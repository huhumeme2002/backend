const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper function to get client IP
const getClientIP = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         'unknown';
};

// Advanced rate limiting với multiple layers
class AdvancedRateLimiter {
  
  // Kiểm tra IP-based rate limiting (chống API attacks)
  static async checkIPRateLimit(ip, endpoint) {
    let client;
    try {
      client = await pool.connect();
      
      const now = new Date();
      const oneHour = new Date(now.getTime() - 60 * 60 * 1000);
      const tenMinutes = new Date(now.getTime() - 10 * 60 * 1000);
      const oneMinute = new Date(now.getTime() - 1 * 60 * 1000);
      
      // Tạo bảng IP rate limiting nếu chưa có
      await client.query(`
        CREATE TABLE IF NOT EXISTS ip_rate_limits (
          id SERIAL PRIMARY KEY,
          ip_address VARCHAR(45) NOT NULL,
          endpoint VARCHAR(255) NOT NULL,
          request_count INTEGER DEFAULT 1,
          first_request TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_request TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          blocked_until TIMESTAMP,
          is_suspicious BOOLEAN DEFAULT FALSE
        )
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_ip_endpoint ON ip_rate_limits(ip_address, endpoint)
      `);
      
      // Lấy thống kê requests từ IP này
      const ipStats = await client.query(`
        SELECT * FROM ip_rate_limits 
        WHERE ip_address = $1 AND endpoint = $2 
        ORDER BY last_request DESC 
        LIMIT 1
      `, [ip, endpoint]);
      
      const limits = {
        'redeem-key-protected': { hourly: 10, per10min: 3, per1min: 1 }, // ULTRA STRICT - 1 request per minute max
        'get-token': { hourly: 20, per10min: 5, per1min: 2 },
        'login-db': { hourly: 15, per10min: 3, per1min: 1 },
        'test-security': { hourly: 30, per10min: 10, per1min: 5 },
        'default': { hourly: 50, per10min: 15, per1min: 3 }
      };
      
      const limit = limits[endpoint] || limits.default;
      
      if (ipStats.rows.length === 0) {
        // IP mới - tạo record
        await client.query(`
          INSERT INTO ip_rate_limits (ip_address, endpoint) 
          VALUES ($1, $2)
        `, [ip, endpoint]);
        
        return { allowed: true, remaining: limit.hourly - 1 };
      }
      
      const stats = ipStats.rows[0];
      
      // Kiểm tra nếu IP đang bị block
      if (stats.blocked_until && new Date(stats.blocked_until) > now) {
        const remainingMinutes = Math.ceil((new Date(stats.blocked_until) - now) / (1000 * 60));
        return {
          allowed: false,
          blocked: true,
          reason: 'IP temporarily blocked due to suspicious activity',
          remaining_minutes: remainingMinutes,
          blocked_until: stats.blocked_until
        };
      }
      
      // Reset counter nếu đã qua 1 giờ
      if (new Date(stats.first_request) < oneHour) {
        await client.query(`
          UPDATE ip_rate_limits 
          SET request_count = 1, first_request = $1, last_request = $1, is_suspicious = FALSE
          WHERE id = $2
        `, [now, stats.id]);
        
        return { allowed: true, remaining: limit.hourly - 1 };
      }
      
      // Kiểm tra limits
      const newCount = stats.request_count + 1;
      
      // Check 1-minute, 10-minute windows for ultra-strict limiting
      const recentRequestsMin = await client.query(`
        SELECT COUNT(*) as count FROM ip_rate_limits 
        WHERE ip_address = $1 AND endpoint = $2 AND last_request > $3
      `, [ip, endpoint, oneMinute]);
      
      const recentRequests10Min = await client.query(`
        SELECT COUNT(*) as count FROM ip_rate_limits 
        WHERE ip_address = $1 AND endpoint = $2 AND last_request > $3
      `, [ip, endpoint, tenMinutes]);
      
      const recentCountMin = parseInt(recentRequestsMin.rows[0].count);
      const recentCount10Min = parseInt(recentRequests10Min.rows[0].count);
      
      // ULTRA-STRICT: Suspicious activity detection with 1-minute limits
      let isSuspicious = stats.is_suspicious;
      let blockedUntil = null;
      let blockReason = '';
      
      // Check 1-minute limit first (most strict)
      if (recentCountMin >= limit.per1min) {
        isSuspicious = true;
        blockReason = 'Too many requests per minute';
        // Immediate 30-minute block for rapid requests
        blockedUntil = new Date(now.getTime() + 30 * 60 * 1000);
      }
      // Check 10-minute limit
      else if (recentCount10Min >= limit.per10min) {
        isSuspicious = true;
        blockReason = 'Too many requests per 10 minutes';
        // 15-minute block
        blockedUntil = new Date(now.getTime() + 15 * 60 * 1000);
      }
      // Check hourly limit
      else if (newCount >= limit.hourly) {
        isSuspicious = true;
        blockReason = 'Hourly limit exceeded';
        // Block for escalating time: 15min → 1h → 6h
        const blockMinutes = stats.is_suspicious ? (newCount > limit.hourly * 2 ? 360 : 60) : 15;
        blockedUntil = new Date(now.getTime() + blockMinutes * 60 * 1000);
      }
      
      // Update stats
      await client.query(`
        UPDATE ip_rate_limits 
        SET request_count = $1, last_request = $2, blocked_until = $3, is_suspicious = $4
        WHERE id = $5
      `, [newCount, now, blockedUntil, isSuspicious, stats.id]);
      
      if (blockedUntil) {
        const remainingMinutes = Math.ceil((blockedUntil - now) / (1000 * 60));
        return {
          allowed: false,
          blocked: true,
          reason: `${blockReason} from IP ${ip}`,
          remaining_minutes: remainingMinutes,
          blocked_until: blockedUntil,
          requests_this_hour: newCount,
          requests_last_10min: recentCount10Min,
          requests_last_1min: recentCountMin
        };
      }
      
      return { 
        allowed: true, 
        remaining: limit.hourly - newCount,
        requests_this_hour: newCount,
        requests_last_10min: recentCount10Min,
        requests_last_1min: recentCountMin
      };
      
    } catch (error) {
      console.error('IP Rate limit check error:', error);
      return { allowed: true, error: error.message }; // Fail open
    } finally {
      if (client) client.release();
    }
  }
  
  // Log suspicious activities
  static async logSuspiciousActivity(ip, endpoint, userAgent, details) {
    let client;
    try {
      client = await pool.connect();
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS security_incidents (
          id SERIAL PRIMARY KEY,
          ip_address VARCHAR(45),
          endpoint VARCHAR(255),
          user_agent TEXT,
          incident_type VARCHAR(100),
          details JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await client.query(`
        INSERT INTO security_incidents (ip_address, endpoint, user_agent, incident_type, details)
        VALUES ($1, $2, $3, $4, $5)
      `, [ip, endpoint, userAgent, 'RATE_LIMIT_EXCEEDED', details]);
      
    } catch (error) {
      console.error('Log suspicious activity error:', error);
    } finally {
      if (client) client.release();
    }
  }
}

module.exports = { AdvancedRateLimiter, getClientIP };