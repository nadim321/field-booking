const crypto = require('crypto');

// Generate a UUID v4 token for slot holds
function generateToken() {
  // Node 14+ provides randomUUID
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback to random bytes hex
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { generateToken };
