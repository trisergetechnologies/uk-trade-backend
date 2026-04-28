const { Plan, PackageProduct, PackageSubscription } = require('../models');
const { purchasePackage } = require('../services/trade.service');
const { recalculateEligibility } = require('../services/eligibility.service');
const { creditSponsorOnPurchase } = require('../services/sponsor.service');
const { creditMatchingOnPurchase } = require('../services/matching.service');
const { logger } = require('../utils/logger');

async function listPlans(req, res, next) {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ code: 1 });
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
}

async function listPackageProducts(req, res, next) {
  try {
    const products = await PackageProduct.find({ isActive: true }).sort({ sortOrder: 1, amount: 1 });
    res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
}

async function purchase(req, res, next) {
  try {
    const sub = await purchasePackage({
      userId: req.user.sub,
      planCode: req.validated.body.planCode,
      packageCode: req.validated.body.packageCode,
    });
    await creditSponsorOnPurchase({ buyerUserId: req.user.sub, packageSubscriptionId: sub._id, purchaseAmount: sub.principalAmount });
    try {
      await creditMatchingOnPurchase({ triggerBuyerUserId: req.user.sub, triggerPurchaseSubscriptionId: sub._id });
    } catch (matchingError) {
      logger.error({ err: matchingError, buyerUserId: req.user.sub, packageSubscriptionId: sub._id }, 'matching income processing failed');
    }
    await recalculateEligibility(req.user.sub);
    res.status(201).json({ success: true, data: sub });
  } catch (error) {
    next(error);
  }
}

async function myPackages(req, res, next) {
  try {
    const packages = await PackageSubscription.find({ userId: req.user.sub }).populate('planId').sort({ createdAt: -1 });
    res.json({ success: true, data: packages });
  } catch (error) {
    next(error);
  }
}

module.exports = { listPlans, listPackageProducts, purchase, myPackages };
