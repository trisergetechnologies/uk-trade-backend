/**
 * Find users who already withdrew more than current Eligible rules allow
 * (same case as Raju: locked trade left the wallet via approved withdrawals).
 *
 * Read-only. Run from uk-trade-backend:
 *   node scripts/report-over-withdrawn-users.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDb } = require('../src/db/connect');
const { User, Wallet, WalletLedger, TradeCreditEvent, FundTransfer } = require('../src/models');
const { previewEligibility } = require('../src/services/eligibility.service');

function r2(n) {
  return Number(Number(n || 0).toFixed(2));
}

async function sumByUser(Model, match, field) {
  const rows = await Model.aggregate([
    { $match: match },
    { $group: { _id: '$userId', t: { $sum: `$${field}` } } },
  ]);
  const map = new Map();
  for (const row of rows) map.set(String(row._id), Number(row.t) || 0);
  return map;
}

async function main() {
  await connectDb();
  const wallets = await Wallet.find({}).select('userId balance eligibleToWithdraw').lean();
  const users = await User.find({ _id: { $in: wallets.map((w) => w.userId) } })
    .select('name email userCode')
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const tradeByUser = await TradeCreditEvent.aggregate([
    { $group: { _id: '$userId', t: { $sum: '$amount' } } },
  ]);
  const tradeMap = new Map(tradeByUser.map((r) => [String(r._id), Number(r.t) || 0]));

  const transferDocs = await FundTransfer.aggregate([
    { $group: { _id: '$toUserId', t: { $sum: '$amount' } } },
  ]);
  const transferDocMap = new Map(transferDocs.map((r) => [String(r._id), Number(r.t) || 0]));

  const transferLedger = await WalletLedger.aggregate([
    { $match: { direction: 'credit', contextType: 'fund_transfer_in' } },
    { $group: { _id: '$userId', t: { $sum: '$amount' } } },
  ]);
  const transferLedgerMap = new Map(transferLedger.map((r) => [String(r._id), Number(r.t) || 0]));

  const hits = [];
  let scanned = 0;
  for (const wallet of wallets) {
    scanned += 1;
    const uid = wallet.userId;
    const preview = await previewEligibility(uid);
    const raw =
      preview.tradeGross +
      preview.sponsorGross +
      preview.matchingGross +
      preview.bonus +
      preview.fundTransferIn -
      preview.fundTransferOut -
      preview.matchingPaidByAdmin -
      preview.approved -
      preview.pending -
      (preview.packageSpendFromEligible || 0);
    const overWithdrawn = r2(Math.max(0, -raw));
    if (overWithdrawn < 0.01) continue;
    const id = String(uid);
    const user = userById.get(id) || {};
    const tradeAll = r2(tradeMap.get(id) || 0);
    const transferDocsIn = r2(transferDocMap.get(id) || 0);
    const transferLedgerIn = r2(transferLedgerMap.get(id) || 0);
    hits.push({
      name: user.name || '',
      email: user.email || '',
      userCode: preview.userCode || user.userCode || '',
      overWithdrawn,
      approved: preview.approved,
      pending: preview.pending,
      entitledBeforeWithdrawals: r2(raw + preview.approved + preview.pending),
      tradeAll,
      tradeUnlocked: preview.tradeGross,
      tradeLocked: r2(tradeAll - preview.tradeGross),
      balance: r2(wallet.balance),
      eligibleStored: r2(wallet.eligibleToWithdraw),
      eligibleFormula: preview.proposedEligible,
      transferDocsIn,
      transferLedgerIn,
      transferDocGap: r2(transferDocsIn - transferLedgerIn),
    });
  }

  hits.sort((a, b) => b.overWithdrawn - a.overWithdrawn);
  console.log(
    JSON.stringify(
      {
        database: mongoose.connection.name,
        scanned,
        overWithdrawnCount: hits.length,
        note: 'overWithdrawn = approved+pending above current Eligible sources (unlocked trade + sponsor + matching + leftover admin bonus + transfers in − out − matchingPaidByAdmin − package spend from those sources). Same as Raju taking locked trade out early.',
        users: hits,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
