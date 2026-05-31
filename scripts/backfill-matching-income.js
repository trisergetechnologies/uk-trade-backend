/**
 * Backfills matching income for ALL existing users under the current matching rules.
 *
 * Strategy: FULL RECOMPUTE (matching only — never touches the binary tree).
 *   1. Archive the existing matchingincomeevents collection (audit copy).
 *   2. Reverse every matching_income wallet credit already given and reset firstMatchingDone.
 *   3. Replay every package purchase in chronological order through the matching engine.
 *   4. Validate wallet/ledger balances and emit an old-vs-new delta report per earner.
 *
 * Because old matching credits are reversed BEFORE replaying, users are NEVER paid twice:
 * each user ends with exactly their new-logic total. Safe only while no matching income has
 * been withdrawn (the reverse step aborts if it would push any wallet negative).
 *
 * SAFETY (both required):
 *   PROD_PROTECT=false
 *   BACKFILL_MATCHING_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP
 *
 * Optional:
 *   ALLOW_PRODUCTION_DB=true  — required when the MONGO_URI database name is uk_trade
 *
 * Flags:
 *   --dry-run   — report only, no writes
 *
 * Run from uk-trade-backend (API stopped):
 *   PROD_PROTECT=false BACKFILL_MATCHING_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP node scripts/backfill-matching-income.js --dry-run
 *   PROD_PROTECT=false BACKFILL_MATCHING_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP node scripts/backfill-matching-income.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const {
  User,
  Wallet,
  WalletLedger,
  MatchingIncomeEvent,
  PackageSubscription,
  TreeNode,
} = require('../src/models');
const {
  creditMatchingOnPurchase,
  getRelativeTreeSnapshot,
  evaluateMatchingEligibility,
  getMaxActivePackageAmountAsOf,
  calculateMatchingPayout,
  MAX_MATCHING_LEVEL,
} = require('../src/services/matching.service');
const { isNetworkParticipant } = require('../src/utils/network-participant');
const { recalculateEligibilityForAllPortfolioUsers } = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function assertBackfillAllowed() {
  if (env.prodProtectBlocksSeeding) {
    throw new Error('Backfill blocked: set PROD_PROTECT=false in the environment.');
  }
  const confirm = String(process.env.BACKFILL_MATCHING_CONFIRM || '').trim();
  if (confirm !== 'YES_I_HAVE_A_DATABASE_BACKUP') {
    throw new Error(
      'Backfill blocked: set BACKFILL_MATCHING_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP after taking a full MongoDB backup.'
    );
  }
}

function parseMongoDbName(uri) {
  const withoutQuery = String(uri || '').split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  if (slash < 0 || slash === withoutQuery.length - 1) return '';
  return withoutQuery.slice(slash + 1);
}

function assertDbTargetAllowed() {
  const dbName = parseMongoDbName(env.mongoUri);
  logger.info({ dbName, mongoUri: env.mongoUri }, 'backfill target database');
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error('Refusing to run on database "uk_trade" without ALLOW_PRODUCTION_DB=true.');
  }
  return dbName;
}

async function archiveMatchingEvents() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const archiveName = `matchingincomeevents_archive_${stamp}`;
  const db = mongoose.connection.db;
  const existing = await db.listCollections({ name: archiveName }).toArray();
  if (existing.length && !DRY_RUN) {
    throw new Error(`Archive collection ${archiveName} already exists; aborting to avoid overwrite`);
  }

  const docs = await MatchingIncomeEvent.find({}).lean();
  if (DRY_RUN) {
    return { archiveName, archivedCount: docs.length, dryRun: true };
  }
  if (docs.length) {
    await db.collection(archiveName).insertMany(docs);
  }
  const archivedCount = await db.collection(archiveName).countDocuments({});
  if (archivedCount !== docs.length) {
    throw new Error(`Archive verify failed: source=${docs.length} archive=${archivedCount}`);
  }
  return { archiveName, archivedCount };
}

async function reverseMatchingFromWallets() {
  const matchingRows = await WalletLedger.find({ contextType: 'matching_income', direction: 'credit' }).lean();
  const byUser = new Map();
  for (const row of matchingRows) {
    const key = String(row.userId);
    byUser.set(key, (byUser.get(key) || 0) + Number(row.amount || 0));
  }

  if (DRY_RUN) {
    return { ledgerRows: matchingRows.length, usersAffected: byUser.size, dryRun: true };
  }

  const negativeBalanceUsers = [];
  for (const [userId, total] of byUser.entries()) {
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) continue;
    if (wallet.balance < total - 0.001) {
      negativeBalanceUsers.push({ userId, balance: wallet.balance, matchingStrip: total });
    }
  }
  if (negativeBalanceUsers.length) {
    throw new Error(
      `Cannot reverse matching credits without going negative for ${negativeBalanceUsers.length} user(s) ` +
        `(matching income appears already withdrawn): ${JSON.stringify(negativeBalanceUsers.slice(0, 5))}`
    );
  }

  for (const [userId, total] of byUser.entries()) {
    if (total > 0) {
      await Wallet.updateOne({ userId }, { $inc: { balance: -total } });
    }
  }
  const deleted = await WalletLedger.deleteMany({ contextType: 'matching_income' });
  await MatchingIncomeEvent.deleteMany({});
  await User.updateMany({}, { $set: { firstMatchingDone: false } });

  return { ledgerRowsRemoved: deleted.deletedCount, usersAdjusted: byUser.size };
}

async function replayMatching() {
  const subs = await PackageSubscription.find({}).sort({ purchaseAtUtc: 1 }).lean();
  if (DRY_RUN) {
    return { subscriptionCount: subs.length, dryRun: true };
  }

  let processed = 0;
  let credited = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const sub of subs) {
    const result = await creditMatchingOnPurchase({
      triggerBuyerUserId: sub.userId,
      triggerPurchaseSubscriptionId: sub._id,
      asOfUtc: sub.purchaseAtUtc,
    });
    processed += result.processed;
    credited += result.credited;
    skipped += result.skipped;
    duplicates += result.duplicates;
  }

  const eventStats = await MatchingIncomeEvent.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$payoutCreditedAmount' } } },
  ]);

  return { subscriptionCount: subs.length, processed, credited, skipped, duplicates, eventStats };
}

/**
 * Read-only projection of the new matching logic over the full purchase history.
 * Mirrors creditMatchingOnPurchase's orchestration but writes nothing: cap usage and
 * the first-matching flag are tracked in memory so we can preview per-user payouts.
 */
