const { Pool } = require('pg');

async function checkDatabaseSchema() {
  console.log('🔍 Checking database schema...');
  
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
    
    // Check tables
    console.log('\n📋 Available tables:');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    tablesResult.rows.forEach(row => {
      console.log(`- ${row.table_name}`);
    });
    
    // Check users table structure
    console.log('\n👤 Users table structure:');
    const usersStructure = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position
    `);
    
    usersStructure.rows.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Get some users data using correct column names
    console.log('\n👥 Sample users data:');
    
    // First try with credits
    try {
      const usersWithCredits = await client.query(`
        SELECT id, username, email, credits, role, is_active 
        FROM users 
        LIMIT 3
      `);
      console.log('Using CREDITS column:');
      usersWithCredits.rows.forEach(user => {
        console.log(`- ${user.username} (${user.role}): ${user.credits} credits`);
      });
    } catch (creditsError) {
      console.log('❌ Credits column not found, trying requests...');
      
      try {
        const usersWithRequests = await client.query(`
          SELECT id, username, email, requests, role, is_active 
          FROM users 
          LIMIT 3
        `);
        console.log('Using REQUESTS column:');
        usersWithRequests.rows.forEach(user => {
          console.log(`- ${user.username} (${user.role}): ${user.requests} requests`);
        });
      } catch (requestsError) {
        console.log('❌ Neither credits nor requests column found!');
        
        // Try basic query
        const basicUsers = await client.query(`
          SELECT id, username, email, role, is_active 
          FROM users 
          LIMIT 3
        `);
        console.log('Basic user data:');
        basicUsers.rows.forEach(user => {
          console.log(`- ${user.username} (${user.role})`);
        });
      }
    }
    
    // Check if admin exists
    console.log('\n🔍 Looking for admin user...');
    const adminResult = await client.query(`
      SELECT id, username, email, role, is_active 
      FROM users 
      WHERE username = 'admin' OR role = 'admin'
    `);
    
    if (adminResult.rows.length > 0) {
      console.log('✅ Found admin users:');
      adminResult.rows.forEach(admin => {
        console.log(`- ID: ${admin.id}, Username: ${admin.username}, Role: ${admin.role}, Active: ${admin.is_active}`);
      });
    } else {
      console.log('❌ No admin users found');
    }
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

checkDatabaseSchema();
