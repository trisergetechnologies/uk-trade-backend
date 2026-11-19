const mongoose = require('mongoose');
const { createWithdrawalRequest, reviewWithdrawalRequest } = require('../services/withdrawal.service');
const { WithdrawalRequest } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');

const WITHDRAWAL_STATUSES = new Set(['pending', 'approved', 'rejected']);

function redactWithdrawalBankSnapshot(doc) {
  const row = doc?.toObject ? doc.toObject() : { ...doc };
  if (row.bankSnapshot && typeof row.bankSnapshot === 'object') {
    const { accountNumber, ...rest } = row.bankSnapshot;
    row.bankSnapshot = rest;
  }
  return row;
}

async function requestWithdrawal(req, res, next) {
  try {
    const result = await createWithdrawalRequest(req.user.sub, req.validated.body.amount);
    res.status(201).json({ success: true, data: redactWithdrawalBankSnapshot(result) });
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
    res.json({
      success: true,
      data: list.map(redactWithdrawalBankSnapshot),
      meta: metaFor(page, limit, total),
    });
  } catch (error) {
    next(error);
  }
}

async function adminWithdrawalSummary(req, res, next) {
  try {
    const rows = await WithdrawalRequest.aggregate([
      { $match: { status: { $in: ['pending', 'approved'] } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          gross: { $sum: '$amount' },
          netPayable: { $sum: '$netPayable' },
          tds: { $sum: '$tdsAmount' },
          handling: { $sum: '$handlingAmount' },
        },
      },
    ]);
    const empty = { count: 0, gross: 0, netPayable: 0, tds: 0, handling: 0 };
    const byStatus = { pending: { ...empty }, approved: { ...empty } };
    for (const row of rows) {
      if (row._id === 'pending' || row._id === 'approved') {
        byStatus[row._id] = {
          count: Number(row.count) || 0,
          gross: Number(row.gross) || 0,
          netPayable: Number(row.netPayable) || 0,
          tds: Number(row.tds) || 0,
          handling: Number(row.handling) || 0,
        };
      }
    }
    res.json({
      success: true,
      data: {
        pending: byStatus.pending,
        approved: byStatus.approved,
      },
    });
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
    const q = String(req.query.q || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [{ reviewReason: rx }, { publicId: rx }];
    }
    const [list, total] = await Promise.all([
      WithdrawalRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email userCode bankAccount'),
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
  adminWithdrawalSummary,
  adminListWithdrawals,
  adminReviewWithdrawal,
};
