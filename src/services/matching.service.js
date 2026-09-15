const { env } = require('../config/env');
const { MatchingIncomeEvent, PackageSubscription, TreeNode, User } = require('../models');
const { ROLES } = require('../constants/roles');
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
/** Direct referrals #1–#10 (signup order) can trigger matching for their sponsor at any tree depth. */
const MAX_DIRECT_REFERRAL_MATCHING = 10;

function buildIdempotencyKey(triggerPurchaseSubscriptionId, earnerUserId) {
  return `matching:${String(triggerPurchaseSubscriptionId)}:${String(earnerUserId)}`;
}

/** When replaying history, stamp events/ledger at the trigger purchase time. */
function eventTimestamps(asOfUtc) {
  if (!asOfUtc) return {};
  const at = asOfUtc instanceof Date ? asOfUtc : new Date(asOfUtc);
  if (Number.isNaN(at.getTime())) return {};
  return { createdAt: at, updatedAt: at };
}

/** Live matching passes null; treat as now (not epoch — `new Date(null)` is 1970). */
function resolveAsOfUtc(asOfUtc) {
  if (asOfUtc == null) return new Date();
  const asOf = asOfUtc instanceof Date ? asOfUtc : new Date(asOfUtc);
  if (Number.isNaN(asOf.getTime())) return new Date();
  return asOf;
}

function isSubscriptionActiveAsOf(sub, asOfUtc) {
  const asOf = resolveAsOfUtc(asOfUtc);
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

async function isWithinFirstDirectReferrals(referrerUserId, buyerUserId) {
  if (!referrerUserId || !buyerUserId) return false;
  const first = await User.find({ referredBy: referrerUserId, role: ROLES.USER })
    .sort({ createdAt: 1, _id: 1 })
    .limit(MAX_DIRECT_REFERRAL_MATCHING)
    .select('_id')
    .lean();
  return first.some((row) => String(row._id) === String(buyerUserId));
}

async function resolveDirectReferralMatchingSponsor(triggerBuyerUserId) {
  const buyer = await User.findById(triggerBuyerUserId).select('referredBy role').lean();
  if (!buyer?.referredBy || buyer.role !== ROLES.USER) return null;
  const eligible = await isWithinFirstDirectReferrals(buyer.referredBy, triggerBuyerUserId);
  if (!eligible) return null;
  const sponsor = await User.findById(buyer.referredBy).select('_id role').lean();
  if (!sponsor || !isNetworkParticipant(sponsor)) return null;
  return sponsor._id;
}

/**
 * Earners for a purchase: up to 5 tree hops, plus the buyer's sponsor when the buyer
 * is one of that sponsor's first 10 direct referrals (any placement depth).
 */
async function collectMatchingEarnerIds(triggerBuyerUserId, triggerNode) {
  const earnerIds = [];
  const seen = new Set();

  let cursorParentUserId = triggerNode?.parentUserId;
  let hops = 1;
  while (cursorParentUserId && hops <= MAX_MATCHING_LEVEL) {
    const earnerNode = await TreeNode.findOne({ userId: cursorParentUserId }).lean();
    if (!earnerNode) break;
    const earnerUser = await User.findById(cursorParentUserId).select('_id role').lean();
    if (!earnerUser) break;
    if (isNetworkParticipant(earnerUser)) {
      const id = String(earnerUser._id);
      if (!seen.has(id)) {
        seen.add(id);
        earnerIds.push(earnerUser._id);
      }
    }
    cursorParentUserId = earnerNode.parentUserId;
    hops += 1;
  }

  const sponsorEarnerId = await resolveDirectReferralMatchingSponsor(triggerBuyerUserId);
  if (sponsorEarnerId && !seen.has(String(sponsorEarnerId))) {
    earnerIds.push(sponsorEarnerId);
  }

  return { earnerIds, sponsorEarnerId };
}

async function buildMatchingSnapshot({
  earnerNode,
  triggerBuyerUserId,
  triggerSubscriptionId,
  asOfUtc = null,
  matchedVolume = 0,
  firstMatchingDone = false,
  allowAnyTriggerDepth = false,
}) {
  const earnerLevel = Number(earnerNode.level || 0);
  const minLevel = earnerLevel + 1;
  const maxLevel = earnerLevel + MAX_MATCHING_LEVEL;

  const allDescendants = await collectDownlineDescendants(earnerNode.userId);
  const descendantsById = new Map(allDescendants.map((n) => [String(n.userId), n]));
  const triggerNode = descendantsById.get(String(triggerBuyerUserId));
  if (!triggerNode) return null;

  const triggerLevelFromEarner = Number(triggerNode.level || 0) - earnerLevel;
  if (triggerLevelFromEarner < 1) return null;
  if (!allowAnyTriggerDepth && triggerLevelFromEarner > MAX_MATCHING_LEVEL) return null;

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
    allowAnyTriggerDepth: Boolean(allowAnyTriggerDepth),
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
  skipEligibility = false,
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
      matchingTrigger:
        snapshot.allowAnyTriggerDepth && snapshot.triggerLevelFromEarner > MAX_MATCHING_LEVEL
          ? 'direct-referral-any-depth'
          : 'tree-level',
      ...(snapshot.catchUp ? { catchUp: 'direct-referral-any-depth' } : {}),
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
      ...eventTimestamps(asOfUtc),
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
    ...eventTimestamps(asOfUtc),
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
      createdAt: asOfUtc,
    });
    if (!skipEligibility) {
      const { recalculateEligibility } = require('./eligibility.service');
      await recalculateEligibility(earnerUser._id.toString(), null, { skipAutoWithdraw: true });
    }
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

  const { earnerIds, sponsorEarnerId } = await collectMatchingEarnerIds(triggerBuyerUserId, triggerNode);
  let processed = 0;
  let credited = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const earnerUserId of earnerIds) {
    const allowAnyTriggerDepth = Boolean(
      sponsorEarnerId && String(earnerUserId) === String(sponsorEarnerId)
    );
    const earnerNode = await TreeNode.findOne({ userId: earnerUserId }).lean();
    if (!earnerNode) continue;
    const earnerUser = await User.findById(earnerUserId)
      .select('_id firstMatchingDone matchingMatchedVolume role')
      .lean();
    if (!earnerUser || !isNetworkParticipant(earnerUser)) continue;

    const snapshot = await buildMatchingSnapshot({
      earnerNode,
      triggerBuyerUserId,
      triggerSubscriptionId: triggerPurchaseSubscriptionId,
      asOfUtc,
      matchedVolume: earnerUser.matchingMatchedVolume || 0,
      firstMatchingDone: earnerUser.firstMatchingDone,
      allowAnyTriggerDepth,
    });

    if (!snapshot) continue;
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

  return { processed, credited, skipped, duplicates };
}

