const { Wallet, WalletLedger } = require('../models');
const { AppError } = require('../utils/errors');

async function getWalletOrThrow(userId) {
  const wallet = await Wallet.findOne({ userId });
  if (!wallet) throw new AppError(404, 'Wallet not found');
  return wallet;
}

async function addLedgerEntry({
  userId,
  amount,
  direction,
  contextType,
  contextId = null,
  packageSubscriptionId = null,
  notes = '',
  metadata = {},
  createdAt = null,
}) {
  const payload = { userId, amount, direction, contextType, contextId, packageSubscriptionId, notes, metadata };
  if (createdAt) {
    const at = createdAt instanceof Date ? createdAt : new Date(createdAt);
    if (!Number.isNaN(at.getTime())) {
      payload.createdAt = at;
      payload.updatedAt = at;
    }
  }
  return WalletLedger.create(payload);
}

async function creditWallet({
  userId,
  amount,
  contextType,
  contextId = null,
  packageSubscriptionId = null,
  notes = '',
  metadata = {},
  createdAt = null,
}) {
  const wallet = await getWalletOrThrow(userId);
  wallet.balance += amount;
  await wallet.save();
  await addLedgerEntry({
    userId,
    amount,
    direction: 'credit',
    contextType,
    contextId,
    packageSubscriptionId,
    notes,
    metadata,
    createdAt,
  });
  return wallet;
}

async function debitWallet({ userId, amount, contextType, contextId = null, packageSubscriptionId = null, notes = '', metadata = {} }) {
  const wallet = await getWalletOrThrow(userId);
  if (wallet.balance < amount) throw new AppError(400, 'Insufficient wallet balance');
  wallet.balance -= amount;
  await wallet.save();
  await addLedgerEntry({ userId, amount, direction: 'debit', contextType, contextId, packageSubscriptionId, notes, metadata });
  return wallet;
}

module.exports = { getWalletOrThrow, creditWallet, debitWallet, addLedgerEntry };
