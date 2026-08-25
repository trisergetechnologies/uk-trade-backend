const { Wallet, WalletLedger, WithdrawalRequest } = require('../models');
const { AppError } = require('../utils/errors');
const mongoose = require('mongoose');

async function getWalletOrThrow(userId) {
  const wallet = await Wallet.findOne({ userId });
  if (!wallet) throw new AppError(404, 'Wallet not found');
  return wallet;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

/**
 * Trade income (locked or unlocked) is reserved for withdrawal only — never for packages.
 * Approved withdrawals consume trade first; whatever trade is still attributed stays reserved
 * in the wallet balance and cannot fund package purchases.
 */
function computeSpendableForPackagesFromTotals({
  balance = 0,
  tradeIncomeCredited = 0,
  approvedWithdrawals = 0,
} = {}) {
  const bal = Math.max(0, Number(balance) || 0);
  const tradeCredited = Math.max(0, Number(tradeIncomeCredited) || 0);
  const approved = Math.max(0, Number(approvedWithdrawals) || 0);
  const tradeLeftAfterApproved = Math.max(0, roundMoney(tradeCredited - approved));
  const tradeReservedInWallet = Math.min(bal, tradeLeftAfterApproved);
  const spendableForPackages = Math.max(0, roundMoney(bal - tradeReservedInWallet));
  return {
    balance: roundMoney(bal),
    tradeIncomeCredited: roundMoney(tradeCredited),
    approvedWithdrawals: roundMoney(approved),
    tradeReservedInWallet: roundMoney(tradeReservedInWallet),
    spendableForPackages,
  };
}

async function sumTradeIncomeCredited(userId) {
  const uid = new mongoose.Types.ObjectId(userId);
  const rows = await WalletLedger.aggregate([
    { $match: { userId: uid, direction: 'credit', contextType: 'trade_income' } },
    { $group: { _id: null, t: { $sum: '$amount' } } },
  ]);
  return Number(rows[0]?.t || 0);
}

async function sumApprovedWithdrawals(userId) {
  const uid = new mongoose.Types.ObjectId(userId);
  const rows = await WithdrawalRequest.aggregate([
    { $match: { userId: uid, status: 'approved' } },
    { $group: { _id: null, t: { $sum: '$amount' } } },
  ]);
  return Number(rows[0]?.t || 0);
}

async function getSpendableForPackages(userId) {
  const wallet = await getWalletOrThrow(userId);
  const [tradeIncomeCredited, approvedWithdrawals] = await Promise.all([
    sumTradeIncomeCredited(userId),
    sumApprovedWithdrawals(userId),
  ]);
  return computeSpendableForPackagesFromTotals({
    balance: wallet.balance,
    tradeIncomeCredited,
    approvedWithdrawals,
  });
}

async function assertSpendableForPackagePurchase(userId, amount) {
  const spendable = await getSpendableForPackages(userId);
  const need = Number(amount);
  if (!Number.isFinite(need) || need <= 0) throw new AppError(400, 'Invalid package amount');
  if (spendable.spendableForPackages < need) {
    throw new AppError(
      400,
      `Insufficient spendable balance for packages. Trade income is reserved for withdrawal and cannot buy packages. Spendable: ${spendable.spendableForPackages}, required: ${need}. Add funds first.`
    );
  }
  return spendable;
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
  if (contextType === 'package_purchase') {
    await reconcileEligibleBonusFromLedger(userId);
  }
  return getWalletOrThrow(userId);
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
  computeSpendableForPackagesFromTotals,
  getSpendableForPackages,
  assertSpendableForPackagePurchase,
};
