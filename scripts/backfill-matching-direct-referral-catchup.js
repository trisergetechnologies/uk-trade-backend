/**
 * Additive catch-up for the first-10 direct-referral any-depth matching rule.
 *
 * Credits sponsors who missed matching because a personally referred buyer (one of
 * their first 10 directs, signup order) purchased while placed deeper than 5 levels.
 * Existing matching events / wallet credits are never reversed or paid twice
 * (idempotency key matching:<subscriptionId>:<earnerId>).
 *
 * SAFETY (both required for writes):
 *   PROD_PROTECT=false
 *   BACKFILL_DIRECT_REFERRAL_CATCHUP_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP
 *
 * Optional:
 *   ALLOW_PRODUCTION_DB=true  — required when the MONGO_URI database name is uk_trade
 *
 * Flags:
 *   --dry-run                 — report only, no wallet/event writes
 *   --user-code USRXXXX       — only credit that sponsor (pilot one user, then all)
 *
 * Run from uk-trade-backend (API stopped):
 *   node scripts/backfill-matching-direct-referral-catchup.js --dry-run --user-code THEIRCODE
 *
 *   PROD_PROTECT=false BACKFILL_DIRECT_REFERRAL_CATCHUP_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     ALLOW_PRODUCTION_DB=true node scripts/backfill-matching-direct-referral-catchup.js --user-code THEIRCODE
 *
 *   # after verifying one user, omit --user-code for everyone:
 *   PROD_PROTECT=false BACKFILL_DIRECT_REFERRAL_CATCHUP_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     ALLOW_PRODUCTION_DB=true node scripts/backfill-matching-direct-referral-catchup.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { catchUpDirectReferralAnyDepthMatching } = require('../src/services/matching.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const userCodeArgIndex = args.indexOf('--user-code');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim().toUpperCase() : '';

function assertBackfillAllowed() {
  if (DRY_RUN) return;
  if (env.prodProtectBlocksSeeding) {
    throw new Error('Catch-up blocked: set PROD_PROTECT=false in the environment.');
  }
  const confirm = String(process.env.BACKFILL_DIRECT_REFERRAL_CATCHUP_CONFIRM || '').trim();
  if (confirm !== 'YES_I_HAVE_A_DATABASE_BACKUP') {
    throw new Error(
      'Catch-up blocked: set BACKFILL_DIRECT_REFERRAL_CATCHUP_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP after taking a full MongoDB backup.'
    );
  }
}

function parseMongoDbName(uri) {
  const withoutQuery = String(uri || '').split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  if (slash < 0 || slash === withoutQuery.length - 1) return '';
  return withoutQuery.slice(slash + 1);
}

function assertDbTargetAllowed() {
  const dbName = parseMongoDbName(env.mongoUri);
  logger.info({ dbName, mongoUri: env.mongoUri }, 'direct-referral catch-up target database');
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error('Refusing to run on database "uk_trade" without ALLOW_PRODUCTION_DB=true.');
  }
  return dbName;
}

async function run() {
  assertBackfillAllowed();
  const dbName = assertDbTargetAllowed();
  if (userCodeArgIndex >= 0 && !SINGLE_USER_CODE) {
    throw new Error('--user-code requires a value, e.g. --user-code USRABC12');
  }

  const summary = await catchUpDirectReferralAnyDepthMatching({
    dryRun: DRY_RUN,
    userCode: SINGLE_USER_CODE || null,
  });
  summary.dbName = dbName;

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const scope = SINGLE_USER_CODE ? `-${SINGLE_USER_CODE}` : '-all';
  const outFile = path.join(outDir, `direct-referral-catchup${scope}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  logger.info(
    {
      dryRun: DRY_RUN,
      userCode: SINGLE_USER_CODE || null,
      subscriptionsScanned: summary.subscriptionsScanned,
      considered: summary.considered,
      credited: summary.credited,
      skipped: summary.skipped,
      duplicates: summary.duplicates,
      payoutTotal: summary.payoutTotal,
      reportFile: outFile,
    },
    'backfill-matching-direct-referral-catchup completed'
  );

  console.log('\n=== DIRECT-REFERRAL MATCHING CATCH-UP ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no DB writes)' : 'LIVE (wallet + events written)'}`);
  console.log(`Database: ${dbName}`);
  console.log(`Scope: ${SINGLE_USER_CODE ? `single user ${SINGLE_USER_CODE}` : 'ALL users'}`);
  console.log(`Purchases scanned: ${summary.subscriptionsScanned}`);
  console.log(`Deep first-10 directs considered: ${summary.considered}`);
  console.log(`Already had an event (skipped): ${summary.duplicates}`);
  console.log(`New credits: ${summary.credited}`);
  console.log(`Zero/skipped payouts: ${summary.skipped}`);
  console.log(`Total amount: ${summary.payoutTotal}`);
  console.log(`Earners paid: ${(summary.earners || []).length}`);
  console.log(`Report file: ${outFile}`);
  if (DRY_RUN) {
    console.log('\nNOTE: --dry-run does NOT change matching income.');
    console.log('Re-run WITHOUT --dry-run (with confirm env vars) to apply credits.\n');
  } else if (SINGLE_USER_CODE) {
    console.log('\nDone for one user. Verify Matching Income + wallet, then re-run without --user-code.\n');
  } else {
    console.log('\nDone. Users should see new Matching Income rows; existing rows were not doubled.\n');
  }
}

if (require.main === module) {
  connectDb()
    .then(run)
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'backfill-matching-direct-referral-catchup failed');
      process.exit(1);
    });
}

module.exports = { catchUpDirectReferralAnyDepthMatching };