async function simulateReplay() {
  const subs = await PackageSubscription.find({}).sort({ purchaseAtUtc: 1 }).lean();

  const paidByEarner = new Map();
  const eventsByEarner = new Map();
  const firstDone = new Set();
  const earnerNodeCache = new Map();
  const earnerUserCache = new Map();

  let processed = 0;
  let credited = 0;
  let skipped = 0;

  const getEarnerNode = async (userId) => {
    const key = String(userId);
    if (earnerNodeCache.has(key)) return earnerNodeCache.get(key);
    const node = await TreeNode.findOne({ userId }).lean();
    earnerNodeCache.set(key, node);
    return node;
  };
  const getEarnerUser = async (userId) => {
    const key = String(userId);
    if (earnerUserCache.has(key)) return earnerUserCache.get(key);
    const user = await User.findById(userId).select('_id role').lean();
    earnerUserCache.set(key, user);
    return user;
  };

  for (const sub of subs) {
    const asOfUtc = sub.purchaseAtUtc;
    const triggerBuyerUserId = sub.userId;
    const triggerPurchaseAmount = round2(sub.principalAmount || 0);
    const triggerNode = await getEarnerNode(triggerBuyerUserId);
    if (!triggerNode) continue;

    let cursorParentUserId = triggerNode.parentUserId;
    let hops = 1;
    while (cursorParentUserId && hops <= MAX_MATCHING_LEVEL) {
      const earnerNode = await getEarnerNode(cursorParentUserId);
      if (!earnerNode) break;
      const earnerUser = await getEarnerUser(cursorParentUserId);
      if (!earnerUser) break;
      if (!isNetworkParticipant(earnerUser)) {
        cursorParentUserId = earnerNode.parentUserId;
        hops += 1;
        continue;
      }

      const snapshot = await getRelativeTreeSnapshot(earnerNode, triggerBuyerUserId, asOfUtc);
      if (snapshot) {
        processed += 1;
        const earnerId = String(earnerUser._id);
        const eligibility = evaluateMatchingEligibility(snapshot, firstDone.has(earnerId));
        if (!eligibility.eligible || triggerPurchaseAmount <= 0) {
          skipped += 1;
        } else {
          const capBaseAmount = round2(await getMaxActivePackageAmountAsOf(earnerUser._id, asOfUtc));
          const { payoutCreditedAmount } = calculateMatchingPayout({
            considerableAmount: triggerPurchaseAmount,
            matchingPercent: env.matchingIncomePercent,
            capBaseAmount,
          });
          if (payoutCreditedAmount > 0) {
            paidByEarner.set(earnerId, round2((paidByEarner.get(earnerId) || 0) + payoutCreditedAmount));
            eventsByEarner.set(earnerId, (eventsByEarner.get(earnerId) || 0) + 1);
            firstDone.add(earnerId);
            credited += 1;
          } else {
            skipped += 1;
          }
        }
      }

      cursorParentUserId = earnerNode.parentUserId;
      hops += 1;
    }
  }

  // Old (current) credited totals per earner from existing events.
  const oldRows = await MatchingIncomeEvent.aggregate([
    { $match: { status: 'credited' } },
    { $group: { _id: '$earnerUserId', total: { $sum: '$payoutCreditedAmount' } } },
  ]);
  const oldMap = new Map(oldRows.map((r) => [String(r._id), round2(r.total)]));

  const earnerIds = new Set([...paidByEarner.keys(), ...oldMap.keys()]);
  const userDocs = earnerIds.size
    ? await User.find({ _id: { $in: [...earnerIds] } }).select('_id name email userCode').lean()
    : [];
  const userById = new Map(userDocs.map((u) => [String(u._id), u]));

  const perEarner = [...earnerIds]
    .map((id) => {
      const u = userById.get(id) || {};
      const newTotal = paidByEarner.get(id) || 0;
      const oldTotal = oldMap.get(id) || 0;
      return {
        earnerUserId: id,
        userCode: u.userCode || '',
        name: u.name || '',
        email: u.email || '',
        events: eventsByEarner.get(id) || 0,
        oldTotal,
        newTotal,
        delta: round2(newTotal - oldTotal),
      };
    })
    .sort((a, b) => b.newTotal - a.newTotal);

  const usersGettingMatching = perEarner.filter((r) => r.newTotal > 0);
  const projectedTotal = round2(perEarner.reduce((s, r) => s + r.newTotal, 0));
  const currentTotal = round2(perEarner.reduce((s, r) => s + r.oldTotal, 0));

  return {
    subscriptionCount: subs.length,
    processed,
    projectedCreditedEvents: credited,
    projectedSkippedEvents: skipped,
    usersGettingMatchingCount: usersGettingMatching.length,
    projectedTotalMatching: projectedTotal,
    currentTotalMatching: currentTotal,
    perEarner,
  };
}

