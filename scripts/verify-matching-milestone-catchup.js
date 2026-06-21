/**
 * Read-only check: did milestone catch-up run? What would Meraj / a user get?
 *
 * No writes. No backup confirm required.
 *
 *   MONGO_URI="mongodb://127.0.0.1:27017/uk-trade-migration" \
 *     node scripts/verify-matching-milestone-catchup.js
 *
 *   node scripts/verify-matching-milestone-catchup.js --user-code USRIWHLVT
 */

require('dotenv').config();
const { connectDb } = require('../src/db/connect');
const { User, MatchingIncomeEvent, WalletLedger } = require('../src/models');
const { planCatchUpForUser } = require('./backfill-matching-milestone-catchup');
const { isNetworkParticipant } = require('../src/utils/network-participant');

const args = process.argv.slice(2);
const userCodeArgIndex = args.indexOf('--user-code');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim().toUpperCase() : '';

function fmt(n) {
  return Number(Number(n || 0).toFixed(2));
}

async function summarizeUser(user) {
  const plan = await planCatchUpForUser(user);
  const credited = await MatchingIncomeEvent.find({
    earnerUserId: user._id,
    status: 'credited',
  })
    .sort({ createdAt: -1 })
    .select('payoutCreditedAmount reason idempotencyKey createdAt leftActiveUserCount rightActiveUserCount')
    .lean();

  const catchUpEvents = credited.filter((e) =>
    String(e.idempotencyKey || '').startsWith('matching:milestone-catchup:')
  );

  const walletRows = await WalletLedger.aggregate([
    {
      $match: {
        userId: user._id,
        contextType: 'matching_income',
        direction: 'credit',
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' }, n: { $sum: 1 } } },
  ]);

  return {
    userCode: user.userCode,
    name: user.name,
    matchingMilestoneCatchUpDone: !!user.matchingMilestoneCatchUpDone,
    firstMatchingDone: !!user.firstMatchingDone,
    creditedEventCount: credited.length,
    catchUpEventCount: catchUpEvents.length,
    walletMatchingTotal: fmt(walletRows[0]?.total),
    walletMatchingRows: walletRows[0]?.n || 0,
    lastCreditedAt: credited[0]?.createdAt || null,
    lastCatchUpAt: catchUpEvents[0]?.createdAt || null,
    plan: plan.skipped
      ? { skipped: true, reason: plan.reason, leftActive: plan.leftActive, rightActive: plan.rightActive }
      : {
          leftActive: plan.leftActive,
          rightActive: plan.rightActive,
          maxK: plan.maxK,
          alreadyPaidMilestones: plan.alreadyPaid,
          pendingMilestones: plan.milestones.map((m) => m.k),
          pendingPayoutTotal: plan.totalPayout,
          perMilestonePayout: plan.perMilestonePayout,
        },
    recentCredits: credited.slice(0, 5).map((e) => ({
      at: e.createdAt,
      amount: e.payoutCreditedAmount,
      reason: e.reason,
      k: e.leftActiveUserCount === e.rightActiveUserCount ? e.leftActiveUserCount : null,
      idempotencyKey: e.idempotencyKey,
    })),
  };
}

async function run() {
  const query = {};
  if (SINGLE_USER_CODE) query.userCode = SINGLE_USER_CODE;

  const users = await User.find(query)
    .select('_id userCode name email role firstMatchingDone matchingMilestoneCatchUpDone')
    .lean();
  const participants = users.filter((u) => isNetworkParticipant(u));

  if (!participants.length) {
    console.log(JSON.stringify({ error: 'No user found', userCode: SINGLE_USER_CODE || null }, null, 2));
    return;
  }

  const rows = [];
  for (const user of participants) {
    rows.push(await summarizeUser(user));
  }

  const pending = rows.filter((r) => r.plan.pendingMilestones?.length);
  const doneFlag = rows.filter((r) => r.matchingMilestoneCatchUpDone);
  const hasCatchUpEvents = rows.filter((r) => r.catchUpEventCount > 0);

  const summary = {
    database: process.env.MONGO_URI || '(from .env)',
    usersChecked: rows.length,
    usersWithCatchUpFlag: doneFlag.length,
    usersWithCatchUpEventsInDb: hasCatchUpEvents.length,
    usersStillPendingMilestones: pending.length,
    hint:
      pending.length && !hasCatchUpEvents.length
        ? 'Catch-up NOT applied yet — run backfill-matching-milestone-catchup.js WITHOUT --dry-run (use BACKFILL_MILESTONE_CATCHUP_CONFIRM, not BACKFILL_MATCHING_CONFIRM).'
        : hasCatchUpEvents.length
          ? 'Catch-up events exist in DB — refresh Matching Income page; new rows should have reason milestone-catchup-existing-users.'
          : 'No pending milestones or catch-up already marked done.',
    users: SINGLE_USER_CODE ? rows : rows.slice(0, 20),
  };

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  connectDb()
    .then(run)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { summarizeUser };
