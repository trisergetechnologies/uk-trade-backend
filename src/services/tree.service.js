const { TreeNode, User, PackageSubscription } = require('../models');
const { ROLES } = require('../constants/roles');
const { env } = require('../config/env');
const { AppError } = require('../utils/errors');
const { metaFor } = require('../utils/pagination');
const { createPublicId } = require('../utils/public-id');
const { isNetworkParticipant } = require('../utils/network-participant');

/** Left vs right branch from signup `preferredCommunity` / `community`. */
function normalizeSignupBranch(signupCommunity) {
  return signupCommunity === 'right' ? 'right' : 'left';
}

async function getMainUserId() {
  const u = await User.findOne({ email: env.seedUserEmail.toLowerCase(), role: ROLES.USER })
    .select('_id')
    .lean();
  return u?._id || null;
}

async function collectDownlineDescendants(rootUserId) {
  const results = [];
  let frontier = [rootUserId];
  const seen = new Set();
  while (frontier.length) {
    const children = await TreeNode.find({ parentUserId: { $in: frontier } })
      .sort({ level: 1, createdAt: 1 })
      .lean();
    if (!children.length) break;
    const next = [];
    for (const c of children) {
      const id = String(c.userId);
      if (seen.has(id)) continue;
      seen.add(id);
      results.push(c);
      next.push(c.userId);
    }
    frontier = next;
  }
  return results;
}

async function collectSubtreeIncludingRoot(rootUserId) {
  const root = await TreeNode.findOne({ userId: rootUserId }).lean();
  if (!root) return [];
  const below = await collectDownlineDescendants(rootUserId);
  return [root, ...below];
}

/**
 * Next parent inside anchor user's left or right branch (level then createdAt within that subtree).
 * If anchor has no direct child on that side yet, caller attaches as anchor's child on that side.
 */
async function findPlacementParentInBranch(anchorUserId, branch) {
  const anchorNode = await TreeNode.findOne({ userId: anchorUserId }).lean();
  if (!anchorNode) return null;

  const legRoot = await TreeNode.findOne({ parentUserId: anchorNode.userId, side: branch }).lean();
  if (!legRoot) {
    return { type: 'under_anchor', anchorNode };
  }

  const subtree = await collectSubtreeIncludingRoot(legRoot.userId);
  subtree.sort((a, b) => {
    if (Number(a.level || 0) !== Number(b.level || 0)) return Number(a.level || 0) - Number(b.level || 0);
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (const node of subtree) {
    const children = await TreeNode.countDocuments({ parentUserId: node.userId });
    if (children < 2) return { type: 'under_node', parentNode: node };
  }
  return null;
}

async function placeUserInTree(userId, signupCommunityInput) {
  const actor = await User.findById(userId).select('role').lean();
  if (!actor || !isNetworkParticipant(actor)) {
    return TreeNode.findOne({ userId });
  }

  const existing = await TreeNode.findOne({ userId });
  if (existing && existing.parentUserId) return existing;

  const branch = normalizeSignupBranch(signupCommunityInput);
  const mainUserId = await getMainUserId();
  if (!mainUserId) {
    throw new AppError(500, 'Main user (SEED_USER_EMAIL) not configured or missing');
  }

  if (String(userId) === String(mainUserId)) {
    const pref = await User.findById(userId).select('preferredCommunity').lean();
    const rootCommunity = normalizeSignupBranch(pref?.preferredCommunity);
    return TreeNode.findOneAndUpdate(
      { userId },
      {
        userId,
        parentUserId: null,
        side: 'left',
        community: rootCommunity,
        level: 0,
      },
      { upsert: true, returnDocument: 'after' }
    );
  }

  const userRow = await User.findById(userId).select('referredBy').lean();
  let anchorUserId = mainUserId;
  if (userRow?.referredBy) {
    const referrer = await User.findById(userRow.referredBy).select('role').lean();
    if (referrer && referrer.role === ROLES.USER) {
      const referrerNode = await TreeNode.findOne({ userId: referrer._id }).lean();
      if (referrerNode) anchorUserId = referrer._id;
    }
  }

  const placement = await findPlacementParentInBranch(anchorUserId, branch);
  if (!placement) {
    throw new AppError(500, 'Tree placement failed: placement anchor tree node missing');
  }

  if (placement.type === 'under_anchor') {
    const { anchorNode } = placement;
    return TreeNode.findOneAndUpdate(
      { userId },
      {
        userId,
        parentUserId: anchorNode.userId,
        side: branch,
        community: branch,
        level: Number(anchorNode.level || 0) + 1,
      },
      { upsert: true, returnDocument: 'after' }
    );
  }

  const { parentNode } = placement;
  const leftTaken = await TreeNode.findOne({ parentUserId: parentNode.userId, side: 'left' });
  const side = leftTaken ? 'right' : 'left';

  return TreeNode.findOneAndUpdate(
    { userId },
    {
      userId,
      parentUserId: parentNode.userId,
      side,
      community: branch,
      level: Number(parentNode.level || 0) + 1,
    },
    { upsert: true, returnDocument: 'after' }
  );
}

async function ensureUserCodeForUser(userId) {
  const doc = await User.findById(userId).select('userCode');
  if (!doc) return;
  if (doc.userCode && String(doc.userCode).trim()) return;
  let next = createPublicId('USR');
  while (await User.exists({ userCode: next })) {
    next = createPublicId('USR');
  }
  await User.updateOne({ _id: userId }, { $set: { userCode: next } });
}

async function ensureUserCodesForMany(userIds) {
  if (!userIds.length) return;
  const rows = await User.find({ _id: { $in: userIds } })
    .select('_id userCode')
    .lean();
  for (const row of rows) {
    if (!row.userCode || !String(row.userCode).trim()) {
      await ensureUserCodeForUser(row._id);
    }
  }
}

async function getMyTree(userId, { page = 1, limit = 50 } = {}) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found');
  const myNode = await TreeNode.findOne({ userId });
  if (!myNode) {
    return { myNode: null, downline: [], meta: metaFor(page, limit, 0) };
  }

  const all = await collectDownlineDescendants(myNode.userId);
  const skip = (page - 1) * limit;
  const slice = all.slice(skip, skip + limit);
  return {
    myNode,
    downline: slice,
    meta: metaFor(page, limit, all.length),
  };
}

function splitDownlineByFirstBranch(rootUserId, descendants) {
  const byParent = new Map();
  for (const node of descendants) {
    const parentKey = String(node.parentUserId || '');
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey).push(node);
  }
  const rootChildren = byParent.get(String(rootUserId)) || [];
  const result = { left: [], right: [] };
  for (const child of rootChildren) {
    const sideKey = child.side === 'right' ? 'right' : 'left';
    const stack = [child];
    while (stack.length) {
      const current = stack.pop();
      result[sideKey].push(current);
      const children = byParent.get(String(current.userId)) || [];
      for (const c of children) stack.push(c);
    }
  }
  return result;
}

