/**
 * READ-ONLY: compares tree position vs signup community relative to each user's referrer.
 *
 * Run:
 *   node scripts/analyze-tree-vs-referrer.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { User, TreeNode } = require('../src/models');
const { ROLES } = require('../src/constants/roles');
const { getMainUserId, normalizeSignupBranch } = require('../src/services/tree.service');

function computeBranchUnderReferrer(node, referrerUserId, nodeByUserId) {
  if (!node || !referrerUserId) return null;
  if (String(node.userId) === String(referrerUserId)) return null;
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

async function main() {
  await connectDb();

  const mainUserId = await getMainUserId();
  if (!mainUserId) {
    throw new Error(`No main user for SEED_USER_EMAIL=${env.seedUserEmail}`);
  }

  const nodes = await TreeNode.find({}).lean();
  const byUserId = new Map(nodes.map((n) => [String(n.userId), n]));

  const users = await User.find({ role: ROLES.USER })
    .select('email name userCode preferredCommunity referredBy')
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const admin = await User.findOne({ role: ROLES.ADMIN }).select('_id').lean();

  const mismatches = [];
  let checked = 0;

  for (const u of users) {
    if (String(u._id) === String(mainUserId)) continue;
    const node = byUserId.get(String(u._id));
    if (!node) {
      mismatches.push({ userCode: u.userCode, email: u.email, issue: 'no_tree_node' });
      continue;
    }

    const signup = normalizeSignupBranch(u.preferredCommunity);
    let referrerId = u.referredBy;
    if (!referrerId) {
      mismatches.push({ userCode: u.userCode, email: u.email, issue: 'no_referrer' });
      continue;
    }
    if (admin && String(referrerId) === String(admin._id)) {
      referrerId = mainUserId;
    }

    const referrer = userById.get(String(referrerId));
    if (!referrer) {
      mismatches.push({ userCode: u.userCode, email: u.email, issue: 'referrer_not_user' });
      continue;
    }

    checked += 1;
    const actualBranch = computeBranchUnderReferrer(node, referrerId, byUserId);
    if (actualBranch === null) {
      mismatches.push({
        userCode: u.userCode,
        email: u.email,
        issue: 'not_under_referrer_subtree',
        signupIntent: signup,
        referrerUserCode: referrer.userCode,
      });
      continue;
    }

    if (actualBranch !== signup) {
      mismatches.push({
        userCode: u.userCode,
        email: u.email,
        signupIntent: signup,
        actualBranchUnderReferrer: actualBranch,
        referrerUserCode: referrer.userCode,
      });
    }
  }

  const summary = {
    mainUserEmail: env.seedUserEmail,
    treeNodeCount: nodes.length,
    usersCheckedAgainstReferrer: checked,
    mismatchCount: mismatches.length,
    mismatchesSample: mismatches.slice(0, 80),
    truncated: mismatches.length > 80,
    behaviourNote:
      'After referrer-leg deploy + migration: each user should sit in referrer left/right branch matching preferredCommunity.',
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
