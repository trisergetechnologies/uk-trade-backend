const mongoose = require('mongoose');
const { createPublicId } = require('../utils/public-id');

const auditLogSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true, default: () => createPublicId('AUD') },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