function getMatchingReplayState(stateMap, earnerUserId) {
  const key = String(earnerUserId);
  if (!stateMap.has(key)) stateMap.set(key, { matched: 0, firstMatchingDone: false });
  return stateMap.get(key);
}

function applyMatchingEventToReplayState(stateMap, event) {
  if (!event) return;
  if (String(event.idempotencyKey || '').startsWith('matching:milestone-catchup:')) return;
  const s = getMatchingReplayState(stateMap, event.earnerUserId);
  const considerable = round2(event.considerableAmount);
  if (considerable > 0) s.matched = round2(s.matched + considerable);
  if (event.firstMatchingBeforeEvent) s.firstMatchingDone = true;
}

/**
 * Additive catch-up: credit sponsors who missed matching because a first-10 direct
 * referral bought while placed deeper than 5 levels. Existing events are never rewritten.
 *
 * Optional filter:
 *   earnerUserId | userCode — only credit that sponsor (pilot one user, then all).
 * Replay still walks all purchases so matched-volume state stays correct for the filter.
 */
async function catchUpDirectReferralAnyDepthMatching({
  dryRun = false,
  earnerUserId = null,
  userCode = null,
} = {}) {
  let filterEarnerId = earnerUserId ? String(earnerUserId) : null;
  let filterUserCode = userCode ? String(userCode).trim().toUpperCase() : null;
  if (filterUserCode && !filterEarnerId) {
    const earner = await User.findOne({ userCode: filterUserCode }).select('_id userCode').lean();
    if (!earner) {
      throw new Error(`User not found for userCode=${filterUserCode}`);
    }
    filterEarnerId = String(earner._id);
    filterUserCode = earner.userCode;
  }

  const subs = await PackageSubscription.find({}).sort({ purchaseAtUtc: 1, _id: 1 }).lean();
  const replayState = new Map();
  const creditedEarnerIds = new Set();
  const perEarner = new Map();
  const summary = {
    dryRun: Boolean(dryRun),
    filterUserCode: filterUserCode || null,
    filterEarnerId: filterEarnerId || null,
    subscriptionsScanned: subs.length,
    considered: 0,
    credited: 0,
    skipped: 0,
    duplicates: 0,
    payoutTotal: 0,
    rows: [],
  };

  const bumpEarner = (earnerId, payout) => {
    const key = String(earnerId);
    const row = perEarner.get(key) || { earnerUserId: key, credited: 0, payout: 0 };
    row.credited += 1;
    row.payout = round2(row.payout + payout);
    perEarner.set(key, row);
  };

  for (const sub of subs) {
    const existing = await MatchingIncomeEvent.find({ triggerPurchaseSubscriptionId: sub._id }).lean();
    for (const event of existing) applyMatchingEventToReplayState(replayState, event);

    const triggerNode = await TreeNode.findOne({ userId: sub.userId }).lean();
    if (!triggerNode) continue;

    const sponsorEarnerId = await resolveDirectReferralMatchingSponsor(sub.userId);
    if (!sponsorEarnerId) continue;
    if (filterEarnerId && String(sponsorEarnerId) !== filterEarnerId) continue;

    const earnerNode = await TreeNode.findOne({ userId: sponsorEarnerId }).lean();
    if (!earnerNode) continue;

    const already = existing.find((e) => String(e.earnerUserId) === String(sponsorEarnerId));
    const relativeLevel = Number(triggerNode.level || 0) - Number(earnerNode.level || 0);
    if (already) {
      if (relativeLevel > MAX_MATCHING_LEVEL) summary.duplicates += 1;
      continue;
    }

    const snapshot = await buildMatchingSnapshot({
      earnerNode,
      triggerBuyerUserId: sub.userId,
      triggerSubscriptionId: sub._id,
      asOfUtc: sub.purchaseAtUtc,
      allowAnyTriggerDepth: true,
    });
    if (!snapshot) continue;
    if (snapshot.triggerLevelFromEarner <= MAX_MATCHING_LEVEL) continue;

    snapshot.catchUp = true;
    summary.considered += 1;

    const earnerUser = await User.findById(sponsorEarnerId)
      .select('_id firstMatchingDone matchingMatchedVolume role userCode name')
      .lean();
    if (!earnerUser || !isNetworkParticipant(earnerUser)) continue;

    const replay = getMatchingReplayState(replayState, sponsorEarnerId);
    const earnerForCalc = {
      ...earnerUser,
      firstMatchingDone: replay.firstMatchingDone,
      matchingMatchedVolume: replay.matched,
    };
    const triggerPurchaseAmount = round2(sub.principalAmount || 0);

    if (dryRun) {
      const calc = calculateConsiderable({
        V: triggerPurchaseAmount,
        leftVolume: snapshot.leftVolumeBefore,
        rightVolume: snapshot.rightVolumeBefore,
        matched: replay.matched,
        legAtEarner: snapshot.legAtEarner,
        firstMatchingDone: replay.firstMatchingDone,
        parentAmount: snapshot.parentAmount,
      });
      const capBaseAmount = round2(await getMaxActivePackageAmountAsOf(sponsorEarnerId, sub.purchaseAtUtc));
      const payoutResult = calculateMatchingPayout({
        considerableAmount: calc.considerable,
        matchingPercent: env.matchingIncomePercent,
        maxPackageAmount: capBaseAmount,
        capThreshold: env.matchingPackageCapThreshold,
      });
      const wouldCredit = capBaseAmount > 0 && payoutResult.payoutCreditedAmount > 0 && calc.considerable > 0;
      applyMatchingEventToReplayState(replayState, {
        earnerUserId: sponsorEarnerId,
        idempotencyKey: buildIdempotencyKey(sub._id, sponsorEarnerId),
        considerableAmount: calc.considerable,
        firstMatchingBeforeEvent: !replay.firstMatchingDone,
      });
      if (wouldCredit) {
        summary.credited += 1;
        summary.payoutTotal = round2(summary.payoutTotal + payoutResult.payoutCreditedAmount);
        bumpEarner(sponsorEarnerId, payoutResult.payoutCreditedAmount);
        summary.rows.push({
          earnerUserCode: earnerUser.userCode,
          earnerName: earnerUser.name,
          triggerPurchaseSubscriptionId: String(sub._id),
          triggerLevelFromEarner: snapshot.triggerLevelFromEarner,
          considerableAmount: calc.considerable,
          payoutCreditedAmount: payoutResult.payoutCreditedAmount,
          status: 'credited',
        });
      } else {
        summary.skipped += 1;
      }
      continue;
    }

    const result = await createEventAndMaybeCredit({
      triggerPurchaseSubscriptionId: sub._id,
      triggerBuyerUserId: sub.userId,
      triggerPurchaseAmount,
      earnerUser: earnerForCalc,
      snapshot,
      asOfUtc: sub.purchaseAtUtc,
      skipEligibility: true,
    });
    applyMatchingEventToReplayState(replayState, result.event);

    if (result.status === 'credited') {
      summary.credited += 1;
      const payout = round2(result.event.payoutCreditedAmount);
      summary.payoutTotal = round2(summary.payoutTotal + payout);
      creditedEarnerIds.add(String(sponsorEarnerId));
      bumpEarner(sponsorEarnerId, payout);
      summary.rows.push({
        earnerUserCode: earnerUser.userCode,
        earnerName: earnerUser.name,
        triggerPurchaseSubscriptionId: String(sub._id),
        triggerLevelFromEarner: snapshot.triggerLevelFromEarner,
        considerableAmount: result.event.considerableAmount,
        payoutCreditedAmount: payout,
        status: 'credited',
      });
    } else if (result.status === 'duplicate') {
      summary.duplicates += 1;
    } else {
      summary.skipped += 1;
    }
  }

  if (!dryRun && creditedEarnerIds.size) {
    const { recalculateEligibilityForUsers } = require('./eligibility.service');
    await recalculateEligibilityForUsers(creditedEarnerIds, null, { skipAutoWithdraw: true });
  }

  summary.earners = [...perEarner.values()].sort((a, b) => b.payout - a.payout);
  return summary;
}

