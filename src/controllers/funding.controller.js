const { createPaymentRequest, reviewPaymentRequest } = require('../services/payment.service');
const { PaymentRequest, AuditLog } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');
const { AppError } = require('../utils/errors');
const { uploadPaymentProof } = require('../services/cloudinary.service');

async function createFundRequest(req, res, next) {
  try {
    let screenshotAsset = null;
    if (req.file?.buffer) {
      screenshotAsset = await uploadPaymentProof(req.file.buffer, req.file.originalname);
    }
    if (!screenshotAsset && !req.validated.body.screenshotUrl) {
      throw new AppError(400, 'Payment screenshot is required');
    }
    const request = await createPaymentRequest(req.user.sub, { ...req.validated.body, screenshotAsset });
    res.status(201).json({ success: true, data: request });
  } catch (error) {
    next(error);
  }
}

async function listMyFundRequests(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = { userId: req.user.sub };
    const [list, total] = await Promise.all([
      PaymentRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      PaymentRequest.countDocuments(filter),
    ]);
    const data = list.map((row) => ({
      ...row.toObject(),
      paymentProofPath: row.screenshotAsset?.publicId || row.screenshotUrl ? `/api/admin/media/payment-proof/${row.publicId}` : '',
    }));
    res.json({
      success: true,
      data,
      meta: metaFor(page, limit, total),
    });
  } catch (error) {
    next(error);
  }
}

async function adminListFundRequests(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    const status = String(req.query.status || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (['pending', 'approved', 'rejected'].includes(status)) filter.status = status;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [{ publicId: rx }, { notes: rx }, { reviewReason: rx }];
    }
    const [list, total] = await Promise.all([
      PaymentRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email'),
      PaymentRequest.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: list,
      meta: metaFor(page, limit, total),
    });
  } catch (error) {
    next(error);
  }
}

async function adminReviewFundRequest(req, res, next) {
  try {
    const result = await reviewPaymentRequest(req.user.sub, req.validated.params.id, req.validated.body);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function adminGetFundRequest(req, res, next) {
  try {
    const id = req.validated.params.id;
    const request = await PaymentRequest.findOne({ publicId: id }).populate('userId', 'name email userCode');
    if (!request) {
      res.status(404).json({ success: false, message: 'Payment request not found' });
      return;
    }
    const audit = await AuditLog.find({ targetType: 'PaymentRequest', targetId: request._id }).sort({ createdAt: -1 }).limit(50);
    const requestData = request.toObject();
    requestData.paymentProofPath = request.screenshotAsset?.publicId || request.screenshotUrl ? `/api/admin/media/payment-proof/${request.publicId}` : '';
    res.json({ success: true, data: { request: requestData, audit } });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createFundRequest,
  listMyFundRequests,
  adminListFundRequests,
  adminGetFundRequest,
  adminReviewFundRequest,
};
