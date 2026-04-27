const { FundTransfer, User } = require('../models');
const { getWalletOrThrow, addLedgerEntry } = require('./wallet.service');
const { AppError } = require('../utils/errors');

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
  senderWallet.eligibleToWithdraw -= amount;
  receiverWallet.balance += amount;
  receiverWallet.eligibleToWithdraw += amount;
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

  return transfer;
}

module.exports = { createFundTransfer };
