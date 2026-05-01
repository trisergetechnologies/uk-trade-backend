/**
 * Drops the entire MongoDB database, then seeds exactly:
 * - one admin (bootstrapAdmin)
 * - one first user under that admin (ensureSeedMainUser)
 *
 * Requires PROD_PROTECT=false. Uses ADMIN_BOOTSTRAP_EMAIL, SEED_USER_EMAIL,
 * SEED_USER_NAME, SEED_SHARED_PASSWORD (see src/config/env.js).
 *
 *   PROD_PROTECT=false npm run seed:reset-users
 */
const mongoose = require('mongoose');
const { connectDb } = require('../src/db/connect');
const { env } = require('../src/config/env');
const { assertSeedingAllowed } = require('../src/utils/seed-guard');
const { bootstrapAdmin, ensureSeedMainUser, syncSeedUserPasswords } = require('../src/services/auth.service');
const { logger } = require('../src/utils/logger');

async function main() {
  assertSeedingAllowed();
  await connectDb();

  const dbName = mongoose.connection.db.databaseName;
  await mongoose.connection.dropDatabase();
  logger.warn({ database: dbName }, 'Dropped database — all collections removed');

  await bootstrapAdmin();
  await ensureSeedMainUser();
  const passwordRowsUpdated = await syncSeedUserPasswords();

  logger.info(
    {
      adminEmail: env.adminBootstrapEmail,
      firstUserEmail: env.seedUserEmail,
      firstUserName: env.seedUserName,
      passwordRowsUpdated,
    },
    'seed:reset-users completed — admin + first user only'
  );
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed:reset-users failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
