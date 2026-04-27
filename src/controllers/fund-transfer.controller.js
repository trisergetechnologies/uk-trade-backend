const { FundTransfer } = require('../models');
const { parsePagination, metaFor } = require('../utils/pagination');
const { createFundTransfer } = require('../services/fund-transfer.service');

async function transferToUser(req, res, next) {
  try {
    const row = await createFundTransfer({
      fromUserId: req.user.sub,
      toUserCode: req.validated.body.toUserCode,
      amount: req.validated.body.amount,
      note: req.validated.body.note || '',
    });
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
}

async function myTransfers(req, res, next) {
  try {
    const { page, limit, skip } = parsePagination(req);
    const type = String(req.query.type || 'all').toLowerCase();
    const query = String(req.query.q || '').trim().toUpperCase();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const filter = {};
    if (type === 'sent') filter.fromUserId = req.user.sub;
    else if (type === 'received') filter.toUserId = req.user.sub;
    else filter.$or = [{ fromUserId: req.user.sub }, { toUserId: req.user.sub }];
    if (query) {
      const codeRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$and = [
        ...(filter.$and || []),
        { $or: [{ fromUserCode: codeRegex }, { toUserCode: codeRegex }, { note: codeRegex }] },
      ];
    }
    if (from || to) {
      const createdAt = {};
      if (from) createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
      filter.$and = [...(filter.$and || []), { createdAt }];
    }

    const [rows, total] = await Promise.all([
      FundTransfer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      FundTransfer.countDocuments(filter),
    ]);
    res.json({ success: true, data: rows, meta: metaFor(page, limit, total) });
  } catch (error) {
    next(error);
  }
}

module.exports = { transferToUser, myTransfers };