async function sumPrincipalForUserIds(userIds) {
  if (!userIds.length) return 0;
  const rows = await PackageSubscription.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: null, total: { $sum: '$principalAmount' } } },
  ]);
  return Number(rows[0]?.total || 0);
}

async function getMyTeamSummary(userId) {
  const me = await TreeNode.findOne({ userId }).lean();
  if (!me) {
    return {
      totalMembers: 0,
      directMembers: 0,
      activeMembers: 0,
      inactiveMembers: 0,
      maxLevel: 0,
      leftCommunityMembers: 0,
      rightCommunityMembers: 0,
      myLeftMembers: 0,
      myRightMembers: 0,
      myLeftInvestment: 0,
      myRightInvestment: 0,
    };
  }

  const descendants = await collectDownlineDescendants(me.userId);
  const allIds = descendants.map((row) => row.userId);
  const users = allIds.length ? await User.find({ _id: { $in: allIds } }).select('_id isActive').lean() : [];
  const activeSet = new Set(users.filter((u) => !!u.isActive).map((u) => String(u._id)));
  const directMembers = descendants.filter((n) => String(n.parentUserId) === String(me.userId)).length;

  const branchSplit = splitDownlineByFirstBranch(me.userId, descendants);
  const leftIds = branchSplit.left.map((n) => n.userId);
  const rightIds = branchSplit.right.map((n) => n.userId);
  const [myLeftInvestment, myRightInvestment] = await Promise.all([
    sumPrincipalForUserIds(leftIds),
    sumPrincipalForUserIds(rightIds),
  ]);

  return {
    totalMembers: descendants.length,
    directMembers,
    activeMembers: descendants.filter((d) => activeSet.has(String(d.userId))).length,
    inactiveMembers: descendants.filter((d) => !activeSet.has(String(d.userId))).length,
    maxLevel: descendants.reduce((mx, d) => Math.max(mx, Number(d.level || 0)), 0),
    leftCommunityMembers: descendants.filter((d) => d.community === 'left').length,
    rightCommunityMembers: descendants.filter((d) => d.community === 'right').length,
    myLeftMembers: leftIds.length,
    myRightMembers: rightIds.length,
    myLeftInvestment,
    myRightInvestment,
  };
}

