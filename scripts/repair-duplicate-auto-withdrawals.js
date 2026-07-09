/**
 * Remove duplicate pending withdrawal requests created by the hourly auto-withdraw bug
 * (same user + amount + trade_cycle_unlock). Keeps the earliest request per group.
 *
 * Flags:
 *   --dry-run
 *   --user-code 74186   — single user; omit to scan all affected users
 *
 * Example:
 *   PROD_PROTECT=false npm run repair:duplicate-auto-withdrawals -- --dry-run
 *   PROD_PROTECT=false npm run repair:duplicate-auto-withdrawals -- --user-code 74186
 *   PROD_PROTECT=false npm run repair:duplicate-auto-withdrawals
 */

require('dotenv').config();
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { User, WithdrawalRequest, AuditLog } = require('../src/models');
const { recalculateEligibility } = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

const AUTO_ACTION = 'withdrawal_request_auto_created';
const AUTO_REASON = 'trade_cycle_unlock';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const userCodeArgIndex = args.indexOf('--user-code');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim().toUpperCase() : '';

function groupKey(userId, amount) {
  return `${String(userId)}|${Number(amount)}`;
}

async function resolveUserFilter() {
  if (!SINGLE_USER_CODE) return {};
  const user = await User.findOne({ userCode: SINGLE_USER_CODE }).select('_id userCode').lean();
  if (!user) throw new Error(`User not found: ${SINGLE_USER_CODE}`);
  return { 'details.userId': String(user._id) };
}

async function findDuplicateSets() {
  const userFilter = await resolveUserFilter();
  const logs = await AuditLog.find({
    action: AUTO_ACTION,
    'details.reason': AUTO_REASON,
    ...userFilter,
  })
    .select('_id targetId details createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const byGroup = new Map();
  for (const log of logs) {
    const userId = log.details?.userId;
    const amount = Number(log.details?.amount);
    if (!userId || !Number.isFinite(amount)) continue;
    const key = groupKey(userId, amount);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(log);
  }

  const sets = [];
  for (const [key, groupLogs] of byGroup.entries()) {
    if (groupLogs.length < 2) continue;

    const withdrawalIds = [
      ...new Set(groupLogs.map((l) => String(l.targetId)).filter((id) => id && id !== 'null')),
    ];
    const withdrawals = await WithdrawalRequest.find({ _id: { $in: withdrawalIds } })
      .select('_id publicId userId amount status createdAt')
      .sort({ createdAt: 1 })
      .lean();

    const pending = withdrawals.filter((w) => w.status === 'pending');
    if (pending.length < 2) continue;

    const keep = pending[0];
    const remove = pending.slice(1);

    sets.push({
      key,
      userId,
      amount: Number(amount),
      keep,
      remove,
    });
  }

  return sets;
}

async function main() {
  if (env.prodProtectBlocksSeeding && !DRY_RUN) {
    throw new Error('Blocked: set PROD_PROTECT=false to run cleanup (use --dry-run to preview).');
  }

  await connectDb();
  const sets = await findDuplicateSets();

  const summary = {
    dryRun: DRY_RUN,
    duplicateGroups: sets.length,
    withdrawalsToDelete: 0,
    usersToRecalculate: new Set(),
  };

  const details = [];

  for (const set of sets) {
    const user = await User.findById(set.userId).select('userCode').lean();
    summary.withdrawalsToDelete += set.remove.length;
    summary.usersToRecalculate.add(String(set.userId));

    const row = {
      userCode: user?.userCode || set.userId,
      amount: set.amount,
      keep: {
        publicId: set.keep.publicId,
        id: String(set.keep._id),
        createdAt: set.keep.createdAt,
      },
      delete: set.remove.map((w) => ({
        publicId: w.publicId,
        id: String(w._id),
        createdAt: w.createdAt,
      })),
    };
    details.push(row);

    if (DRY_RUN) continue;

    const removeIds = set.remove.map((w) => w._id);
    await WithdrawalRequest.deleteMany({ _id: { $in: removeIds } });
    await AuditLog.deleteMany({ targetId: { $in: removeIds }, action: AUTO_ACTION });
  }

  if (!DRY_RUN) {
    for (const userId of summary.usersToRecalculate) {
      await recalculateEligibility(userId, null, { skipAutoWithdraw: true });
    }
  }

  const output = {
    summary: {
      ...summary,
      usersToRecalculate: [...summary.usersToRecalculate],
    },
    details,
  };

  logger.info(output.summary, 'repair-duplicate-auto-withdrawals completed');
  console.log(JSON.stringify(output, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'repair-duplicate-auto-withdrawals failed');
    console.error(err);
    process.exit(1);
  });
