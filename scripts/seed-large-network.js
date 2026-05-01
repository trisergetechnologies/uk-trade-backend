/**
 * Seeds a very large and deep team under a chosen root user.
 *
 * Usage examples:
 *   npm run seed:network
 *   npm run seed:network -- --total=2500 --depth=60
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { connectDb } = require('../src/db/connect');
const { env } = require('../src/config/env');
const { assertSeedingAllowed } = require('../src/utils/seed-guard');
const { User, Wallet, TreeNode } = require('../src/models');
const { bootstrapAdmin, ensureSeedMainUser } = require('../src/services/auth.service');
const { logger } = require('../src/utils/logger');

function parseArg(name, fallback) {
  const row = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!row) return fallback;
  const value = Number.parseInt(row.split('=')[1], 10);
  return Number.isFinite(value) ? value : fallback;
}

async function main() {
  assertSeedingAllowed();
  const totalUsers = Math.max(200, parseArg('total', 2000));
  const targetDepth = Math.max(15, parseArg('depth', 45));

  await connectDb();
  await bootstrapAdmin();
  await ensureSeedMainUser();

  const rootUser = await User.findOne({ email: env.seedUserEmail.toLowerCase() }).lean();
  if (!rootUser) throw new Error(`Root user not found for ${env.seedUserEmail}`);
  const rootNode = await TreeNode.findOne({ userId: rootUser._id }).lean();
  if (!rootNode) throw new Error('Root user has no tree node');

  const passHash = await bcrypt.hash(env.seedSharedPassword, 10);
  const run = Date.now().toString(36).toUpperCase();

  const newUsers = [];
  const newWallets = [];
  const newNodes = [];

  const nodesById = new Map([[String(rootNode.userId), { ...rootNode }]]);
  const childSides = new Map();
  const existingChildren = await TreeNode.find({ parentUserId: rootNode.userId }).select('parentUserId side').lean();
  childSides.set(
    String(rootNode.userId),
    new Set(existingChildren.map((c) => c.side))
  );

  const queue = [nodesById.get(String(rootNode.userId))];

  function createMember({ parent, side, level }) {
    const id = new mongoose.Types.ObjectId();
    const idx = newUsers.length + 1;
    const userCode = `USR${run}${String(idx).padStart(6, '0')}`;
    const referralCode = `UT${run}${String(idx).padStart(6, '0')}`;
    const email = `load.${run}.${String(idx).padStart(6, '0')}@uktrade.local`;
    const community = parent.community || rootNode.community || 'left';
    const name = `Load User ${idx}`;
    const user = {
      _id: id,
      name,
      email,
      passwordHash: passHash,
      role: 'user',
      userCode,
      referralCode,
      referredBy: rootUser._id,
      preferredCommunity: community,
      treePlacedAt: new Date(),
      isActive: idx % 11 !== 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const wallet = {
      userId: id,
      balance: 1000 + (idx % 9) * 200,
      eligibleToWithdraw: 500 + (idx % 7) * 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const node = {
      userId: id,
      parentUserId: parent.userId,
      side,
      community,
      level,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    newUsers.push(user);
    newWallets.push(wallet);
    newNodes.push(node);
    nodesById.set(String(id), node);
    return node;
  }

  // 1) Build a long depth chain first.
  let cursor = nodesById.get(String(rootNode.userId));
  let cursorLevel = Number(rootNode.level || 0);
  for (let i = 0; i < targetDepth && newUsers.length < totalUsers; i += 1) {
    const parentId = String(cursor.userId);
    const used = childSides.get(parentId) || new Set();
    const side = used.has('left') ? (used.has('right') ? null : 'right') : 'left';
    if (!side) break;
    used.add(side);
    childSides.set(parentId, used);
    const node = createMember({ parent: cursor, side, level: cursorLevel + 1 });
    cursor = node;
    cursorLevel += 1;
    queue.push(node);
  }

  // 2) Fill wide tree with BFS for high volume.
  while (newUsers.length < totalUsers && queue.length) {
    const parent = queue.shift();
    if (!parent) break;
    const parentId = String(parent.userId);
    const used = childSides.get(parentId) || new Set();
    for (const side of ['left', 'right']) {
      if (newUsers.length >= totalUsers) break;
      if (used.has(side)) continue;
      used.add(side);
      const node = createMember({
        parent,
        side,
        level: Number(parent.level || 0) + 1,
      });
      queue.push(node);
    }
    childSides.set(parentId, used);
  }

  if (!newUsers.length) {
    logger.info('No new users inserted (root may already be saturated).');
    return;
  }

  await User.insertMany(newUsers, { ordered: false });
  await Wallet.insertMany(newWallets, { ordered: false });
  await TreeNode.insertMany(newNodes, { ordered: false });

  const deepest = newNodes.reduce((mx, n) => Math.max(mx, Number(n.level || 0)), Number(rootNode.level || 0));
  logger.info(
    {
      seededUsers: newUsers.length,
      targetUsers: totalUsers,
      targetDepth,
      achievedDepth: deepest,
      rootUserEmail: rootUser.email,
      rootUserCode: rootUser.userCode,
      sharedPassword: env.seedSharedPassword,
      runTag: run,
    },
    'Large network seed completed'
  );
}

main()
  .catch((err) => {
    logger.error({ err }, 'Large network seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });

