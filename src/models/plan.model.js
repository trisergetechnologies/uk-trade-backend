const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    dailyPercent: { type: Number, required: true },
    cycleDaysW: { type: Number, required: true },
    maxWorkingDaysN: { type: Number, required: true },
    sponsorPercent: { type: Number, default: 5 },
    isActive: { type: Boolean, default: true },
    /** One-line summary for cards (optional) */
    summary: { type: String, default: '' },
    /** Longer explanation for the (i) tooltip (optional) */
    detailHelp: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Plan', planSchema);
