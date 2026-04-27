const { createPaymentRequest, reviewPaymentRequest } = require('../services/payment.service');
const { PaymentRequest, AuditLog } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');

async function createFundRequest(req, res, next) {
  try {
    const request = await createPaymentRequest(req.user.sub, req.validated.body);
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
    res.json({
      success: true,
      data: list,
      meta: metaFor(page, limit, total),
    });
  } catch (error) {
    next(error);
  }
}

async function adminListFundRequests(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const [list, total] = await Promise.all([
      PaymentRequest.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email'),
      PaymentRequest.countDocuments({}),
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
    res.json({ success: true, data: { request, audit } });
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
