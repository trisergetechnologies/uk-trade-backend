const mongoose = require('mongoose');
const { createPublicId } = require('../utils/public-id');

const walletLedgerSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true, default: () => createPublicId('WL') },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    contextType: { type: String, required: true },
    contextId: { type: mongoose.Schema.Types.ObjectId, default: null },
    packageSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackageSubscription', default: null },
    notes: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

walletLedgerSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('WalletLedger', walletLedgerSchema);
