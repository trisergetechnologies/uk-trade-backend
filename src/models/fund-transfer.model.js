const mongoose = require('mongoose');
const { createPublicId } = require('../utils/public-id');

const fundTransferSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true, default: () => createPublicId('TR') },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fromUserCode: { type: String, required: true, index: true },
    toUserCode: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    note: { type: String, default: '' },
    status: { type: String, enum: ['completed'], default: 'completed' },
  },
  { timestamps: true }
);

fundTransferSchema.index({ fromUserId: 1, createdAt: -1 });
fundTransferSchema.index({ toUserId: 1, createdAt: -1 });

module.exports = mongoose.model('FundTransfer', fundTransferSchema);