async function getMyTeamMembers(userId, { page = 1, limit = 20, type = 'all', q = '', level, community } = {}) {
  const me = await TreeNode.findOne({ userId }).lean();
  if (!me) return { data: [], total: 0 };

  let nodes = [];
  if (type === 'direct') {
    nodes = await TreeNode.find({ parentUserId: me.userId }).sort({ createdAt: -1 }).lean();
  } else {
    nodes = await collectDownlineDescendants(me.userId);
  }

  const userIds = nodes.map((row) => row.userId);
  const parentIds = nodes.map((row) => row.parentUserId).filter(Boolean);
  const relatedIds = [...new Set([...userIds, ...parentIds].map((id) => String(id)))];
  await ensureUserCodesForMany(relatedIds);
  const relatedUsers = relatedIds.length
    ? await User.find({ _id: { $in: relatedIds } }).select('_id name email userCode isActive createdAt').lean()
    : [];
  const userById = new Map(relatedUsers.map((u) => [String(u._id), u]));

  let rows = nodes.map((node) => {
    const member = userById.get(String(node.userId));
    const sponsor = node.parentUserId ? userById.get(String(node.parentUserId)) : null;
    return {
      userId: node.userId,
      parentUserId: node.parentUserId,
      level: node.level,
      side: node.side,
      community: node.community,
      createdAt: node.createdAt,
      memberName: member?.name || '',
      memberEmail: member?.email || '',
      memberUserCode: member?.userCode || '',
      memberIsActive: !!member?.isActive,
      joinedAt: member?.createdAt || node.createdAt,
      sponsorName: sponsor?.name || '-',
      sponsorUserCode: sponsor?.userCode || '-',
    };
  });

  const term = String(q || '').trim().toLowerCase();
  if (term) {
    rows = rows.filter((r) =>
      [r.memberName, r.memberEmail, r.memberUserCode, r.sponsorName, r.sponsorUserCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }
  if (typeof level === 'number' && Number.isFinite(level) && level >= 1) {
    rows = rows.filter((r) => Number(r.level) === level);
  }
  // Match dashboard "left / right community" counts (myLeftMembers / myRightMembers):
  // split by binary-tree branch from this user, not by each member's registration `community` field.
  if (community === 'left' || community === 'right') {
    const branchSplit = splitDownlineByFirstBranch(me.userId, nodes);
    const inBranch = new Set(
      (community === 'left' ? branchSplit.left : branchSplit.right).map((n) => String(n.userId))
    );
    rows = rows.filter((r) => inBranch.has(String(r.userId)));
  }

  rows.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());
  const total = rows.length;
  const skip = (page - 1) * limit;
  return { data: rows.slice(skip, skip + limit), total };
}

async function getMyTeamTree(userId, { maxDepth = 6, maxNodes = 500 } = {}) {
  const meNode = await TreeNode.findOne({ userId }).lean();
  if (!meNode) {
    return {
      root: null,
      levels: [],
      totalNodes: 0,
      shownNodes: 0,
      truncated: false,
      maxDepthApplied: maxDepth,
      maxNodesApplied: maxNodes,
    };
  }

  await ensureUserCodeForUser(userId);
  const meUser = await User.findById(userId).select('name email userCode isActive').lean();
  const descendants = await collectDownlineDescendants(meNode.userId);
  const bounded = descendants
    .filter((n) => Number(n.level || 0) <= maxDepth)
    .sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const shown = bounded.slice(0, maxNodes);

  const ids = [
    String(meNode.userId),
    ...shown.map((n) => String(n.userId)),
    ...shown.map((n) => String(n.parentUserId)).filter(Boolean),
  ];
  const uniqueIds = [...new Set(ids)];
  await ensureUserCodesForMany(uniqueIds);
  const users = uniqueIds.length
    ? await User.find({ _id: { $in: uniqueIds } }).select('_id name email userCode isActive createdAt').lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const childCount = new Map();
  for (const n of shown) {
    const pid = String(n.parentUserId || '');
    childCount.set(pid, (childCount.get(pid) || 0) + 1);
  }

  const levelMap = new Map();
  for (const n of shown) {
    const level = Number(n.level || 0);
    const member = userById.get(String(n.userId));
    const sponsor = n.parentUserId ? userById.get(String(n.parentUserId)) : null;
    const row = {
      memberUserCode: member?.userCode || '',
      memberName: member?.name || '',
      memberEmail: member?.email || '',
      memberIsActive: !!member?.isActive,
      sponsorUserCode: sponsor?.userCode || '',
      sponsorName: sponsor?.name || '',
      side: n.side,
      community: n.community,
      level: level,
      joinedAt: member?.createdAt || n.createdAt,
      directChildrenCount: childCount.get(String(n.userId)) || 0,
    };
    if (!levelMap.has(level)) levelMap.set(level, []);
    levelMap.get(level).push(row);
  }

  const levels = [...levelMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, nodes]) => ({ level, nodes }));

  return {
    root: {
      memberUserCode: meUser?.userCode || '',
      memberName: meUser?.name || '',
      memberEmail: meUser?.email || '',
      memberIsActive: !!meUser?.isActive,
      side: meNode.side,
      community: meNode.community,
      level: meNode.level || 0,
      directChildrenCount: childCount.get(String(meNode.userId)) || 0,
    },
    levels,
    totalNodes: bounded.length,
    shownNodes: shown.length,
    truncated: bounded.length > shown.length,
    maxDepthApplied: maxDepth,
    maxNodesApplied: maxNodes,
  };
}

