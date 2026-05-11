/**
 * Rebuilds the entire binary tree under Main User (SEED_USER_EMAIL) as the only root.
 * - Deletes ALL TreeNode documents, then replays placement (same algorithm as live signup).
 * - Excludes role=admin from the tree (no TreeNode for admin).
 * - Does NOT touch wallets, ledger, subscriptions, or income history collections.
 *
 * SAFETY (both required):
 *   PROD_PROTECT=false
 *   MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP
 *
 * OPERATIONS:
 *   Stop the API (or run during maintenance) so no signups/placements run mid-migration.
 *   Take a full MongoDB backup first.
 *
 * Run from uk-trade-backend:
 *   PROD_PROTECT=false MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP node scripts/migrate-tree-main-user-root.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { assertTreeMigrationAllowed } = require('../src/utils/migrate-tree-guard');
const { connectDb } = require('../src/db/connect');
const { User, TreeNode } = require('../src/models');
const { ROLES } = require('../src/constants/roles');
const { placeUserInTree } = require('../src/services/tree.service');
const { logger } = require('../src/utils/logger');

async function main() {
  assertTreeMigrationAllowed();
  await connectDb();

  const mainEmail = env.seedUserEmail.toLowerCase();
  const mainUser = await User.findOne({ email: mainEmail }).lean();
  if (!mainUser || mainUser.role !== ROLES.USER) {
    throw new Error(`Main user not found or not role=user for email: ${mainEmail}`);
  }

  const adminUser = await User.findOne({ role: ROLES.ADMIN }).select('_id').lean();

  const oldCount = await TreeNode.countDocuments({});
  const oldNodes = await TreeNode.find({}).sort({ level: 1, createdAt: 1 }).lean();

  const orderedIds = [];
  const seen = new Set();
  for (const n of oldNodes) {
    const id = String(n.userId);
    if (adminUser && id === String(adminUser._id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(n.userId);
  }

  const mainIdStr = String(mainUser._id);
  const rest = orderedIds.filter((id) => String(id) !== mainIdStr);
  const replayOrder = [mainUser._id, ...rest];

  await TreeNode.deleteMany({});

  for (const uid of replayOrder) {
    const u = await User.findById(uid).select('role').lean();
    if (!u || u.role !== ROLES.USER) continue;
    await placeUserInTree(uid, 'left');
  }

  const newCount = await TreeNode.countDocuments({});
  const placedIds = await TreeNode.distinct('userId');

  await User.updateMany({}, { $unset: { treePlacedAt: 1 } });
  if (placedIds.length) {
    const placedAt = new Date();
    await User.updateMany({ _id: { $in: placedIds } }, { $set: { treePlacedAt: placedAt } });
  }
  if (adminUser) {
    await User.updateOne({ _id: adminUser._id }, { $set: { treePlacedAt: null } });
  }

  const rootNode = await TreeNode.findOne({ parentUserId: null }).lean();
  logger.info(
    {
      oldTreeNodeCount: oldCount,
      newTreeNodeCount: newCount,
      replayedUserCount: replayOrder.length,
      rootUserId: rootNode ? String(rootNode.userId) : null,
      mainUserId: mainIdStr,
      rootMatchesMain: rootNode ? String(rootNode.userId) === mainIdStr : false,
    },
    'migrate-tree-main-user-root completed'
  );

  if (!rootNode || String(rootNode.userId) !== mainIdStr) {
    throw new Error(
      'Post-migration validation failed: expected exactly one root TreeNode owned by main user (SEED_USER_EMAIL).'
    );
  }

  const extraRoots = await TreeNode.countDocuments({ parentUserId: null });
  if (extraRoots !== 1) {
    throw new Error(`Post-migration validation failed: expected 1 root TreeNode, found ${extraRoots}`);
  }
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'migrate-tree-main-user-root failed');
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
