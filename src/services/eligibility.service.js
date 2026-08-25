const mongoose = require('mongoose');
const { addIstDays, toIstDateParts, istDateCompare } = require('../utils/date-utils');
const { PackageSubscription, TradeCreditEvent, WithdrawalRequest, Wallet, SponsorIncomeEvent, MatchingIncomeEvent, User } = require('../models');
const { getWalletOrThrow, reconcileEligibleBonusFromLedger } = require('./wallet.service');
const { matchingPaidByAdminForUserCode } = require('../constants/matching-paid-by-admin');

function firstDayAfterWithdrawalCycleK(withdrawalDay1Ist, W, cycleK) {
  return addIstDays(withdrawalDay1Ist, cycleK * W);
}

function cycleEndInclusive(withdrawalDay1Ist, W, cycleK) {
  return addIstDays(withdrawalDay1Ist, cycleK * W - 1);
}

/**
 * Gross trade income that is eligible to withdraw under W-cycle rules (BUSINESS-LOGIC §3.3–3.4),
 * before subtracting approved/pending withdrawals.
 */
function grossEligibleForSubscription(sub, plan, credits, todayIst) {
  if (!credits.length) return 0;
  const D0 = sub.withdrawalDay1Ist;
  const W = plan.cycleDaysW;
  const maxCycle = Math.max(...credits.map((c) => c.cycleNumber));
  const lastCreditIst = credits[credits.length - 1].creditDateIst;
  const isCompleted = sub.status === 'completed';
  const nominalEndLast = cycleEndInclusive(D0, W, maxCycle);
  const isPartialLastCycle = isCompleted && istDateCompare(lastCreditIst, nominalEndLast) < 0;

  let sum = 0;
  for (const c of credits) {
    const K = c.cycleNumber;
    let unlocked = false;
    if (isPartialLastCycle && K === maxCycle) {
      unlocked = true;
    } else {
      const gate = firstDayAfterWithdrawalCycleK(D0, W, K);
      unlocked = istDateCompare(todayIst, gate) >= 0;
    }
    if (unlocked) sum += c.amount;
  }
  return sum;
}

async function computeGrossEligibleTrade(userId, todayIst) {
  const subs = await PackageSubscription.find({ userId }).populate('planId');
  let total = 0;
  for (const sub of subs) {
    const credits = await TradeCreditEvent.find({ packageSubscriptionId: sub._id }).sort({ creditDateIst: 1 });
    total += grossEligibleForSubscription(sub, sub.planId, credits, todayIst);
  }
  return total;
}

/** Sponsor income credited to the wallet is always fully withdrawable (no W-cycle gates). */
async function computeTotalSponsorCredited(userId) {
  const uid = new mongoose.Types.ObjectId(userId);
  const rows = await SponsorIncomeEvent.aggregate([
    { $match: { referrerUserId: uid } },
    { $group: { _id: null, t: { $sum: '$creditedAmount' } } },
  ]);
  return Number(rows[0]?.t || 0);
}

