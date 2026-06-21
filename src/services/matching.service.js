const { env } = require('../config/env');
const { MatchingIncomeEvent, PackageSubscription, TreeNode, User } = require('../models');
const { isNetworkParticipant } = require('../utils/network-participant');
const { creditWallet } = require('./wallet.service');
const { getMaxActivePackageAmount } = require('./sponsor.service');
const { collectDownlineDescendants } = require('./tree.service');
const {
  round2,
  splitByFirstBranch,
  determineLegAtEarner,
  calculateConsiderable,
  calculateMatchingPayout,
} = require('./matching-engine');

const MAX_MATCHING_LEVEL = 5;

function buildIdempotencyKey(triggerPurchaseSubscriptionId, earnerUserId) {
  return `matching:${String(triggerPurchaseSubscriptionId)}:${String(earnerUserId)}`;
}

function isSubscriptionActiveAsOf(sub, asOfUtc) {
  const asOf = asOfUtc instanceof Date ? asOfUtc : new Date(asOfUtc);
  const purchased = sub.purchaseAtUtc ? new Date(sub.purchaseAtUtc) : null;
  if (!purchased || purchased.getTime() > asOf.getTime()) return false;
  if (sub.status === 'active') return true;
  if (sub.status === 'completed') {
    const completedAt = sub.completedAtUtc ? new Date(sub.completedAtUtc) : null;
    return completedAt && completedAt.getTime() > asOf.getTime();
  }
  return false;
}

async function getActivePackageHoldersByUserIds(userIds, asOfUtc = null) {
  if (!userIds.length) return new Set();
  if (!asOfUtc) {
    const rows = await PackageSubscription.aggregate([
      { $match: { userId: { $in: userIds }, status: 'active' } },
      { $group: { _id: '$userId' } },
    ]);
    return new Set(rows.map((r) => String(r._id)));
  }

  const subs = await PackageSubscription.find({ userId: { $in: userIds } }).lean();
  const active = new Set();
  for (const sub of subs) {
    if (isSubscriptionActiveAsOf(sub, asOfUtc)) active.add(String(sub.userId));
  }
  return active;
}

async function sumActivePrincipalForUserIdsAsOf(userIds, asOfUtc, excludeSubscriptionId = null) {
  if (!userIds.length) return 0;
  const subs = await PackageSubscription.find({ userId: { $in: userIds } }).lean();
  let total = 0;
  const excludeId = excludeSubscriptionId ? String(excludeSubscriptionId) : null;
  for (const sub of subs) {
    if (excludeId && String(sub._id) === excludeId) continue;
    if (isSubscriptionActiveAsOf(sub, asOfUtc)) {
      total += Number(sub.principalAmount || 0);
    }
  }
  return round2(total);
}

async function getMaxActivePackageAmountAsOf(userId, asOfUtc) {
  if (!asOfUtc) return getMaxActivePackageAmount(userId);
  const subs = await PackageSubscription.find({ userId }).lean();
  const amounts = subs.filter((s) => isSubscriptionActiveAsOf(s, asOfUtc)).map((s) => s.principalAmount);
  if (!amounts.length) return 0;
  return Math.max(...amounts);
}

async function buildMatchingSnapshot({
  earnerNode,
  triggerBuyerUserId,
  triggerSubscriptionId,
  asOfUtc = null,
  matchedVolume = 0,
  firstMatchingDone = false,
}) {
  const earnerLevel = Number(earnerNode.level || 0);
  const minLevel = earnerLevel + 1;
  const maxLevel = earnerLevel + MAX_MATCHING_LEVEL;

  const allDescendants = await collectDownlineDescendants(earnerNode.userId);
  const descendantsById = new Map(allDescendants.map((n) => [String(n.userId), n]));
  const triggerNode = descendantsById.get(String(triggerBuyerUserId));
  if (!triggerNode) return null;

  const triggerLevelFromEarner = Number(triggerNode.level || 0) - earnerLevel;
  if (triggerLevelFromEarner < 1 || triggerLevelFromEarner > MAX_MATCHING_LEVEL) return null;

  const split = splitByFirstBranch(earnerNode.userId, allDescendants);
  const legAtEarner = determineLegAtEarner(triggerBuyerUserId, split);
  if (!legAtEarner) return null;

  const leftUserIds = split.left.map((n) => n.userId);
  const rightUserIds = split.right.map((n) => n.userId);

  const leftVolumeBefore = await sumActivePrincipalForUserIdsAsOf(
    leftUserIds,
    asOfUtc,
    triggerSubscriptionId
  );
  const rightVolumeBefore = await sumActivePrincipalForUserIdsAsOf(
    rightUserIds,
    asOfUtc,
    triggerSubscriptionId
  );

  const triggerParentNode = triggerNode.parentUserId
    ? descendantsById.get(String(triggerNode.parentUserId)) ||
      (await TreeNode.findOne({ userId: triggerNode.parentUserId }).lean())
    : null;
  let parentAmount = 0;
  if (triggerParentNode) {
    parentAmount = await sumActivePrincipalForUserIdsAsOf(
      [triggerParentNode.userId],
      asOfUtc,
      triggerSubscriptionId
    );
  }

  const windowDescendants = allDescendants.filter(
    (n) => Number(n.level || 0) >= minLevel && Number(n.level || 0) <= maxLevel
  );
  const windowSplit = splitByFirstBranch(earnerNode.userId, windowDescendants);
  const windowUserIds = windowDescendants.map((n) => n.userId);
  const activeHolders = await getActivePackageHoldersByUserIds(windowUserIds, asOfUtc);
  const leftActiveUserCount = windowSplit.left.filter((n) => activeHolders.has(String(n.userId))).length;
  const rightActiveUserCount = windowSplit.right.filter((n) => activeHolders.has(String(n.userId))).length;

  return {
    triggerLevelFromEarner,
    legAtEarner,
    leftVolumeBefore,
    rightVolumeBefore,
    matchedVolumeBefore: round2(matchedVolume),
    firstMatchingDone,
    parentAmount,
    leftActiveUserCount,
    rightActiveUserCount,
  };
}

