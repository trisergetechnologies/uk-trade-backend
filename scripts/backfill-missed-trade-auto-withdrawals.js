/**
 * Backfill missed auto-withdrawal requests for unlocked trade income.
 *
 * Background: until KYC (and bank) were removed as gates, tryAutoWithdrawNewTradeIncome
 * silently skipped on cycle unlock day. Eligibility still saved lastGrossEligibleTrade,
 * so later days never re-fired for that cycle.
 *
 * This script creates one pending WithdrawalRequest per user for remaining unlocked
 * trade still sitting after existing approved+pending withdrawals (trade is consumed
 * first), capped by wallet balance. Min amount ₹500 (same as live auto-withdraw).
 *
 * Dry-run (default, read-only):
 *   node scripts/backfill-missed-trade-auto-withdrawals.js --dry-run
 *   node scripts/backfill-missed-trade-auto-withdrawals.js --dry-run --pro-only
 *   node scripts/backfill-missed-trade-auto-withdrawals.js --dry-run --user-code 08407
 *   node scripts/backfill-missed-trade-auto-withdrawals.js --dry-run --user-codes "USRP82QCN,87817,08407"
 *   node scripts/backfill-missed-trade-auto-withdrawals.js --dry-run --pro-only \
 *     --mongo-uri "mongodb://127.0.0.1:27017/uk-trade-migration-v2"
 *
 * Apply:
 *   PROD_PROTECT=false BACKFILL_MISSED_AUTO_WD_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     node scripts/backfill-missed-trade-auto-withdrawals.js --apply --pro-only \
 *     --mongo-uri "mongodb://127.0.0.1:27017/uk-trade-migration-v2"
 *
 * Production DB name uk_trade also needs ALLOW_PRODUCTION_DB=true.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const {
  User,
  Wallet,
  Plan,
  PackageSubscription,
  WithdrawalRequest,
  AuditLog,
} = require('../src/models');
const {
  previewEligibility,
  recalculateEligibility,
} = require('../src/services/eligibility.service');
const { isBankAccountComplete } = require('../src/services/kyc.service');
const { computeWithdrawalDeductions } = require('../src/utils/withdrawal-deductions');
const { logger } = require('../src/utils/logger');

const MIN_WITHDRAWAL_AMOUNT = 500;
const AUTO_ACTION = 'withdrawal_request_auto_created';
const BACKFILL_REASON = 'trade_cycle_unlock_backfill';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || !args.includes('--apply');
const APPLY = args.includes('--apply');
const PRO_ONLY = args.includes('--pro-only');
const userCodeArgIndex = args.indexOf('--user-code');
const userCodesArgIndex = args.indexOf('--user-codes');
const mongoUriArgIndex = args.indexOf('--mongo-uri');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim() : '';
const USER_CODES_CSV =
  userCodesArgIndex >= 0 ? String(args[userCodesArgIndex + 1] || '').trim() : '';
const MONGO_URI_OVERRIDE =
  mongoUriArgIndex >= 0 ? String(args[mongoUriArgIndex + 1] || '').trim() : '';

function parseMongoDbName(uri) {
  const withoutQuery = String(uri || '').split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  if (slash < 0 || slash === withoutQuery.length - 1) return '';
  return withoutQuery.slice(slash + 1);
}

function assertApplyAllowed(mongoUri) {
  if (env.prodProtectBlocksSeeding) {
    throw new Error('Apply blocked: set PROD_PROTECT=false in the environment.');
  }
  const confirm = String(process.env.BACKFILL_MISSED_AUTO_WD_CONFIRM || '').trim();
  if (confirm !== 'YES_I_HAVE_A_DATABASE_BACKUP') {
    throw new Error(
      'Apply blocked: set BACKFILL_MISSED_AUTO_WD_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP after a full MongoDB backup.'
    );
  }
  const dbName = parseMongoDbName(mongoUri);
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error('Refusing to run --apply on database "uk_trade" without ALLOW_PRODUCTION_DB=true.');
  }
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

/** Unlocked trade still left after approved+pending (withdrawals consume trade first). */
function remainingUnlockedTrade(tradeGross, approved, pending) {
  let remainingWithdrawn = Number(approved || 0) + Number(pending || 0);
  const avail = Math.max(0, Number(tradeGross) || 0);
  const used = Math.min(avail, remainingWithdrawn);
  return roundMoney(avail - used);
}

