/**
 * Loaded only for `npm run test:api` — isolated DB + deterministic JWT.
 * Override with MONGO_URI_TEST if needed.
 */
process.env.MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/uk_trade_jest';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jest-integration-jwt-secret';
process.env.SEED_SHARED_PASSWORD = process.env.SEED_SHARED_PASSWORD || 'JestSeed@123';
process.env.ADMIN_BOOTSTRAP_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL || 'jest-admin@local.test';
process.env.SEED_USER_EMAIL = process.env.SEED_USER_EMAIL || 'jest-user@local.test';
process.env.SEED_USER_NAME = process.env.SEED_USER_NAME || 'Jest Main User';
/** 32-byte hex key for passwordCipher in integration tests */
process.env.PASSWORD_CIPHER_KEY =
  process.env.PASSWORD_CIPHER_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
