const { WithdrawalRequest, AuditLog, User } = require('../models');
const { getWalletOrThrow, debitWallet } = require('./wallet.service');
const { recalculateEligibility } = require('./eligibility.service');
const { assertKycApproved, isBankAccountComplete } = require('./kyc.service');
const { AppError } = require('../utils/errors');

const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;
const MIN_WITHDRAWAL_AMOUNT = 500;

function buildBankSnapshot(bank) {
  const accountDigits = String(bank.accountNumber || '').replace(/\D/g, '');
  return {
    accountHolderName: String(bank.accountHolderName || '').trim(),
    bankName: String(bank.bankName || '').trim(),
    accountLast4: accountDigits.slice(-4),
    ifscCode: String(bank.ifscCode || '').trim().toUpperCase(),
    upiId: String(bank.upiId || '').trim().toLowerCase(),
  };
}

/**
 * When a W-cycle unlocks new trade income and KYC + bank are complete, auto-create a pending withdrawal.
 * Returns the amount moved into pending (0 if skipped).
 */
async function tryAutoWithdrawNewTradeIncome(userId, newlyUnlockedTrade, wallet) {
  const unlocked = Number(newlyUnlockedTrade) || 0;
  if (unlocked < MIN_WITHDRAWAL_AMOUNT) return 0;

  const user = await User.findById(userId).lean();
  if (!user) return 0;
  if ((user.kyc?.status || 'unverified') !== 'approved') return 0;
  if (!isBankAccountComplete(user)) return 0;

  const amount = Math.min(unlocked, Number(wallet.balance) || 0);
  if (amount < MIN_WITHDRAWAL_AMOUNT) return 0;

  const created = await WithdrawalRequest.create({
    userId,
    amount,
    status: 'pending',
    bankSnapshot: buildBankSnapshot(user.bankAccount || {}),
  });

  await AuditLog.create({
    actorUserId: null,
    action: 'withdrawal_request_auto_created',
    targetType: 'WithdrawalRequest',
    targetId: created._id,
    details: { userId: String(userId), amount, reason: 'trade_cycle_unlock' },
  });

  return amount;
}

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
  await recalculateEligibility(userId, null, { skipAutoWithdraw: true });
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
  if (!isBankAccountComplete(user)) {
    throw new AppError(400, 'Add your bank account before creating a withdrawal request');
  }
  const created = await WithdrawalRequest.create({
    userId,
    amount,
    status: 'pending',
    bankSnapshot: buildBankSnapshot(user.bankAccount || {}),
  });
  await recalculateEligibility(userId, null, { skipAutoWithdraw: true });
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

  await recalculateEligibility(request.userId.toString(), null, { skipAutoWithdraw: true });

  await AuditLog.create({
    actorUserId: adminUserId,
    action: 'withdrawal_request_reviewed',
    targetType: 'WithdrawalRequest',
    targetId: request._id,
    details: { status, reason, amount: request.amount },
  });

  return request;
}

module.exports = {
  MIN_WITHDRAWAL_AMOUNT,
  tryAutoWithdrawNewTradeIncome,
  createWithdrawalRequest,
  reviewWithdrawalRequest,
};
