const mongoose = require('mongoose');
const { createPublicId } = require('../utils/public-id');

const matchingIncomeEventSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true, default: () => createPublicId('MCH') },
    triggerPurchaseSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackageSubscription', required: true, index: true },
    triggerBuyerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    earnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    triggerLevelFromEarner: { type: Number, required: true },
    matchingPercent: { type: Number, required: true },
    leftActiveUserCount: { type: Number, required: true },
    rightActiveUserCount: { type: Number, required: true },
    triggerPurchaseAmount: { type: Number, required: true, default: 0 },
    directLeftActivePurchaser: { type: Boolean, required: true, default: false },
    directRightActivePurchaser: { type: Boolean, required: true, default: false },
    hasDeeperActivePurchaser: { type: Boolean, required: true, default: false },
    considerableAmount: { type: Number, required: true, default: 0 },
    rawPayoutAmount: { type: Number, required: true, default: 0 },
    capBaseAmount: { type: Number, required: true, default: 0 },
    capRemainingBeforeAmount: { type: Number, required: true, default: 0 },
    payoutCreditedAmount: { type: Number, required: true, default: 0 },
    capRemainingAfterAmount: { type: Number, required: true, default: 0 },
    firstMatchingBeforeEvent: { type: Boolean, required: true, default: false },
    status: {
      type: String,
      enum: ['credited', 'skipped', 'duplicate'],
      required: true,
      default: 'skipped',
      index: true,
    },
    reason: { type: String, required: true, default: '' },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

matchingIncomeEventSchema.index({ earnerUserId: 1, createdAt: -1 });
matchingIncomeEventSchema.index({ triggerBuyerUserId: 1, createdAt: -1 });

module.exports = mongoose.model('MatchingIncomeEvent', matchingIncomeEventSchema);
