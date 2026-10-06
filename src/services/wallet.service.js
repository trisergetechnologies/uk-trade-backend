const { Wallet, WalletLedger } = require('../models');
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

function takePool(pools, key, rest) {
  const avail = Math.max(0, Number(pools[key]) || 0);
  const used = Math.min(avail, rest);
  pools[key] = avail - used;
  return rest - used;
}

/**
 * Packages may be bought only with leftover deposits, admin credits, and incoming
 * transfers. Sponsor, matching, and trade (locked or unlocked) are withdrawal-only.
 *
 * Replay walks the ledger in time. Packages consume deposit → admin → transfer in
 * (then income only if a past purchase already leaked). Withdrawals and outbound
 * transfers consume trade → admin leftover → sponsor → matching, then deposit/transfer.
 */
function computeSpendableForPackagesFromLedgerEntries(entries, balance = 0) {
  const sorted = [...(entries || [])].sort((a, b) => {
    const dt = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (dt !== 0) return dt;
    return String(a._id || '').localeCompare(String(b._id || ''));
  });
  const pools = {
    deposit: 0,
    admin: 0,
    transferIn: 0,
    sponsor: 0,
    matching: 0,
    trade: 0,
  };

  for (const entry of sorted) {
    const amt = Number(entry.amount) || 0;
    if (amt <= 0) continue;
    const { direction, contextType } = entry;
    if (direction === 'credit') {
      if (contextType === 'fund_request_approval') pools.deposit += amt;
      else if (contextType === 'admin_credit') pools.admin += amt;
      else if (contextType === 'fund_transfer_in') pools.transferIn += amt;
      else if (contextType === 'sponsor_income') pools.sponsor += amt;
      else if (contextType === 'matching_income') pools.matching += amt;
      else if (contextType === 'trade_income') pools.trade += amt;
    } else if (direction === 'debit' && contextType === 'package_purchase') {
      let rest = amt;
      rest = takePool(pools, 'deposit', rest);
      rest = takePool(pools, 'admin', rest);
      rest = takePool(pools, 'transferIn', rest);
      rest = takePool(pools, 'sponsor', rest);
      rest = takePool(pools, 'matching', rest);
      takePool(pools, 'trade', rest);
    } else if (
      direction === 'debit' &&
      (contextType === 'withdrawal_approved' || contextType === 'fund_transfer_out')
    ) {
      let rest = amt;
      rest = takePool(pools, 'trade', rest);
      rest = takePool(pools, 'admin', rest);
      rest = takePool(pools, 'sponsor', rest);
      rest = takePool(pools, 'matching', rest);
      rest = takePool(pools, 'deposit', rest);
      takePool(pools, 'transferIn', rest);
    }
  }

  const bal = Math.max(0, Number(balance) || 0);
  const spendableRaw = pools.deposit + pools.admin + pools.transferIn;
  const spendableForPackages = Math.max(0, roundMoney(Math.min(bal, spendableRaw)));
  const tradeReservedInWallet = Math.max(0, roundMoney(Math.min(bal, pools.trade)));
  return {
    balance: roundMoney(bal),
    depositLeft: roundMoney(pools.deposit),
    adminLeft: roundMoney(pools.admin),
    transferInLeft: roundMoney(pools.transferIn),
    tradeReservedInWallet,
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

async function getSpendableForPackages(userId) {
  const wallet = await getWalletOrThrow(userId);
  const entries = await WalletLedger.find({ userId })
    .select('amount direction contextType createdAt')
    .lean();
  return computeSpendableForPackagesFromLedgerEntries(entries, wallet.balance);
}

async function assertSpendableForPackagePurchase(userId, amount) {
  const spendable = await getSpendableForPackages(userId);
  const need = Number(amount);
  if (!Number.isFinite(need) || need <= 0) throw new AppError(400, 'Invalid package amount');
  if (spendable.spendableForPackages < need) {
    throw new AppError(
      400,
      `Insufficient spendable balance for packages. Only deposits, admin credits, and incoming transfers can buy packages. Sponsor, matching, and trade income cannot. Spendable: ${spendable.spendableForPackages}, required: ${need}. Add funds first.`
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
  computeSpendableForPackagesFromLedgerEntries,
  sumTradeIncomeCredited,
  getSpendableForPackages,
  assertSpendableForPackagePurchase,
};