/** Matching income credited to the wallet is always fully withdrawable (no W-cycle gates), same as sponsor. */
async function computeTotalMatchingCredited(userId) {
  const uid = new mongoose.Types.ObjectId(userId);
  const rows = await MatchingIncomeEvent.aggregate([
    { $match: { earnerUserId: uid, status: 'credited' } },
    { $group: { _id: null, t: { $sum: '$payoutCreditedAmount' } } },
  ]);
  return Number(rows[0]?.t || 0);
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

/**
 * Eligible = unlocked trade + sponsor + matching + leftover admin bonus
 *          − matching already paid via admin workaround − approved − pending.
 */
function computeNetEligibleToWithdraw({
  tradeGross = 0,
  sponsorGross = 0,
  matchingGross = 0,
  bonus = 0,
  matchingPaidByAdmin = 0,
  approved = 0,
  pending = 0,
} = {}) {
  const net =
    Number(tradeGross || 0) +
    Number(sponsorGross || 0) +
    Number(matchingGross || 0) +
    Number(bonus || 0) -
    Number(matchingPaidByAdmin || 0) -
    Number(approved || 0) -
    Number(pending || 0);
  return Math.max(0, roundMoney(net));
}

/**
 * Remaining sponsor/matching still sitting in Eligible after withdrawals.
 * Withdrawals consume unlocked trade first (auto-withdraw), then leftover admin bonus,
 * then sponsor, then matching — so leftover matching is not shown as still-available sponsor.
 */
function computeAvailableIncomeStreams({
  tradeGross = 0,
  sponsorGross = 0,
  matchingGross = 0,
  bonus = 0,
  matchingPaidByAdmin = 0,
  approved = 0,
  pending = 0,
} = {}) {
  const matchingNet = Math.max(0, Number(matchingGross || 0) - Number(matchingPaidByAdmin || 0));
  let remainingWithdrawn = Number(approved || 0) + Number(pending || 0);

  const take = (amount) => {
    const avail = Math.max(0, Number(amount) || 0);
    const used = Math.min(avail, remainingWithdrawn);
    remainingWithdrawn -= used;
    return roundMoney(avail - used);
  };

  take(tradeGross);
  take(bonus);
  return {
    sponsorAvailable: take(sponsorGross),
    matchingAvailable: take(matchingNet),
  };
}

function resolveMatchingPaidByAdmin(wallet, userCode) {
  const stored = Number(wallet?.matchingPaidByAdmin);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return matchingPaidByAdminForUserCode(userCode);
}

async function previewEligibility(userId, todayIst = null) {
  const today = todayIst || toIstDateParts(new Date()).isoDate;
  const wallet = await getWalletOrThrow(userId);
  const user = await User.findById(userId).select('userCode').lean();
  const tradeGross = await computeGrossEligibleTrade(userId, today);
  const sponsorGross = await computeTotalSponsorCredited(userId);
  const matchingGross = await computeTotalMatchingCredited(userId);
  const approved = await sumWithdrawalsByStatus(userId, 'approved');
  const pending = await sumWithdrawalsByStatus(userId, 'pending');
  const bonus = Math.max(0, Number(wallet.eligibleBonus) || 0);
  const matchingPaidByAdmin = resolveMatchingPaidByAdmin(wallet, user?.userCode);
  const proposedEligible = computeNetEligibleToWithdraw({
    tradeGross,
    sponsorGross,
    matchingGross,
    bonus,
    matchingPaidByAdmin,
    approved,
    pending,
  });
  const currentEligible = roundMoney(wallet.eligibleToWithdraw);
  const available = computeAvailableIncomeStreams({
    tradeGross,
    sponsorGross,
    matchingGross,
    bonus,
    matchingPaidByAdmin,
    approved,
    pending,
  });
  return {
    userCode: user?.userCode || '',
    tradeGross: roundMoney(tradeGross),
    sponsorGross: roundMoney(sponsorGross),
    matchingGross: roundMoney(matchingGross),
    bonus: roundMoney(bonus),
    matchingPaidByAdmin: roundMoney(matchingPaidByAdmin),
    approved: roundMoney(approved),
    pending: roundMoney(pending),
    sponsorAvailable: available.sponsorAvailable,
    matchingAvailable: available.matchingAvailable,
    currentEligible,
    proposedEligible,
    currentBalance: roundMoney(wallet.balance),
    delta: roundMoney(proposedEligible - currentEligible),
  };
}

async function sumWithdrawalsByStatus(userId, status) {
  const uid = new mongoose.Types.ObjectId(userId);
  const rows = await WithdrawalRequest.aggregate([
    { $match: { userId: uid, status } },
    { $group: { _id: null, t: { $sum: '$amount' } } },
  ]);
  return rows[0]?.t || 0;
}

/**
 * Trade income from one subscription that unlocks on `todayIst` because a W-cycle completed
 * (gate day) or the final partial cycle finished — never per daily credit.
 */
function newlyUnlockedTradeForSubscriptionOnDate(sub, plan, credits, todayIst) {
  if (!credits.length || !plan) return 0;

  const D0 = sub.withdrawalDay1Ist;
  const W = plan.cycleDaysW;
  const maxCycle = Math.max(...credits.map((c) => c.cycleNumber));
  const lastCreditIst = credits[credits.length - 1].creditDateIst;
  const isCompleted = sub.status === 'completed';
  const nominalEndLast = cycleEndInclusive(D0, W, maxCycle);
  const isPartialLastCycle = isCompleted && istDateCompare(lastCreditIst, nominalEndLast) < 0;

  const byCycle = new Map();
  for (const c of credits) {
    const prev = byCycle.get(c.cycleNumber) || 0;
    byCycle.set(c.cycleNumber, prev + c.amount);
  }

  let newlyUnlocked = 0;
  for (const [cycleK, amount] of byCycle.entries()) {
    const K = Number(cycleK);
    let cycleCompletedToday = false;
    if (isPartialLastCycle && K === maxCycle) {
      cycleCompletedToday = lastCreditIst === todayIst;
    } else {
      cycleCompletedToday = firstDayAfterWithdrawalCycleK(D0, W, K) === todayIst;
    }
    if (cycleCompletedToday) newlyUnlocked += amount;
  }
  return newlyUnlocked;
}

/**
 * Pure resolver: after baseline exists, only a tradeGross *increase* triggers auto-withdraw
 * (once per cycle unlock). Gate-day alone must not re-fire on every hourly recalc.
 */
function resolveTradeAutoWithdrawAmount(tradeGross, lastGrossEligibleTrade, gateUnlockToday) {
  if (lastGrossEligibleTrade != null) {
    return computeNewlyUnlockedTradeDelta(tradeGross, lastGrossEligibleTrade);
  }
  return Math.max(0, Number(gateUnlockToday) || 0);
}

/**
 * Amount of trade income to auto-move to pending withdrawal on this recalc.
 * Only fires when a full W-cycle completes (lump sum), e.g. all 31 days of Plan B cycle 1 on day 31.
 */
async function computeTradeAutoWithdrawAmount(userId, todayIst, tradeGross, lastGrossEligibleTrade) {
  const gateUnlockToday = await computeNewlyUnlockedTradeOnDate(userId, todayIst);
  return resolveTradeAutoWithdrawAmount(tradeGross, lastGrossEligibleTrade, gateUnlockToday);
}

async function computeNewlyUnlockedTradeOnDate(userId, todayIst) {
  const subs = await PackageSubscription.find({ userId }).populate('planId');
  let newlyUnlocked = 0;
  for (const sub of subs) {
    const credits = await TradeCreditEvent.find({ packageSubscriptionId: sub._id }).sort({ creditDateIst: 1 });
    newlyUnlocked += newlyUnlockedTradeForSubscriptionOnDate(sub, sub.planId, credits, todayIst);
  }
  return newlyUnlocked;
}

function computeNewlyUnlockedTradeDelta(tradeGross, lastGrossEligibleTrade) {
  if (lastGrossEligibleTrade == null) return 0;
  const previous = Number(lastGrossEligibleTrade);
  if (!Number.isFinite(previous)) return 0;
  return Math.max(0, tradeGross - previous);
}

async function recalculateEligibility(userId, todayIst = null, options = {}) {
  const { skipAutoWithdraw = false } = options;
  const today = todayIst || toIstDateParts(new Date()).isoDate;
  await reconcileEligibleBonusFromLedger(userId);
  const wallet = await getWalletOrThrow(userId);
  const tradeGross = await computeGrossEligibleTrade(userId, today);
  const sponsorGross = await computeTotalSponsorCredited(userId);
  const matchingGross = await computeTotalMatchingCredited(userId);
  const approved = await sumWithdrawalsByStatus(userId, 'approved');
  let pending = await sumWithdrawalsByStatus(userId, 'pending');
  const bonus = Math.max(0, Number(wallet.eligibleBonus) || 0);
  const user = await User.findById(userId).select('userCode').lean();
  const matchingPaidByAdmin = resolveMatchingPaidByAdmin(wallet, user?.userCode);

  const hasTradeBaseline = wallet.lastGrossEligibleTrade != null;
  let newlyUnlockedTrade = await computeTradeAutoWithdrawAmount(
    userId,
    today,
    tradeGross,
    hasTradeBaseline ? wallet.lastGrossEligibleTrade : null
  );

  if (!skipAutoWithdraw && newlyUnlockedTrade > 0) {
    const { tryAutoWithdrawNewTradeIncome } = require('./withdrawal.service');
    const autoPending = await tryAutoWithdrawNewTradeIncome(userId, newlyUnlockedTrade, wallet);
    if (autoPending > 0) pending += autoPending;
  }

  const net = computeNetEligibleToWithdraw({
    tradeGross,
    sponsorGross,
    matchingGross,
    bonus,
    matchingPaidByAdmin,
    approved,
    pending,
  });
  await Wallet.updateOne(
    { userId },
    { $set: { eligibleToWithdraw: net, lastGrossEligibleTrade: tradeGross } }
  );
  return getWalletOrThrow(userId);
}

async function recalculateEligibilityForUsers(userIdSet, todayIst = null, options = {}) {
  const today = todayIst || toIstDateParts(new Date()).isoDate;
  for (const uid of userIdSet) {
    await recalculateEligibility(uid.toString(), today, options);
  }
}

/** After a trade job day, refresh everyone who has ever held a package (calendar-only unlocks). */
async function recalculateEligibilityForAllPortfolioUsers(todayIst, options = {}) {
  const ids = await PackageSubscription.distinct('userId');
  await recalculateEligibilityForUsers(new Set(ids.map(String)), todayIst, options);
}

module.exports = {
  firstDayAfterWithdrawalCycleK,
  cycleEndInclusive,
  grossEligibleForSubscription,
  newlyUnlockedTradeForSubscriptionOnDate,
  computeNewlyUnlockedTradeOnDate,
  computeNewlyUnlockedTradeDelta,
  resolveTradeAutoWithdrawAmount,
  computeTradeAutoWithdrawAmount,
  computeTotalSponsorCredited,
  computeTotalMatchingCredited,
  computeNetEligibleToWithdraw,
  computeAvailableIncomeStreams,
  resolveMatchingPaidByAdmin,
  previewEligibility,
  recalculateEligibility,
  recalculateEligibilityForUsers,
  recalculateEligibilityForAllPortfolioUsers,
};
