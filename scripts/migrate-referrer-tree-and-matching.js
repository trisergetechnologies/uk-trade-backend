/**
 * Rebuilds binary tree under referrer legs + replays matching income from package purchase history.
 *
 * SAFETY (both required):
 *   PROD_PROTECT=false
 *   MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP
 *
 * Optional:
 *   ALLOW_PRODUCTION_DB=true  — required when MONGO_URI database name is uk_trade
 *
 * Flags:
 *   --dry-run       — report only, no writes
 *   --tree-only     — Phase A only
 *   --matching-only — Phases B–D only (tree must already be rebuilt)
 *
 * Run from uk-trade-backend (API stopped):
 *   PROD_PROTECT=false MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP node scripts/migrate-referrer-tree-and-matching.js --dry-run
 *   PROD_PROTECT=false MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP node scripts/migrate-referrer-tree-and-matching.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { assertTreeMigrationAllowed } = require('../src/utils/migrate-tree-guard');
const { connectDb } = require('../src/db/connect');
const {
  User,
  TreeNode,
  Wallet,
  WalletLedger,
  MatchingIncomeEvent,
  PackageSubscription,
} = require('../src/models');
const { ROLES } = require('../src/constants/roles');
const { placeUserInTree, getMainUserId } = require('../src/services/tree.service');
const { creditMatchingOnPurchase } = require('../src/services/matching.service');
const { recalculateEligibilityForAllPortfolioUsers } = require('../src/services/eligibility.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TREE_ONLY = args.includes('--tree-only');
const MATCHING_ONLY = args.includes('--matching-only');

function parseMongoDbName(uri) {
  const withoutQuery = String(uri || '').split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  if (slash < 0 || slash === withoutQuery.length - 1) return '';
  return withoutQuery.slice(slash + 1);
}

function assertDbTargetAllowed() {
  const dbName = parseMongoDbName(env.mongoUri);
  logger.info({ dbName, mongoUri: env.mongoUri }, 'migration target database');
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error(
      'Refusing to run on database "uk_trade" without ALLOW_PRODUCTION_DB=true. Use uk-trade-migration for practice first.'
    );
  }
  return dbName;
}

async function buildReplayOrder(mainUser, adminUser) {
  const users = await User.find({ role: ROLES.USER }).select('_id createdAt').lean();
  const mainIdStr = String(mainUser._id);
  const rest = users
    .filter((u) => String(u._id) !== mainIdStr)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return [mainUser._id, ...rest.map((u) => u._id)];
}

async function validateTree(mainUserId) {
  const rootNode = await TreeNode.findOne({ parentUserId: null }).lean();
  if (!rootNode || String(rootNode.userId) !== String(mainUserId)) {
    throw new Error('Validation failed: single root must be Main User');
  }
  const extraRoots = await TreeNode.countDocuments({ parentUserId: null });
  if (extraRoots !== 1) {
    throw new Error(`Validation failed: expected 1 root, found ${extraRoots}`);
  }

  const dupes = await TreeNode.aggregate([
    { $match: { parentUserId: { $ne: null } } },
    { $group: { _id: { parentUserId: '$parentUserId', side: '$side' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  if (dupes.length) {
    throw new Error(`Validation failed: duplicate parent/side slots: ${JSON.stringify(dupes.slice(0, 5))}`);
  }

  const admin = await User.findOne({ role: ROLES.ADMIN }).select('_id').lean();
  const networkUsers = await User.find({ role: ROLES.USER }).select('_id referredBy').lean();
  const nodeByUser = new Map(
    (await TreeNode.find({}).select('userId parentUserId').lean()).map((n) => [String(n.userId), n])
  );

  for (const u of networkUsers) {
    if (String(u._id) === String(mainUserId)) continue;
    const node = nodeByUser.get(String(u._id));
    if (!node) {
      throw new Error(`Validation failed: user ${u._id} has no TreeNode`);
    }
    let cur = node;
    let hops = 0;
    while (cur && cur.parentUserId) {
      cur = nodeByUser.get(String(cur.parentUserId));
      hops += 1;
      if (hops > 500) throw new Error(`Validation failed: cycle or depth for user ${u._id}`);
    }
    if (!cur || String(cur.userId) !== String(mainUserId)) {
      throw new Error(`Validation failed: user ${u._id} does not reach Main root`);
    }
    if (u.referredBy && admin && String(u.referredBy) === String(admin._id)) continue;
    if (u.referredBy) {
      const refNode = nodeByUser.get(String(u.referredBy));
      if (!refNode && String(u.referredBy) !== String(mainUserId)) {
        const refUser = await User.findById(u.referredBy).select('role email').lean();
        if (refUser?.role === ROLES.USER) {
          throw new Error(`Validation failed: referrer ${u.referredBy} missing TreeNode for user ${u._id}`);
        }
      }
    }
  }

  return { rootNode, treeNodeCount: await TreeNode.countDocuments({}) };
}

async function phaseRebuildTree(mainUser, adminUser) {
  const replayOrder = await buildReplayOrder(mainUser, adminUser);
  const oldCount = await TreeNode.countDocuments({});

  if (DRY_RUN) {
    return { dryRun: true, oldCount, replayUserCount: replayOrder.length };
  }

  await TreeNode.deleteMany({});
  for (const uid of replayOrder) {
    const u = await User.findById(uid).select('role preferredCommunity referredBy email').lean();
    if (!u || u.role !== ROLES.USER) continue;
    const branch = u.preferredCommunity === 'right' ? 'right' : 'left';
    await placeUserInTree(uid, branch);
  }

  const placedIds = await TreeNode.distinct('userId');
  const placedAt = new Date();
  await User.updateMany({}, { $unset: { treePlacedAt: 1 } });
  if (placedIds.length) {
    await User.updateMany({ _id: { $in: placedIds } }, { $set: { treePlacedAt: placedAt } });
  }
  if (adminUser) {
    await User.updateOne({ _id: adminUser._id }, { $set: { treePlacedAt: null } });
  }

  const validation = await validateTree(mainUser._id);
  return { oldCount, newCount: validation.treeNodeCount, replayUserCount: replayOrder.length, validation };
}

async function archiveMatchingEvents(dbName) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const archiveName = `matchingincomeevents_archive_${stamp}`;
  const db = mongoose.connection.db;
  const source = db.collection('matchingincomeevents');
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

async function stripMatchingFromWallets() {
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
      `Cannot strip matching credits: would make balance negative for ${negativeBalanceUsers.length} user(s): ${JSON.stringify(negativeBalanceUsers.slice(0, 5))}`
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
    const file = path.join(outDir, `migrate-referrer-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    report.reportFile = file;
  }
  logger.info(report, 'migrate-referrer-tree-and-matching completed');
}

async function main() {
  assertTreeMigrationAllowed();
  const dbName = assertDbTargetAllowed();
  await connectDb();

  const mainEmail = env.seedUserEmail.toLowerCase();
  const mainUser = await User.findOne({ email: mainEmail }).lean();
  if (!mainUser || mainUser.role !== ROLES.USER) {
    throw new Error(`Main user not found for email: ${mainEmail}`);
  }
  const adminUser = await User.findOne({ role: ROLES.ADMIN }).select('_id').lean();

  const report = { dryRun: DRY_RUN, dbName, treeOnly: TREE_ONLY, matchingOnly: MATCHING_ONLY };

  if (!MATCHING_ONLY) {
    report.tree = await phaseRebuildTree(mainUser, adminUser);
  }

  let archiveName = null;
  if (!TREE_ONLY) {
    archiveName = `matchingincomeevents_archive_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    report.matchingArchive = await archiveMatchingEvents(dbName);
    archiveName = report.matchingArchive.archiveName;
    report.matchingStrip = await stripMatchingFromWallets();
    report.matchingReplay = await replayMatching();
    if (!DRY_RUN) {
      report.eligibility = { refreshed: true };
      await recalculateEligibilityForAllPortfolioUsers();
    }
  }

  if (!DRY_RUN && !TREE_ONLY) {
    report.walletMismatches = await validateWalletLedgerBalance();
    if (report.walletMismatches.length) {
      throw new Error(`Wallet/ledger mismatch for ${report.walletMismatches.length} user(s)`);
    }
    if (archiveName) {
      report.matchingDeltaByEarner = await matchingDeltaFromArchive(archiveName);
    }
  }

  if (!MATCHING_ONLY && !DRY_RUN) {
    report.treeValidation = await validateTree(mainUser._id);
  }

  await writeReport(report);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'migrate-referrer-tree-and-matching failed');
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