/** @deprecated Use buildMatchingSnapshot — kept for backfill script compatibility during transition */
async function getRelativeTreeSnapshot(earnerNode, triggerBuyerUserId, asOfUtc = null) {
  return buildMatchingSnapshot({
    earnerNode,
    triggerBuyerUserId,
    triggerSubscriptionId: null,
    asOfUtc,
  });
}

async function createEventAndMaybeCredit({
  triggerPurchaseSubscriptionId,
  triggerBuyerUserId,
  triggerPurchaseAmount,
  earnerUser,
  snapshot,
  asOfUtc = null,
}) {
  const idempotencyKey = buildIdempotencyKey(triggerPurchaseSubscriptionId, earnerUser._id);
  const existing = await MatchingIncomeEvent.findOne({ idempotencyKey });
  if (existing) return { status: 'duplicate', event: existing };

  const firstMatchingBeforeEvent = !earnerUser.firstMatchingDone;
  const matchedVolumeBefore = round2(earnerUser.matchingMatchedVolume || 0);

  const calc = calculateConsiderable({
    V: triggerPurchaseAmount,
    leftVolume: snapshot.leftVolumeBefore,
    rightVolume: snapshot.rightVolumeBefore,
    matched: matchedVolumeBefore,
    legAtEarner: snapshot.legAtEarner,
    firstMatchingDone: earnerUser.firstMatchingDone,
    parentAmount: snapshot.parentAmount,
  });

  const considerableAmount = calc.considerable;
  const matchedVolumeAfter = calc.matchedAfter;

  const eventBase = {
    triggerPurchaseSubscriptionId,
    triggerBuyerUserId,
    earnerUserId: earnerUser._id,
    triggerLevelFromEarner: snapshot.triggerLevelFromEarner,
    matchingPercent: env.matchingIncomePercent,
    leftActiveUserCount: snapshot.leftActiveUserCount || 0,
    rightActiveUserCount: snapshot.rightActiveUserCount || 0,
    leftVolumeBefore: snapshot.leftVolumeBefore,
    rightVolumeBefore: snapshot.rightVolumeBefore,
    matchedVolumeBefore,
    matchedVolumeAfter,
    legAtEarner: snapshot.legAtEarner,
    parentAmount: snapshot.parentAmount,
    packageCapThreshold: env.matchingPackageCapThreshold,
    firstMatchingBeforeEvent,
    triggerPurchaseAmount: round2(triggerPurchaseAmount),
    idempotencyKey,
    metadata: {
      considerableRule: calc.rule,
    },
  };

  if (considerableAmount <= 0) {
    await updateEarnerMatchingState({
      earnerUserId: earnerUser._id,
      considerableAmount: 0,
      firstMatchingBeforeEvent,
      firstMatchingDoneAfter: calc.firstMatchingDoneAfter,
    });
    const event = await MatchingIncomeEvent.create({
      ...eventBase,
      status: 'skipped',
      reason: 'zero-considerable',
      considerableAmount: 0,
      rawPayoutAmount: 0,
      capBaseAmount: 0,
      packageCapApplied: false,
      capRemainingBeforeAmount: 0,
      payoutCreditedAmount: 0,
      capRemainingAfterAmount: 0,
    });
    return { status: 'skipped', event };
  }

  const capBaseAmount = round2(await getMaxActivePackageAmountAsOf(earnerUser._id, asOfUtc));
  const payoutResult = calculateMatchingPayout({
    considerableAmount,
    matchingPercent: env.matchingIncomePercent,
    maxPackageAmount: capBaseAmount,
    capThreshold: env.matchingPackageCapThreshold,
  });

  let reason = 'matching-income-credited';
  let status = 'credited';
  if (capBaseAmount <= 0) {
    status = 'skipped';
    reason = 'earner-has-no-active-package';
  } else if (payoutResult.payoutCreditedAmount <= 0) {
    status = 'skipped';
    reason = 'zero-payout-after-cap';
  }

  const event = await MatchingIncomeEvent.create({
    ...eventBase,
    status,
    reason,
    considerableAmount,
    rawPayoutAmount: payoutResult.rawPayoutAmount,
    capBaseAmount,
    packageCapApplied: payoutResult.packageCapApplied,
    capRemainingBeforeAmount: payoutResult.capRemainingBeforeAmount,
    payoutCreditedAmount: payoutResult.payoutCreditedAmount,
    capRemainingAfterAmount: payoutResult.capRemainingAfterAmount,
  });

  await updateEarnerMatchingState({
    earnerUserId: earnerUser._id,
    considerableAmount,
    firstMatchingBeforeEvent,
    firstMatchingDoneAfter: calc.firstMatchingDoneAfter,
  });

  if (status === 'credited') {
    const triggerBuyer = await User.findById(triggerBuyerUserId).select('name userCode').lean();
    const sourceName = triggerBuyer?.name || 'Member';
    const sourceUserCode = triggerBuyer?.userCode || '';
    const sourceNote = sourceUserCode ? `${sourceName} (${sourceUserCode})` : sourceName;
    await creditWallet({
      userId: earnerUser._id,
      amount: payoutResult.payoutCreditedAmount,
      contextType: 'matching_income',
      contextId: event._id,
      packageSubscriptionId: triggerPurchaseSubscriptionId,
      notes: `Matching income from ${sourceNote} purchase`,
      metadata: {
        triggerLevelFromEarner: snapshot.triggerLevelFromEarner,
        considerableAmount,
        matchingPercent: env.matchingIncomePercent,
        sourceName,
        sourceUserCode: sourceUserCode || undefined,
        legAtEarner: snapshot.legAtEarner,
      },
    });
  }

  return { status, event };
}

