const { Wallet, WalletLedger } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');
const { enrichLedgerEntries } = require('../services/wallet-ledger-enrich.service');
const { previewEligibility } = require('../services/eligibility.service');
const { getSpendableForPackages, sumTradeIncomeCredited } = require('../services/wallet.service');

async function myWallet(req, res, next) {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.sub });
    if (!wallet) {
      res.json({ success: true, data: null });
      return;
    }
    const [preview, spendable, totalTradeCredited] = await Promise.all([
      previewEligibility(req.user.sub),
      getSpendableForPackages(req.user.sub),
      sumTradeIncomeCredited(req.user.sub),
    ]);
    const data = wallet.toObject ? wallet.toObject() : { ...wallet };
    data.sponsorAvailable = preview.sponsorAvailable;
    data.matchingAvailable = preview.matchingAvailable;
    data.spendableForPackages = spendable.spendableForPackages;
    data.tradeReservedInWallet = spendable.tradeReservedInWallet;
    data.tradeCurrentCycle = Math.max(0, totalTradeCredited - (preview.tradeGross || 0));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function myLedger(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = { userId: req.user.sub };
    const [entries, total] = await Promise.all([
      WalletLedger.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      WalletLedger.countDocuments(filter),
    ]);
    const data = await enrichLedgerEntries(entries, req.user.sub);
    res.json({ success: true, data, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

module.exports = { myWallet, myLedger };
