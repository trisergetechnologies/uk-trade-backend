const { Wallet, WalletLedger } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');

async function myWallet(req, res, next) {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.sub });
    res.json({ success: true, data: wallet });
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
    res.json({ success: true, data: entries, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

module.exports = { myWallet, myLedger };