function buildBankSnapshot(bank) {
  const accountDigits = String(bank?.accountNumber || '').replace(/\D/g, '');
  return {
    accountHolderName: String(bank?.accountHolderName || '').trim(),
    bankName: String(bank?.bankName || '').trim(),
    accountNumber: accountDigits,
    accountLast4: accountDigits.slice(-4),
    ifscCode: String(bank?.ifscCode || '').trim().toUpperCase(),
    upiId: String(bank?.upiId || '').trim().toLowerCase(),
  };
}

async function resolveTargetUserIds() {
  if (SINGLE_USER_CODE) {
    const user = await User.findOne({ userCode: SINGLE_USER_CODE }).select('_id userCode').lean();
    if (!user) throw new Error(`User not found: ${SINGLE_USER_CODE}`);
    return [user._id];
  }

  if (USER_CODES_CSV) {
    const codes = USER_CODES_CSV.split(/[,\s]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const users = await User.find({ userCode: { $in: codes } }).select('_id userCode').lean();
    const found = new Set(users.map((u) => String(u.userCode)));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length) logger.warn({ missing }, 'user codes not found');
    return users.map((u) => u._id);
  }

  if (PRO_ONLY) {
    const proPlans = await Plan.find({
      $or: [{ cycleDaysW: 62 }, { name: /pro/i }, { code: 'C' }],
    })
      .select('_id code name cycleDaysW')
      .lean();
    if (!proPlans.length) {
      throw new Error(
        'No Pro / W=62 plan found in this database. Use --user-codes "USRP82QCN,87817,..." or point --mongo-uri at the DB that has Pro Plan.'
      );
    }
    logger.info(
      { plans: proPlans.map((p) => ({ code: p.code, name: p.name, W: p.cycleDaysW })) },
      'Pro plan filter'
    );
    const planIds = proPlans.map((p) => p._id);
    return PackageSubscription.distinct('userId', { planId: { $in: planIds } });
  }

  return PackageSubscription.distinct('userId');
}

async function sumPriorAutoBackfill(userId) {
  const uid = String(userId);
  const logs = await AuditLog.find({
    action: AUTO_ACTION,
    'details.reason': BACKFILL_REASON,
    $or: [{ 'details.userId': uid }, { 'details.userId': userId }],
  })
    .select('details.targetId details.amount targetId')
    .lean();

  let total = 0;
  for (const log of logs) {
    const requestId = log.targetId || log.details?.targetId;
    if (requestId) {
      const wd = await WithdrawalRequest.findById(requestId).select('status amount').lean();
      if (wd && (wd.status === 'pending' || wd.status === 'approved')) {
        total += Number(wd.amount) || 0;
        continue;
      }
      if (wd && wd.status === 'rejected') continue;
    }
    total += Number(log.details?.amount) || 0;
  }
  return roundMoney(total);
}

async function buildRow(userId) {
  const user = await User.findById(userId)
    .select('userCode name email kyc.status bankAccount')
    .lean();
  if (!user) return null;

  const wallet = await Wallet.findOne({ userId }).lean();
  if (!wallet) return null;

  const preview = await previewEligibility(userId);
  const tradeLeft = remainingUnlockedTrade(preview.tradeGross, preview.approved, preview.pending);
  const balance = roundMoney(wallet.balance);
  const priorBackfill = await sumPriorAutoBackfill(userId);
  const createAmount = roundMoney(Math.min(Math.max(0, tradeLeft - priorBackfill), balance));

  const kycStatus = user.kyc?.status || 'unverified';
  const bankOk = isBankAccountComplete(user);

  return {
    userId: user._id,
    userCode: user.userCode,
    name: user.name,
    email: user.email,
    kycStatus,
    bankOk,
    tradeGross: preview.tradeGross,
    approved: preview.approved,
    pending: preview.pending,
    tradeLeft,
    priorBackfill,
    balance,
    eligible: preview.currentEligible,
    createAmount,
    wouldCreate: createAmount >= MIN_WITHDRAWAL_AMOUNT,
  };
}

