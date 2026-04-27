const crypto = require('crypto');

function createPublicId(prefix) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(10);
  let token = '';
  for (let i = 0; i < bytes.length; i += 1) {
    token += chars[bytes[i] % chars.length];
  }
  return `${String(prefix || '').toUpperCase()}${token}`;
}

module.exports = { createPublicId };