async function getMyTeamTreeChildren(userId, { parentUserCode, limit = 100, asAdmin = false } = {}) {
  if (!parentUserCode) throw new AppError(400, 'parentUserCode is required');

  await ensureUserCodeForUser(userId);
  const me = await User.findById(userId).select('_id userCode name').lean();
  if (!me) throw new AppError(404, 'User not found');
  const target = await User.findOne({ userCode: parentUserCode }).select('_id userCode name').lean();
  if (!target) throw new AppError(404, 'Parent user not found');

  if (!asAdmin && String(target._id) !== String(me._id)) {
    const descendants = await collectDownlineDescendants(userId);
    const allowed = descendants.some((d) => String(d.userId) === String(target._id));
    if (!allowed) throw new AppError(403, 'You can only access your own team tree');
  }

  const childrenNodes = await TreeNode.find({ parentUserId: target._id })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  const childIds = childrenNodes.map((n) => n.userId);
  await ensureUserCodesForMany(childIds.map((id) => String(id)));
  const users = childIds.length
    ? await User.find({ _id: { $in: childIds } }).select('_id name email userCode isActive createdAt').lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const childParentIds = childrenNodes.map((n) => n.userId);
  const grandCountRows = childParentIds.length
    ? await TreeNode.aggregate([
        { $match: { parentUserId: { $in: childParentIds } } },
        { $group: { _id: '$parentUserId', count: { $sum: 1 } } },
      ])
    : [];
  const grandCount = new Map(grandCountRows.map((r) => [String(r._id), Number(r.count || 0)]));

  const data = childrenNodes.map((node) => {
    const member = userById.get(String(node.userId));
    return {
      memberUserCode: member?.userCode || '',
      memberName: member?.name || '',
      memberEmail: member?.email || '',
      memberIsActive: !!member?.isActive,
      sponsorUserCode: parentUserCode,
      sponsorName: target?.name || '',
      side: node.side,
      community: node.community,
      level: Number(node.level || 0),
      joinedAt: member?.createdAt || node.createdAt,
      directChildrenCount: grandCount.get(String(node.userId)) || 0,
    };
  });

  return { parentUserCode, data };
}

function toTreeCard(node, member, sponsor, childrenCount = 0) {
  return {
    memberUserCode: member?.userCode || '',
    memberName: member?.name || '',
    memberEmail: member?.email || '',
    memberIsActive: !!member?.isActive,
    sponsorUserCode: sponsor?.userCode || '',
    sponsorName: sponsor?.name || '',
    side: node?.side || 'left',
    community: node?.community || 'left',
    level: Number(node?.level || 0),
    joinedAt: member?.createdAt || node?.createdAt,
    directChildrenCount: childrenCount,
  };
}

