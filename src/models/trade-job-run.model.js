const mongoose = require('mongoose');

const tradeJobRunSchema = new mongoose.Schema(
  {
    dayIst: { type: String, required: true, unique: true, index: true },
    finished: { type: Boolean, default: false },
    processed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TradeJobRun', tradeJobRunSchema);
