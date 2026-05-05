const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKeyBuffer() {
  const hex = String(process.env.PASSWORD_CIPHER_KEY || '').trim();
  if (hex.length !== 64) {
    throw new Error('PASSWORD_CIPHER_KEY must be exactly 64 hex characters (32 bytes)');
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('PASSWORD_CIPHER_KEY decodes to invalid length');
  }
  return buf;
}

/**
 * Encrypt plaintext password for admin recovery view (AES-256-GCM).
 * @param {string} plaintext
 * @returns {string|null} base64(iv || tag || ciphertext)
 */
function encryptPassword(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * @param {string|null|undefined} ciphertextB64
 * @returns {string|null}
 */
function decryptPassword(ciphertextB64) {
  if (!ciphertextB64 || typeof ciphertextB64 !== 'string') return null;
  const key = getKeyBuffer();
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return null;
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encryptPassword, decryptPassword };
