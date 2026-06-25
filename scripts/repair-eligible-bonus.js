/**
 * Recompute eligibleBonus from wallet ledger (admin_credit minus package_purchase debits).
 *
 * Flags:
 *   --dry-run
 *   --user-code 80928   — single user; omit to process all wallets with ledger activity
 *
 * Example:
 *   PROD_PROTECT=false MONGO_URI=mongodb://127.0.0.1:27017/uk-trade-migration-v2 \
 *     node scripts/repair-eligible-bonus.js --user-code 80928 --dry-run
 */

require('dotenv').config();
const { connectDb } = require('../src/db/connect');
const { User, Wallet, WalletLedger } = require('../src/models');
const { reconcileEligibleBonusFromLedger } = require('../src/services/wallet.service');
const { recalculateEligibility } = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const userCodeArgIndex = args.indexOf('--user-code');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim().toUpperCase() : '';

async function resolveUserIds() {
  if (SINGLE_USER_CODE) {
    const user = await User.findOne({ userCode: SINGLE_USER_CODE }).select('_id userCode').lean();
    if (!user) throw new Error(`User not found: ${SINGLE_USER_CODE}`);
    return [user];
  }

  const userIds = await WalletLedger.distinct('userId', {
    contextType: { $in: ['admin_credit', 'package_purchase'] },
  });
  const users = await User.find({ _id: { $in: userIds } }).select('_id userCode').lean();
  return users;
}

async function main() {
  await connectDb();
  const users = await resolveUserIds();
  const results = [];

  for (const user of users) {
    const before = await Wallet.findOne({ userId: user._id }).lean();
    const beforeBonus = Number(before?.eligibleBonus || 0);

    if (DRY_RUN) {
      const entries = await WalletLedger.find({ userId: user._id })
        .select('amount direction contextType createdAt')
        .lean();
      const { computeEligibleBonusFromLedgerEntries } = require('../src/services/wallet.service');
      const afterBonus = computeEligibleBonusFromLedgerEntries(entries);
      results.push({
        userCode: user.userCode,
        dryRun: true,
        eligibleBonusBefore: beforeBonus,
        eligibleBonusAfter: afterBonus,
      });
      continue;
    }

    const afterBonus = await reconcileEligibleBonusFromLedger(user._id);
    await recalculateEligibility(user._id);
    const after = await Wallet.findOne({ userId: user._id }).lean();
    results.push({
      userCode: user.userCode,
      eligibleBonusBefore: beforeBonus,
      eligibleBonusAfter: afterBonus,
      eligibleToWithdrawAfter: Number(after?.eligibleToWithdraw || 0),
      balanceAfter: Number(after?.balance || 0),
    });
  }

  logger.info({ count: results.length, dryRun: DRY_RUN }, 'repair-eligible-bonus completed');
  console.log(JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'repair-eligible-bonus failed');
    console.error(err);
    process.exit(1);
  });
