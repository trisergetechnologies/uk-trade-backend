const { User, PackageSubscription, SponsorIncomeEvent } = require('../models');
const { creditWallet } = require('./wallet.service');
const { recalculateEligibility } = require('./eligibility.service');
const { isNetworkParticipant } = require('../utils/network-participant');

async function getMaxActivePackageAmount(userId) {
  const activeSubs = await PackageSubscription.find({ userId, status: 'active' });
  if (!activeSubs.length) return 0;
  return Math.max(...activeSubs.map((x) => x.principalAmount));
}

async function creditSponsorOnPurchase({ buyerUserId, packageSubscriptionId, purchaseAmount }) {
  const buyer = await User.findById(buyerUserId);
  if (!buyer || !buyer.referredBy) return { creditedAmount: 0, reason: 'no-referrer' };

  const referrer = await User.findById(buyer.referredBy);
  if (!referrer) return { creditedAmount: 0, reason: 'referrer-missing' };

  if (!isNetworkParticipant(referrer)) {
    await SponsorIncomeEvent.create({
      buyerUserId,
      referrerUserId: referrer._id,
      packageSubscriptionId,
      grossAmount: 0,
      creditedAmount: 0,
      capAmount: 0,
      notes: 'Referrer is not a network participant (e.g. system admin)',
    });
    return { creditedAmount: 0, reason: 'referrer-not-network-participant' };
  }

  const cap = await getMaxActivePackageAmount(referrer._id);
  if (cap <= 0) {
    await SponsorIncomeEvent.create({
      buyerUserId,
      referrerUserId: referrer._id,
      packageSubscriptionId,
      grossAmount: 0,
      creditedAmount: 0,
      capAmount: 0,
      notes: 'No active package for referrer',
    });
    return { creditedAmount: 0, reason: 'referrer-no-active-package' };
  }

  const sub = await PackageSubscription.findById(packageSubscriptionId).populate('planId');
  const sponsorPercent = sub?.planId?.sponsorPercent ?? 5;
  const gross = Number(((purchaseAmount * sponsorPercent) / 100).toFixed(2));
  const creditedAmount = Math.min(gross, cap);

  await SponsorIncomeEvent.create({
    buyerUserId,
    referrerUserId: referrer._id,
    packageSubscriptionId,
    grossAmount: gross,
    creditedAmount,
    capAmount: cap,
    notes: `Sponsor income (${sponsorPercent}% of purchase, capped)`,
  });

  if (creditedAmount > 0) {
    await creditWallet({
      userId: referrer._id,
      amount: creditedAmount,
      contextType: 'sponsor_income',
      contextId: packageSubscriptionId,
      packageSubscriptionId,
      notes: `Sponsor income from referral purchase`,
      metadata: { gross, cap },
    });
    await recalculateEligibility(referrer._id.toString());
  }

  return { creditedAmount, gross, cap };
}

module.exports = { creditSponsorOnPurchase, getMaxActivePackageAmount };