/**
 * Re-run matching for a purchase whose events were miscomputed (e.g. null-asOfUtc zero volumes).
 * Deletes skipped zero-considerable events for that subscription, then replays at purchase time.
 */
async function reprocessMatchingForSubscription({ triggerPurchaseSubscriptionId, dryRun = false } = {}) {
  if (!triggerPurchaseSubscriptionId) {
    throw new Error('triggerPurchaseSubscriptionId is required');
  }
  const sub = await PackageSubscription.findById(triggerPurchaseSubscriptionId).lean();
  if (!sub) throw new Error('Package subscription not found');

  const miscomputedFilter = {
    triggerPurchaseSubscriptionId,
    status: 'skipped',
    reason: 'zero-considerable',
    leftVolumeBefore: 0,
    rightVolumeBefore: 0,
  };
  const toRemove = await MatchingIncomeEvent.find(miscomputedFilter).lean();

  if (dryRun) {
    return {
      dryRun: true,
      triggerPurchaseSubscriptionId: String(triggerPurchaseSubscriptionId),
      eventsToRemove: toRemove.length,
      earnersAffected: [...new Set(toRemove.map((e) => String(e.earnerUserId)))],
    };
  }

  if (toRemove.length) {
    await MatchingIncomeEvent.deleteMany({ _id: { $in: toRemove.map((e) => e._id) } });
  }

  const replay = await creditMatchingOnPurchase({
    triggerBuyerUserId: sub.userId,
    triggerPurchaseSubscriptionId: sub._id,
    asOfUtc: sub.purchaseAtUtc,
  });

  return {
    eventsRemoved: toRemove.length,
    replay,
  };
}

module.exports = {
  creditMatchingOnPurchase,
  reprocessMatchingForSubscription,
  MAX_MATCHING_LEVEL,
  MAX_DIRECT_REFERRAL_MATCHING,
  isWithinFirstDirectReferrals,
  collectMatchingEarnerIds,
  catchUpDirectReferralAnyDepthMatching,
  buildIdempotencyKey,
  calculateMatchingPayout,
  calculateConsiderable,
  splitByFirstBranch,
  isSubscriptionActiveAsOf,
  resolveAsOfUtc,
  getActivePackageHoldersByUserIds,
  getMaxActivePackageAmountAsOf,
  sumActivePrincipalForUserIdsAsOf,
  buildMatchingSnapshot,
  getRelativeTreeSnapshot,
};
