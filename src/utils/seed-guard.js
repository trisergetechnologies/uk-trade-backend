const { env } = require('../config/env');
const { logger } = require('./logger');

/**
 * Throws if seeding is not explicitly allowed via PROD_PROTECT=false.
 */
function assertSeedingAllowed() {
  if (env.prodProtectBlocksSeeding) {
    const msg =
      'Seeding blocked: set PROD_PROTECT=false in the environment to run seed scripts (destructive).';
    logger.warn(msg);
    throw new Error(msg);
  }
}

module.exports = { assertSeedingAllowed };
