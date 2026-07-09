const mongoose = require('mongoose');
const { createPublicId } = require('../utils/public-id');

const withdrawalRequestSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true, default: () => createPublicId('WD') },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    tdsPercent: { type: Number, default: 5 },
    handlingPercent: { type: Number, default: 5 },
    tdsAmount: { type: Number, default: 0 },
    handlingAmount: { type: Number, default: 0 },
    /** Amount admin pays to user after TDS + handling (gross − deductions). */
    netPayable: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewReason: { type: String, default: '' },
    bankSnapshot: {
      accountHolderName: { type: String, default: '' },
      bankName: { type: String, default: '' },
      /** Full account number at request time (admin payout only; omitted from user APIs). */
      accountNumber: { type: String, default: '' },
      accountLast4: { type: String, default: '' },
      ifscCode: { type: String, default: '' },
      upiId: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
