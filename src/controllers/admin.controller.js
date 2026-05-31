const { AuditLog, PackageProduct, PaymentRequest, Plan, User } = require('../models');
const { AppError } = require('../utils/errors');
const { parsePagination, metaFor } = require('../utils/pagination');
const { getSignedDownloadUrl } = require('../services/cloudinary.service');
const {
  getAdminOverview,
  getAdminUserDetail,
  getAdminUserWalletLedger,
  listAdminUsers,
  listAdminUsersWithPasswords,
  setAdminUserStatus,
  listAuditLogs,
  lookupUserByCode,
  adminCreditUserWallet,
  listCommunityUsers,
  getCommunityTotals,
} = require('../services/admin.service');
const { purchasePackage } = require('../services/trade.service');
const { recalculateEligibility } = require('../services/eligibility.service');
const { creditSponsorOnPurchase } = require('../services/sponsor.service');
const { creditMatchingOnPurchase } = require('../services/matching.service');
const { logger } = require('../utils/logger');
const { getMyTeamTree, getMyTeamTreeChildren, getMyTeamFocusWindow } = require('../services/tree.service');
const { decryptPassword } = require('../utils/password-cipher');

async function adminOverview(req, res, next) {
  try {
    const days = Number(req.query.days || 14);
    const data = await getAdminOverview(days);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function adminListUsers(req, res, next) {
  try {
    const { page, limit } = parsePagination(req);
    const q = String(req.query.q || '').trim();
    const role = String(req.query.role || '').trim() || undefined;
    const isActiveRaw = String(req.query.isActive || '').trim().toLowerCase();
    const isActive = isActiveRaw === '' ? undefined : isActiveRaw === 'true';
    const hasPkgRaw = String(req.query.hasPurchasedPackage || '').trim().toLowerCase();
    const hasPurchasedPackage = hasPkgRaw === '' ? undefined : hasPkgRaw === 'true';
    const { rows, total } = await listAdminUsers({ page, limit, q, role, isActive, hasPurchasedPackage });
    res.json({ success: true, data: rows, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

async function adminListUsersPasswords(req, res, next) {
  try {
    const { page, limit } = parsePagination(req);
    const q = String(req.query.q || '').trim();
    const role = String(req.query.role || '').trim() || undefined;
    const isActiveRaw = String(req.query.isActive || '').trim().toLowerCase();
    const isActive = isActiveRaw === '' ? undefined : isActiveRaw === 'true';
    const { rows, total } = await listAdminUsersWithPasswords({ page, limit, q, role, isActive });
    await AuditLog.create({
      actorUserId: req.user.sub,
      action: 'admin_list_user_passwords',
      targetType: 'System',
      details: { page, limit, q: q || null, role: role || null, returnedCount: rows.length },
    });
    res.json({ success: true, data: rows, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

async function adminGetUser(req, res, next) {
  try {
    const detail = await getAdminUserDetail(req.validated.params.userCode);
    if (!detail) throw new AppError(404, 'User not found');
    res.json({ success: true, data: detail });
  } catch (error) {
    next(error);
  }
}

async function adminGetUserWalletLedger(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const result = await getAdminUserWalletLedger(req.validated.params.userCode, { page, limit, skip });
    if (!result) throw new AppError(404, 'User not found');
    res.json({ success: true, data: result.data, meta: metaFor(page, limit, result.total) });
  } catch (error) {
    next(error);
  }
}

async function adminSetUserStatus(req, res, next) {
  try {
    const updated = await setAdminUserStatus(req.validated.params.userCode, req.validated.body.isActive);
    if (!updated) throw new AppError(404, 'User not found');
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

async function adminListAuditLogs(req, res, next) {
  try {
    const { page, limit } = parsePagination(req);
    const payload = {
      page,
      limit,
      action: String(req.query.action || '').trim(),
      targetType: String(req.query.targetType || '').trim(),
      actorUserCode: String(req.query.actorUserCode || '').trim().toUpperCase(),
      from: String(req.query.from || '').trim(),
      to: String(req.query.to || '').trim(),
    };
    const { rows, total } = await listAuditLogs(payload);
    res.json({ success: true, data: rows, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

async function adminGetPaymentProof(req, res, next) {
  try {
    const id = req.validated.params.id;
    const request = await PaymentRequest.findOne({ publicId: id });
    if (!request) {
      throw new AppError(404, 'Payment proof not found');
    }
    const signedUrl = request.screenshotAsset?.publicId
      ? getSignedDownloadUrl(request.screenshotAsset)
      : request.screenshotUrl;
    if (!signedUrl) throw new AppError(404, 'Payment proof not found');
    const upstream = await fetch(signedUrl);
    if (!upstream.ok) {
      throw new AppError(502, 'Unable to fetch payment proof');
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    next(error);
  }
}

async function adminListPlans(req, res, next) {
  try {
    const rows = await Plan.find({}).sort({ code: 1 });
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
}

async function adminCreatePlan(req, res, next) {
  try {
    const row = await Plan.create(req.validated.body);
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
}

async function adminListPackages(req, res, next) {
  try {
    const rows = await PackageProduct.find({}).sort({ sortOrder: 1, amount: 1 });
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
}

async function adminCreatePackage(req, res, next) {
  try {
    const row = await PackageProduct.create(req.validated.body);
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
}

async function adminUpdatePlan(req, res, next) {
  try {
    const { code } = req.validated.params;
    const updated = await Plan.findOneAndUpdate(
      { code },
      { $set: req.validated.body },
      { new: true, runValidators: true }
    );
    if (!updated) throw new AppError(404, 'Plan not found');
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

async function adminUpdatePackage(req, res, next) {
  try {
    const { code } = req.validated.params;
    const updated = await PackageProduct.findOneAndUpdate(
      { code },
      { $set: req.validated.body },
      { new: true, runValidators: true }
    );
    if (!updated) throw new AppError(404, 'Package not found');
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

async function adminLookupUser(req, res, next) {
  try {
    const row = await lookupUserByCode(req.validated.params.userCode);
    if (!row) throw new AppError(404, 'User not found');
    res.json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
}

async function adminCreditUser(req, res, next) {
  try {
    const { userCode } = req.validated.params;
    const { amount, note } = req.validated.body;
    const transfer = await adminCreditUserWallet({
      adminUserId: req.user.sub,
      toUserCode: userCode,
      amount,
      note,
    });
    res.status(201).json({ success: true, data: transfer });
  } catch (error) {
    next(error);
  }
}

async function adminPurchaseForUser(req, res, next) {
  try {
    const { userCode } = req.validated.params;
    const { planCode, packageCode } = req.validated.body;
    const target = await User.findOne({ userCode }).select('_id');
    if (!target) throw new AppError(404, 'User not found');
    const sub = await purchasePackage({ userId: target._id, planCode, packageCode });
    await creditSponsorOnPurchase({ buyerUserId: target._id, packageSubscriptionId: sub._id, purchaseAmount: sub.principalAmount });
    try {
      await creditMatchingOnPurchase({ triggerBuyerUserId: target._id, triggerPurchaseSubscriptionId: sub._id });
    } catch (matchingError) {
      logger.error({ err: matchingError, buyerUserId: target._id, packageSubscriptionId: sub._id }, 'matching income processing failed');
    }
    await recalculateEligibility(target._id);
    await AuditLog.create({
      actorUserId: req.user.sub,
      action: 'admin_package_purchase_on_behalf',
      targetType: 'User',
      targetId: target._id,
      details: { targetUserCode: userCode, planCode, packageCode, packageSubscriptionId: String(sub._id) },
    });
    res.status(201).json({ success: true, data: sub });
  } catch (error) {
    next(error);
  }
}

async function adminGetUserPassword(req, res, next) {
  try {
    const { userCode } = req.validated.params;
    const user = await User.findOne({ userCode }).select('_id passwordCipher');
    if (!user) throw new AppError(404, 'User not found');
    let password = null;
    try {
      password = decryptPassword(user.passwordCipher);
    } catch {
      password = null;
    }
    await AuditLog.create({
      actorUserId: req.user.sub,
      action: 'admin_view_user_password',
      targetType: 'User',
      targetId: user._id,
      details: { targetUserCode: userCode },
    });
    res.json({ success: true, data: { password } });
  } catch (error) {
    next(error);
  }
}

async function adminCommunityUsers(req, res, next) {
  try {
    const { page, limit } = parsePagination(req);
    const community = req.validated.query.community;
    const q = String(req.validated.query.q || '').trim();
    const { rows, total } = await listCommunityUsers({ community, page, limit, q });
    res.json({ success: true, data: rows, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

async function adminCommunityTotals(req, res, next) {
  try {
    const data = await getCommunityTotals();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function adminUserTeamTree(req, res, next) {
  try {
    const rootCode = req.validated.params.userCode;
    const root = await User.findOne({ userCode: rootCode }).select('_id');
    if (!root) throw new AppError(404, 'User not found');
    const depthRaw = Number.parseInt(String(req.validated.query.depth ?? req.query.depth ?? '6'), 10);
    const nodesRaw = Number.parseInt(String(req.validated.query.nodes ?? req.query.nodes ?? '500'), 10);
    const depth = Math.max(1, Math.min(30, Number.isFinite(depthRaw) ? depthRaw : 6));
    const nodes = Math.max(50, Math.min(5000, Number.isFinite(nodesRaw) ? nodesRaw : 500));
    const data = await getMyTeamTree(root._id, { maxDepth: depth, maxNodes: nodes });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function adminUserTeamTreeChildren(req, res, next) {
  try {
    const rootCode = req.validated.params.userCode;
    const root = await User.findOne({ userCode: rootCode }).select('_id');
    if (!root) throw new AppError(404, 'User not found');
    const { parentUserCode } = req.validated.query;
    const limitRaw = Number.parseInt(String(req.validated.query.limit ?? req.query.limit ?? '120'), 10);
    const lim = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 120));
    const data = await getMyTeamTreeChildren(root._id, { parentUserCode, limit: lim, asAdmin: true });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function adminUserTeamFocus(req, res, next) {
  try {
    const rootCode = req.validated.params.userCode;
    const root = await User.findOne({ userCode: rootCode }).select('_id');
    if (!root) throw new AppError(404, 'User not found');
    const raw = req.validated.query.targetUserCode;
    const targetUserCode = raw && String(raw).trim() ? String(raw).trim().toUpperCase() : '';
    const depthRaw = Number.parseInt(String(req.query.depth || req.validated.query.depth || '5'), 10);
    const maxRelativeDepth = Math.max(1, Math.min(5, Number.isFinite(depthRaw) ? depthRaw : 5));
    const data = await getMyTeamFocusWindow(root._id, { targetUserCode, asAdmin: true, maxRelativeDepth });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  adminOverview,
  adminListUsers,
  adminListUsersPasswords,
  adminLookupUser,
  adminGetUser,
  adminGetUserWalletLedger,
  adminSetUserStatus,
  adminCreditUser,
  adminPurchaseForUser,
  adminGetUserPassword,
  adminCommunityUsers,
  adminCommunityTotals,
  adminUserTeamTree,
  adminUserTeamTreeChildren,
  adminUserTeamFocus,
  adminListAuditLogs,
  adminGetPaymentProof,
  adminListPlans,
  adminCreatePlan,
  adminUpdatePlan,
  adminListPackages,
  adminCreatePackage,
  adminUpdatePackage,
};
