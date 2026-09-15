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
 *   --diagnose                — with --user-code: explain first-10 directs / depth / why 0
 *
 * Diagnose (no writes):
 *   node scripts/backfill-matching-direct-referral-catchup.js --diagnose --user-code THEIRCODE
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
const {
  catchUpDirectReferralAnyDepthMatching,
  diagnoseDirectReferralCatchupForUser,
} = require('../src/services/matching.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DIAGNOSE = args.includes('--diagnose');
const userCodeArgIndex = args.indexOf('--user-code');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim().toUpperCase() : '';

function assertBackfillAllowed() {
  if (DRY_RUN || DIAGNOSE) return;
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

async function runDiagnose(dbName) {
  if (!SINGLE_USER_CODE) {
    throw new Error('--diagnose requires --user-code USRXXXX');
  }
  const report = await diagnoseDirectReferralCatchupForUser({ userCode: SINGLE_USER_CODE });
  report.dbName = dbName;

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `direct-referral-diagnose-${SINGLE_USER_CODE}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log('\n=== DIRECT-REFERRAL CATCH-UP DIAGNOSE ===');
  console.log(`Database: ${dbName}`);
  console.log(`Sponsor: ${report.earner.userCode} (${report.earner.name})`);
  console.log(`Tree level: ${report.earner.treeLevel}`);
  console.log(`Existing credited matching events: ${report.earner.existingCreditedMatchingEvents}`);
  console.log(`Direct referrals: ${report.totals.directReferrals} (first 10: ${report.totals.first10})`);
  console.log(`Catch-up candidates (depth>5, no event yet): ${report.totals.catchUpCandidates}`);
  console.log(`Purchases within 5 levels (not catch-up): ${report.totals.withinFivePurchases}`);
  console.log(`Deep purchases already have event: ${report.totals.alreadyEventPurchases}`);
  console.log(`Directs with no package: ${report.totals.directsWithNoPurchase}`);
  console.log(`Report file: ${outFile}`);

  const first10 = report.directs.filter((d) => d.inFirst10);
  console.log('\nFirst 10 directs:');
  for (const d of first10) {
    const levelLabel = d.relativeLevel == null ? 'NOT IN TREE' : `L${d.relativeLevel}`;
    console.log(
      `  #${d.rank} ${d.userCode} ${d.name} — ${levelLabel}, purchases=${d.purchaseCount}`
    );
    for (const p of d.purchases) {
      console.log(
        `      sub ${p.subscriptionId.slice(-6)} amt=${p.principalAmount} → ${p.skipReason}` +
          (p.existingEvent ? ` [${p.existingEvent.status} ₹${p.existingEvent.payoutCreditedAmount}]` : '')
      );
    }
  }

  if (report.totals.catchUpCandidates === 0) {
    console.log('\nWhy dry-run was 0: no first-10 direct is both deeper than 5 levels AND missing a matching event.');
    console.log('Catch-up only fills that gap; it does not re-pay within-5-level purchases.\n');
  } else {
    console.log('\nRe-run without --diagnose (with --dry-run) to see projected payouts.\n');
  }
}

async function run() {
  assertBackfillAllowed();
  const dbName = assertDbTargetAllowed();
  if (userCodeArgIndex >= 0 && !SINGLE_USER_CODE) {
    throw new Error('--user-code requires a value, e.g. --user-code USRABC12');
  }

  if (DIAGNOSE) {
    await runDiagnose(dbName);
    return;
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
  if (summary.credited === 0 && SINGLE_USER_CODE) {
    console.log('\nTIP: run with --diagnose --user-code ' + SINGLE_USER_CODE + ' to see why nothing matched.\n');
  } else if (DRY_RUN) {
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

module.exports = {
  catchUpDirectReferralAnyDepthMatching,
  diagnoseDirectReferralCatchupForUser,
};
