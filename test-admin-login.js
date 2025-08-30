const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function testAdminLogin() {
  console.log('🔐 Testing admin login process...');
  
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Database connected');
    
    // Get admin user
    const adminResult = await client.query(`
      SELECT id, username, password_hash, credits, role, is_active 
      FROM users 
      WHERE username = 'admin'
    `);
    
    if (adminResult.rows.length === 0) {
      console.log('❌ Admin user not found');
      return;
    }
    
    const admin = adminResult.rows[0];
    console.log('🔍 Admin user found:', {
      id: admin.id,
      username: admin.username,
      credits: admin.credits,
      role: admin.role,
      is_active: admin.is_active,
      password_hash_length: admin.password_hash ? admin.password_hash.length : 0
    });
    
    // Test password verification
    console.log('\n🔐 Testing password verification...');
    const passwords = ['admin123', 'admin', 'password'];
    
    for (const testPassword of passwords) {
      const isValid = await bcrypt.compare(testPassword, admin.password_hash);
      console.log(`Password "${testPassword}": ${isValid ? '✅ VALID' : '❌ invalid'}`);
      
      if (isValid) {
        console.log(`🎉 Correct password found: "${testPassword}"`);
        break;
      }
    }
    
    // Test creating a new hash for "admin123"
    console.log('\n🔧 Creating new hash for "admin123"...');
    const newHash = await bcrypt.hash('admin123', 10);
    console.log('New hash created, length:', newHash.length);
    
    const testNewHash = await bcrypt.compare('admin123', newHash);
    console.log('New hash verification:', testNewHash ? '✅ WORKS' : '❌ FAILS');
    
    // Update admin password to be absolutely sure
    console.log('\n🔄 Updating admin password...');
    await client.query(`
      UPDATE users 
      SET password_hash = $1, updated_at = NOW()
      WHERE username = 'admin'
    `, [newHash]);
    
    console.log('✅ Admin password updated with new hash');
    
    // Final verification
    const finalResult = await client.query(`
      SELECT password_hash FROM users WHERE username = 'admin'
    `);
    
    const finalTest = await bcrypt.compare('admin123', finalResult.rows[0].password_hash);
    console.log('🔍 Final verification:', finalTest ? '✅ SUCCESS' : '❌ FAILED');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

testAdminLogin();
