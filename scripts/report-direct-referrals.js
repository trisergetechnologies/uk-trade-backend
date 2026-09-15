/**
 * List users ranked by personal direct referrals (referredBy).
 *
 * Flags:
 *   --limit N              — top N (default 30)
 *   --min N                — only users with at least N directs (default 1)
 *   --with-deep            — also count first-10 directs placed deeper than 5 levels
 *   --deep-only            — with --with-deep: only print users who have deepFirst10 > 0
 *   --all-with-deep        — scan every sponsor (not just top N) for deep first-10
 *   --user-code USRXXXX    — single user detail
 *
 * Run:
 *   node scripts/report-direct-referrals.js
 *   node scripts/report-direct-referrals.js --limit 50 --with-deep
 *   node scripts/report-direct-referrals.js --all-with-deep
 *   node scripts/report-direct-referrals.js --user-code USRIWHLVT --with-deep
 */

require('dotenv').config();
const { connectDb } = require('../src/db/connect');
const { User, TreeNode } = require('../src/models');
const { ROLES } = require('../src/constants/roles');
const { collectDownlineDescendants } = require('../src/services/tree.service');
const { MAX_MATCHING_LEVEL, MAX_DIRECT_REFERRAL_MATCHING } = require('../src/services/matching.service');
const { logger } = require('../src/utils/logger');

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const minIdx = args.indexOf('--min');
const userCodeIdx = args.indexOf('--user-code');
const WITH_DEEP = args.includes('--with-deep') || args.includes('--all-with-deep') || args.includes('--deep-only');
const ALL_WITH_DEEP = args.includes('--all-with-deep');
const DEEP_ONLY = args.includes('--deep-only') || ALL_WITH_DEEP;
const LIMIT = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 30) : 30;
const MIN = minIdx >= 0 ? Math.max(0, Number(args[minIdx + 1]) || 1) : 1;
const SINGLE_USER_CODE =
  userCodeIdx >= 0 ? String(args[userCodeIdx + 1] || '').trim().toUpperCase() : '';

async function deepFirst10Count(earnerId) {
  const earnerNode = await TreeNode.findOne({ userId: earnerId }).lean();
  if (!earnerNode) return { deepFirst10: 0, first10Levels: [] };

  const directs = await User.find({ referredBy: earnerId, role: ROLES.USER })
    .sort({ createdAt: 1, _id: 1 })
    .limit(MAX_DIRECT_REFERRAL_MATCHING)
    .select('_id userCode name')
    .lean();

  const descendants = await collectDownlineDescendants(earnerId);
  const byId = new Map(descendants.map((n) => [String(n.userId), n]));
  const first10Levels = [];
  let deepFirst10 = 0;

  for (let i = 0; i < directs.length; i += 1) {
    const d = directs[i];
    const node = byId.get(String(d._id));
    const rel = node ? Number(node.level || 0) - Number(earnerNode.level || 0) : null;
    if (rel != null && rel > MAX_MATCHING_LEVEL) deepFirst10 += 1;
    first10Levels.push({
      rank: i + 1,
      userCode: d.userCode,
      name: d.name,
      relativeLevel: rel,
    });
  }

  return { deepFirst10, first10Levels };
}

async function run() {
  if (SINGLE_USER_CODE) {
    const u = await User.findOne({ userCode: SINGLE_USER_CODE })
      .select('_id userCode name email')
      .lean();
    if (!u) throw new Error(`User not found: ${SINGLE_USER_CODE}`);
    const total = await User.countDocuments({ referredBy: u._id, role: ROLES.USER });
    const row = { userCode: u.userCode, name: u.name, email: u.email, directReferrals: total };
    if (WITH_DEEP) {
      const deep = await deepFirst10Count(u._id);
      Object.assign(row, deep);
    }
    console.log(JSON.stringify(row, null, 2));
    return;
  }

  const ranks = await User.aggregate([
    { $match: { role: ROLES.USER, referredBy: { $ne: null } } },
    { $group: { _id: '$referredBy', directReferrals: { $sum: 1 } } },
    { $match: { directReferrals: { $gte: MIN } } },
    { $sort: { directReferrals: -1 } },
    ...(ALL_WITH_DEEP ? [] : [{ $limit: LIMIT }]),
  ]);

  const ids = ranks.map((r) => r._id);
  const users = await User.find({ _id: { $in: ids } })
    .select('_id userCode name email')
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const rows = [];
  let sponsorsWithDeep = 0;
  for (const r of ranks) {
    const u = byId.get(String(r._id));
    if (!u) continue;
    const row = {
      userCode: u.userCode,
      name: u.name,
      email: u.email,
      directReferrals: r.directReferrals,
    };
    if (WITH_DEEP) {
      const deep = await deepFirst10Count(u._id);
      row.deepFirst10 = deep.deepFirst10;
      if (deep.deepFirst10 > 0) sponsorsWithDeep += 1;
      if (DEEP_ONLY && deep.deepFirst10 <= 0) continue;
    }
    rows.push(row);
  }

  console.log('\n=== TOP SPONSORS BY DIRECT REFERRALS ===');
  if (ALL_WITH_DEEP) {
    console.log(
      `Scanned all sponsors with >= ${MIN} directs; ${sponsorsWithDeep} have first-10 directs deeper than L5\n`
    );
  } else {
    console.log(
      `Showing ${DEEP_ONLY ? 'deep-only from ' : ''}top ${Math.min(LIMIT, ranks.length)} with >= ${MIN} directs${WITH_DEEP ? ' (+ deep first-10 count)' : ''}\n`
    );
  }
  if (!rows.length) {
    console.log('No matching sponsors.');
    if (WITH_DEEP) {
      console.log(
        '\nNo sponsor currently has a first-10 direct placed deeper than 5 levels.'
      );
      console.log('Catch-up will credit 0 until such placements + purchases exist.');
      console.log('Live matching rule still applies for future deep first-10 purchases.\n');
    }
    return;
  }
  for (const row of rows) {
    const deepPart = WITH_DEEP ? ` | deepFirst10(>L5)=${row.deepFirst10}` : '';
    console.log(`${String(row.directReferrals).padStart(4)} directs | ${row.userCode} | ${row.name}${deepPart}`);
  }
  console.log('\nTip: for catch-up pilot, prefer users with deepFirst10 > 0:');
  console.log('  node scripts/report-direct-referrals.js --all-with-deep');
  console.log('  node scripts/backfill-matching-direct-referral-catchup.js --diagnose --user-code THEIRCODE\n');
}

if (require.main === module) {
  connectDb()
    .then(run)
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'report-direct-referrals failed');
      process.exit(1);
    });
}
