const dotenv = require('dotenv');

dotenv.config();

const env = {
  port: Number(process.env.PORT || 5001),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/uk_trade',
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  appTz: process.env.APP_TZ || 'Asia/Kolkata',
  adminBootstrapEmail: process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@uktrade.local',
  /** Legacy name; same source as seed shared password when only one is set in .env. */
  adminBootstrapPassword:
    process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.SEED_SHARED_PASSWORD || 'UkTrade@Dev123',
  /** Plaintext used by `npm run seed` for both admin + main user (before bcrypt). */
  seedUserEmail: process.env.SEED_USER_EMAIL || 'user@uktrade.local',
  seedUserName: process.env.SEED_USER_NAME || 'Main User',
  seedSharedPassword:
    process.env.SEED_SHARED_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD || 'UkTrade@Dev123',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',
  cloudinaryFolder: process.env.CLOUDINARY_FOLDER || 'uk-trade',
  /**
   * Browser origins allowed to call this API (comma-separated).
   * Set CORS_ORIGINS on the server, e.g. https://uktrade.co.in,https://www.uktrade.co.in
   */
  corsOrigins: (() => {
    const raw = process.env.CORS_ORIGINS;
    if (raw === undefined || String(raw).trim() === '') {
      return [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://uktrade.co.in',
        'https://www.uktrade.co.in',
      ];
    }
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  })(),
  /** Dev only: reflect any Origin (do not use in production unless you understand the risk). */
  corsAllowAll: process.env.CORS_ALLOW_ALL === 'true' || process.env.CORS_ALLOW_ALL === '1',
};

module.exports = { env };
