const { env } = require('../config/env');

/**
 * Blocks accidental production runs. Requires:
 * - PROD_PROTECT=false (same convention as seed scripts)
 * - MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP
 */
function assertTreeMigrationAllowed() {
  if (env.prodProtectBlocksSeeding) {
    throw new Error(
      'Tree migration blocked: set PROD_PROTECT=false in the environment (same as seed scripts).'
    );
  }
  const confirm = String(process.env.MIGRATE_TREE_CONFIRM || '').trim();
  if (confirm !== 'YES_I_HAVE_A_DATABASE_BACKUP') {
    throw new Error(
      'Tree migration blocked: set MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP after taking a full MongoDB backup.'
    );
  }
}

module.exports = { assertTreeMigrationAllowed };
