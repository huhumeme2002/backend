const fs = require('fs');
const path = require('path');

// Use /tmp directory for persistent file storage in Vercel
const STORAGE_FILE = '/tmp/users.json';

// In-memory cache for performance
let memoryCache = null;
let lastModified = 0;

function loadUsers() {
  try {
    // Check if file exists and is newer than our cache
    const stats = fs.existsSync(STORAGE_FILE) ? fs.statSync(STORAGE_FILE) : null;
    const fileModified = stats ? stats.mtime.getTime() : 0;
    
    // If we have a fresh cache, use it
    if (memoryCache && fileModified <= lastModified) {
      return memoryCache;
    }
    
    // Load from file
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, 'utf8');
      const users = JSON.parse(data);
      
      // Convert array back to Map
      memoryCache = new Map();
      for (const [key, user] of users) {
        memoryCache.set(key, user);
      }
      
      lastModified = fileModified;
      console.log(`Loaded ${memoryCache.size} users from storage file`);
      return memoryCache;
    }
    
    // No file exists, create empty Map
    memoryCache = new Map();
    lastModified = Date.now();
    return memoryCache;
    
  } catch (error) {
    console.error('Error loading users:', error);
    // Fallback to empty Map
    memoryCache = new Map();
    return memoryCache;
  }
}

function saveUsers(users) {
  try {
    // Convert Map to array for JSON serialization
    const usersArray = Array.from(users.entries());
    
    // Save to file
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(usersArray, null, 2));
    
    // Update cache
    memoryCache = users;
    lastModified = Date.now();
    
    console.log(`Saved ${users.size} users to storage file`);
    return true;
  } catch (error) {
    console.error('Error saving users:', error);
    return false;
  }
}

function addUser(userId, user) {
  const users = loadUsers();
  users.set(userId, user);
  saveUsers(users);
  return user;
}

function getUser(userId) {
  const users = loadUsers();
  return users.get(userId);
}

function findUserByUsername(username) {
  const users = loadUsers();
  for (const [key, user] of users) {
    if (user.username === username && user.is_active) {
      return user;
    }
  }
  return null;
}

function findUserByEmail(email) {
  const users = loadUsers();
  for (const [key, user] of users) {
    if (user.email === email) {
      return user;
    }
  }
  return null;
}

function getAllUsers() {
  return loadUsers();
}

function getUserCount() {
  const users = loadUsers();
  return users.size;
}

// Initialize storage on module load
loadUsers();

module.exports = {
  addUser,
  getUser,
  findUserByUsername,
  findUserByEmail,
  getAllUsers,
  getUserCount,
  saveUsers,
  loadUsers
};