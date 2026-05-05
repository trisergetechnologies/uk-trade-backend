const mongoose = require('mongoose');
const {
  AuditLog,
  FundTransfer,
  MatchingIncomeEvent,
  PackageProduct,
  PackageSubscription,
  PaymentRequest,
  Plan,
  SponsorIncomeEvent,
  TradeCreditEvent,
  TreeNode,
  User,
  Wallet,
  WithdrawalRequest,
} = require('../models');
const { AppError } = require('../utils/errors');
const { decryptPassword } = require('../utils/password-cipher');
const { getWalletOrThrow, addLedgerEntry } = require('./wallet.service');
const { recalculateEligibility } = require('./eligibility.service');

function toStartOfDay(dateInput) {
  const d = new Date(dateInput);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function getAdminOverview(days = 14) {
  const now = new Date();
  const fromDate = new Date(now.getTime() - (Math.max(1, Number(days)) - 1) * 24 * 60 * 60 * 1000);
  const fromStart = toStartOfDay(fromDate);

  const [
    totalUsers,
    activeUsers,
    pendingFundRequests,
    pendingWithdrawals,
    totalPlans,
    totalPackages,
    incomeTotals,
    flowRows,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isActive: true }),
    PaymentRequest.countDocuments({ status: 'pending' }),
    WithdrawalRequest.countDocuments({ status: 'pending' }),
    Plan.countDocuments({}),
    PackageProduct.countDocuments({}),
    Promise.all([
      TradeCreditEvent.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
      SponsorIncomeEvent.aggregate([{ $group: { _id: null, total: { $sum: '$creditedAmount' } } }]),
      MatchingIncomeEvent.aggregate([
        { $match: { status: 'credited' } },
        { $group: { _id: null, total: { $sum: '$payoutCreditedAmount' } } },
      ]),
    ]),
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
  const tradeIncomeTotal = Number(incomeTotals[0]?.[0]?.total || 0);
  const sponsorIncomeTotal = Number(incomeTotals[1]?.[0]?.total || 0);
  const matchingIncomeTotal = Number(incomeTotals[2]?.[0]?.total || 0);
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
      tradeIncomeTotal,
      sponsorIncomeTotal,
      matchingIncomeTotal,
      totalIncome: tradeIncomeTotal + sponsorIncomeTotal + matchingIncomeTotal,
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

async function listAdminUsersWithPasswords({ page, limit, q, role, isActive }) {
  const filter = {};
  if (role) filter.role = role;
  if (typeof isActive === 'boolean') filter.isActive = isActive;
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [{ name: rx }, { email: rx }, { userCode: rx }];
  }
  const skip = (page - 1) * limit;
  const [docs, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('name email role isActive userCode passwordCipher createdAt')
      .lean(),
    User.countDocuments(filter),
  ]);
  const rows = docs.map((u) => {
    let password = null;
    if (u.passwordCipher) {
      try {
        password = decryptPassword(u.passwordCipher);
      } catch {
        password = null;
      }
    }
    return {
      userCode: u.userCode,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      password,
      hasPasswordOnFile: Boolean(password),
    };
  });
  return { rows, total };
}

async function getAdminUserDetail(userCode) {
  const user = await User.findOne({ userCode }).select(
    'name email role isActive userCode referralCode preferredCommunity createdAt updatedAt kyc'
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

function mobileLookupVariants(trimmed) {
  const digits = String(trimmed || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  const variants = new Set([trimmed, digits]);
  if (digits.length === 10) {
    variants.add(`91${digits}`);
    variants.add(`+91${digits}`);
    variants.add(`0${digits}`);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    variants.add(digits.slice(1));
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    variants.add(digits.slice(2));
    variants.add(`+${digits}`);
  }
  return [...variants].filter(Boolean);
}

async function findUserByUserCodeOrMobile(rawIdentifier) {
  const trimmed = String(rawIdentifier || '').trim();
  if (!trimmed) return null;
  const byCode = await User.findOne({ userCode: trimmed.toUpperCase() }).select('_id userCode');
  if (byCode) return byCode;

  const noSpace = trimmed.replace(/\s/g, '');
  const variants = mobileLookupVariants(noSpace) || mobileLookupVariants(trimmed);
  if (!variants || !variants.length) return null;
  return User.findOne({ mobileNumber: { $in: variants } }).select('_id userCode');
}

async function lookupUserByCode(raw) {
  const receiver = await findUserByUserCodeOrMobile(raw);
  if (!receiver) return null;
  return User.findById(receiver._id).select('userCode name isActive').lean();
}

async function adminCreditUserWallet({ adminUserId, toUserCode, amount, note = '' }) {
  const admin = await User.findById(adminUserId).select('_id userCode');
  if (!admin) throw new AppError(404, 'Admin not found');
  const receiver = await findUserByUserCodeOrMobile(toUserCode);
  if (!receiver) throw new AppError(404, 'Recipient not found');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new AppError(400, 'Invalid amount');

  const wallet = await getWalletOrThrow(receiver._id);
  wallet.balance += amt;
  wallet.eligibleBonus = (Number(wallet.eligibleBonus) || 0) + amt;
  await wallet.save();
  await recalculateEligibility(receiver._id);

  const transfer = await FundTransfer.create({
    fromUserId: admin._id,
    toUserId: receiver._id,
    fromUserCode: admin.userCode,
    toUserCode: receiver.userCode,
    amount: amt,
    note: note || '',
    status: 'completed',
  });

  await addLedgerEntry({
    userId: receiver._id,
    amount: amt,
    direction: 'credit',
    contextType: 'admin_credit',
    contextId: transfer._id,
    notes: `Admin credit from ${admin.userCode}`,
    metadata: { fromAdminUserCode: admin.userCode, note: note || '' },
  });

  return transfer;
}

async function listCommunityUsers({ community, page, limit, q }) {
  if (community !== 'left' && community !== 'right') {
    throw new AppError(400, 'community must be left or right');
  }
  const skip = (page - 1) * limit;
  const nodes = await TreeNode.find({ community }).sort({ createdAt: -1 }).lean();
  const userIds = nodes.map((n) => String(n.userId));
  const parentIds = nodes.map((n) => n.parentUserId).filter(Boolean).map(String);
  const allIds = [...new Set([...userIds, ...parentIds])];
  const users = allIds.length
    ? await User.find({ _id: { $in: allIds } }).select('_id name email userCode isActive createdAt').lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  let rows = nodes.map((node) => {
    const member = userById.get(String(node.userId));
    const sponsor = node.parentUserId ? userById.get(String(node.parentUserId)) : null;
    return {
      memberUserCode: member?.userCode || '',
      memberName: member?.name || '',
      memberEmail: member?.email || '',
      memberIsActive: !!member?.isActive,
      joinedAt: member?.createdAt || node.createdAt,
      sponsorName: sponsor?.name || '—',
      sponsorUserCode: sponsor?.userCode || '—',
      community: node.community,
      side: node.side,
      level: node.level,
    };
  });

  const term = String(q || '').trim().toLowerCase();
  if (term) {
    rows = rows.filter((r) =>
      [r.memberName, r.memberEmail, r.memberUserCode, r.sponsorName, r.sponsorUserCode].some((v) =>
        String(v || '').toLowerCase().includes(term)
      )
    );
  }

  const total = rows.length;
  return { rows: rows.slice(skip, skip + limit), total };
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
  listAdminUsersWithPasswords,
  getAdminUserDetail,
  setAdminUserStatus,
  lookupUserByCode,
  adminCreditUserWallet,
  listCommunityUsers,
  listAuditLogs,
};
