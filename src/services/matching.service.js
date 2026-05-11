const { env } = require('../config/env');
const { MatchingIncomeEvent, PackageSubscription, TreeNode, User } = require('../models');
const { isNetworkParticipant } = require('../utils/network-participant');
const { creditWallet } = require('./wallet.service');
const { getMaxActivePackageAmount } = require('./sponsor.service');
const { collectDownlineDescendants } = require('./tree.service');

const MAX_MATCHING_LEVEL = 5;

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildIdempotencyKey(triggerPurchaseSubscriptionId, earnerUserId) {
  return `matching:${String(triggerPurchaseSubscriptionId)}:${String(earnerUserId)}`;
}

function calculateMatchingPayout({ considerableAmount, matchingPercent, capBaseAmount, alreadyPaidAmount }) {
  const rawPayoutAmount = round2((Number(considerableAmount || 0) * Number(matchingPercent || 0)) / 100);
  const capRemainingBeforeAmount = round2(Math.max(0, Number(capBaseAmount || 0) - Number(alreadyPaidAmount || 0)));
  const payoutCreditedAmount = round2(Math.min(rawPayoutAmount, capRemainingBeforeAmount));
  const capRemainingAfterAmount = round2(Math.max(0, capRemainingBeforeAmount - payoutCreditedAmount));
  return { rawPayoutAmount, capRemainingBeforeAmount, payoutCreditedAmount, capRemainingAfterAmount };
}

async function getActivePackageHoldersByUserIds(userIds) {
  if (!userIds.length) return new Set();
  const rows = await PackageSubscription.aggregate([
    { $match: { userId: { $in: userIds }, status: 'active' } },
    { $group: { _id: '$userId' } },
  ]);
  return new Set(rows.map((r) => String(r._id)));
}

function splitByFirstBranch(rootUserId, descendants) {
  const byParent = new Map();
  for (const node of descendants) {
    const parentKey = String(node.parentUserId || '');
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey).push(node);
  }
  const rootChildren = byParent.get(String(rootUserId)) || [];
  const result = { left: [], right: [] };
  for (const child of rootChildren) {
    const sideKey = child.side === 'right' ? 'right' : 'left';
    const stack = [child];
    while (stack.length) {
      const current = stack.pop();
      result[sideKey].push(current);
      const children = byParent.get(String(current.userId)) || [];
      for (const c of children) stack.push(c);
    }
  }
  return result;
}

async function getRelativeTreeSnapshot(earnerNode, triggerBuyerUserId) {
  const minLevel = Number(earnerNode.level || 0) + 1;
  const maxLevel = Number(earnerNode.level || 0) + MAX_MATCHING_LEVEL;
  const descendants = (await collectDownlineDescendants(earnerNode.userId)).filter(
    (n) => Number(n.level || 0) >= minLevel && Number(n.level || 0) <= maxLevel
  );

  const split = splitByFirstBranch(earnerNode.userId, descendants);
  const descendantsById = new Map(descendants.map((n) => [String(n.userId), n]));
  const triggerNode = descendantsById.get(String(triggerBuyerUserId));
  if (!triggerNode) return null;

  const triggerLevelFromEarner = Number(triggerNode.level || 0) - Number(earnerNode.level || 0);
  if (triggerLevelFromEarner < 1 || triggerLevelFromEarner > MAX_MATCHING_LEVEL) return null;

  const allUserIds = descendants.map((n) => n.userId);
  const activeHolders = await getActivePackageHoldersByUserIds(allUserIds);

  const leftActiveUserCount = split.left.filter((n) => activeHolders.has(String(n.userId))).length;
  const rightActiveUserCount = split.right.filter((n) => activeHolders.has(String(n.userId))).length;

  const levelNodes = descendants.filter((n) => Number(n.level || 0) === Number(triggerNode.level || 0));
  const levelUsers = levelNodes.filter((n) => activeHolders.has(String(n.userId))).map((n) => n.userId);

  return { triggerLevelFromEarner, leftActiveUserCount, rightActiveUserCount, levelUsers };
}

async function getTotalMatchingPaid(earnerUserId) {
  const row = await MatchingIncomeEvent.aggregate([
    { $match: { earnerUserId, status: 'credited' } },
    { $group: { _id: null, total: { $sum: '$payoutCreditedAmount' } } },
  ]);
  return row.length ? round2(row[0].total) : 0;
}

