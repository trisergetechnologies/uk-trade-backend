const mongoose = require('mongoose');
const { addIstDays, toIstDateParts, istDateCompare } = require('../utils/date-utils');
const { PackageSubscription, TradeCreditEvent, WithdrawalRequest, Wallet } = require('../models');
const { getWalletOrThrow } = require('./wallet.service');

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

async function sumWithdrawalsByStatus(userId, status) {
  const uid = new mongoose.Types.ObjectId(userId);
  const rows = await WithdrawalRequest.aggregate([
    { $match: { userId: uid, status } },
    { $group: { _id: null, t: { $sum: '$amount' } } },
  ]);
  return rows[0]?.t || 0;
}

async function recalculateEligibility(userId, todayIst = null) {
  const today = todayIst || toIstDateParts(new Date()).isoDate;
  await getWalletOrThrow(userId);
  const gross = await computeGrossEligibleTrade(userId, today);
  const approved = await sumWithdrawalsByStatus(userId, 'approved');
  const pending = await sumWithdrawalsByStatus(userId, 'pending');
  const net = Math.max(0, gross - approved - pending);
  await Wallet.updateOne({ userId }, { $set: { eligibleToWithdraw: net } });
  return getWalletOrThrow(userId);
}

async function recalculateEligibilityForUsers(userIdSet, todayIst = null) {
  const today = todayIst || toIstDateParts(new Date()).isoDate;
  for (const uid of userIdSet) {
    await recalculateEligibility(uid.toString(), today);
  }
}

/** After a trade job day, refresh everyone who has ever held a package (calendar-only unlocks). */
async function recalculateEligibilityForAllPortfolioUsers(todayIst) {
  const ids = await PackageSubscription.distinct('userId');
  await recalculateEligibilityForUsers(new Set(ids.map(String)), todayIst);
}

module.exports = {
  firstDayAfterWithdrawalCycleK,
  cycleEndInclusive,
  grossEligibleForSubscription,
  recalculateEligibility,
  recalculateEligibilityForUsers,
  recalculateEligibilityForAllPortfolioUsers,
};
