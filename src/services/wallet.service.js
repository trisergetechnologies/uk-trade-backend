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
  const debitAmount = Number(amount);
  if (!Number.isFinite(debitAmount) || debitAmount <= 0) throw new AppError(400, 'Invalid debit amount');
  if (wallet.balance < debitAmount) throw new AppError(400, 'Insufficient wallet balance');
  wallet.balance -= debitAmount;
  if (contextType === 'package_purchase') {
    const bonus = Math.max(0, Number(wallet.eligibleBonus) || 0);
    wallet.eligibleBonus = Math.max(0, bonus - debitAmount);
  }
  await wallet.save();
  await addLedgerEntry({
    userId,
    amount: debitAmount,
    direction: 'debit',
    contextType,
    contextId,
    packageSubscriptionId,
    notes,
    metadata,
  });
  return wallet;
}

/** Replay admin credits vs package debits to fix eligibleBonus for existing wallets. */
function computeEligibleBonusFromLedgerEntries(entries) {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  let bonus = 0;
  for (const entry of sorted) {
    const amt = Number(entry.amount || 0);
    if (entry.direction === 'credit' && entry.contextType === 'admin_credit') {
      bonus += amt;
    } else if (entry.direction === 'debit' && entry.contextType === 'package_purchase') {
      bonus = Math.max(0, bonus - amt);
    }
  }
  return bonus;
}

async function reconcileEligibleBonusFromLedger(userId) {
  const { WalletLedger } = require('../models');
  const entries = await WalletLedger.find({ userId }).select('amount direction contextType createdAt').lean();
  const eligibleBonus = computeEligibleBonusFromLedgerEntries(entries);
  await Wallet.updateOne({ userId }, { $set: { eligibleBonus } });
  return eligibleBonus;
}

module.exports = {
  getWalletOrThrow,
  creditWallet,
  debitWallet,
  addLedgerEntry,
  computeEligibleBonusFromLedgerEntries,
  reconcileEligibleBonusFromLedger,
};
