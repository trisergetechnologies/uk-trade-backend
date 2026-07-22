/**
 * Move a single user (and their whole subtree) to an EMPTY left/right slot under a chosen sponsor.
 *
 * Use case: a referral spilled onto the wrong leg (e.g. everyone landed left, right leg empty).
 * This re-parents the user under the sponsor's empty slot and recomputes levels for the whole
 * moved subtree. It DOES NOT touch matching income — run the matching replay afterwards (see below).
 *
 * SAFETY (both required, same convention as other tree migrations):
 *   PROD_PROTECT=false
 *   MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP
 *
 * Optional:
 *   ALLOW_PRODUCTION_DB=true   — required only when the target database name is "uk_trade"
 *
 * Flags:
 *   --user-code <code>          user to move (e.g. 20392)      \  one of these
 *   --user-email <email>        user to move (by email)        /  identifies the mover
 *   --to-sponsor-code <code>    sponsor to move under (e.g. 66280)   \ one of these
 *   --to-sponsor-email <email>  sponsor to move under (by email)     / identifies the new parent
 *   --side <left|right>         which empty slot under the sponsor (default: right)
 *   --dry-run                   report only, no writes
 *
 * Example (ALWAYS dry-run first):
 *   PROD_PROTECT=false MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     node scripts/move-user-to-empty-leg.js --user-code 20392 --to-sponsor-code 66280 --side right --dry-run
 *
 * Then apply:
 *   PROD_PROTECT=false MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     node scripts/move-user-to-empty-leg.js --user-code 20392 --to-sponsor-code 66280 --side right
 *
 * After applying, recompute matching income on the new tree:
 *   PROD_PROTECT=false MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \
 *     node scripts/migrate-referrer-tree-and-matching.js --matching-only
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { assertTreeMigrationAllowed } = require('../src/utils/migrate-tree-guard');
const { connectDb } = require('../src/db/connect');
const { User, TreeNode } = require('../src/models');
const { getMainUserId } = require('../src/services/tree.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function readArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? String(args[i + 1] || '').trim() : '';
}

function parseMongoDbName(uri) {
  const withoutQuery = String(uri || '').split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  if (slash < 0 || slash === withoutQuery.length - 1) return '';
  return withoutQuery.slice(slash + 1);
}

function assertDbTargetAllowed() {
  const dbName = parseMongoDbName(env.mongoUri);
  logger.info({ dbName, mongoUri: env.mongoUri }, 'move-user target database');
  if (dbName === 'uk_trade' && String(process.env.ALLOW_PRODUCTION_DB || '').trim() !== 'true') {
    throw new Error(
      'Refusing to run on database "uk_trade" without ALLOW_PRODUCTION_DB=true. Practice on a copy first.'
    );
  }
  return dbName;
}

async function resolveUser({ code, email, label }) {
  let user = null;
  if (code) user = await User.findOne({ userCode: code.toUpperCase() }).select('_id name email userCode').lean();
  if (!user && email) {
    user = await User.findOne({ email: email.toLowerCase() }).select('_id name email userCode').lean();
  }
  if (!user) throw new Error(`${label} not found (code="${code}" email="${email}")`);
  return user;
}

/** BFS collect the moved user's subtree (root + all descendants) as TreeNode docs. */
async function collectSubtree(rootUserId) {
  const root = await TreeNode.findOne({ userId: rootUserId }).lean();
  if (!root) throw new Error(`Move user has no TreeNode: ${rootUserId}`);
  const all = [root];
  let frontier = [rootUserId];
  const seen = new Set([String(rootUserId)]);
  while (frontier.length) {
    const children = await TreeNode.find({ parentUserId: { $in: frontier } }).lean();
    if (!children.length) break;
    const next = [];
    for (const c of children) {
      const id = String(c.userId);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(c);
      next.push(c.userId);
    }
    frontier = next;
  }
  return all;
}

