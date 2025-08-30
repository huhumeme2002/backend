const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function fixAdminPassword() {
  console.log('🔧 Fixing admin password...');
  
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DATABASE_URL not found');
    return;
  }
  
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Database connected');
    
    // Get current admin user
    const adminResult = await client.query(`
      SELECT id, username, password_hash, credits 
      FROM users 
      WHERE username = 'admin'
    `);
    
    if (adminResult.rows.length === 0) {
      console.log('❌ Admin user not found');
      return;
    }
    
    const admin = adminResult.rows[0];
    console.log('Current admin:', { id: admin.id, username: admin.username, credits: admin.credits });
    
    // Test current password
    console.log('\n🔐 Testing current password...');
    const isCurrentPasswordValid = await bcrypt.compare('admin123', admin.password_hash);
    console.log('Current password "admin123" valid:', isCurrentPasswordValid);
    
    if (!isCurrentPasswordValid) {
      console.log('🔧 Updating admin password to "admin123"...');
      
      // Generate new password hash
      const newPasswordHash = await bcrypt.hash('admin123', 10);
      
      // Update password
      await client.query(`
        UPDATE users 
        SET password_hash = $1, updated_at = NOW()
        WHERE id = $2
      `, [newPasswordHash, admin.id]);
      
      console.log('✅ Admin password updated successfully');
      
      // Test new password
      const testResult = await client.query(`
        SELECT password_hash FROM users WHERE id = $1
      `, [admin.id]);
      
      const isNewPasswordValid = await bcrypt.compare('admin123', testResult.rows[0].password_hash);
      console.log('✅ New password verification:', isNewPasswordValid);
    }
    
    // Fix credits to requests if needed
    console.log('\n💰 Checking admin credits...');
    if (admin.credits === 0) {
      console.log('🔧 Adding 1000 credits to admin...');
      await client.query(`
        UPDATE users 
        SET credits = 1000, updated_at = NOW()
        WHERE id = $1
      `, [admin.id]);
      console.log('✅ Admin credits updated to 1000');
    }
    
    // Final verification
    console.log('\n✅ Final admin status:');
    const finalResult = await client.query(`
      SELECT id, username, credits, role, is_active 
      FROM users 
      WHERE username = 'admin'
    `);
    console.log(finalResult.rows[0]);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

fixAdminPassword();
