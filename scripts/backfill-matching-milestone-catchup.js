/**
 * One-time milestone catch-up for EXISTING users only (does not change live matching.service.js).
 *
 * Credits missed k–k matching milestones (k = 1..min(leftActive, rightActive) in L1–L5)
 * for users who already had unequal left/right growth and skipped repeat payouts.
 *
 * Live purchase flow keeps first-gate + equality-on-event rules for everyone going forward.
 *
 * SAFETY (both required for writes):
 *   PROD_PROTECT=false
 *   BACKFILL_MILESTONE_CATCHUP_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP
 *
 * Optional:
 *   ALLOW_PRODUCTION_DB=true  — when MONGO_URI database name is uk_trade
 *
 * Flags:
 *   --dry-run              — report only, no wallet/event writes, no user flags
 *   --user-code USRIWHLVT  — process a single user (still requires confirm unless dry-run)
 *
 * Payout per milestone k:
 *   considerableAmount = earner's greatest active package principal
 *   payout = min(4% of that amount, same cap base) — same per-event cap as live matching
 *
 * Idempotency: matching:milestone-catchup:{k}:{earnerUserId}
 *
 * Run from uk-trade-backend (API stopped):
 *   PROD_PROTECT=false BACKFILL_MILESTONE_CATCHUP_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     node scripts/backfill-matching-milestone-catchup.js --dry-run
 *
 *   PROD_PROTECT=false BACKFILL_MILESTONE_CATCHUP_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     node scripts/backfill-matching-milestone-catchup.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const {
  User,
  MatchingIncomeEvent,
  PackageSubscription,
  TreeNode,
} = require('../src/models');
const {
  calculateMatchingPayout,
  MAX_MATCHING_LEVEL,
} = require('../src/services/matching.service');
const {
  collectDownlineDescendants,
  buildMatchingWindowSummary,
  getPurchasedUserIdSet,
} = require('../src/services/tree.service');
const { getMaxActivePackageAmount } = require('../src/services/sponsor.service');
const { creditWallet } = require('../src/services/wallet.service');
const { isNetworkParticipant } = require('../src/utils/network-participant');
const { logger } = require('../src/utils/logger');

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const userCodeArgIndex = args.indexOf('--user-code');
const SINGLE_USER_CODE =
  userCodeArgIndex >= 0 ? String(args[userCodeArgIndex + 1] || '').trim().toUpperCase() : '';

function assertBackfillAllowed() {
  if (DRY_RUN) return;
  if (env.prodProtectBlocksSeeding) {
    throw new Error('Backfill blocked: set PROD_PROTECT=false in the environment.');
  }
  const confirm = String(process.env.BACKFILL_MILESTONE_CATCHUP_CONFIRM || '').trim();
  if (confirm !== 'YES_I_HAVE_A_DATABASE_BACKUP') {
    throw new Error(
      'Backfill blocked: set BACKFILL_MILESTONE_CATCHUP_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP after taking a full MongoDB backup.'
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
  logger.info({ dbName, mongoUri: env.mongoUri }, 'milestone catch-up target database');
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error('Refusing to run on database "uk_trade" without ALLOW_PRODUCTION_DB=true.');
  }
  return dbName;
}

function buildCatchUpIdempotencyKey(earnerUserId, milestoneK) {
  return `matching:milestone-catchup:${milestoneK}:${String(earnerUserId)}`;
}

async function getAlreadyCreditedMilestones(earnerUserId) {
  const milestones = new Set();
  const rows = await MatchingIncomeEvent.find({
    earnerUserId,
    status: 'credited',
  })
    .select('leftActiveUserCount rightActiveUserCount idempotencyKey')
    .lean();

  for (const row of rows) {
    const key = String(row.idempotencyKey || '');
    if (key.startsWith('matching:milestone-catchup:')) {
      const k = Number(key.split(':')[2]);
      if (Number.isFinite(k) && k >= 1 && k <= MAX_MATCHING_LEVEL) milestones.add(k);
      continue;
    }
    const left = Number(row.leftActiveUserCount);
    const right = Number(row.rightActiveUserCount);
    if (left === right && left >= 1 && left <= MAX_MATCHING_LEVEL) milestones.add(left);
  }
  return milestones;
}

async function getEarnerAnchorSubscription(earnerUserId) {
  const subs = await PackageSubscription.find({ userId: earnerUserId, status: 'active' })
    .sort({ principalAmount: -1, purchaseAtUtc: -1 })
    .select('_id principalAmount')
    .lean();
  return subs[0] || null;
}

async function planCatchUpForUser(user) {
  const earnerUserId = user._id;
  const meNode = await TreeNode.findOne({ userId: earnerUserId }).lean();
  if (!meNode) {
    return { skipped: true, reason: 'no-tree-node', milestones: [], totalPayout: 0 };
  }

  const capBaseAmount = round2(await getMaxActivePackageAmount(earnerUserId));
  if (capBaseAmount <= 0) {
    return { skipped: true, reason: 'no-active-package', milestones: [], totalPayout: 0 };
  }

  const descendants = await collectDownlineDescendants(meNode.userId);
  const purchasedSet = await getPurchasedUserIdSet(descendants.map((d) => d.userId));
  const window = buildMatchingWindowSummary(meNode, descendants, purchasedSet);
  const maxK = Math.min(window.leftActiveTotal, window.rightActiveTotal);

  if (maxK <= 0) {
    return {
      skipped: true,
      reason: 'zero-matching-window-active',
      leftActive: window.leftActiveTotal,
      rightActive: window.rightActiveTotal,
      milestones: [],
      totalPayout: 0,
    };
  }

  const alreadyPaid = await getAlreadyCreditedMilestones(earnerUserId);
  const considerableAmount = capBaseAmount;
  const { payoutCreditedAmount, rawPayoutAmount } = calculateMatchingPayout({
    considerableAmount,
    matchingPercent: env.matchingIncomePercent,
    capBaseAmount,
  });

  if (payoutCreditedAmount <= 0) {
    return {
      skipped: true,
      reason: 'zero-payout-after-cap',
      leftActive: window.leftActiveTotal,
      rightActive: window.rightActiveTotal,
      milestones: [],
      totalPayout: 0,
    };
  }

  const anchorSub = await getEarnerAnchorSubscription(earnerUserId);
  if (!anchorSub) {
    return { skipped: true, reason: 'no-anchor-subscription', milestones: [], totalPayout: 0 };
  }

  const milestones = [];
  for (let k = 1; k <= maxK; k += 1) {
    if (alreadyPaid.has(k)) continue;
    milestones.push({
      k,
      idempotencyKey: buildCatchUpIdempotencyKey(earnerUserId, k),
      payoutCreditedAmount,
      rawPayoutAmount,
      considerableAmount,
      capBaseAmount,
      leftActiveAtCredit: k,
      rightActiveAtCredit: k,
      triggerSubscriptionId: anchorSub._id,
      triggerPurchaseAmount: considerableAmount,
    });
  }

  return {
    skipped: false,
    leftActive: window.leftActiveTotal,
    rightActive: window.rightActiveTotal,
    maxK,
    alreadyPaid: [...alreadyPaid].sort((a, b) => a - b),
    milestones,
    totalPayout: round2(milestones.reduce((s, m) => s + m.payoutCreditedAmount, 0)),
    perMilestonePayout: payoutCreditedAmount,
  };
}

async function applyCatchUpForUser(user, plan) {
  if (plan.skipped || !plan.milestones.length) {
    if (!DRY_RUN) {
      await User.updateOne({ _id: user._id }, { $set: { matchingMilestoneCatchUpDone: true } });
    }
    return { credited: 0, amount: 0 };
  }

  let credited = 0;
  let amount = 0;

  for (const m of plan.milestones) {
    const existing = await MatchingIncomeEvent.findOne({ idempotencyKey: m.idempotencyKey }).lean();
    if (existing) continue;

    if (DRY_RUN) {
      credited += 1;
      amount = round2(amount + m.payoutCreditedAmount);
      continue;
    }

    const event = await MatchingIncomeEvent.create({
      triggerPurchaseSubscriptionId: m.triggerSubscriptionId,
      triggerBuyerUserId: user._id,
      earnerUserId: user._id,
      triggerLevelFromEarner: m.k,
      matchingPercent: env.matchingIncomePercent,
      leftActiveUserCount: m.leftActiveAtCredit,
      rightActiveUserCount: m.rightActiveAtCredit,
      triggerPurchaseAmount: m.triggerPurchaseAmount,
      directLeftActivePurchaser: m.k >= 1,
      directRightActivePurchaser: m.k >= 1,
      hasDeeperActivePurchaser: m.k >= 2,
      considerableAmount: m.considerableAmount,
      rawPayoutAmount: m.rawPayoutAmount,
      capBaseAmount: m.capBaseAmount,
      capRemainingBeforeAmount: m.capBaseAmount,
      payoutCreditedAmount: m.payoutCreditedAmount,
      capRemainingAfterAmount: m.capBaseAmount,
      firstMatchingBeforeEvent: !user.firstMatchingDone,
      status: 'credited',
      reason: 'milestone-catchup-existing-users',
      idempotencyKey: m.idempotencyKey,
      metadata: {
        milestoneCatchUp: true,
        milestoneK: m.k,
        script: 'backfill-matching-milestone-catchup',
        leftActiveTotalAtRun: plan.leftActive,
        rightActiveTotalAtRun: plan.rightActive,
      },
    });

    await creditWallet({
      userId: user._id,
      amount: m.payoutCreditedAmount,
      contextType: 'matching_income',
      contextId: event._id,
      packageSubscriptionId: m.triggerSubscriptionId,
      notes: `Matching milestone catch-up ${m.k}-${m.k} (existing users one-time)`,
      metadata: {
        milestoneCatchUp: true,
        milestoneK: m.k,
        idempotencyKey: m.idempotencyKey,
      },
    });

    credited += 1;
    amount = round2(amount + m.payoutCreditedAmount);
  }

  const updates = { matchingMilestoneCatchUpDone: true };
  if (!user.firstMatchingDone && credited > 0) {
    updates.firstMatchingDone = true;
  }
  if (!DRY_RUN) {
    await User.updateOne({ _id: user._id }, { $set: updates });
  }

  return { credited, amount };
}

async function run() {
  assertBackfillAllowed();
  const dbName = assertDbTargetAllowed();

  const userQuery = {
    matchingMilestoneCatchUpDone: { $ne: true },
  };
  if (SINGLE_USER_CODE) {
    userQuery.userCode = SINGLE_USER_CODE;
  }

  const users = await User.find(userQuery).select('_id userCode name email firstMatchingDone role').lean();
  const participants = users.filter((u) => isNetworkParticipant(u));

  const report = {
    dryRun: DRY_RUN,
    dbName,
    singleUserCode: SINGLE_USER_CODE || null,
    usersScanned: participants.length,
    usersWithCatchUp: 0,
    totalMilestonesCredited: 0,
    totalAmountCredited: 0,
    perUser: [],
  };

  for (const user of participants) {
    const plan = await planCatchUpForUser(user);
    const result = await applyCatchUpForUser(user, plan);

    if (!plan.skipped && plan.milestones.length > 0) {
      report.usersWithCatchUp += 1;
    }
    report.totalMilestonesCredited += result.credited;
    report.totalAmountCredited = round2(report.totalAmountCredited + result.amount);

    if (!plan.skipped && (plan.milestones.length > 0 || plan.maxK > 0)) {
      report.perUser.push({
        userCode: user.userCode,
        name: user.name,
        email: user.email,
        leftActive: plan.leftActive,
        rightActive: plan.rightActive,
        maxK: plan.maxK,
        alreadyPaidMilestones: plan.alreadyPaid,
        newMilestones: plan.milestones.map((m) => m.k),
        perMilestonePayout: plan.perMilestonePayout,
        totalPayout: plan.totalPayout,
        credited: result.credited,
        creditedAmount: result.amount,
      });
    } else if (plan.skipped && SINGLE_USER_CODE) {
      report.perUser.push({
        userCode: user.userCode,
        name: user.name,
        skipped: true,
        reason: plan.reason,
        leftActive: plan.leftActive,
        rightActive: plan.rightActive,
      });
    }
  }

  report.perUser.sort((a, b) => (b.totalPayout || 0) - (a.totalPayout || 0));

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `milestone-catchup-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  logger.info(
    {
      dryRun: DRY_RUN,
      usersScanned: report.usersScanned,
      usersWithCatchUp: report.usersWithCatchUp,
      totalMilestonesCredited: report.totalMilestonesCredited,
      totalAmountCredited: report.totalAmountCredited,
      reportFile: outFile,
    },
    'backfill-matching-milestone-catchup completed'
  );

  if (SINGLE_USER_CODE && report.perUser[0]) {
    logger.info({ row: report.perUser[0] }, 'single-user milestone catch-up summary');
  }
}

module.exports = {
  buildCatchUpIdempotencyKey,
  getAlreadyCreditedMilestones,
  planCatchUpForUser,
};

if (require.main === module) {
  connectDb()
    .then(run)
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'backfill-matching-milestone-catchup failed');
      process.exit(1);
    });
}
