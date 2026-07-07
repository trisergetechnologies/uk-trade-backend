/**
 * Recompute eligibleBonus from wallet ledger (admin_credit minus package_purchase debits),
 * then refresh eligibleToWithdraw for affected users.
 *
 * Flags:
 *   --dry-run
 *   --user-code 74186   — single user; omit to process all affected wallets
 *   --all-wallets       — also scan wallets with eligibleBonus > 0 (default includes these)
 *
 * Example:
 *   PROD_PROTECT=false node scripts/repair-eligible-bonus.js --dry-run
 *   PROD_PROTECT=false node scripts/repair-eligible-bonus.js
 */

require('dotenv').config();
const { connectDb } = require('../src/db/connect');
const { User, Wallet, WalletLedger } = require('../src/models');
const {
  computeEligibleBonusFromLedgerEntries,
  reconcileEligibleBonusFromLedger,
} = require('../src/services/wallet.service');
const { recalculateEligibility } = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const userCodeArgIndex = args.indexOf('--user-code');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim().toUpperCase() : '';

async function resolveUsers() {
  if (SINGLE_USER_CODE) {
    const user = await User.findOne({ userCode: SINGLE_USER_CODE }).select('_id userCode').lean();
    if (!user) throw new Error(`User not found: ${SINGLE_USER_CODE}`);
    return [user];
  }

  const [ledgerUserIds, bonusWallets] = await Promise.all([
    WalletLedger.distinct('userId', {
      contextType: { $in: ['admin_credit', 'package_purchase'] },
    }),
    Wallet.find({ eligibleBonus: { $gt: 0 } }).select('userId').lean(),
  ]);

  const idSet = new Set([
    ...ledgerUserIds.map((id) => String(id)),
    ...bonusWallets.map((w) => String(w.userId)),
  ]);

  if (!idSet.size) return [];

  return User.find({ _id: { $in: [...idSet] } })
    .select('_id userCode')
    .lean();
}

async function main() {
  await connectDb();
  const users = await resolveUsers();
  const results = [];
  let fixedCount = 0;

  for (const user of users) {
    const before = await Wallet.findOne({ userId: user._id }).lean();
    const beforeBonus = Number(before?.eligibleBonus || 0);
    const beforeEligible = Number(before?.eligibleToWithdraw || 0);

    const entries = await WalletLedger.find({ userId: user._id })
      .select('amount direction contextType createdAt')
      .lean();
    const computedBonus = computeEligibleBonusFromLedgerEntries(entries);

    if (DRY_RUN) {
      results.push({
        userCode: user.userCode,
        dryRun: true,
        eligibleBonusBefore: beforeBonus,
        eligibleBonusAfter: computedBonus,
        eligibleToWithdrawBefore: beforeEligible,
        changed: beforeBonus !== computedBonus,
      });
      if (beforeBonus !== computedBonus) fixedCount += 1;
      continue;
    }

    const afterBonus = await reconcileEligibleBonusFromLedger(user._id);
    await recalculateEligibility(user._id);
    const after = await Wallet.findOne({ userId: user._id }).lean();
    const afterEligible = Number(after?.eligibleToWithdraw || 0);
    const changed = beforeBonus !== afterBonus || beforeEligible !== afterEligible;

    if (beforeBonus !== afterBonus) fixedCount += 1;

    if (changed || beforeBonus > 0) {
      results.push({
        userCode: user.userCode,
        eligibleBonusBefore: beforeBonus,
        eligibleBonusAfter: afterBonus,
        eligibleToWithdrawBefore: beforeEligible,
        eligibleToWithdrawAfter: afterEligible,
        balanceAfter: Number(after?.balance || 0),
        changed,
      });
    }
  }

  const summary = {
    usersScanned: users.length,
    bonusCorrected: fixedCount,
    dryRun: DRY_RUN,
    rowsReported: results.length,
  };

  logger.info(summary, 'repair-eligible-bonus completed');
  console.log(JSON.stringify({ summary, results }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'repair-eligible-bonus failed');
    console.error(err);
    process.exit(1);
  });
