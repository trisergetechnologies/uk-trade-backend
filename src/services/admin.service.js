const mongoose = require('mongoose');
const { AuditLog, PaymentRequest, User, WithdrawalRequest, Plan, PackageProduct, Wallet, PackageSubscription } = require('../models');

function toStartOfDay(dateInput) {
  const d = new Date(dateInput);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function getAdminOverview(days = 14) {
  const now = new Date();
  const fromDate = new Date(now.getTime() - (Math.max(1, Number(days)) - 1) * 24 * 60 * 60 * 1000);
  const fromStart = toStartOfDay(fromDate);

  const [totalUsers, activeUsers, pendingFundRequests, pendingWithdrawals, totalPlans, totalPackages, flowRows] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isActive: true }),
    PaymentRequest.countDocuments({ status: 'pending' }),
    WithdrawalRequest.countDocuments({ status: 'pending' }),
    Plan.countDocuments({}),
    PackageProduct.countDocuments({}),
    Promise.all([
      PaymentRequest.aggregate([
        { $match: { createdAt: { $gte: fromStart } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, value: { $sum: '$approvedAmount' } } },
      ]),
      PackageSubscription.aggregate([
        { $match: { createdAt: { $gte: fromStart } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, value: { $sum: '$principalAmount' } } },
      ]),
      WithdrawalRequest.aggregate([
        { $match: { status: 'approved', createdAt: { $gte: fromStart } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, value: { $sum: '$amount' } } },
      ]),
    ]),
  ]);

  const fundRequestsByDay = new Map(flowRows[0].map((r) => [r._id, Number(r.value || 0)]));
  const purchaseAmountByDay = new Map(flowRows[1].map((r) => [r._id, Number(r.value || 0)]));
  const approvedWithdrawalsByDay = new Map(flowRows[2].map((r) => [r._id, Number(r.value || 0)]));
  const series = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(fromStart.getTime() + i * 24 * 60 * 60 * 1000);
    const label = d.toISOString().slice(0, 10);
    series.push({
      day: label,
      fundRequestsAmount: fundRequestsByDay.get(label) || 0,
      purchaseAmount: purchaseAmountByDay.get(label) || 0,
      approvedWithdrawalsOut: approvedWithdrawalsByDay.get(label) || 0,
    });
  }

  return {
    totals: {
      totalUsers,
      activeUsers,
      inactiveUsers: Math.max(0, totalUsers - activeUsers),
      pendingFundRequests,
      pendingWithdrawals,
      totalPlans,
      totalPackages,
    },
    series,
  };
}

async function listAdminUsers({ page, limit, q, role, isActive }) {
  const filter = {};
  if (role) filter.role = role;
  if (typeof isActive === 'boolean') filter.isActive = isActive;
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [{ name: rx }, { email: rx }, { userCode: rx }];
  }
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('name email role isActive userCode createdAt updatedAt'),
    User.countDocuments(filter),
  ]);
  return { rows, total };
}

async function getAdminUserDetail(userCode) {
  const user = await User.findOne({ userCode }).select(
    'name email role isActive userCode referralCode preferredCommunity createdAt updatedAt'
  );
  if (!user) return null;
  const [wallet, fundStats, withdrawalStats] = await Promise.all([
    Wallet.findOne({ userId: user._id }).select('balance eligibleToWithdraw updatedAt'),
    PaymentRequest.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    WithdrawalRequest.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
  ]);
  return { user, wallet, fundStats, withdrawalStats };
}

async function setAdminUserStatus(userCode, isActive) {
  return User.findOneAndUpdate({ userCode }, { $set: { isActive: Boolean(isActive) } }, { new: true }).select(
    'name email role isActive userCode updatedAt'
  );
}

async function listAuditLogs({ page, limit, action, targetType, actorUserCode, from, to }) {
  const filter = {};
  if (action) filter.action = action;
  if (targetType) filter.targetType = targetType;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (actorUserCode) {
    const actor = await User.findOne({ userCode: actorUserCode }).select('_id');
    filter.actorUserId = actor?._id || new mongoose.Types.ObjectId('000000000000000000000000');
  }
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actorUserId', 'name email userCode'),
    AuditLog.countDocuments(filter),
  ]);
  return { rows, total };
}

module.exports = {
  getAdminOverview,
  listAdminUsers,
  getAdminUserDetail,
  setAdminUserStatus,
  listAuditLogs,
};
