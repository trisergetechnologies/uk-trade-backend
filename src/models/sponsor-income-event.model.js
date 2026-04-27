const mongoose = require('mongoose');

const sponsorIncomeEventSchema = new mongoose.Schema(
  {
    buyerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referrerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    packageSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackageSubscription', required: true },
    grossAmount: { type: Number, required: true },
    creditedAmount: { type: Number, required: true },
    capAmount: { type: Number, required: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SponsorIncomeEvent', sponsorIncomeEventSchema);
