const mongoose = require('mongoose');

const packageProductSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    shortDescription: { type: String, default: '' },
    /** Longer text for the (i) tooltip — plain text */
    detailHelp: { type: String, default: '' },
    features: [{ type: String }],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PackageProduct', packageProductSchema);
