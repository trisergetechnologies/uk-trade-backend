const { PackageProduct, PaymentRequest, Plan } = require('../models');
const { AppError } = require('../utils/errors');
const { parsePagination, metaFor } = require('../utils/pagination');
const { getSignedDownloadUrl } = require('../services/cloudinary.service');
const { getAdminOverview, getAdminUserDetail, listAdminUsers, setAdminUserStatus, listAuditLogs } = require('../services/admin.service');

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
    const { rows, total } = await listAdminUsers({ page, limit, q, role, isActive });
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

module.exports = {
  adminOverview,
  adminListUsers,
  adminGetUser,
  adminSetUserStatus,
  adminListAuditLogs,
  adminGetPaymentProof,
  adminListPlans,
  adminCreatePlan,
  adminUpdatePlan,
  adminListPackages,
  adminCreatePackage,
  adminUpdatePackage,
};
