const { Wallet, WalletLedger } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');
const { enrichLedgerEntries } = require('../services/wallet-ledger-enrich.service');
const { previewEligibility } = require('../services/eligibility.service');

async function myWallet(req, res, next) {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.sub });
    if (!wallet) {
      res.json({ success: true, data: null });
      return;
    }
    const preview = await previewEligibility(req.user.sub);
    const data = wallet.toObject ? wallet.toObject() : { ...wallet };
    data.sponsorAvailable = preview.sponsorAvailable;
    data.matchingAvailable = preview.matchingAvailable;
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