async function updateEarnerMatchingState({
  earnerUserId,
  considerableAmount,
  firstMatchingBeforeEvent,
  firstMatchingDoneAfter,
}) {
  const update = {};
  if (considerableAmount > 0) {
    update.$inc = { matchingMatchedVolume: considerableAmount };
  }
  if (firstMatchingBeforeEvent && firstMatchingDoneAfter) {
    update.$set = { ...(update.$set || {}), firstMatchingDone: true };
  }
  if (Object.keys(update).length) {
    await User.updateOne({ _id: earnerUserId }, update);
  }
}

async function creditMatchingOnPurchase({ triggerBuyerUserId, triggerPurchaseSubscriptionId, asOfUtc = null }) {
  if (!env.matchingIncomeEnabled) return { processed: 0, credited: 0, skipped: 0, duplicates: 0 };
  const triggerNode = await TreeNode.findOne({ userId: triggerBuyerUserId }).lean();
  if (!triggerNode) return { processed: 0, credited: 0, skipped: 0, duplicates: 0 };

  const triggerSub = await PackageSubscription.findById(triggerPurchaseSubscriptionId)
    .select('principalAmount')
    .lean();
  const triggerPurchaseAmount = round2(triggerSub?.principalAmount || 0);

  let cursorParentUserId = triggerNode.parentUserId;
  let hops = 1;
  let processed = 0;
  let credited = 0;
  let skipped = 0;
  let duplicates = 0;

  while (cursorParentUserId && hops <= MAX_MATCHING_LEVEL) {
    const earnerNode = await TreeNode.findOne({ userId: cursorParentUserId }).lean();
    if (!earnerNode) break;
    const earnerUser = await User.findById(cursorParentUserId)
      .select('_id firstMatchingDone matchingMatchedVolume role')
      .lean();
    if (!earnerUser) break;

    if (!isNetworkParticipant(earnerUser)) {
      cursorParentUserId = earnerNode.parentUserId;
      hops += 1;
      continue;
    }

    const snapshot = await buildMatchingSnapshot({
      earnerNode,
      triggerBuyerUserId,
      triggerSubscriptionId: triggerPurchaseSubscriptionId,
      asOfUtc,
      matchedVolume: earnerUser.matchingMatchedVolume || 0,
      firstMatchingDone: earnerUser.firstMatchingDone,
    });

    if (snapshot) {
      processed += 1;
      const result = await createEventAndMaybeCredit({
        triggerPurchaseSubscriptionId,
        triggerBuyerUserId,
        triggerPurchaseAmount,
        earnerUser,
        snapshot,
        asOfUtc,
      });
      if (result.status === 'credited') credited += 1;
      else if (result.status === 'duplicate') duplicates += 1;
      else skipped += 1;
    }

    cursorParentUserId = earnerNode.parentUserId;
    hops += 1;
  }

  return { processed, credited, skipped, duplicates };
}

module.exports = {
  creditMatchingOnPurchase,
  MAX_MATCHING_LEVEL,
  buildIdempotencyKey,
  calculateMatchingPayout,
  calculateConsiderable,
  splitByFirstBranch,
  isSubscriptionActiveAsOf,
  getActivePackageHoldersByUserIds,
  getMaxActivePackageAmountAsOf,
  sumActivePrincipalForUserIdsAsOf,
  buildMatchingSnapshot,
  getRelativeTreeSnapshot,
};
