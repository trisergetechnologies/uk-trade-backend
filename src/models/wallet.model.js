const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, default: 0 },
    /** Admin (or other) top-ups that should stay withdrawable across eligibility recomputes; see eligibility.service */
    eligibleBonus: { type: Number, default: 0 },
    eligibleToWithdraw: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', walletSchema);
