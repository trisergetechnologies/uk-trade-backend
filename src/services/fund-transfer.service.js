const mongoose = require('mongoose');
const { FundTransfer, User } = require('../models');
const { getWalletOrThrow, addLedgerEntry } = require('./wallet.service');
const { AppError } = require('../utils/errors');
const { canViewTransferRecipientReport } = require('../constants/fund-transfer-recipients');

async function createFundTransfer({ fromUserId, toUserCode, amount, note = '' }) {
  const sender = await User.findById(fromUserId).select('userCode');
  if (!sender) throw new AppError(404, 'Sender not found');
  const receiver = await User.findOne({ userCode: toUserCode }).select('userCode');
  if (!receiver) throw new AppError(404, 'Recipient user ID not found');
  if (String(receiver._id) === String(fromUserId)) throw new AppError(400, 'Cannot transfer to yourself');

  const [senderWallet, receiverWallet] = await Promise.all([
    getWalletOrThrow(fromUserId),
    getWalletOrThrow(receiver._id),
  ]);

  if (senderWallet.eligibleToWithdraw < amount) {
    throw new AppError(400, 'Amount exceeds your eligible amount');
  }
  if (senderWallet.balance < amount) {
    throw new AppError(400, 'Amount exceeds your wallet balance');
  }

  senderWallet.balance -= amount;
  receiverWallet.balance += amount;
  await senderWallet.save();
  await receiverWallet.save();

  const transfer = await FundTransfer.create({
    fromUserId,
    toUserId: receiver._id,
    fromUserCode: sender.userCode,
    toUserCode: receiver.userCode,
    amount,
    note: note || '',
    status: 'completed',
  });

  await addLedgerEntry({
    userId: fromUserId,
    amount,
    direction: 'debit',
    contextType: 'fund_transfer_out',
    contextId: transfer._id,
    notes: `Transfer to ${receiver.userCode}`,
    metadata: { toUserCode: receiver.userCode, note: note || '' },
  });
  await addLedgerEntry({
    userId: receiver._id,
    amount,
    direction: 'credit',
    contextType: 'fund_transfer_in',
    contextId: transfer._id,
    notes: `Transfer from ${sender.userCode}`,
    metadata: { fromUserCode: sender.userCode, note: note || '' },
  });

  // Eligibility includes fund_transfer_in/out so Eligible stays reduced after send
  // (admin credits in eligibleBonus would otherwise reappear on hourly recalc).
  const { recalculateEligibility } = require('./eligibility.service');
  await recalculateEligibility(fromUserId);
  await recalculateEligibility(receiver._id);

  return transfer;
}

/**
 * Aggregated list of users this account has sent fund transfers to,
 * with recipient profile details. Restricted to allow-listed user codes.
 */
async function listSentTransferRecipients(fromUserId) {
  const sender = await User.findById(fromUserId).select('userCode').lean();
  if (!sender) throw new AppError(404, 'Sender not found');
  if (!canViewTransferRecipientReport(sender.userCode)) {
    throw new AppError(403, 'Transfer recipients report is not available for this account');
  }

  const uid = new mongoose.Types.ObjectId(fromUserId);
  const rows = await FundTransfer.aggregate([
    { $match: { fromUserId: uid } },
    {
      $group: {
        _id: '$toUserId',
        toUserCode: { $first: '$toUserCode' },
        transferCount: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        lastTransferAt: { $max: '$createdAt' },
        firstTransferAt: { $min: '$createdAt' },
        notes: { $addToSet: '$note' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $sort: { totalAmount: -1, lastTransferAt: -1 } },
    {
      $project: {
        _id: 0,
        userCode: { $ifNull: ['$user.userCode', '$toUserCode'] },
        name: { $ifNull: ['$user.name', ''] },
        email: { $ifNull: ['$user.email', ''] },
        mobileNumber: { $ifNull: ['$user.mobileNumber', ''] },
        referralCode: { $ifNull: ['$user.referralCode', ''] },
        preferredCommunity: { $ifNull: ['$user.preferredCommunity', ''] },
        isActive: { $ifNull: ['$user.isActive', false] },
        kycStatus: { $ifNull: ['$user.kyc.status', 'unverified'] },
        registeredAt: '$user.createdAt',
        bankAccount: {
          accountHolderName: { $ifNull: ['$user.bankAccount.accountHolderName', ''] },
          bankName: { $ifNull: ['$user.bankAccount.bankName', ''] },
          accountNumber: { $ifNull: ['$user.bankAccount.accountNumber', ''] },
          ifscCode: { $ifNull: ['$user.bankAccount.ifscCode', ''] },
          upiId: { $ifNull: ['$user.bankAccount.upiId', ''] },
        },
        transferCount: 1,
        totalAmount: 1,
        firstTransferAt: 1,
        lastTransferAt: 1,
        notes: {
          $filter: {
            input: '$notes',
            as: 'n',
            cond: { $and: [{ $ne: ['$$n', null] }, { $ne: ['$$n', ''] }] },
          },
        },
      },
    },
  ]);

  const summary = rows.reduce(
    (acc, row) => {
      acc.recipientCount += 1;
      acc.transferCount += Number(row.transferCount || 0);
      acc.totalAmount += Number(row.totalAmount || 0);
      return acc;
    },
    { recipientCount: 0, transferCount: 0, totalAmount: 0 }
  );

  return { summary, recipients: rows };
}

module.exports = { createFundTransfer, listSentTransferRecipients };
