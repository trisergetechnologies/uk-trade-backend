/**
 * Standalone: upsert 4 plans (A–D) and 10 fixed-amount package products.
 * Use when you only want to refresh the catalog: `npm run seed:packages`
 * (Full app seed: `npm run seed` which also calls this via seedDefaultPlans.)
 */
const mongoose = require('mongoose');
const { connectDb } = require('../src/db/connect');
const { seedPackageCatalog } = require('../src/services/package-product.service');
const { logger } = require('../src/utils/logger');

async function main() {
  await connectDb();
  await seedPackageCatalog();
  logger.info('seed-packages-and-plans: done');
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed-packages-and-plans failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
