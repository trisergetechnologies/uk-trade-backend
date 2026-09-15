/**
 * Manually credit matching income for one user (wallet + MatchingIncomeEvent + Eligible).
 * Does not reverse existing matching or touch withdrawals.
 *
 * Dry-run (default):
 *   node scripts/manual-credit-matching-income.js --user-code USRIWHLVT --amount 30000
 *
 * Apply:
 *   PROD_PROTECT=false MANUAL_MATCHING_CREDIT_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     ALLOW_PRODUCTION_DB=true \
 *     node scripts/manual-credit-matching-income.js --user-code USRIWHLVT --amount 30000 --apply
 *
 * Optional:
 *   --note "reason text"   — stored on event + ledger
 *   --force-key SUFFIX     — new idempotency key if you must credit again (rare)
 */

require('dotenv').config();
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { User, Wallet, PackageSubscription, MatchingIncomeEvent } = require('../src/models');
const { creditWallet } = require('../src/services/wallet.service');
const { recalculateEligibility } = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

function argValue(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return '';
  return String(args[i + 1] || '').trim();
}

const USER_CODE = argValue('--user-code').toUpperCase();
const AMOUNT = Number(argValue('--amount') || 30000);
const NOTE = argValue('--note') || 'Manual matching income credit (ops)';
const FORCE_KEY = argValue('--force-key');

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function parseMongoDbName(uri) {
  const withoutQuery = String(uri || '').split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  if (slash < 0 || slash === withoutQuery.length - 1) return '';
  return withoutQuery.slice(slash + 1);
}

function assertApplyAllowed() {
  if (DRY_RUN) return;
  if (env.prodProtectBlocksSeeding) {
    throw new Error('Apply blocked: set PROD_PROTECT=false in the environment.');
  }
  const confirm = String(process.env.MANUAL_MATCHING_CREDIT_CONFIRM || '').trim();
  if (confirm !== 'YES_I_HAVE_A_DATABASE_BACKUP') {
    throw new Error(
      'Apply blocked: set MANUAL_MATCHING_CREDIT_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP after a full MongoDB backup.'
    );
  }
  const dbName = parseMongoDbName(env.mongoUri);
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error('Refusing to apply on database "uk_trade" without ALLOW_PRODUCTION_DB=true.');
  }
}

function buildIdempotencyKey(userCode, amount) {
  const base = `matching:manual:${userCode}:${round2(amount)}`;
  return FORCE_KEY ? `${base}:${FORCE_KEY}` : base;
}

async function run() {
  if (!USER_CODE) throw new Error('--user-code is required, e.g. --user-code USRIWHLVT');
  if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) throw new Error('--amount must be a positive number');

  assertApplyAllowed();
  const dbName = parseMongoDbName(env.mongoUri);
  const amount = round2(AMOUNT);
  const idempotencyKey = buildIdempotencyKey(USER_CODE, amount);

  const user = await User.findOne({ userCode: USER_CODE })
    .select('_id userCode name email firstMatchingDone matchingMatchedVolume')
    .lean();
  if (!user) throw new Error(`User not found: ${USER_CODE}`);

  const walletBefore = await Wallet.findOne({ userId: user._id }).lean();
  if (!walletBefore) throw new Error(`Wallet not found for ${USER_CODE}`);

  const existing = await MatchingIncomeEvent.findOne({ idempotencyKey }).lean();
  if (existing) {
    console.log('\n=== MANUAL MATCHING CREDIT ===');
    console.log(`Already applied (idempotent). Event ${existing.publicId || existing._id}`);
    console.log(`Status: ${existing.status}, amount: ${existing.payoutCreditedAmount}`);
    console.log('No further change.\n');
    return;
  }

  const anchorSub =
    (await PackageSubscription.findOne({ userId: user._id, status: 'active' })
      .sort({ principalAmount: -1, purchaseAtUtc: -1 })
      .select('_id principalAmount')
      .lean()) ||
    (await PackageSubscription.findOne({ userId: user._id })
      .sort({ purchaseAtUtc: -1 })
      .select('_id principalAmount')
      .lean());

  if (!anchorSub) {
    throw new Error(`No package subscription found for ${USER_CODE} (needed as event anchor).`);
  }

  const preview = {
    dryRun: DRY_RUN,
    dbName,
    userCode: user.userCode,
    name: user.name,
    amount,
    note: NOTE,
    idempotencyKey,
    balanceBefore: walletBefore.balance,
    eligibleBefore: walletBefore.eligibleToWithdraw,
    balanceAfterWouldBe: round2(Number(walletBefore.balance || 0) + amount),
    anchorSubscriptionId: String(anchorSub._id),
  };

  console.log('\n=== MANUAL MATCHING CREDIT ===');
  console.log(JSON.stringify(preview, null, 2));

  if (DRY_RUN) {
    console.log('\nDRY-RUN only. Re-run with --apply and confirm env vars to credit.\n');
    return;
  }

  const event = await MatchingIncomeEvent.create({
    triggerPurchaseSubscriptionId: anchorSub._id,
    triggerBuyerUserId: user._id,
    earnerUserId: user._id,
    triggerLevelFromEarner: 1,
    matchingPercent: 100,
    leftActiveUserCount: 0,
    rightActiveUserCount: 0,
    leftVolumeBefore: 0,
    rightVolumeBefore: 0,
    matchedVolumeBefore: Number(user.matchingMatchedVolume || 0),
    matchedVolumeAfter: Number(user.matchingMatchedVolume || 0),
    legAtEarner: '',
    parentAmount: 0,
    packageCapThreshold: env.matchingPackageCapThreshold,
    packageCapApplied: false,
    triggerPurchaseAmount: amount,
    considerableAmount: amount,
    rawPayoutAmount: amount,
    capBaseAmount: amount,
    capRemainingBeforeAmount: amount,
    payoutCreditedAmount: amount,
    capRemainingAfterAmount: amount,
    firstMatchingBeforeEvent: !user.firstMatchingDone,
    status: 'credited',
    reason: 'manual-matching-credit',
    idempotencyKey,
    metadata: {
      manual: true,
      script: 'manual-credit-matching-income',
      note: NOTE,
      userCode: user.userCode,
    },
  });

  await creditWallet({
    userId: user._id,
    amount,
    contextType: 'matching_income',
    contextId: event._id,
    packageSubscriptionId: anchorSub._id,
    notes: NOTE,
    metadata: {
      manual: true,
      idempotencyKey,
      userCode: user.userCode,
    },
  });

  if (!user.firstMatchingDone) {
    await User.updateOne({ _id: user._id }, { $set: { firstMatchingDone: true } });
  }

  await recalculateEligibility(user._id.toString(), null, { skipAutoWithdraw: true });

  const walletAfter = await Wallet.findOne({ userId: user._id }).lean();
  console.log('\nApplied.');
  console.log(`Matching event: ${event.publicId}`);
  console.log(`Balance: ${walletBefore.balance} → ${walletAfter.balance}`);
  console.log(`Eligible to withdraw: ${walletBefore.eligibleToWithdraw} → ${walletAfter.eligibleToWithdraw}`);
  console.log('User should see a new Matching Income row and be able to withdraw the added amount (subject to KYC/other gates).\n');
}

if (require.main === module) {
  connectDb()
    .then(run)
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'manual-credit-matching-income failed');
      process.exit(1);
    });
}

module.exports = { buildIdempotencyKey };
