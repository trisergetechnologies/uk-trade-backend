const mongoose = require('mongoose');
const { createPublicId } = require('../utils/public-id');

const paymentRequestSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true, default: () => createPublicId('FR') },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestedAmount: { type: Number, required: true },
    approvedAmount: { type: Number, default: null },
    screenshotUrl: { type: String, default: '' },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewReason: { type: String, default: '' },
    reviewMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentRequest', paymentRequestSchema);
