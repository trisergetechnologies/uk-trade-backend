/**
 * Add matching income to Eligible to withdraw, without double-paying users who
 * already received matching via admin_credit.
 *
 * Does NOT change wallet.balance, packages, trade lock, or ledger history.
 *
 * Dry-run (read-only):
 *   node scripts/apply-matching-eligible.js --dry-run
 *
 * Apply (writes matchingPaidByAdmin on 8 users, then recalcs Eligible for all wallets):
 *   PROD_PROTECT=false APPLY_MATCHING_ELIGIBLE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     node scripts/apply-matching-eligible.js --apply
 *
 * Production DB name uk_trade also needs ALLOW_PRODUCTION_DB=true.
 */

require('dotenv').config();
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { User, Wallet } = require('../src/models');
const {
  MATCHING_PAID_BY_ADMIN_BY_USER_CODE,
} = require('../src/constants/matching-paid-by-admin');
const {
  previewEligibility,
  recalculateEligibility,
} = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || !args.includes('--apply');
const APPLY = args.includes('--apply');

function parseMongoDbName(uri) {
  const withoutQuery = String(uri || '').split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  if (slash < 0 || slash === withoutQuery.length - 1) return '';
  return withoutQuery.slice(slash + 1);
}

function assertApplyAllowed() {
  if (env.prodProtectBlocksSeeding) {
    throw new Error('Apply blocked: set PROD_PROTECT=false in the environment.');
  }
  const confirm = String(process.env.APPLY_MATCHING_ELIGIBLE_CONFIRM || '').trim();
  if (confirm !== 'YES_I_HAVE_A_DATABASE_BACKUP') {
    throw new Error(
      'Apply blocked: set APPLY_MATCHING_ELIGIBLE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP after a full MongoDB backup.'
    );
  }
  const dbName = parseMongoDbName(env.mongoUri);
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error('Refusing to run --apply on database "uk_trade" without ALLOW_PRODUCTION_DB=true.');
  }
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function loadCompensationUsers() {
  const codes = Object.keys(MATCHING_PAID_BY_ADMIN_BY_USER_CODE);
  const users = await User.find({ userCode: { $in: codes } })
    .select('_id userCode name email')
    .lean();
  const byCode = new Map(users.map((u) => [String(u.userCode).toUpperCase(), u]));
  const missing = codes.filter((c) => !byCode.has(c));
  return { byCode, missing, codes };
}

async function previewAllWallets() {
  const wallets = await Wallet.find({}).select('userId balance eligibleToWithdraw matchingPaidByAdmin').lean();
  const rows = [];
  for (const wallet of wallets) {
    const preview = await previewEligibility(wallet.userId);
    const expectedDelta = roundMoney(preview.matchingGross - preview.matchingPaidByAdmin);
    const unexpected = Math.abs(preview.delta - expectedDelta) > 1;
    rows.push({
      userCode: preview.userCode,
      matchingGross: preview.matchingGross,
      matchingPaidByAdmin: preview.matchingPaidByAdmin,
      currentEligible: preview.currentEligible,
      proposedEligible: preview.proposedEligible,
      delta: preview.delta,
      expectedDelta,
      unexpected,
      balance: preview.currentBalance,
    });
  }
  return rows;
}

async function stampCompensation(byCode) {
  const stamped = [];
  for (const [code, amount] of Object.entries(MATCHING_PAID_BY_ADMIN_BY_USER_CODE)) {
    const user = byCode.get(code);
    await Wallet.updateOne({ userId: user._id }, { $set: { matchingPaidByAdmin: amount } });
    stamped.push({ userCode: code, matchingPaidByAdmin: amount });
  }
  return stamped;
}

async function recalcAllWallets() {
  const wallets = await Wallet.find({}).select('userId').lean();
  let n = 0;
  for (const wallet of wallets) {
    await recalculateEligibility(wallet.userId.toString(), null, { skipAutoWithdraw: true });
    n += 1;
  }
  return n;
}

async function main() {
  if (APPLY && DRY_RUN && args.includes('--dry-run')) {
    throw new Error('Pass only one of --dry-run or --apply.');
  }
  if (APPLY) assertApplyAllowed();

  await connectDb();
  const dbName = parseMongoDbName(env.mongoUri);
  const { byCode, missing, codes } = await loadCompensationUsers();

  if (missing.length) {
    const msg = `Compensation userCode(s) not found: ${missing.join(', ')}`;
    if (APPLY) throw new Error(msg);
    logger.warn({ missing }, msg);
  }

  const before = await previewAllWallets();
  const compensated = before.filter((r) => codes.includes(String(r.userCode).toUpperCase()));
  const changing = before.filter((r) => Math.abs(r.delta) > 0.009);
  const unexpected = before.filter((r) => r.unexpected && Math.abs(r.matchingGross) + Math.abs(r.delta) > 0);

  const summary = {
    dbName,
    dryRun: !APPLY,
    walletsScanned: before.length,
    compensationCodes: codes.length,
    compensationUsersFound: codes.length - missing.length,
    missingUserCodes: missing,
    walletsWhoseEligibleWouldChange: changing.length,
    unexpectedDeltaCount: unexpected.length,
  };

  if (!APPLY) {
    logger.info(summary, 'apply-matching-eligible dry-run (no writes)');
    console.log(
      JSON.stringify(
        {
          summary,
          compensatedUsers: compensated,
          changing: changing.filter((r) => !codes.includes(String(r.userCode).toUpperCase())).slice(0, 50),
          unexpected: unexpected.slice(0, 30),
        },
        null,
        2
      )
    );
    return;
  }

  const stamped = await stampCompensation(byCode);
  const recalcCount = await recalcAllWallets();
  const afterCompensated = [];
  for (const user of byCode.values()) {
    afterCompensated.push(await previewEligibility(user._id));
  }

  logger.info({ ...summary, stamped: stamped.length, recalcCount }, 'apply-matching-eligible applied');
  console.log(JSON.stringify({ summary: { ...summary, dryRun: false, recalcCount }, stamped, afterCompensated }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'apply-matching-eligible failed');
    console.error(err);
    process.exit(1);
  });
