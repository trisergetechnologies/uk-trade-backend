const { PaymentRequest, AuditLog } = require('../models');
const { creditWallet } = require('./wallet.service');
const { AppError } = require('../utils/errors');

async function createPaymentRequest(userId, payload) {
  return PaymentRequest.create({
    userId,
    requestedAmount: payload.amount,
    screenshotAsset: payload.screenshotAsset,
    screenshotUrl: payload.screenshotUrl || '',
    notes: payload.notes || '',
  });
}

async function reviewPaymentRequest(adminUserId, requestId, payload) {
  const request = await PaymentRequest.findOne({ publicId: requestId });
  if (!request) throw new AppError(404, 'Payment request not found');
  if (request.status !== 'pending') throw new AppError(400, 'Request already reviewed');

  request.status = payload.status;
  request.reviewedBy = adminUserId;
  request.reviewReason = payload.reason || '';

  if (payload.status === 'approved') {
    const approvedAmount = payload.approvedAmount ?? request.requestedAmount;
    request.approvedAmount = approvedAmount;
    request.reviewMetadata = {
      previousAmount: request.requestedAmount,
      approvedAmount,
      changedByAdmin: approvedAmount !== request.requestedAmount,
    };

    await creditWallet({
      userId: request.userId,
      amount: approvedAmount,
      contextType: 'fund_request_approval',
      contextId: request._id,
      notes: `Fund request approved by admin`,
      metadata: { requestedAmount: request.requestedAmount, approvedAmount },
    });
  }

  await request.save();

  await AuditLog.create({
    actorUserId: adminUserId,
    action: 'payment_request_reviewed',
    targetType: 'PaymentRequest',
    targetId: request._id,
    details: {
      status: request.status,
      requestedAmount: request.requestedAmount,
      approvedAmount: request.approvedAmount,
      reason: request.reviewReason,
    },
  });

  return request;
}

module.exports = { createPaymentRequest, reviewPaymentRequest };
