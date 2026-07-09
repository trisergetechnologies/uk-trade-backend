/**
 * Remove duplicate withdrawal requests + audit traces from the hourly auto-withdraw bug.
 * Source of truth: audit logs (withdrawal_request_auto_created / trade_cycle_unlock).
 * Keeps the earliest request per user+amount group; deletes the rest and extra audit logs.
 *
 * Flags:
 *   --dry-run
 *   --diagnose          — print counts only, no changes
 *   --user-code 74186   — limit to one user
 *   --user-id <mongoId> — limit by Mongo user _id (if userCode unknown)
 *   --mongo-uri <uri>   — override MONGO_URI from .env (required if prod data is on another DB)
 *
 * Examples:
 *   node scripts/repair-duplicate-auto-withdrawals.js --diagnose --user-code 74186
 *   PROD_PROTECT=false node scripts/repair-duplicate-auto-withdrawals.js --dry-run --user-code 74186
 *   PROD_PROTECT=false node scripts/repair-duplicate-auto-withdrawals.js --user-id 6a257d9496d6e933628f13ee
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { User, WithdrawalRequest, AuditLog } = require('../src/models');
const { recalculateEligibility } = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

const AUTO_ACTION = 'withdrawal_request_auto_created';
const AUTO_REASON = 'trade_cycle_unlock';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DIAGNOSE = args.includes('--diagnose');
const userCodeArgIndex = args.indexOf('--user-code');
const userIdArgIndex = args.indexOf('--user-id');
const mongoUriArgIndex = args.indexOf('--mongo-uri');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim().toUpperCase() : '';
const SINGLE_USER_ID =
  userIdArgIndex >= 0 ? String(args[userIdArgIndex + 1] || '').trim() : '';
const MONGO_URI_OVERRIDE =
  mongoUriArgIndex >= 0 ? String(args[mongoUriArgIndex + 1] || '').trim() : '';

function toObjectId(id) {
  if (!id) return null;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function groupKey(userId, amount) {
  return `${String(userId)}|${Number(amount)}`;
}

async function resolveScope() {
  if (SINGLE_USER_ID) {
    const oid = toObjectId(SINGLE_USER_ID);
    if (!oid) throw new Error(`Invalid --user-id: ${SINGLE_USER_ID}`);
    const user = await User.findById(oid).select('_id userCode').lean();
    if (!user) throw new Error(`User not found for id: ${SINGLE_USER_ID}`);
    return {
      userId: String(user._id),
      userCode: user.userCode,
      auditFilter: {
        $or: [{ 'details.userId': String(user._id) }, { 'details.userId': user._id }],
      },
    };
  }
  if (SINGLE_USER_CODE) {
    const user = await User.findOne({ userCode: SINGLE_USER_CODE }).select('_id userCode').lean();
    if (!user) throw new Error(`User not found: ${SINGLE_USER_CODE}`);
    return {
      userId: String(user._id),
      userCode: user.userCode,
      auditFilter: {
        $or: [{ 'details.userId': String(user._id) }, { 'details.userId': user._id }],
      },
    };
  }
  return { userId: null, userCode: null, auditFilter: {} };
}

async function loadAutoLogs(auditFilter) {
  return AuditLog.find({
    action: AUTO_ACTION,
    'details.reason': AUTO_REASON,
    ...auditFilter,
  })
    .select('_id targetId details createdAt')
    .sort({ createdAt: 1 })
    .lean();
}

async function diagnose(scope) {
  const logs = await loadAutoLogs(scope.auditFilter);
  const withdrawalCollection = WithdrawalRequest.collection.name;
  const auditCollection = AuditLog.collection.name;

  const byGroup = new Map();
  for (const log of logs) {
    const uid = log.details?.userId;
    const amount = Number(log.details?.amount);
    if (!uid || !Number.isFinite(amount)) continue;
    const key = groupKey(uid, amount);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(log);
  }

  const groups = [];
  for (const [key, groupLogs] of byGroup.entries()) {
    const [userId, amountStr] = key.split('|');
    const targetIds = [...new Set(groupLogs.map((l) => l.targetId).filter(Boolean))];
    const withdrawals = targetIds.length
      ? await WithdrawalRequest.find({ _id: { $in: targetIds } })
          .select('_id publicId status amount createdAt')
          .sort({ createdAt: 1 })
          .lean()
      : [];

    groups.push({
      userId,
      amount: Number(amountStr),
      auditLogCount: groupLogs.length,
      withdrawalDocsFound: withdrawals.length,
      statuses: withdrawals.map((w) => w.status),
      publicIds: withdrawals.map((w) => w.publicId),
    });
  }

  let scopedWithdrawals = [];
  if (scope.userId) {
    scopedWithdrawals = await WithdrawalRequest.find({
      userId: toObjectId(scope.userId),
      status: 'pending',
    })
      .select('publicId amount status createdAt')
      .sort({ createdAt: 1 })
      .lean();
  }

  return {
    mongoUri: env.mongoUri,
    withdrawalCollection,
    auditCollection,
    autoAuditLogsTotal: logs.length,
    duplicateGroups: groups.filter((g) => g.auditLogCount >= 2),
    allGroups: groups,
    scopedPendingWithdrawals: scopedWithdrawals,
  };
}

async function findDuplicateSets(scope) {
  const logs = await loadAutoLogs(scope.auditFilter);
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

    const [userId, amountStr] = key.split('|');
    const amount = Number(amountStr);
    const targetIds = groupLogs.map((l) => l.targetId).filter(Boolean);
    const uniqueIds = [...new Map(targetIds.map((id) => [String(id), id])).values()];

    const withdrawals = uniqueIds.length
      ? await WithdrawalRequest.find({ _id: { $in: uniqueIds } })
          .select('_id publicId userId amount status createdAt')
          .sort({ createdAt: 1 })
          .lean()
      : [];

    const keepLog = groupLogs[0];
    let keepWithdrawal = withdrawals.find((w) => String(w._id) === String(keepLog.targetId));

    if (!keepWithdrawal && withdrawals.length) {
      const pending = withdrawals.filter((w) => w.status === 'pending');
      keepWithdrawal = pending[0] || withdrawals[0];
    }

    const removeWithdrawals = keepWithdrawal
      ? withdrawals.filter((w) => String(w._id) !== String(keepWithdrawal._id))
      : withdrawals;

    const keepLogId = keepLog._id;
    const removeLogs = groupLogs.filter((l) => String(l._id) !== String(keepLogId));

    if (!removeWithdrawals.length && !removeLogs.length) continue;

    sets.push({
      userId,
      amount,
      keepWithdrawal: keepWithdrawal || null,
      keepLog,
      removeWithdrawals,
      removeLogs,
    });
  }

  return sets;
}

async function main() {
  if (env.prodProtectBlocksSeeding && !DRY_RUN && !DIAGNOSE) {
    throw new Error('Blocked: set PROD_PROTECT=false to run cleanup (use --dry-run or --diagnose first).');
  }

  if (MONGO_URI_OVERRIDE) {
    env.mongoUri = MONGO_URI_OVERRIDE;
  }

  await connectDb();
  const scope = await resolveScope();

  if (DIAGNOSE) {
    const report = await diagnose(scope);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const sets = await findDuplicateSets(scope);

  if (!sets.length) {
    const report = await diagnose(scope);
    console.log(
      JSON.stringify(
        {
          message: 'No duplicate sets found to clean. Diagnostic snapshot:',
          ...report,
        },
        null,
        2
      )
    );
    return;
  }

  const summary = {
    dryRun: DRY_RUN,
    mongoUri: env.mongoUri,
    duplicateGroups: sets.length,
    withdrawalsToDelete: 0,
    auditLogsToDelete: 0,
    usersToRecalculate: new Set(),
  };

  const details = [];

  for (const set of sets) {
    const user = await User.findById(set.userId).select('userCode').lean();
    summary.withdrawalsToDelete += set.removeWithdrawals.length;
    summary.auditLogsToDelete += set.removeLogs.length;
    summary.usersToRecalculate.add(String(set.userId));

    details.push({
      userCode: user?.userCode || set.userId,
      amount: set.amount,
      keep: set.keepWithdrawal
        ? {
            publicId: set.keepWithdrawal.publicId,
            id: String(set.keepWithdrawal._id),
            status: set.keepWithdrawal.status,
            createdAt: set.keepWithdrawal.createdAt,
          }
        : { auditLogOnly: String(set.keepLog._id) },
      deleteWithdrawals: set.removeWithdrawals.map((w) => ({
        publicId: w.publicId,
        id: String(w._id),
        status: w.status,
        createdAt: w.createdAt,
      })),
      deleteAuditLogs: set.removeLogs.length,
    });

    if (DRY_RUN) continue;

    const removeWdIds = set.removeWithdrawals.map((w) => w._id);
    const removeLogIds = set.removeLogs.map((l) => l._id);

    if (removeWdIds.length) {
      await WithdrawalRequest.deleteMany({ _id: { $in: removeWdIds } });
    }
    if (removeLogIds.length) {
      await AuditLog.deleteMany({ _id: { $in: removeLogIds } });
    }
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