/** Is `maybeAncestorId` on the parent-chain of `nodeUserId` (would moving under it create a cycle)? */
async function isAncestorOf(maybeAncestorId, nodeUserId, nodeByUserId) {
  let cur = nodeByUserId.get(String(nodeUserId));
  let hops = 0;
  while (cur && cur.parentUserId) {
    if (String(cur.parentUserId) === String(maybeAncestorId)) return true;
    cur = nodeByUserId.get(String(cur.parentUserId));
    if (++hops > 1000) throw new Error('Cycle detected while checking ancestry');
  }
  return false;
}

async function main() {
  assertTreeMigrationAllowed();
  const dbName = assertDbTargetAllowed();
  await connectDb();

  const side = (readArg('--side') || 'right').toLowerCase();
  if (side !== 'left' && side !== 'right') throw new Error('--side must be left or right');

  const moveUser = await resolveUser({
    code: readArg('--user-code'),
    email: readArg('--user-email'),
    label: 'Move user',
  });
  const sponsor = await resolveUser({
    code: readArg('--to-sponsor-code'),
    email: readArg('--to-sponsor-email'),
    label: 'Sponsor',
  });

  if (String(moveUser._id) === String(sponsor._id)) {
    throw new Error('Move user and sponsor cannot be the same person');
  }

  const mainUserId = await getMainUserId();
  const sponsorNode = await TreeNode.findOne({ userId: sponsor._id }).lean();
  if (!sponsorNode) throw new Error(`Sponsor has no TreeNode: ${sponsor.userCode}`);

  const moveNode = await TreeNode.findOne({ userId: moveUser._id }).lean();
  if (!moveNode) throw new Error(`Move user has no TreeNode: ${moveUser.userCode}`);

  // The target slot under the sponsor must be empty.
  const slotTaken = await TreeNode.findOne({ parentUserId: sponsor._id, side }).lean();
  if (slotTaken && String(slotTaken.userId) !== String(moveUser._id)) {
    throw new Error(
      `Sponsor ${sponsor.userCode} already has a ${side} child (userId=${slotTaken.userId}). Slot not empty; aborting.`
    );
  }

  // Cycle guard: sponsor must not be inside the moved subtree.
  const allNodes = await TreeNode.find({}).select('userId parentUserId level side').lean();
  const nodeByUserId = new Map(allNodes.map((n) => [String(n.userId), n]));
  if (await isAncestorOf(moveUser._id, sponsor._id, nodeByUserId)) {
    throw new Error('Sponsor is a descendant of the move user; moving would create a cycle. Aborting.');
  }

  const subtree = await collectSubtree(moveUser._id);
  const newRootLevel = Number(sponsorNode.level || 0) + 1;

  // Recompute absolute levels for the whole moved subtree via BFS from the new root level.
  const levelByUserId = new Map();
  levelByUserId.set(String(moveUser._id), newRootLevel);
  {
    const childrenByParent = new Map();
    for (const n of subtree) {
      const p = String(n.parentUserId || '');
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p).push(n);
    }
    const queue = [String(moveUser._id)];
    while (queue.length) {
      const pid = queue.shift();
      const parentLevel = levelByUserId.get(pid);
      for (const child of childrenByParent.get(pid) || []) {
        levelByUserId.set(String(child.userId), parentLevel + 1);
        queue.push(String(child.userId));
      }
    }
  }

  const oldParent = moveNode.parentUserId
    ? await User.findById(moveNode.parentUserId).select('userCode name email').lean()
    : null;

  const levelChanges = subtree.map((n) => ({
    userId: String(n.userId),
    oldLevel: Number(n.level || 0),
    newLevel: levelByUserId.get(String(n.userId)),
  }));

  const report = {
    dryRun: DRY_RUN,
    dbName,
    side,
    moveUser: { userCode: moveUser.userCode, name: moveUser.name, email: moveUser.email, id: String(moveUser._id) },
    sponsor: { userCode: sponsor.userCode, name: sponsor.name, email: sponsor.email, id: String(sponsor._id) },
    from: {
      parentId: moveNode.parentUserId ? String(moveNode.parentUserId) : null,
      parentUserCode: oldParent?.userCode || null,
      side: moveNode.side,
      level: Number(moveNode.level || 0),
    },
    to: { parentId: String(sponsor._id), parentUserCode: sponsor.userCode, side, level: newRootLevel },
    subtreeSize: subtree.length,
    levelDeltaForRoot: newRootLevel - Number(moveNode.level || 0),
    sampleLevelChanges: levelChanges.slice(0, 25),
  };

  if (DRY_RUN) {
    logger.info(report, 'move-user-to-empty-leg DRY RUN (no writes)');
    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    return;
  }

  // Apply: re-parent the moved root, then relevel the whole subtree.
  const bulk = [];
  bulk.push({
    updateOne: {
      filter: { userId: moveUser._id },
      update: {
        $set: {
          parentUserId: sponsor._id,
          side,
          community: side,
          level: newRootLevel,
        },
      },
    },
  });
  for (const n of subtree) {
    if (String(n.userId) === String(moveUser._id)) continue;
    bulk.push({
      updateOne: {
        filter: { userId: n.userId },
        update: { $set: { level: levelByUserId.get(String(n.userId)) } },
      },
    });
  }
  const bulkResult = await TreeNode.bulkWrite(bulk, { ordered: true });
  report.bulkResult = { matched: bulkResult.matchedCount, modified: bulkResult.modifiedCount };

  // Keep the user's own preferredCommunity pointer consistent with their placed side.
  await User.updateOne({ _id: moveUser._id }, { $set: { preferredCommunity: side } });

  // Post-validation.
  const errors = [];

  // 1. No duplicate (parentUserId, side) slots anywhere.
  const dupes = await TreeNode.aggregate([
    { $match: { parentUserId: { $ne: null } } },
    { $group: { _id: { parentUserId: '$parentUserId', side: '$side' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  if (dupes.length) errors.push(`duplicate parent/side slots: ${JSON.stringify(dupes.slice(0, 5))}`);

  // 2. Moved subtree reaches Main root and levels are consistent (child = parent + 1).
  const refreshed = await TreeNode.find({}).select('userId parentUserId level').lean();
  const freshByUser = new Map(refreshed.map((n) => [String(n.userId), n]));
  for (const n of subtree) {
    const cur = freshByUser.get(String(n.userId));
    if (!cur) {
      errors.push(`node vanished after update: ${n.userId}`);
      continue;
    }
    if (cur.parentUserId) {
      const parent = freshByUser.get(String(cur.parentUserId));
      if (parent && Number(cur.level || 0) !== Number(parent.level || 0) + 1) {
        errors.push(`level mismatch user ${cur.userId}: level=${cur.level} parentLevel=${parent.level}`);
      }
    }
  }
  // Reaches main root
  {
    let cur = freshByUser.get(String(moveUser._id));
    let hops = 0;
    while (cur && cur.parentUserId) {
      cur = freshByUser.get(String(cur.parentUserId));
      if (++hops > 1000) {
        errors.push('cycle detected after move');
        break;
      }
    }
    if (!cur || (mainUserId && String(cur.userId) !== String(mainUserId))) {
      errors.push('moved subtree does not reach Main User root');
    }
  }

  report.validationErrors = errors;

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `move-user-${moveUser.userCode}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  report.reportFile = file;

  if (errors.length) {
    logger.error(report, 'move-user-to-empty-leg completed WITH VALIDATION ERRORS — review immediately');
    console.log(JSON.stringify(report, null, 2));
    throw new Error(`Post-move validation failed with ${errors.length} error(s). See ${file}`);
  }

  logger.info(report, 'move-user-to-empty-leg completed OK');
  console.log(JSON.stringify(report, null, 2));
  console.log(
    '\nNEXT STEP: recompute matching income on the new tree:\n' +
      '  PROD_PROTECT=false MIGRATE_TREE_CONFIRM=YES_I_HAVE_A_DATABASE_BACKUP \\\n' +
      '    node scripts/migrate-referrer-tree-and-matching.js --matching-only\n'
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error({ err }, 'move-user-to-empty-leg failed');
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
