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

function createNumericPublicId(length = 5) {
  const len = Math.max(1, Math.min(12, Number(length) || 5));
  const max = 10 ** len;
  const value = crypto.randomInt(0, max);
  return String(value).padStart(len, '0');
}

module.exports = { createPublicId, createNumericPublicId };
