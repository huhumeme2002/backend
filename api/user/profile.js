// Thin route wrapper to expose /api/user/profile without relying on rewrites
// Reuses the existing handler defined in ../user-profile.js

const handler = require('../user-profile');

module.exports = handler;


