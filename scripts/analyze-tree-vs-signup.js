/**
 * READ-ONLY: compares current binary tree position vs each user's signup choice (preferredCommunity).
 *
 * Use BEFORE running migrate-tree-main-user-root.js on production to see:
 * - how many members sit under Main User's left vs right branch today
 * - who differs from their signup intent (mismatch list)
 *
 * Does NOT modify the database.
 *
 * Run:
 *   node scripts/analyze-tree-vs-signup.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { connectDb } = require('../src/db/connect');
const { User, TreeNode } = require('../src/models');
const { ROLES } = require('../src/constants/roles');
const {
  getMainUserId,
  normalizeSignupBranch,
  computeBranchUnderMainFromNode,
} = require('../src/services/tree.service');

async function main() {
  await connectDb();

  const mainUserId = await getMainUserId();
  if (!mainUserId) {
    throw new Error(`No main user for SEED_USER_EMAIL=${env.seedUserEmail}`);
  }

  const nodes = await TreeNode.find({}).lean();
  const byUserId = new Map(nodes.map((n) => [String(n.userId), n]));

  const userIds = nodes.map((n) => n.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select('role email name userCode preferredCommunity')
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const mismatches = [];
  const byBranchActual = { left: 0, right: 0 };
  const bySignup = { left: 0, right: 0 };

  for (const n of nodes) {
    const u = userById.get(String(n.userId));
    if (!u || u.role !== ROLES.USER) continue;

    const signup = normalizeSignupBranch(u.preferredCommunity);
    bySignup[signup] += 1;

    if (String(n.userId) === String(mainUserId)) {
      const rootCommunity = signup;
      if (n.community && rootCommunity !== n.community) {
        mismatches.push({
          userCode: u.userCode,
          email: u.email,
          issue: 'root_community_field',
          signupIntent: rootCommunity,
          note: 'Main User root node.community vs preferredCommunity',
        });
      }
      continue;
    }

    const actualBranch = computeBranchUnderMainFromNode(n, mainUserId, byUserId);
    if (actualBranch === null) {
      mismatches.push({
        userCode: u.userCode,
        email: u.email,
        issue: 'not_under_main_or_orphan',
        signupIntent: signup,
      });
      continue;
    }

    byBranchActual[actualBranch] += 1;

    if (actualBranch !== signup) {
      mismatches.push({
        userCode: u.userCode,
        email: u.email,
        signupIntent: signup,
        actualBranchUnderMain: actualBranch,
      });
    }
  }

  const summary = {
    mainUserEmail: env.seedUserEmail,
    mainUserId: String(mainUserId),
    treeNodeCount: nodes.length,
    countBySignupPreference: bySignup,
    countByActualBranchUnderMain: byBranchActual,
    mismatchCount: mismatches.length,
    mismatchesSample: mismatches.slice(0, 80),
    truncated: mismatches.length > 80,
    behaviourNote:
      'After code deploy: NEW signups follow preferredCommunity under Main User (left/right subtree). ' +
      'Existing TreeNode rows unchanged until you run migrate-tree-main-user-root.js (backup first). ' +
      'Migration replay reshapes the tree; sponsor income still uses referredBy; matching uses new TreeNode graph going forward.',
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
