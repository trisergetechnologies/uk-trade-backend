const mongoose = require('mongoose');
const { ROLES } = require('../constants/roles');
const { createPublicId } = require('../utils/public-id');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
    userCode: { type: String, required: true, unique: true, index: true, default: () => createPublicId('USR') },
    referralCode: { type: String, required: true, unique: true, index: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    preferredCommunity: { type: String, enum: ['left', 'right'], default: 'left' },
    treePlacedAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    firstMatchingDone: { type: Boolean, default: false, index: true },
    bankAccount: {
      accountHolderName: { type: String, default: '' },
      bankName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      ifscCode: { type: String, default: '' },
      upiId: { type: String, default: '' },
      updatedAtUtc: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
