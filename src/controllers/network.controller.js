const { User, TreeNode } = require('../models');
const { ROLES } = require('../constants/roles');
const {
  getMyTree,
  placeUserInTree,
  getMyTeamSummary,
  getMyTeamMembers,
  getMyTeamTree,
  getMyTeamTreeChildren,
  getMyTeamFocusWindow,
} = require('../services/tree.service');
const { parsePagination, metaFor } = require('../utils/pagination');

async function myTree(req, res, next) {
  try {
    const { page, limit } = parsePagination(req);
    const data = await getMyTree(req.user.sub, { page, limit });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function placeSelf(req, res, next) {
  try {
    const user = await User.findById(req.user.sub);
    if (user?.role === ROLES.ADMIN) {
      const node = await TreeNode.findOne({ userId: req.user.sub });
      return res.json({ success: true, data: node });
    }
    if (user?.treePlacedAt) {
      const node = await TreeNode.findOne({ userId: req.user.sub });
      return res.json({ success: true, data: node });
    }
    const node = await placeUserInTree(req.user.sub, req.validated.body.community);
    await User.updateOne({ _id: req.user.sub }, { $set: { treePlacedAt: new Date() } });
    res.json({ success: true, data: node });
  } catch (error) {
    next(error);
  }
}

async function myTeamSummary(req, res, next) {
  try {
    const data = await getMyTeamSummary(req.user.sub);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function myTeamMembers(req, res, next) {
  try {
    const { page, limit } = parsePagination(req);
    const type = String(req.query.type || 'all').toLowerCase();
    const q = String(req.query.q || '').trim();
    const levelRaw = String(req.query.level || '').trim();
    const level = levelRaw ? Number.parseInt(levelRaw, 10) : undefined;
    const communityRaw = String(req.query.community || '').trim().toLowerCase();
    const community = communityRaw === 'left' || communityRaw === 'right' ? communityRaw : undefined;

    const { data, total } = await getMyTeamMembers(req.user.sub, { page, limit, type, q, level, community });
    res.json({ success: true, data, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

async function myTeamTree(req, res, next) {
  try {
    const depthRaw = Number.parseInt(String(req.query.depth || '5'), 10);
    const nodesRaw = Number.parseInt(String(req.query.nodes || '500'), 10);
    const maxRelativeDepth = Math.max(1, Math.min(5, Number.isFinite(depthRaw) ? depthRaw : 5));
    const nodes = Math.max(50, Math.min(5000, Number.isFinite(nodesRaw) ? nodesRaw : 500));
    const data = await getMyTeamTree(req.user.sub, { maxRelativeDepth, maxNodes: nodes });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function myTeamTreeChildren(req, res, next) {
  try {
    const parentUserCode = String(req.query.parentUserCode || '').trim().toUpperCase();
    const limitRaw = Number.parseInt(String(req.query.limit || '120'), 10);
    const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 120));
    const data = await getMyTeamTreeChildren(req.user.sub, { parentUserCode, limit });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function myTeamFocusWindow(req, res, next) {
  try {
    const targetUserCode = String(req.query.userCode || '').trim().toUpperCase();
    const depthRaw = Number.parseInt(String(req.query.depth || '5'), 10);
    const maxRelativeDepth = Math.max(1, Math.min(5, Number.isFinite(depthRaw) ? depthRaw : 5));
    const data = await getMyTeamFocusWindow(req.user.sub, { targetUserCode, maxRelativeDepth });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { myTree, placeSelf, myTeamSummary, myTeamMembers, myTeamTree, myTeamTreeChildren, myTeamFocusWindow };
