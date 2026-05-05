const { WithdrawalRequest, AuditLog, User } = require('../models');
const { getWalletOrThrow, debitWallet } = require('./wallet.service');
const { recalculateEligibility } = require('./eligibility.service');
const { assertKycApproved } = require('./kyc.service');
const { AppError } = require('../utils/errors');

const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

async function findWithdrawalForAdminReview(requestId) {
  const rid = String(requestId || '').trim();
  if (!rid) return null;
  if (OBJECT_ID_HEX.test(rid)) {
    const byId = await WithdrawalRequest.findById(rid);
    if (byId) return byId;
  }
  return WithdrawalRequest.findOne({ publicId: rid });
}

async function createWithdrawalRequest(userId, amount) {
  await recalculateEligibility(userId);
  const wallet = await getWalletOrThrow(userId);
  if (wallet.eligibleToWithdraw < amount) {
    throw new AppError(400, 'Amount exceeds eligible to withdraw');
  }
  if (wallet.balance < amount) {
    throw new AppError(400, 'Amount exceeds wallet balance');
  }
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found');
  assertKycApproved(user);
  const bank = user.bankAccount || {};
  const hasBankAccount = Boolean(
    String(bank.accountHolderName || '').trim() &&
      String(bank.bankName || '').trim() &&
      String(bank.accountNumber || '').trim() &&
      String(bank.ifscCode || '').trim()
  );
  if (!hasBankAccount) {
    throw new AppError(400, 'Add your bank account before creating a withdrawal request');
  }
  const accountDigits = String(bank.accountNumber || '').replace(/\D/g, '');
  const created = await WithdrawalRequest.create({
    userId,
    amount,
    status: 'pending',
    bankSnapshot: {
      accountHolderName: String(bank.accountHolderName || '').trim(),
      bankName: String(bank.bankName || '').trim(),
      accountLast4: accountDigits.slice(-4),
      ifscCode: String(bank.ifscCode || '').trim().toUpperCase(),
      upiId: String(bank.upiId || '').trim().toLowerCase(),
    },
  });
  await recalculateEligibility(userId);
  return created;
}

async function reviewWithdrawalRequest(adminUserId, requestId, status, reason) {
  const request = await findWithdrawalForAdminReview(requestId);
  if (!request) throw new AppError(404, 'Withdrawal request not found');
  if (request.status !== 'pending') throw new AppError(400, 'Request already reviewed');

  request.status = status;
  request.reviewedBy = adminUserId;
  request.reviewReason = reason || '';
  await request.save();

  if (status === 'approved') {
    await debitWallet({
      userId: request.userId,
      amount: request.amount,
      contextType: 'withdrawal_approved',
      contextId: request._id,
      notes: 'Withdrawal approved by admin',
    });
  }

  await recalculateEligibility(request.userId.toString());

  await AuditLog.create({
    actorUserId: adminUserId,
    action: 'withdrawal_request_reviewed',
    targetType: 'WithdrawalRequest',
    targetId: request._id,
    details: { status, reason, amount: request.amount },
  });

  return request;
}

module.exports = { createWithdrawalRequest, reviewWithdrawalRequest };
