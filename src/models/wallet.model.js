const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, default: 0 },
    /** Admin (or other) top-ups that should stay withdrawable across eligibility recomputes; see eligibility.service */
    eligibleBonus: { type: Number, default: 0 },
    eligibleToWithdraw: { type: Number, default: 0 },
    /**
     * Matching already paid out via admin_credit workaround (before matching was in Eligible).
     * Subtracted in eligibility so those users are not paid twice. 0 for everyone else.
     */
    matchingPaidByAdmin: { type: Number, default: 0 },
    /** Snapshot of gross trade income eligible under W-cycle rules; used to detect newly unlocked trade per day. */
    lastGrossEligibleTrade: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', walletSchema);
