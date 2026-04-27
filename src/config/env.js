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
};

module.exports = { env };
