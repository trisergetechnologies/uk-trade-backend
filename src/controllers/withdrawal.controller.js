const mongoose = require('mongoose');
const { createWithdrawalRequest, reviewWithdrawalRequest } = require('../services/withdrawal.service');
const { WithdrawalRequest } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');

const WITHDRAWAL_STATUSES = new Set(['pending', 'approved', 'rejected']);

async function requestWithdrawal(req, res, next) {
  try {
    const result = await createWithdrawalRequest(req.user.sub, req.validated.body.amount);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function myWithdrawalSummary(req, res, next) {
  try {
    const uid = new mongoose.Types.ObjectId(req.user.sub);
    const [row] = await WithdrawalRequest.aggregate([
      { $match: { userId: uid, status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    res.json({ success: true, data: { approvedTotal: row?.total ?? 0 } });
  } catch (error) {
    next(error);
  }
}

async function listMyWithdrawals(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = { userId: req.user.sub };
    const status = String(req.query.status || '').toLowerCase();
    if (WITHDRAWAL_STATUSES.has(status)) {
      filter.status = status;
    }
    const [list, total] = await Promise.all([
      WithdrawalRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      WithdrawalRequest.countDocuments(filter),
    ]);
    res.json({ success: true, data: list, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

async function adminListWithdrawals(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    const status = String(req.query.status || '').toLowerCase();
    if (WITHDRAWAL_STATUSES.has(status)) {
      filter.status = status;
    }
    const [list, total] = await Promise.all([
      WithdrawalRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email'),
      WithdrawalRequest.countDocuments(filter),
    ]);
    res.json({ success: true, data: list, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

async function adminReviewWithdrawal(req, res, next) {
  try {
    const row = await reviewWithdrawalRequest(req.user.sub, req.validated.params.id, req.validated.body.status, req.validated.body.reason);
    res.json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requestWithdrawal,
  myWithdrawalSummary,
  listMyWithdrawals,
  adminListWithdrawals,
  adminReviewWithdrawal,
};
