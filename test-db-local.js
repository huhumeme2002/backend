const { Pool } = require('pg');

async function testDatabaseConnection() {
  console.log('🔌 Testing database connection via Vercel CLI...');
  
  // Vercel CLI sẽ inject environment variables
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('❌ DATABASE_URL not found in environment');
    console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('DB') || k.includes('DATABASE')));
    return;
  }
  
  console.log('📊 Database URL found:', connectionString.substring(0, 50) + '...');
  
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Database connected successfully!');
    
    // Test query: Get users
    console.log('\n👥 Testing users query...');
    const usersResult = await client.query(`
      SELECT id, username, email, requests, role, is_active, created_at
      FROM users 
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    console.log(`Found ${usersResult.rows.length} users:`);
    usersResult.rows.forEach(user => {
      console.log(`- ${user.username} (${user.role}): ${user.requests} requests, active: ${user.is_active}`);
    });
    
    // Test query: Get available keys
    console.log('\n🔑 Testing keys query...');
    const keysResult = await client.query(`
      SELECT id, key_value, requests, is_used, expires_at
      FROM keys 
      WHERE is_used = false
      LIMIT 5
    `);
    
    console.log(`Found ${keysResult.rows.length} available keys:`);
    keysResult.rows.forEach(key => {
      console.log(`- ${key.key_value}: ${key.requests} requests`);
    });
    
    // Test admin creation
    console.log('\n👑 Testing admin user...');
    const bcrypt = require('bcryptjs');
    
    // Check if admin exists
    const adminCheck = await client.query(
      'SELECT id, username, requests, role FROM users WHERE username = $1',
      ['admin']
    );
    
    if (adminCheck.rows.length > 0) {
      console.log('✅ Admin user already exists:', adminCheck.rows[0]);
      
      // Test admin login
      console.log('\n🔐 Testing admin password...');
      const adminUser = adminCheck.rows[0];
      const passwordCheckResult = await client.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [adminUser.id]
      );
      
      const isPasswordValid = await bcrypt.compare('admin123', passwordCheckResult.rows[0].password_hash);
      console.log('Password "admin123" valid:', isPasswordValid);
      
    } else {
      console.log('🔨 Creating admin user...');
      const passwordHash = await bcrypt.hash('admin123', 10);
      
      const adminResult = await client.query(
        `INSERT INTO users (username, email, password_hash, requests, role, is_active, created_at) 
         VALUES ($1, $2, $3, 1000, 'admin', true, NOW()) 
         RETURNING id, username, email, requests, role`,
        ['admin', 'admin@cursor.local', passwordHash]
      );
      
      console.log('✅ Admin user created:', adminResult.rows[0]);
    }
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

testDatabaseConnection();
