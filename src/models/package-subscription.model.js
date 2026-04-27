const mongoose = require('mongoose');
const { createPublicId } = require('../utils/public-id');

const packageSubscriptionSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true, default: () => createPublicId('SUB') },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    principalAmount: { type: Number, required: true },
    purchaseDateIst: { type: String, required: true },
    purchaseAtUtc: { type: Date, required: true, default: Date.now },
    withdrawalDay1Ist: { type: String, required: true },
    firstEarningDateIst: { type: String, required: true },
    workingDaysCredited: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'completed'], default: 'active', index: true },
    completedAtUtc: { type: Date, default: null },
  },
  { timestamps: true }
);

packageSubscriptionSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('PackageSubscription', packageSubscriptionSchema);
