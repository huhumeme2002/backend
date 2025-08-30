const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Detect high-frequency attack patterns like the Key Checker tool
class FrequencyDetector {
  
  static async detectSuspiciousFrequency(ip, endpoint, userAgent) {
    let client;
    try {
      client = await pool.connect();
      
      // Create frequency tracking table if not exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS frequency_tracking (
          id SERIAL PRIMARY KEY,
          ip_address VARCHAR(45),
          endpoint VARCHAR(255),
          request_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          user_agent TEXT,
          blocked BOOLEAN DEFAULT FALSE
        )
      `);
      
      // Create index for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_frequency_tracking_ip_endpoint_time 
        ON frequency_tracking(ip_address, endpoint, request_timestamp)
      `);
      
      // Log this request
      await client.query(`
        INSERT INTO frequency_tracking (ip_address, endpoint, user_agent)
        VALUES ($1, $2, $3)
      `, [ip, endpoint, userAgent]);
      
      const now = new Date();
      const last10Seconds = new Date(now.getTime() - 10 * 1000);
      const last60Seconds = new Date(now.getTime() - 60 * 1000);
      
      // Check request frequency in last 10 seconds
      const freq10s = await client.query(`
        SELECT COUNT(*) as count FROM frequency_tracking
        WHERE ip_address = $1 AND endpoint = $2 
        AND request_timestamp > $3
      `, [ip, endpoint, last10Seconds]);
      
      // Check request frequency in last 60 seconds  
      const freq60s = await client.query(`
        SELECT COUNT(*) as count FROM frequency_tracking
        WHERE ip_address = $1 AND endpoint = $2 
        AND request_timestamp > $3
      `, [ip, endpoint, last60Seconds]);
      
      const count10s = parseInt(freq10s.rows[0].count);
      const count60s = parseInt(freq60s.rows[0].count);
      
      // ULTRA-STRICT frequency limits to stop tools like Key Checker
      const isSuspicious = 
        count10s > 2 ||  // More than 2 requests in 10 seconds = TOOL
        count60s > 5 ||  // More than 5 requests in 60 seconds = AUTOMATED
        userAgent.includes('Key') || // Tool-like user agent
        userAgent.includes('Checker') ||
        userAgent.includes('Bot') ||
        userAgent === 'Unknown';
      
      if (isSuspicious) {
        // Mark as blocked in frequency tracking
        await client.query(`
          UPDATE frequency_tracking 
          SET blocked = TRUE 
          WHERE ip_address = $1 AND endpoint = $2 
          AND request_timestamp > $3
        `, [ip, endpoint, last60Seconds]);
        
        return {
          suspicious: true,
          reason: 'High-frequency automated tool detected',
          count_10s: count10s,
          count_60s: count60s,
          user_agent: userAgent,
          block_duration_minutes: 60 // 1 hour block for tools
        };
      }
      
      return {
        suspicious: false,
        count_10s: count10s,
        count_60s: count60s
      };
      
    } catch (error) {
      console.error('Frequency detection error:', error);
      return { suspicious: false, error: error.message };
    } finally {
      if (client) client.release();
    }
  }
  
  // Clean old frequency records (run periodically)
  static async cleanup() {
    let client;
    try {
      client = await pool.connect();
      
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      await client.query(`
        DELETE FROM frequency_tracking 
        WHERE request_timestamp < $1
      `, [oneDayAgo]);
      
    } catch (error) {
      console.error('Frequency cleanup error:', error);
    } finally {
      if (client) client.release();
    }
  }
}

module.exports = { FrequencyDetector };