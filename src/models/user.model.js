const mongoose = require('mongoose');
const { ROLES } = require('../constants/roles');
const { createNumericPublicId } = require('../utils/public-id');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    /** AES-GCM ciphertext (base64) for admin recovery; optional for legacy users */
    passwordCipher: { type: String, default: null },
    mobileNumber: { type: String, default: '', trim: true },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
    userCode: { type: String, required: true, unique: true, index: true, default: () => createNumericPublicId(5) },
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
    kyc: {
      status: {
        type: String,
        enum: ['unverified', 'pending', 'approved', 'rejected'],
        default: 'unverified',
        index: true,
      },
      aadhaarAsset: {
        publicId: { type: String, default: '' },
        resourceType: { type: String, default: 'image' },
        format: { type: String, default: 'jpg' },
      },
      passbookAsset: {
        publicId: { type: String, default: '' },
        resourceType: { type: String, default: 'image' },
        format: { type: String, default: 'jpg' },
      },
      aadhaarFrontAsset: {
        publicId: { type: String, default: '' },
        resourceType: { type: String, default: 'image' },
        format: { type: String, default: 'jpg' },
      },
      aadhaarBackAsset: {
        publicId: { type: String, default: '' },
        resourceType: { type: String, default: 'image' },
        format: { type: String, default: 'jpg' },
      },
      panAsset: {
        publicId: { type: String, default: '' },
        resourceType: { type: String, default: 'image' },
        format: { type: String, default: 'jpg' },
      },
      photoAsset: {
        publicId: { type: String, default: '' },
        resourceType: { type: String, default: 'image' },
        format: { type: String, default: 'jpg' },
      },
      submittedAt: { type: Date, default: null },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewReason: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