async function createEventAndMaybeCredit({
  triggerPurchaseSubscriptionId,
  triggerBuyerUserId,
  earnerUser,
  snapshot,
}) {
  const idempotencyKey = buildIdempotencyKey(triggerPurchaseSubscriptionId, earnerUser._id);
  const existing = await MatchingIncomeEvent.findOne({ idempotencyKey });
  if (existing) return { status: 'duplicate', event: existing };

  const firstMatchingBeforeEvent = !earnerUser.firstMatchingDone;
  const eventBase = {
    triggerPurchaseSubscriptionId,
    triggerBuyerUserId,
    earnerUserId: earnerUser._id,
    triggerLevelFromEarner: snapshot.triggerLevelFromEarner,
    matchingPercent: env.matchingIncomePercent,
    leftActiveUserCount: snapshot.leftActiveUserCount,
    rightActiveUserCount: snapshot.rightActiveUserCount,
    firstMatchingBeforeEvent,
    idempotencyKey,
  };

  if (snapshot.leftActiveUserCount !== snapshot.rightActiveUserCount) {
    const event = await MatchingIncomeEvent.create({
      ...eventBase,
      status: 'skipped',
      reason: 'left-right-active-count-not-equal',
    });
    return { status: 'skipped', event };
  }

  const levelUserMaxValues = await Promise.all(snapshot.levelUsers.map((uid) => getMaxActivePackageAmount(uid)));
  const considerableAmount = round2(Math.max(0, ...levelUserMaxValues));
  if (considerableAmount <= 0) {
    const event = await MatchingIncomeEvent.create({
      ...eventBase,
      status: 'skipped',
      reason: 'no-active-package-on-trigger-level',
      considerableAmount: 0,
    });
    return { status: 'skipped', event };
  }

  const capBaseAmount = round2(await getMaxActivePackageAmount(earnerUser._id));
  const totalPaid = await getTotalMatchingPaid(earnerUser._id);
  const capRemainingBeforeAmount = round2(Math.max(0, capBaseAmount - totalPaid));
  const { rawPayoutAmount, payoutCreditedAmount, capRemainingAfterAmount } = calculateMatchingPayout({
    considerableAmount,
    matchingPercent: env.matchingIncomePercent,
    capBaseAmount,
    alreadyPaidAmount: totalPaid,
  });

  let reason = 'matching-income-credited';
  let status = 'credited';
  if (capRemainingBeforeAmount <= 0 || payoutCreditedAmount <= 0) {
    status = 'skipped';
    reason = 'no-remaining-cap';
  }

  const event = await MatchingIncomeEvent.create({
    ...eventBase,
    status,
    reason,
    considerableAmount,
    rawPayoutAmount,
    capBaseAmount,
    capRemainingBeforeAmount,
    payoutCreditedAmount,
    capRemainingAfterAmount,
    metadata: { levelUserCount: snapshot.levelUsers.length },
  });

  if (status === 'credited') {
    await creditWallet({
      userId: earnerUser._id,
      amount: payoutCreditedAmount,
      contextType: 'matching_income',
      contextId: event._id,
      packageSubscriptionId: triggerPurchaseSubscriptionId,
      notes: `Matching income credit on trigger purchase ${String(triggerPurchaseSubscriptionId)}`,
      metadata: {
        eventId: event._id,
        triggerBuyerUserId: String(triggerBuyerUserId),
        triggerLevelFromEarner: snapshot.triggerLevelFromEarner,
        considerableAmount,
        matchingPercent: env.matchingIncomePercent,
      },
    });
    if (!earnerUser.firstMatchingDone) {
      await User.updateOne({ _id: earnerUser._id, firstMatchingDone: false }, { $set: { firstMatchingDone: true } });
    }
  }

  return { status, event };
}

async function creditMatchingOnPurchase({ triggerBuyerUserId, triggerPurchaseSubscriptionId }) {
  if (!env.matchingIncomeEnabled) return { processed: 0, credited: 0, skipped: 0, duplicates: 0 };
  const triggerNode = await TreeNode.findOne({ userId: triggerBuyerUserId }).lean();
  if (!triggerNode) return { processed: 0, credited: 0, skipped: 0, duplicates: 0 };

  let cursorParentUserId = triggerNode.parentUserId;
  let hops = 1;
  let processed = 0;
  let credited = 0;
  let skipped = 0;
  let duplicates = 0;

  while (cursorParentUserId && hops <= MAX_MATCHING_LEVEL) {
    const earnerNode = await TreeNode.findOne({ userId: cursorParentUserId }).lean();
    if (!earnerNode) break;
    const earnerUser = await User.findById(cursorParentUserId).select('_id firstMatchingDone role').lean();
    if (!earnerUser) break;

    if (!isNetworkParticipant(earnerUser)) {
      cursorParentUserId = earnerNode.parentUserId;
      hops += 1;
      continue;
    }

    const snapshot = await getRelativeTreeSnapshot(earnerNode, triggerBuyerUserId);
    if (snapshot) {
      processed += 1;
      const result = await createEventAndMaybeCredit({
        triggerPurchaseSubscriptionId,
        triggerBuyerUserId,
        earnerUser,
        snapshot,
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
  splitByFirstBranch,
};