async function applyRow(row) {
  const user = await User.findById(row.userId).lean();
  const deductions = computeWithdrawalDeductions(row.createAmount);
  const bankSnapshot = isBankAccountComplete(user)
    ? buildBankSnapshot(user.bankAccount)
    : buildBankSnapshot({});

  const created = await WithdrawalRequest.create({
    userId: row.userId,
    amount: row.createAmount,
    ...deductions,
    status: 'pending',
    bankSnapshot,
  });

  await AuditLog.create({
    actorUserId: null,
    action: AUTO_ACTION,
    targetType: 'WithdrawalRequest',
    targetId: created._id,
    details: {
      userId: String(row.userId),
      userCode: row.userCode,
      amount: row.createAmount,
      netPayable: deductions.netPayable,
      tdsAmount: deductions.tdsAmount,
      handlingAmount: deductions.handlingAmount,
      reason: BACKFILL_REASON,
      bankOnFile: isBankAccountComplete(user),
      tradeGross: row.tradeGross,
      tradeLeft: row.tradeLeft,
    },
  });

  await recalculateEligibility(row.userId.toString(), null, { skipAutoWithdraw: true });

  return {
    publicId: created.publicId,
    amount: row.createAmount,
    netPayable: deductions.netPayable,
  };
}

async function main() {
  const isDry = !APPLY;
  const mongoUri = MONGO_URI_OVERRIDE || env.mongoUri;
  if (!mongoUri) throw new Error('MONGO_URI is not set (use .env or --mongo-uri)');
  if (APPLY) assertApplyAllowed(mongoUri);

  await mongoose.connect(mongoUri);
  const dbName = mongoose.connection.name;
  logger.info(
    { dbName, mongoUri, mode: isDry ? 'dry-run' : 'apply', proOnly: PRO_ONLY, userCode: SINGLE_USER_CODE || null },
    'backfill missed trade auto-withdrawals'
  );

  const userIds = await resolveTargetUserIds();
  logger.info({ userCount: userIds.length }, 'users to scan');

  const rows = [];
  for (const uid of userIds) {
    const row = await buildRow(uid);
    if (row) rows.push(row);
  }

  const actionable = rows.filter((r) => r.wouldCreate).sort((a, b) => b.createAmount - a.createAmount);
  const skipped = rows.filter((r) => !r.wouldCreate);

  console.log('\n=== ACTIONABLE (will create pending withdrawal) ===');
  console.table(
    actionable.map((r) => ({
      userCode: r.userCode,
      name: r.name,
      kyc: r.kycStatus,
      bankOk: r.bankOk,
      tradeGross: r.tradeGross,
      tradeLeft: r.tradeLeft,
      balance: r.balance,
      eligible: r.eligible,
      createAmount: r.createAmount,
    }))
  );

  console.log(`\nActionable: ${actionable.length}`);
  console.log(
    `Skipped (trade left < ${MIN_WITHDRAWAL_AMOUNT} or balance too low): ${skipped.length}`
  );
  console.log(
    `Total createAmount: ${roundMoney(actionable.reduce((s, r) => s + r.createAmount, 0))}`
  );

  if (isDry) {
    console.log('\nDry-run only. Re-run with --apply and confirm env vars to create requests.');
    await mongoose.disconnect();
    return;
  }

  const created = [];
  for (const row of actionable) {
    const result = await applyRow(row);
    created.push({ userCode: row.userCode, ...result });
    logger.info({ userCode: row.userCode, ...result }, 'created backfill withdrawal');
  }

  console.log('\n=== CREATED ===');
  console.table(created);
  console.log(`Created ${created.length} pending withdrawal(s).`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error({ err }, 'backfill-missed-trade-auto-withdrawals failed');
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