async function validateWalletLedgerBalance() {
  const wallets = await Wallet.find({}).lean();
  const mismatches = [];
  for (const w of wallets) {
    const rows = await WalletLedger.aggregate([
      { $match: { userId: w.userId } },
      {
        $group: {
          _id: null,
          credits: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', 0] } },
          debits: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', 0] } },
        },
      },
    ]);
    const net = rows.length ? Number(rows[0].credits || 0) - Number(rows[0].debits || 0) : 0;
    const balance = Number(w.balance || 0);
    if (Math.abs(net - balance) > 0.02) {
      mismatches.push({ userId: String(w.userId), balance, ledgerNet: net });
    }
  }
  return mismatches;
}

async function matchingDeltaFromArchive(archiveName) {
  const db = mongoose.connection.db;
  const cols = await db.listCollections({ name: archiveName }).toArray();
  if (!cols.length) return null;

  const oldRows = await db
    .collection(archiveName)
    .aggregate([
      { $match: { status: 'credited' } },
      { $group: { _id: '$earnerUserId', total: { $sum: '$payoutCreditedAmount' } } },
    ])
    .toArray();
  const newRows = await MatchingIncomeEvent.aggregate([
    { $match: { status: 'credited' } },
    { $group: { _id: '$earnerUserId', total: { $sum: '$payoutCreditedAmount' } } },
  ]);

  const oldMap = new Map(oldRows.map((r) => [String(r._id), Number(r.total || 0)]));
  const newMap = new Map(newRows.map((r) => [String(r._id), Number(r.total || 0)]));
  const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);
  const deltas = [];
  for (const id of allIds) {
    const oldT = oldMap.get(id) || 0;
    const newT = newMap.get(id) || 0;
    if (Math.abs(oldT - newT) > 0.01) {
      deltas.push({ earnerUserId: id, oldTotal: oldT, newTotal: newT, delta: Number((newT - oldT).toFixed(2)) });
    }
  }
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return deltas;
}

async function writeReport(report) {
  const outDir = path.join(__dirname, 'output');
  if (!DRY_RUN) {
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `backfill-matching-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    report.reportFile = file;
  }
  logger.info(report, 'backfill-matching-income completed');
}

async function main() {
  assertBackfillAllowed();
  const dbName = assertDbTargetAllowed();
  await connectDb();

  const report = { dryRun: DRY_RUN, dbName };

  if (DRY_RUN) {
    // Read-only projection: shows who would receive matching income under the new logic.
    report.simulation = await simulateReplay();
    await writeReport(report);
    return report;
  }

  report.matchingArchive = await archiveMatchingEvents();
  const archiveName = report.matchingArchive.archiveName;
  report.matchingReverse = await reverseMatchingFromWallets();
  report.matchingReplay = await replayMatching();

  if (!DRY_RUN) {
    await recalculateEligibilityForAllPortfolioUsers();
    report.eligibility = { refreshed: true };

    report.walletMismatches = await validateWalletLedgerBalance();
    if (report.walletMismatches.length) {
      throw new Error(`Wallet/ledger mismatch for ${report.walletMismatches.length} user(s)`);
    }
    report.matchingDeltaByEarner = await matchingDeltaFromArchive(archiveName);
  }

  await writeReport(report);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'backfill-matching-income failed');
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
