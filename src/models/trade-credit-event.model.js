const mongoose = require('mongoose');

const tradeCreditEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    packageSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackageSubscription', required: true, index: true },
    cycleNumber: { type: Number, required: true },
    creditDateIst: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    isPartialCycleUnlock: { type: Boolean, default: false },
  },
  { timestamps: true }
);

tradeCreditEventSchema.index({ packageSubscriptionId: 1, creditDateIst: 1 }, { unique: true });

module.exports = mongoose.model('TradeCreditEvent', tradeCreditEventSchema);
