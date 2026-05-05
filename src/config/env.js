const dotenv = require('dotenv');

dotenv.config();

const env = {
  port: Number(process.env.PORT || 5001),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/uk_trade',
  /**
   * Destructive seed scripts run only when PROD_PROTECT=false (case-insensitive).
   * Any other value or unset blocks seeds to avoid accidental runs in production.
   */
  prodProtectBlocksSeeding: String(process.env.PROD_PROTECT || '').toLowerCase() !== 'false',
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
  matchingIncomeEnabled: String(process.env.MATCHING_INCOME_ENABLED || 'true').toLowerCase() === 'true',
  matchingIncomePercent: Number(process.env.MATCHING_INCOME_PERCENT || 4),
  /** 64 hex chars (32 bytes) for AES-256-GCM passwordCipher storage */
  passwordCipherKey: process.env.PASSWORD_CIPHER_KEY || '',
};

module.exports = { env };