async function getMyTeamFocusWindow(userId, { targetUserCode = '', asAdmin = false } = {}) {
  await ensureUserCodeForUser(userId);
  const viewer = await User.findById(userId).select('_id userCode name email isActive createdAt').lean();
  if (!viewer) throw new AppError(404, 'User not found');

  const viewerNode = await TreeNode.findOne({ userId: viewer._id }).lean();
  if (!viewerNode) {
    return { parent: null, focus: null, children: [], grandchildrenByParent: {}, relation: 'self' };
  }

  let targetUser = viewer;
  if (targetUserCode && targetUserCode.trim()) {
    targetUser = await User.findOne({ userCode: targetUserCode.trim().toUpperCase() })
      .select('_id userCode name email isActive createdAt')
      .lean();
    if (!targetUser) throw new AppError(404, 'Target user not found');
  }
  const targetNode = await TreeNode.findOne({ userId: targetUser._id }).lean();
  if (!targetNode) throw new AppError(404, 'Target user has no tree node');

  const isSelf = String(targetUser._id) === String(viewer._id);
  let isParentOfViewer = false;
  if (viewerNode.parentUserId) isParentOfViewer = String(targetUser._id) === String(viewerNode.parentUserId);

  let isDescendant = false;
  if (!isSelf && !isParentOfViewer) {
    const descendants = await collectDownlineDescendants(viewer._id);
    isDescendant = descendants.some((d) => String(d.userId) === String(targetUser._id));
  }

  if (!asAdmin && !isSelf && !isParentOfViewer && !isDescendant) {
    throw new AppError(403, 'You can only view your own network context');
  }

  let relation = 'descendant';
  if (isSelf) relation = 'self';
  else if (isParentOfViewer) relation = 'parent';
  else if (isDescendant) relation = 'descendant';
  else if (asAdmin) relation = 'admin_view';
  const parentNode = targetNode.parentUserId ? await TreeNode.findOne({ userId: targetNode.parentUserId }).lean() : null;
  const directChildNodes = await TreeNode.find({ parentUserId: targetNode.userId }).sort({ createdAt: 1 }).lean();
  const grandChildNodes = directChildNodes.length
    ? await TreeNode.find({ parentUserId: { $in: directChildNodes.map((n) => n.userId) } }).sort({ createdAt: 1 }).lean()
    : [];

  const allIds = [
    String(targetNode.userId),
    ...(parentNode ? [String(parentNode.userId)] : []),
    ...directChildNodes.map((n) => String(n.userId)),
    ...grandChildNodes.map((n) => String(n.userId)),
  ];
  const uniqueIds = [...new Set(allIds)];
  await ensureUserCodesForMany(uniqueIds);
  const users = uniqueIds.length
    ? await User.find({ _id: { $in: uniqueIds } }).select('_id name email userCode isActive createdAt').lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const childCountRows = uniqueIds.length
    ? await TreeNode.aggregate([
        { $match: { parentUserId: { $in: uniqueIds.map((id) => userById.get(id)?._id).filter(Boolean) } } },
        { $group: { _id: '$parentUserId', count: { $sum: 1 } } },
      ])
    : [];
  const childCount = new Map(childCountRows.map((r) => [String(r._id), Number(r.count || 0)]));

  const parent = parentNode
    ? toTreeCard(
        parentNode,
        userById.get(String(parentNode.userId)),
        null,
        childCount.get(String(parentNode.userId)) || 0
      )
    : null;
  const focus = toTreeCard(
    targetNode,
    userById.get(String(targetNode.userId)),
    parentNode ? userById.get(String(parentNode.userId)) : null,
    childCount.get(String(targetNode.userId)) || 0
  );

  const children = directChildNodes.map((n) =>
    toTreeCard(n, userById.get(String(n.userId)), userById.get(String(targetNode.userId)), childCount.get(String(n.userId)) || 0)
  );
  const grandchildrenByParent = {};
  for (const childNode of directChildNodes) {
    const key = userById.get(String(childNode.userId))?.userCode || '';
    grandchildrenByParent[key] = grandChildNodes
      .filter((n) => String(n.parentUserId) === String(childNode.userId))
      .map((n) =>
        toTreeCard(n, userById.get(String(n.userId)), userById.get(String(childNode.userId)), childCount.get(String(n.userId)) || 0)
      );
  }

  return { parent, focus, children, grandchildrenByParent, relation };
}

/**
 * Binary branch under Main User: walk up until parent is Main; child's `side` is left vs right leg from root.
 * Returns null for Main User root node; null also if chain breaks (orphan).
 */
function computeBranchUnderMainFromNode(node, mainUserId, nodeByUserId) {
  if (!node || String(node.userId) === String(mainUserId)) return null;
  let cur = node;
  while (cur && cur.parentUserId) {
    if (String(cur.parentUserId) === String(mainUserId)) {
      return cur.side === 'right' ? 'right' : 'left';
    }
    cur = nodeByUserId.get(String(cur.parentUserId));
    if (!cur) return null;
  }
  return null;
}

module.exports = {
  placeUserInTree,
  findPlacementParentInBranch,
  getMainUserId,
  normalizeSignupBranch,
  computeBranchUnderMainFromNode,
  getMyTree,
  collectDownlineDescendants,
  collectSubtreeIncludingRoot,
  getMyTeamSummary,
  getMyTeamMembers,
  getMyTeamTree,
  getMyTeamTreeChildren,
  getMyTeamFocusWindow,
};
