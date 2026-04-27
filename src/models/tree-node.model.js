const mongoose = require('mongoose');

const treeNodeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    parentUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    side: { type: String, enum: ['left', 'right'], required: true },
    community: { type: String, enum: ['left', 'right'], required: true },
    level: { type: Number, default: 0 },
  },
  { timestamps: true }
);

treeNodeSchema.index({ parentUserId: 1, side: 1 });

module.exports = mongoose.model('TreeNode', treeNodeSchema);
