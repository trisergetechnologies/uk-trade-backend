const mongoose = require('mongoose');
const { createPublicId } = require('../utils/public-id');

const withdrawalRequestSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true, default: () => createPublicId('WD') },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewReason: { type: String, default: '' },
    bankSnapshot: {
      accountHolderName: { type: String, default: '' },
      bankName: { type: String, default: '' },
      accountLast4: { type: String, default: '' },
      ifscCode: { type: String, default: '' },
      upiId: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
