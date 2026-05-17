const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { connectDb } = require('../src/db/connect');
const { bootstrapAdmin } = require('../src/services/auth.service');
const { env } = require('../src/config/env');
const { placeUserInTree, getMainUserId, computeBranchUnderMainFromNode } = require('../src/services/tree.service');
const { User, TreeNode, Wallet } = require('../src/models');
const { createNumericPublicId } = require('../src/utils/public-id');

function branchUnderReferrer(node, referrerUserId, nodeByUserId) {
  if (!node || String(node.userId) === String(referrerUserId)) return null;
  let cur = node;
  while (cur && cur.parentUserId) {
    if (String(cur.parentUserId) === String(referrerUserId)) {
      return cur.side === 'right' ? 'right' : 'left';
    }
    cur = nodeByUserId.get(String(cur.parentUserId));
    if (!cur) return null;
  }
  return null;
}

async function createNetworkUser({ name, email, referredBy, community }) {
  const passwordHash = await bcrypt.hash('testpass123', 10);
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash,
    userCode: createNumericPublicId(5),
    referralCode: createNumericPublicId(5),
    referredBy,
    preferredCommunity: community,
    role: 'user',
  });
  await Wallet.create({ userId: user._id, balance: 0, eligibleToWithdraw: 0 });
  await placeUserInTree(user._id, community);
  return user;
}

beforeAll(async () => {
  await connectDb();
  await mongoose.connection.dropDatabase();
  await bootstrapAdmin();
  const admin = await User.findOne({ role: 'admin' }).lean();
  const main = await User.create({
    name: 'Main',
    email: env.seedUserEmail.toLowerCase(),
    passwordHash: await bcrypt.hash('testpass123', 10),
    userCode: createNumericPublicId(5),
    referralCode: createNumericPublicId(5),
    referredBy: admin._id,
    preferredCommunity: 'right',
    role: 'user',
  });
  await Wallet.create({ userId: main._id, balance: 0, eligibleToWithdraw: 0 });
  await placeUserInTree(main._id, 'right');
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('tree.service referrer-leg placement', () => {
  test('places new user under referrer branch, not Main User leg', async () => {
    const mainUserId = await getMainUserId();
    const referrer = await createNetworkUser({
      name: 'Referrer A',
      email: 'referrer.a@test.local',
      referredBy: mainUserId,
      community: 'left',
    });

    await createNetworkUser({
      name: 'Main Right Leg',
      email: 'main.right.leg@test.local',
      referredBy: mainUserId,
      community: 'right',
    });

    const child = await createNetworkUser({
      name: 'Child Under Referrer',
      email: 'child.under.referrer@test.local',
      referredBy: referrer._id,
      community: 'right',
    });

    const childNode = await TreeNode.findOne({ userId: child._id }).lean();
    const mainRightDirect = await TreeNode.findOne({ parentUserId: mainUserId, side: 'right' }).lean();

    expect(String(childNode.parentUserId)).toBe(String(referrer._id));
    expect(childNode.side).toBe('right');
    expect(String(mainRightDirect.userId)).not.toBe(String(child._id));

    const nodes = await TreeNode.find({}).lean();
    const byUserId = new Map(nodes.map((n) => [String(n.userId), n]));
    expect(branchUnderReferrer(childNode, referrer._id, byUserId)).toBe('right');
  });

  test('falls back to Main User when referrer has no tree node', async () => {
    const mainUserId = await getMainUserId();
    const referrer = await createNetworkUser({
      name: 'Referrer Without Node',
      email: 'referrer.nonode@test.local',
      referredBy: mainUserId,
      community: 'right',
    });
    await TreeNode.deleteOne({ userId: referrer._id });
    expect(await TreeNode.exists({ userId: referrer._id })).toBeNull();

    const child = await createNetworkUser({
      name: 'Fallback Child',
      email: 'fallback.child@test.local',
      referredBy: referrer._id,
      community: 'left',
    });

    const childNode = await TreeNode.findOne({ userId: child._id }).lean();
    const nodes = await TreeNode.find({}).lean();
    const byUserId = new Map(nodes.map((n) => [String(n.userId), n]));

    expect(String(childNode.parentUserId)).not.toBe(String(referrer._id));
    expect(computeBranchUnderMainFromNode(childNode, mainUserId, byUserId)).toBe('left');
  });
});
